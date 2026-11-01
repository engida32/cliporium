import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {ClipboardReader} from './src/clipboard.js';
import {History} from './src/history.js';
import {HistoryStorage} from './src/storage.js';

const CLIPBOARD = St.ClipboardType.CLIPBOARD;
const TEXT_MIME = 'text/plain;charset=utf-8';
const MAX_VISIBLE_ITEMS = 25;
const KEYBINDING_NAME = 'toggle-popup';

export default class CliporiumExtension extends Extension {
    enable() {
        this._indicator = new CliporiumIndicator(this);
        Main.panel.addToStatusArea('cliporium', this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}

const CliporiumIndicator = GObject.registerClass({
    GTypeName: 'CliporiumIndicator',
}, class CliporiumIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'Cliporium', false);

        this._extension = extension;
        this._settings = extension.getSettings();
        this._clipboard = St.Clipboard.get_default();
        this._reader = new ClipboardReader();
        this._history = new History();
        this._storage = new HistoryStorage({
            history: this._history,
            onLoaded: () => this._onHistoryLoaded(),
            onWarning: message => this._onStorageWarning(message),
            onError: error => this._onStorageError(error),
        });

        this._selection = null;
        this._selectionId = 0;
        this._captureTimeout = 0;
        this._focusTimeout = 0;
        this._searchTimeout = 0;
        this._settingsIds = [];
        this._shortcutBound = false;
        this._destroyed = false;
        this._historyReady = false;
        this._warning = '';
        this._items = [];
        this._visibleItems = [];
        this._resultItems = [];
        this._selectedIndex = 0;

        this.add_child(new St.Icon({
            icon_name: 'edit-paste-symbolic',
            style_class: 'system-status-icon',
        }));

        this._applySettings();
        this._buildMenu();
        this._connectSettings();
        this._connectSelection();
        this._bindShortcut();
        this.visible = this._settings.get_boolean('show-indicator');
        this._storage.load();
    }

    _applySettings() {
        this._history.setOptions({
            limit: this._settings.get_int('history-limit'),
            maxBytes: this._settings.get_int('max-content-size'),
            retentionDays: this._settings.get_int('retention-days'),
        });
    }

    _buildMenu() {
        this.menu.box.add_style_class_name('cliporium-menu');

        const searchItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        this._search = new St.Entry({
            name: 'cliporiumSearch',
            style_class: 'cliporium-search',
            can_focus: true,
            x_expand: true,
            hint_text: 'Search clipboard history',
            primary_icon: new St.Icon({icon_name: 'edit-find-symbolic'}),
        });
        const clutterText = this._search.get_clutter_text();
        clutterText.connect('text-changed', () => this._scheduleSearch());
        clutterText.connect('key-press-event', (_actor, event) =>
            this._onSearchKey(event.get_key_symbol()));
        searchItem.add_child(this._search);
        this.menu.addMenuItem(searchItem);

        this._results = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._results);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._manage = new PopupMenu.PopupSubMenuMenuItem('Clear history', true);
        this._manage.icon.icon_name = 'edit-delete-symbolic';
        const clearUnpinned = new PopupMenu.PopupMenuItem('Clear unpinned items');
        clearUnpinned.connect('activate', () => this._clearUnpinned());
        this._manage.menu.addMenuItem(clearUnpinned);

        const clearAll = new PopupMenu.PopupSubMenuMenuItem('Clear all items…', false);
        const warning = new PopupMenu.PopupMenuItem(
            'This deletes pinned items too and cannot be undone.',
            {reactive: false, can_focus: false}
        );
        warning.add_style_class_name('cliporium-warning');
        clearAll.menu.addMenuItem(warning);
        const confirm = new PopupMenu.PopupMenuItem('Confirm: delete everything');
        confirm.connect('activate', () => this._clearAll());
        clearAll.menu.addMenuItem(confirm);
        this._manage.menu.addMenuItem(clearAll);
        this.menu.addMenuItem(this._manage);

        this._status = new PopupMenu.PopupMenuItem('Loading clipboard history…', {
            reactive: false,
            can_focus: false,
        });
        this.menu.addMenuItem(this._status);

        const footer = new PopupMenu.PopupMenuItem(
            '↑↓ Select   ·   Enter Copy   ·   Esc Clear or Close',
            {reactive: false, can_focus: false}
        );
        footer.add_style_class_name('cliporium-footer');
        this.menu.addMenuItem(footer);

