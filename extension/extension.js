import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

Gio._promisify(Gio.DBusConnection.prototype, 'call');

const SERVICE_NAME = 'io.github.cliporium.Cliporium';
const OBJECT_PATH = '/io/github/cliporium/Cliporium';
const INTERFACE = 'io.github.cliporium.Cliporium';
const CLIPBOARD = St.ClipboardType.CLIPBOARD;
const TEXT_MIME = 'text/plain;charset=utf-8';
const TEXT_MIMES = [TEXT_MIME, 'UTF8_STRING', 'text/plain', 'STRING'];
const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

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
        this._clipboard = St.Clipboard.get_default();
        this._selection = null;
        this._selectionId = 0;
        this._captureTimeout = 0;
        this._focusTimeout = 0;
        this._searchTimeout = 0;
        this._requestId = 0;
        this._items = [];
        this._resultItems = [];
        this._destroyed = false;

        this.add_child(new St.Icon({
            icon_name: 'edit-paste-symbolic',
            style_class: 'system-status-icon',
        }));

        this._buildMenu();
        this._connectSelection();
        this._refresh();
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
        clutterText.connect('key-press-event', (_actor, event) => {
            const symbol = event.get_key_symbol();
            if (symbol === Clutter.KEY_Escape) {
                this.menu.close();
                return Clutter.EVENT_STOP;
            }
            if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
                this._activateFirst();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        searchItem.add_child(this._search);
        this.menu.addMenuItem(searchItem);

        this._results = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._results);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._status = new PopupMenu.PopupMenuItem('Loading clipboard history…', {
            reactive: false,
            can_focus: false,
        });
        this.menu.addMenuItem(this._status);

        const footer = new PopupMenu.PopupMenuItem('Enter Copy   ·   Esc Close', {
            reactive: false,
            can_focus: false,
        });
        footer.add_style_class_name('cliporium-footer');
        this.menu.addMenuItem(footer);

        this.menu.connect('open-state-changed', (_menu, open) => {
            if (!open)
                return;
            this._search.set_text('');
            this._focusTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                this._focusTimeout = 0;
                global.stage.set_key_focus(this._search);
                return GLib.SOURCE_REMOVE;
            });
            this._refresh();
        });
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
                this._captureClipboard().catch(error => {
                    console.error(`Cliporium: capture failed: ${error}`);
                });
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    _sourceApp() {
        const window = Shell.Global.get().display.focusWindow;
        return window?.get_wm_class?.() ?? '';
    }

    async _captureClipboard() {
        const text = await this._readText();
        if (text) {
            await this._captureText(text);
            return;
        }
        const image = await this._readImage();
        if (image)
            await this._captureImage(image);
    }

    async _readText() {
        for (const mime of TEXT_MIMES) {
            const bytes = await this._readContent(mime);
            if (bytes && bytes.get_size() > 0)
                return new TextDecoder().decode(bytes.get_data());
        }
        return null;
    }

    async _readImage() {
        for (const mime of IMAGE_MIMES) {
            const bytes = await this._readContent(mime);
            if (bytes && bytes.get_size() > 0)
                return {mime, bytes: bytes.get_data()};
        }
        return null;
    }

    _readContent(mime) {
        return new Promise(resolve => {
            this._clipboard.get_content(CLIPBOARD, mime, (_clipboard, bytes) => {
                resolve(bytes);
            });
        });
    }

    async _captureText(text) {
        try {
            await this._call(
                'CaptureText',
                new GLib.Variant('(ss)', [text, this._sourceApp()]),
                '(s)'
            );
            if (this.menu.isOpen)
                this._refresh();
        } catch (error) {
            this._showOffline(error);
        }
    }

    async _captureImage(image) {
        try {
            await this._call(
                'CaptureImage',
                new GLib.Variant('(ayss)', [image.bytes, image.mime, this._sourceApp()]),
                '(s)'
            );
            if (this.menu.isOpen)
                this._refresh();
        } catch (error) {
            this._showOffline(error);
        }
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

    async _refresh() {
        const requestId = ++this._requestId;
        const query = this._search?.get_text() ?? '';
        try {
            const reply = query
                ? await this._call(
                    'Search',
                    new GLib.Variant('(su)', [query, 50]),
                    '(s)'
                )
                : await this._call(
                    'Recent',
                    new GLib.Variant('(u)', [50]),
                    '(s)'
                );
            if (this._destroyed || requestId !== this._requestId)
                return;
            const [json] = reply.deep_unpack();
            this._items = JSON.parse(json);
            this._render();
        } catch (error) {
            if (!this._destroyed)
                this._showOffline(error);
        }
    }

    _clearResults() {
        for (const menuItem of this._resultItems)
            menuItem.destroy();
        this._resultItems = [];
    }

    _render() {
        this._clearResults();
        if (!this._items.length) {
            this._setStatus('No clipboard items yet');
            return;
        }

        for (const item of this._items.slice(0, 25)) {
            const menuItem = new PopupMenu.PopupMenuItem(this._itemLabel(item));
            if (item.pinned)
                menuItem.setOrnament(PopupMenu.Ornament.DOT);
            menuItem.connect('activate', () => {
                this._activate(item).catch(error => {
                    console.error(`Cliporium: copy failed: ${error}`);
                });
            });
            this._results.addMenuItem(menuItem);
            this._resultItems.push(menuItem);
        }
        this._setStatus(
            `${this._items.length} item${this._items.length === 1 ? '' : 's'}`
        );
    }

    _itemLabel(item) {
        if (item.kind === 'image')
            return `Image · ${item.mime ?? 'unknown type'}`;
        const firstLine = (item.text ?? item.preview ?? '').split('\n')[0];
        return firstLine.length > 90 ? `${firstLine.slice(0, 90)}…` : firstLine;
    }

    _setStatus(text) {
        if (this._status)
            this._status.label.text = text;
    }

    _showOffline(error) {
        console.error(`Cliporium: daemon unavailable: ${error}`);
        this._items = [];
        this._clearResults();
        this._setStatus('Daemon offline. Start cliporium-daemon.');
    }

    _activateFirst() {
        if (this._items.length)
            this._activate(this._items[0]);
    }

    async _activate(item) {
        if (item.kind === 'image') {
            const reply = await this._call(
                'GetBlob',
                new GLib.Variant('(s)', [item.id]),
                '(ay)'
            );
            const bytes = reply.get_child_value(0).get_data();
            this._clipboard.set_content(
                CLIPBOARD,
                item.mime ?? 'image/png',
                GLib.Bytes.new(bytes)
            );
        } else {
            const text = item.text ?? '';
            this._clipboard.set_content(
                CLIPBOARD,
                TEXT_MIME,
                GLib.Bytes.new(new TextEncoder().encode(text))
            );
        }
        this.menu.close();
    }

    async _call(method, parameters, replyType) {
        return await Gio.DBus.session.call(
            SERVICE_NAME,
            OBJECT_PATH,
            INTERFACE,
            method,
            parameters,
            new GLib.VariantType(replyType),
            Gio.DBusCallFlags.NONE,
            5000,
            null
        );
    }

    destroy() {
        this._destroyed = true;
        if (this._selectionId) {
            this._selection.disconnect(this._selectionId);
            this._selectionId = 0;
        }
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