        this.menu.connect('open-state-changed', (_menu, open) => {
            if (!open)
                return;
            this._search.set_text('');
            this._selectedIndex = 0;
            this._focusTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                this._focusTimeout = 0;
                global.stage.set_key_focus(this._search);
                return GLib.SOURCE_REMOVE;
            });
            this._refresh();
        });
    }

    _onSearchKey(symbol) {
        if (symbol === Clutter.KEY_Escape) {
            if (this._search.get_text().length > 0) {
                this._search.set_text('');
                this._refresh();
            } else {
                this.menu.close();
            }
            return Clutter.EVENT_STOP;
        }
        if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
            this._activateSelected();
            return Clutter.EVENT_STOP;
        }
        if (symbol === Clutter.KEY_Up) {
            this._moveSelection(-1);
            return Clutter.EVENT_STOP;
        }
        if (symbol === Clutter.KEY_Down) {
            this._moveSelection(1);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _connectSettings() {
        for (const key of [
            'history-limit',
            'max-content-size',
            'retention-days',
        ]) {
            this._settingsIds.push(this._settings.connect(`changed::${key}`, () => {
                this._applySettings();
                if (this._historyReady)
                    this._storage.scheduleSave();
                this._refresh();
            }));
        }

        for (const key of ['capture-enabled', 'private-mode']) {
            this._settingsIds.push(this._settings.connect(`changed::${key}`, () => {
                this._refresh();
            }));
        }

        this._settingsIds.push(this._settings.connect('changed::show-indicator', () => {
            const show = this._settings.get_boolean('show-indicator');
            this.visible = show;
            if (!show)
                this.menu.close();
        }));

        this._settingsIds.push(this._settings.connect('changed::toggle-popup', () => {
            this._bindShortcut();
        }));
    }

    _connectSelection() {
        this._selection = Shell.Global.get().get_display().get_selection();
        this._selectionId = this._selection.connect('owner-changed', (
            _selection,
            selectionType,
        ) => {
            if (selectionType !== Meta.SelectionType.SELECTION_CLIPBOARD)
                return;
            if (this._captureTimeout)
                GLib.source_remove(this._captureTimeout);
            this._captureTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
                this._captureTimeout = 0;
                this._captureClipboard().catch(() => {});
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    _bindShortcut() {
        if (this._shortcutBound) {
            Main.wm.removeKeybinding(KEYBINDING_NAME);
            this._shortcutBound = false;
        }

        const accelerators = this._settings.get_strv('toggle-popup')
            .filter(accelerator => accelerator.length > 0);
        if (accelerators.length === 0)
            return;

        try {
            Main.wm.addKeybinding(
                KEYBINDING_NAME,
                this._settings,
                Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.ALL,
                () => this._toggleMenu()
            );
            this._shortcutBound = true;
        } catch {
            this._shortcutBound = false;
        }
    }

    _toggleMenu() {
        if (this.menu.isOpen)
            this.menu.close();
        else
            this.menu.open();
    }

    _sourceApp() {
        const window = Shell.Global.get().display.focusWindow;
        return window?.get_wm_class?.() ?? '';
    }

    async _captureClipboard() {
        if (this._destroyed)
            return;
        if (!this._historyReady)
            return;
        if (!this._settings.get_boolean('capture-enabled') ||
            this._settings.get_boolean('private-mode'))
            return;

        const {text, tooLarge} = await this._reader.readText(
            this._settings.get_int('max-content-size')
        );
        if (this._destroyed)
            return;
        if (!this._settings.get_boolean('capture-enabled') ||
            this._settings.get_boolean('private-mode'))
            return;
        if (tooLarge) {
            this._setStatus('Clipboard item is larger than the configured limit.');
            return;
        }
        if (!text)
            return;

        const result = this._history.captureText(text, this._sourceApp());
        if (result.added || result.reason === 'duplicate') {
            this._storage.scheduleSave();
            if (this.menu.isOpen)
                this._refresh();
        }
    }

    _onHistoryLoaded() {
        if (this._destroyed)
            return;
        this._historyReady = true;
        this._refresh();
        this._captureClipboard().catch(() => {});
    }

    _onStorageWarning(message) {
        this._warning = message;
        if (this.menu.isOpen)
            this._refresh();
        else
            this._setStatus(message);
    }

    _onStorageError(error) {
        this._warning = `History storage error: ${error.message}`;
        if (this.menu.isOpen)
            this._refresh();
        else
            this._setStatus(this._warning);
    }

    _scheduleSearch() {
        if (this._searchTimeout)
            GLib.source_remove(this._searchTimeout);
        this._searchTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 120, () => {
            this._searchTimeout = 0;
            this._refresh();
            return GLib.SOURCE_REMOVE;
        });
    }

    _refresh() {
        if (this._destroyed || !this._status)
            return;

        const selectedId = this._visibleItems[this._selectedIndex]?.id;
        const query = this._search?.get_text() ?? '';
        this._items = this._history.getItems(query);
        this._visibleItems = this._items.slice(0, MAX_VISIBLE_ITEMS);
        const nextIndex = selectedId
            ? this._visibleItems.findIndex(item => item.id === selectedId)
            : -1;
        this._selectedIndex = nextIndex >= 0
            ? nextIndex
            : Math.min(this._selectedIndex, Math.max(0, this._visibleItems.length - 1));
        this._render(query);
    }

    _clearResults() {
        for (const menuItem of this._resultItems)
            menuItem.destroy();
        this._resultItems = [];
    }

    _render(query) {
        this._clearResults();

        for (const item of this._visibleItems) {
            const menuItem = new PopupMenu.PopupSubMenuMenuItem(
                this._itemLabel(item),
                true
            );
            menuItem.icon.icon_name = 'text-x-generic-symbolic';
            if (item.pinned)
                menuItem.setOrnament(PopupMenu.Ornament.DOT);

            const copy = new PopupMenu.PopupMenuItem('Copy');
            copy.connect('activate', () => this._copy(item));
            menuItem.menu.addMenuItem(copy);

            const pin = new PopupMenu.PopupMenuItem(item.pinned ? 'Unpin' : 'Pin');
            pin.connect('activate', () => this._setPinned(item, !item.pinned));
            menuItem.menu.addMenuItem(pin);

            const remove = new PopupMenu.PopupMenuItem('Delete');
            remove.connect('activate', () => this._delete(item));
            menuItem.menu.addMenuItem(remove);

            this._results.addMenuItem(menuItem);
            this._resultItems.push(menuItem);
        }

        if (this._resultItems.length > 0)
            this._resultItems[this._selectedIndex]?.add_style_class_name(
                'cliporium-selected'
            );

        this._renderStatus(query);
    }

    _renderStatus(query) {
        let status;
        if (!this._historyReady) {
            status = 'Loading clipboard history…';
        } else if (this._visibleItems.length === 0) {
            status = query
                ? 'No matching clipboard items.'
                : 'No clipboard items yet. Copy text to start.';
        } else {
            const count = this._items.length;
            const pinned = this._items.filter(item => item.pinned).length;
            status = `${count} item${count === 1 ? '' : 's'}`;
            if (pinned > 0)
                status += ` · ${pinned} pinned`;
        }

        if (this._warning)
            status = this._warning;
        if (this._settings.get_boolean('private-mode'))
            status += ' · Private mode';
        if (!this._settings.get_boolean('capture-enabled'))
            status += ' · Capture off';

        this._setStatus(status);
    }

    _itemLabel(item) {
        const firstLine = (item.text ?? item.preview ?? '').split('\n')[0].trim();
        const suffix = item.pinned ? '  ·  Pinned' : '';
        const label = firstLine.length > 90
            ? `${firstLine.slice(0, 90)}…`
            : firstLine;
        return `${label}${suffix}`;
    }

    _setStatus(text) {
        if (this._status)
            this._status.label.text = text;
    }

    _moveSelection(delta) {
        if (this._visibleItems.length === 0)
            return;
        this._selectedIndex = (
            this._selectedIndex + delta + this._visibleItems.length
        ) % this._visibleItems.length;
        for (const item of this._resultItems)
            item.remove_style_class_name('cliporium-selected');
        this._resultItems[this._selectedIndex]?.add_style_class_name(
            'cliporium-selected'
        );
    }

    _activateSelected() {
        const item = this._visibleItems[this._selectedIndex] ??
            this._visibleItems[0];
        if (item)
            this._copy(item);
    }

    _copy(item) {
        this._clipboard.set_content(
            CLIPBOARD,
            TEXT_MIME,
            GLib.Bytes.new(new TextEncoder().encode(item.text))
        );
        this.menu.close();
    }

    _setPinned(item, pinned) {
        if (!this._history.setPinned(item.id, pinned))
            return;
        this._storage.scheduleSave();
        this._refresh();
    }

    _delete(item) {
        if (!this._history.delete(item.id))
            return;
        this._storage.scheduleSave();
        this._refresh();
    }

    _clearUnpinned() {
        this._history.clearUnpinned();
        this._storage.scheduleSave();
        this._refresh();
    }

    _clearAll() {
        this._history.clearAll();
        this._storage.scheduleSave();
        this._refresh();
    }

    destroy() {
        this._destroyed = true;
        this._storage.destroy();

        if (this._shortcutBound) {
            Main.wm.removeKeybinding(KEYBINDING_NAME);
            this._shortcutBound = false;
        }

        if (this._selectionId) {
            this._selection.disconnect(this._selectionId);
            this._selectionId = 0;
        }

        for (const id of this._settingsIds)
            this._settings.disconnect(id);
        this._settingsIds = [];

        for (const id of [
            this._captureTimeout,
            this._focusTimeout,
            this._searchTimeout,
        ]) {
            if (id)
                GLib.source_remove(id);
        }
        this._captureTimeout = 0;
        this._focusTimeout = 0;
        this._searchTimeout = 0;

        super.destroy();
    }
});
