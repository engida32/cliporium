import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as AnimationUtils from 'resource:///org/gnome/shell/misc/animationUtils.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {ClipboardReader} from './src/clipboard.js';
import {payloadForItem} from './src/copy-payload.js';
import {
    iconForItem,
    metaForItem,
    titleForItem,
} from './src/display.js';
import {History} from './src/history.js';
import {ImageStore} from './src/image-store.js';
import {decodeImage} from './src/image-utils.js';
import {HistoryStorage} from './src/storage.js';

const CLIPBOARD = St.ClipboardType.CLIPBOARD;
const MAX_VISIBLE_ITEMS = 100;
const KEYBINDING_NAME = 'toggle-popup';
const NOTICE_TIMEOUT = 2500;

export default class CliporiumExtension extends Extension {
    enable() {
        this._indicator = new CliporiumIndicator(this);
        Main.panel.addToStatusArea('cliporium', this._indicator);
    }

    disable() {
        this._indicator?.disable();
        this._indicator?.destroy();
        this._indicator = null;
    }
}

const CliporiumIndicator = GObject.registerClass({
    GTypeName: 'CliporiumIndicator',
}, class CliporiumIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'Cliporium clipboard history', false);

        this._extension = extension;
        this._settings = extension.getSettings();
        this._clipboard = St.Clipboard.get_default();
        this._reader = new ClipboardReader(
            this._clipboard,
            St.ClipboardType.CLIPBOARD
        );
        this._imageStore = new ImageStore();
        this._history = new History();
        this._storage = new HistoryStorage({
            history: this._history,
            imageStore: this._imageStore,
            onLoaded: () => this._onHistoryLoaded(),
            onWarning: message => this._onStorageWarning(message),
            onError: error => this._onStorageError(error),
        });

        this._selection = null;
        this._selectionId = 0;
        this._captureTimeout = 0;
        this._focusTimeout = 0;
        this._searchTimeout = 0;
        this._noticeTimeout = 0;
        this._previewFocusTimeout = 0;
        this._settingsIds = [];
        this._actorSignalIds = [];
        this._shortcutBound = false;
        this._disabled = false;
        this._destroyed = false;
        this._historyReady = false;
        this._captureGeneration = 0;
        this._hidden = false;

        this._items = [];
        this._pinnedItems = [];
        this._recentItems = [];
        this._visibleItems = [];
        this._selectionItems = [];
        this._rowActors = new Map();
        this._selectedId = null;
        this._pendingSelectionId = null;
        this._showPinnedOnly = false;
        this._showClearConfirm = false;
        this._confirmClearAll = false;
        this._actionsId = null;
        this._previewId = null;
        this._previewImageId = null;
        this._noticeText = '';
        this._noticeWarning = false;
        this._persistentNotice = '';
        this._shortcutWarning = '';
        this._viewScroll = {recent: 0, pinned: 0};
        this._restoringScroll = false;
        this._scrollGeneration = 0;
        this._scrollUpperId = 0;
        this._scrollTimeout = 0;

        this._themeSettings = St.Settings.get();
        this._themeSettingsId = 0;

        this.accessible_name = 'Cliporium clipboard history';
        this.menu.actor.accessible_name = 'Cliporium clipboard history';
        this._icon = new St.Icon({
            icon_name: 'edit-copy-symbolic',
            style_class: 'system-status-icon',
        });
        this.add_child(this._icon);

        this._applySettings();
        this._buildMenu();
        this._connectSettings();
        this._connectSelection();
        this._bindShortcut();
        this._themeSettingsId = this._themeSettings.connect(
            'notify::color-scheme',
            () => this._applyTheme()
        );
        this._applyTheme();
        this._setIndicatorVisible(this._settings.get_boolean('show-indicator'));
        this._storage.load();
    }

    _setIndicatorVisible(show) {
        this._hidden = !show;
        this._icon.visible = show;
        this.reactive = show;
        if (show) {
            this.remove_style_class_name('cliporium-indicator-hidden');
            this.menu.sourceActor = this;
            this.menu.focusActor = this;
        } else {
            this.add_style_class_name('cliporium-indicator-hidden');
            this.menu.close();
        }
    }

    _applySettings() {
        this._history.setOptions({
            limit: this._settings.get_int('history-limit'),
            maxBytes: this._settings.get_int('max-content-size'),
            maxImageBytes: this._settings.get_int('max-image-size'),
            retentionDays: this._settings.get_int('retention-days'),
        });
    }

    _buildMenu() {
        this.menu.box.add_style_class_name('cliporium-menu');

        this._section = new PopupMenu.PopupMenuSection();
        this._section.actor.add_style_class_name('cliporium-card-host');
        this._section.actor.x_expand = true;
        this.menu.addMenuItem(this._section);

        this._card = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style_class: 'cliporium-card',
        });
        this._section.actor.add_child(this._card);

        this._buildToolbar();
        this._buildSectionHeader();
        this._buildConfirm();
        this._buildList();
        this._buildPreview();
        this._buildNotice();
        this._buildFooter();

        this._connectActor(this._card, 'key-press-event', (_actor, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape)
                return this._onKeyPress(event);
            return Clutter.EVENT_PROPAGATE;
        });

        this._connectActor(this.menu, 'open-state-changed', (_menu, open) => {
            if (open)
                this._onOpened();
            else
                this._onClosed();
        });
    }

    _buildToolbar() {
        this._topArea = new St.BoxLayout({
            vertical: true,
            x_expand: true,
        });

        this._recentToolbar = new St.BoxLayout({
            style_class: 'cliporium-toolbar',
            x_expand: true,
        });
        this._searchPill = new St.BoxLayout({
            style_class: 'cliporium-search-pill',
            x_expand: true,
        });
        this._searchPill.add_child(new St.Icon({
            icon_name: 'edit-find-symbolic',
            icon_size: 16,
            style_class: 'cliporium-search-icon',
        }));

        this._search = new St.Entry({
            name: 'cliporiumSearch',
            style_class: 'cliporium-search-entry',
            can_focus: true,
            x_expand: true,
            hint_text: 'Search clipboard…',
            accessible_name: 'Search clipboard',
        });
        const clutterText = this._search.get_clutter_text();
        this._connectActor(clutterText, 'text-changed', () => {
            this._showClearConfirm = false;
            this._scheduleSearch();
        });
        this._connectActor(clutterText, 'key-press-event', (_actor, event) =>
            this._onKeyPress(event)
        );
        this._connectActor(clutterText, 'key-focus-in', () => {
            this._searchPill.add_style_class_name('cliporium-search-focused');
        });
        this._connectActor(clutterText, 'key-focus-out', () => {
            this._searchPill.remove_style_class_name('cliporium-search-focused');
        });
        this._searchPill.add_child(this._search);

        this._searchHint = new St.Label({
            text: 'Ctrl+K',
            style_class: 'cliporium-search-hint',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._searchPill.add_child(this._searchHint);
        this._recentToolbar.add_child(this._searchPill);

        this._settingsButton = this._iconButton(
            'emblem-system-symbolic',
            'Cliporium preferences',
            () => this._openPreferences()
        );
        this._recentToolbar.add_child(this._settingsButton);

        this._pinnedHeader = new St.BoxLayout({
            style_class: 'cliporium-pinned-header',
            x_expand: true,
            visible: false,
        });
        this._backButton = this._iconButton(
            'go-previous-symbolic',
            'Back to Recent',
            () => this._switchView(false)
        );
        this._pinnedHeading = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style_class: 'cliporium-pinned-heading',
        });
        this._pinnedTitle = new St.Label({
            text: 'Pinned items',
            style_class: 'cliporium-pinned-title',
        });
        this._pinnedSubtitle = new St.Label({
            text: '',
            style_class: 'cliporium-pinned-subtitle',
        });
        this._pinnedHeading.add_child(this._pinnedTitle);
        this._pinnedHeading.add_child(this._pinnedSubtitle);

        this._pinnedStatusLabel = new St.Label({
            text: '',
            style_class: 'cliporium-status-label',
        });
        this._pinnedStatusPill = new St.Bin({
            visible: false,
            style_class: 'cliporium-status-pill',
            child: this._pinnedStatusLabel,
        });
        this._pinnedSettingsButton = this._iconButton(
            'emblem-system-symbolic',
            'Cliporium preferences',
            () => this._openPreferences()
        );
        this._pinnedHeader.add_child(this._backButton);
        this._pinnedHeader.add_child(this._pinnedHeading);
        this._pinnedHeader.add_child(this._pinnedStatusPill);
        this._pinnedHeader.add_child(this._pinnedSettingsButton);

        this._pinnedSearchRow = new St.BoxLayout({
            style_class: 'cliporium-pinned-search-row',
            x_expand: true,
            visible: false,
        });

        this._topArea.add_child(this._recentToolbar);
        this._topArea.add_child(this._pinnedHeader);
        this._topArea.add_child(this._pinnedSearchRow);
        this._card.add_child(this._topArea);
    }

    _buildSectionHeader() {
        this._sectionHeader = new St.BoxLayout({
            style_class: 'cliporium-section-header',
            x_expand: true,
        });
        const content = new St.BoxLayout({
            style_class: 'cliporium-section-content',
            x_expand: true,
        });

        this._recentTitle = new St.Label({
            text: 'Recent',
            style_class: 'cliporium-section-title',
        });
        this._captureLabel = new St.Label({
            text: '',
            style_class: 'cliporium-status-label',
        });
        this._capturePill = new St.Bin({
            visible: false,
            style_class: 'cliporium-status-pill',
            child: this._captureLabel,
        });
        content.add_child(this._recentTitle);
        content.add_child(this._capturePill);
        this._sectionHeader.add_child(content);

        this._manageButton = this._textButton('Manage pins', () => {
            this._switchView(true);
        }, 'cliporium-text-button cliporium-manage-button', 'starred-symbolic');
        this._clearButton = this._textButton('Clear', () => {
            this._showClearConfirm = true;
            this._confirmClearAll = false;
            this._renderConfirm();
        }, 'cliporium-text-button cliporium-clear-button');
        this._clearButton.accessible_name = 'Clear history';
        this._sectionHeader.add_child(this._manageButton);
        this._sectionHeader.add_child(this._clearButton);
        this._card.add_child(this._sectionHeader);
    }

    _buildConfirm() {
        this._confirmBar = new St.BoxLayout({
            vertical: true,
            visible: false,
            style_class: 'cliporium-confirm',
        });
        this._confirmLabel = new St.Label({
            text: '',
            x_expand: true,
            style_class: 'cliporium-confirm-label',
        });
        this._confirmActions = new St.BoxLayout({
            style_class: 'cliporium-confirm-actions',
        });
        this._confirmCancel = this._textButton('Cancel', () => {
            this._showClearConfirm = false;
            this._confirmClearAll = false;
            this._renderConfirm();
        }, 'cliporium-text-button');
        this._confirmPrimary = this._textButton('Clear unpinned', () => {
            if (this._confirmClearAll)
                this._clearAll();
            else
                this._clearUnpinned();
        }, 'cliporium-text-button cliporium-danger-button');
        this._confirmSecondary = this._textButton('Clear all…', () => {
            this._confirmClearAll = true;
            this._renderConfirm();
        }, 'cliporium-text-button cliporium-danger-text');
        this._confirmActions.add_child(this._confirmCancel);
        this._confirmActions.add_child(this._confirmSecondary);
        this._confirmActions.add_child(this._confirmPrimary);
        this._confirmBar.add_child(this._confirmLabel);
        this._confirmBar.add_child(this._confirmActions);
        this._card.add_child(this._confirmBar);
    }

    _buildList() {
        this._listScroll = new St.ScrollView({
            style_class: 'cliporium-list-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            x_expand: true,
        });
        this._listBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style_class: 'cliporium-list',
        });
        this._listScroll.set_child(this._listBox);
        this._card.add_child(this._listScroll);
    }

    _buildPreview() {
        this._previewBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            visible: false,
            style_class: 'cliporium-preview',
        });

        const header = new St.BoxLayout({
            style_class: 'cliporium-preview-header',
            x_expand: true,
        });
        this._previewBack = this._iconButton(
            'go-previous-symbolic',
            'Back to clipboard',
            () => this._closePreview()
        );
        this._previewTitle = new St.Label({
            text: 'Image',
            style_class: 'cliporium-preview-title',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        header.add_child(this._previewBack);
        header.add_child(this._previewTitle);
        this._previewBox.add_child(header);

        this._previewImageBin = new St.Bin({
            style_class: 'cliporium-preview-image',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL,
        });
        this._previewBox.add_child(this._previewImageBin);

        this._previewMeta = new St.Label({
            text: '',
            style_class: 'cliporium-preview-meta',
            x_expand: true,
        });
        this._ellipsize(this._previewMeta);
        this._previewBox.add_child(this._previewMeta);

        const actions = new St.BoxLayout({
            style_class: 'cliporium-preview-actions',
            x_expand: true,
        });
        this._previewCopy = this._actionButton(
            'edit-copy-symbolic',
            'Copy image',
            () => this._copyPreview()
        );
        this._previewOpen = this._actionButton(
            'document-open-symbolic',
            'Open image',
            () => this._openPreviewImage()
        );
        this._previewPin = this._actionButton(
            'starred-symbolic',
            'Pin image',
            () => this._togglePreviewPin()
        );
        this._previewClose = this._actionButton(
            'window-close-symbolic',
            'Close preview',
            () => this._closePreview()
        );
        actions.add_child(this._previewCopy);
        actions.add_child(this._previewOpen);
        actions.add_child(this._previewPin);
        actions.add_child(this._previewClose);
        this._previewBox.add_child(actions);

        this._card.add_child(this._previewBox);
    }

    _buildNotice() {
        this._notice = new St.BoxLayout({
            visible: false,
            style_class: 'cliporium-notice',
        });
        this._noticeIcon = new St.Icon({
            icon_name: 'dialog-information-symbolic',
            icon_size: 14,
            style_class: 'cliporium-notice-icon',
        });
        this._noticeLabel = new St.Label({
            text: '',
            x_expand: true,
            style_class: 'cliporium-notice-label',
        });
        this._ellipsize(this._noticeLabel);
        const dismiss = this._iconButton(
            'window-close-symbolic',
            'Dismiss message',
            () => this._dismissNotice(),
            'cliporium-notice-dismiss'
        );
        this._notice.add_child(this._noticeIcon);
        this._notice.add_child(this._noticeLabel);
        this._notice.add_child(dismiss);
        this._card.add_child(this._notice);
    }

    _buildFooter() {
        const footer = new St.BoxLayout({
            style_class: 'cliporium-footer',
            x_expand: true,
        });
        this._footerCount = new St.Label({
            text: '',
            style_class: 'cliporium-footer-count',
            x_expand: true,
        });
        footer.add_child(this._footerCount);
        this._footerHints = new St.BoxLayout({
            style_class: 'cliporium-footer-hints',
        });
        this._footerHints.add_child(this._footerHint('↑↓', 'Navigate'));
        this._footerHints.add_child(this._footerHint('↵', 'Copy'));
        this._footerHints.add_child(this._footerHint('Esc', 'Close'));
        footer.add_child(this._footerHints);
        this._card.add_child(footer);
    }

    _connectActor(actor, signal, callback) {
        const id = actor.connect(signal, callback);
        const entry = [actor, id];
        this._actorSignalIds.push(entry);
        try {
            actor.connect('destroy', () => {
                const index = this._actorSignalIds.indexOf(entry);
                if (index !== -1)
                    this._actorSignalIds.splice(index, 1);
            });
        } catch {
        }
        return id;
    }

    _wireButton(button) {
        this._connectActor(button, 'key-press-event', (_actor, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape)
                return this._onKeyPress(event);
            return Clutter.EVENT_PROPAGATE;
        });
        return button;
    }

    _iconButton(iconName, accessibleName, callback,
        styleClass = 'cliporium-icon-button') {
        const button = new St.Button({
            style_class: styleClass,
            can_focus: true,
            reactive: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            accessible_name: accessibleName,
            child: new St.Icon({icon_name: iconName, icon_size: 16}),
        });
        this._connectActor(button, 'clicked', callback);
        this._wireButton(button);
        return button;
    }

    _textButton(text, callback, styleClass = 'cliporium-text-button',
        iconName = '') {
        const box = new St.BoxLayout({style_class: 'cliporium-button-content'});
        if (iconName)
            box.add_child(new St.Icon({icon_name: iconName, icon_size: 14}));
        const label = new St.Label({text, style_class: 'cliporium-button-label'});
        box.add_child(label);
        const button = new St.Button({
            style_class: styleClass,
            can_focus: true,
            reactive: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            accessible_name: text,
            child: box,
        });
        button._cliporiumLabel = label;
        this._connectActor(button, 'clicked', callback);
        this._wireButton(button);
        return button;
    }

    _keycap(text) {
        return new St.Bin({
            style_class: 'cliporium-keycap',
            child: new St.Label({
                text,
                style_class: 'cliporium-keycap-label',
            }),
        });
    }

    _footerHint(key, label) {
        const box = new St.BoxLayout({style_class: 'cliporium-footer-item'});
        box.add_child(this._keycap(key));
        box.add_child(new St.Label({
            text: label,
            style_class: 'cliporium-footer-label',
        }));
        return box;
    }

    _onOpened() {
        this._search.set_text('');
        this._showPinnedOnly = false;
        this._showClearConfirm = false;
        this._confirmClearAll = false;
        this._actionsId = null;
        this._previewId = null;
        this._previewImageId = null;
        this._selectedId = null;
        this._pendingSelectionId = null;
        this._viewScroll = {recent: 0, pinned: 0};
        this._clearTransientNotice();
        this._applyListHeight();
        this._refresh();
        this._focusSearch();
    }

    _onClosed() {
        this._showClearConfirm = false;
        this._confirmClearAll = false;
        this._actionsId = null;
        this._previewId = null;
        this._previewImageId = null;
        this._clearTransientNotice();
    }

    _focusSearch() {
        if (this._focusTimeout)
            GLib.source_remove(this._focusTimeout);
        this._focusTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            this._focusTimeout = 0;
            if (!this._destroyed)
                global.stage.set_key_focus(this._search);
            return GLib.SOURCE_REMOVE;
        });
    }

    _openPreferences() {
        this.menu.close();
        try {
            this._extension.openPreferences?.();
        } catch (error) {
            this._setNotice(`Could not open preferences: ${error.message}`, true, 4000);
        }
    }

    _query() {
        return this._search?.get_text().trim() ?? '';
    }

    _onKeyPress(event) {
        const symbol = event.get_key_symbol();
        const state = event.get_state();
        const ctrl = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;
        const query = this._query();

        if (ctrl && (symbol === Clutter.KEY_k || symbol === Clutter.KEY_K)) {
            this._focusSearch();
            return Clutter.EVENT_STOP;
        }
        if (ctrl && (symbol === Clutter.KEY_p || symbol === Clutter.KEY_P)) {
            if (this._previewId)
                this._togglePreviewPin();
            else
                this._togglePinSelected();
            return Clutter.EVENT_STOP;
        }
        if (ctrl) {
            const index = this._digitIndex(symbol);
            if (index > 0) {
                this._copyPinned(index);
                return Clutter.EVENT_STOP;
            }
        }

        if (symbol === Clutter.KEY_Escape) {
            if (this._previewId) {
                this._closePreview();
            } else if (this._search.get_text().length > 0) {
                this._search.set_text('');
                this._refresh();
            } else if (this._showClearConfirm) {
                this._showClearConfirm = false;
                this._confirmClearAll = false;
                this._renderConfirm();
            } else if (this._actionsId) {
                this._actionsId = null;
                this._refresh();
            } else if (this._showPinnedOnly) {
                this._switchView(false);
            } else {
                this.menu.close();
            }
            return Clutter.EVENT_STOP;
        }

        if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
            if (this._previewId)
                this._copyPreview();
            else
                this._copySelected();
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
        if (symbol === Clutter.KEY_Home && query.length === 0) {
            this._moveSelectionTo(0);
            return Clutter.EVENT_STOP;
        }
        if (symbol === Clutter.KEY_End && query.length === 0) {
            this._moveSelectionTo(this._selectionItems.length - 1);
            return Clutter.EVENT_STOP;
        }
        if ((symbol === Clutter.KEY_Delete ||
            symbol === Clutter.KEY_KP_Delete) && query.length === 0) {
            this._deleteSelected();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _digitIndex(symbol) {
        const digits = [
            Clutter.KEY_1, Clutter.KEY_2, Clutter.KEY_3, Clutter.KEY_4,
            Clutter.KEY_5, Clutter.KEY_6, Clutter.KEY_7, Clutter.KEY_8,
            Clutter.KEY_9,
        ];
        return digits.indexOf(symbol) + 1;
    }

    _connectSettings() {
        for (const key of [
            'history-limit',
            'max-content-size',
            'max-image-size',
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
            this._setIndicatorVisible(this._settings.get_boolean('show-indicator'));
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
        if (accelerators.length === 0) {
            this._shortcutWarning = '';
            this._renderNotice();
            return;
        }

        try {
            const action = Main.wm.addKeybinding(
                KEYBINDING_NAME,
                this._settings,
                Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.ALL,
                () => this._toggleMenu()
            );
            if (action === Meta.KeyBindingAction.NONE) {
                this._shortcutBound = false;
                this._shortcutWarning =
                    `Shortcut ${accelerators[0]} is unavailable. ` +
                    'Choose another shortcut in Preferences.';
            } else {
                this._shortcutBound = true;
                this._shortcutWarning = '';
            }
        } catch {
            this._shortcutBound = false;
            this._shortcutWarning =
                `Shortcut ${accelerators[0]} is unavailable. ` +
                'Choose another shortcut in Preferences.';
        }
        this._renderNotice();
    }

    _toggleMenu() {
        if (this.menu.isOpen) {
            this.menu.close();
            return;
        }

        const anchor = this._hidden ? Main.panel : this;
        this.menu.sourceActor = anchor;
        this.menu.focusActor = anchor;
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

        const generation = ++this._captureGeneration;
        const {text, tooLarge} = await this._reader.readText(
            this._settings.get_int('max-content-size')
        );
        if (!this._captureStillCurrent(generation))
            return;
        if (tooLarge) {
            this._setNotice(
                'Clipboard item is larger than the configured limit.',
                true,
                4000
            );
            return;
        }
        if (text) {
            this._captureText(text);
            return;
        }

        const image = await this._reader.readImage(
            this._settings.get_int('max-image-size')
        );
        if (!this._captureStillCurrent(generation))
            return;
        if (image.tooLarge) {
            this._setNotice(
                'Image is larger than the configured limit.',
                true,
                4000
            );
            return;
        }
        if (!image.bytes)
            return;

        let dimensions;
        try {
            dimensions = decodeImage(image.bytes);
        } catch (error) {
            if (error.message.includes('exceed the supported limit')) {
                this._setNotice(
                    'Image dimensions are larger than the supported limit.',
                    true,
                    4000
                );
            }
            return;
        }

        let saved;
        try {
            saved = await this._imageStore.saveAsync(image.bytes, image.mime);
        } catch (error) {
            this._setNotice(
                `Image could not be stored: ${error.message}`,
                true,
                4000
            );
            return;
        }

        if (!this._captureStillCurrent(generation)) {
            if (saved.created)
                this._imageStore.delete(saved.blob_path);
            return;
        }

        const result = this._history.captureImage({
            ...saved,
            width: dimensions.width,
            height: dimensions.height,
        }, this._sourceApp());
        if (result.added || result.reason === 'duplicate') {
            if (saved.created && result.item?.blob_path !== saved.blob_path)
                this._imageStore.delete(saved.blob_path);
            this._storage.scheduleSave();
            if (this.menu.isOpen)
                this._refresh();
            return;
        }

        if (saved.created)
            this._imageStore.delete(saved.blob_path);
    }

    _captureStillCurrent(generation) {
        return !this._destroyed && generation === this._captureGeneration &&
            this._settings.get_boolean('capture-enabled') &&
            !this._settings.get_boolean('private-mode');
    }

    _captureText(text) {
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
    }

    _onStorageWarning(message) {
        this._persistentNotice = message;
        this._renderNotice();
    }

    _onStorageError(error) {
        this._persistentNotice = `History storage error: ${error.message}`;
        this._renderNotice();
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
        if (this._destroyed || !this._card)
            return;

        const query = this._query();
        const items = this._history.getItems(query);
        this._items = items;
        this._pinnedItems = items.filter(item => item.pinned);
        this._recentItems = items.filter(item => !item.pinned);

        let visible;
        if (this._showPinnedOnly)
            visible = this._pinnedItems.slice(0, MAX_VISIBLE_ITEMS);
        else if (query.length > 0)
            visible = items.slice(0, MAX_VISIBLE_ITEMS);
        else
            visible = this._recentItems.slice(0, MAX_VISIBLE_ITEMS);
        this._visibleItems = visible;

        this._selectionItems = visible;

        const ids = new Set(this._selectionItems.map(item => item.id));
        if (this._pendingSelectionId && ids.has(this._pendingSelectionId)) {
            this._selectedId = this._pendingSelectionId;
        } else if (!this._selectedId || !ids.has(this._selectedId)) {
            this._selectedId = this._defaultSelectionId(query);
        }
        this._pendingSelectionId = null;

        if (this._actionsId && !items.some(item => item.id === this._actionsId))
            this._actionsId = null;

        this._render();
        this._applySelection();
    }

    _defaultSelectionId(query) {
        if (query.length > 0)
            return this._visibleItems[0]?.id ?? null;
        if (this._showPinnedOnly)
            return this._visibleItems[0]?.id ?? null;
        return this._visibleItems[0]?.id ?? null;
    }

    _render() {
        this._renderHeader();
        this._renderConfirm();
        this._renderList();
        this._renderPreview();
        this._renderNotice();
    }

    _switchView(showPinnedOnly) {
        if (this._showPinnedOnly === showPinnedOnly)
            return;
        this._viewScroll[this._showPinnedOnly ? 'pinned' : 'recent'] =
            this._listScroll.vadjustment.value;
        this._showPinnedOnly = showPinnedOnly;
        this._previewId = null;
        this._previewImageId = null;
        this._selectedId = null;
        this._actionsId = null;
        this._showClearConfirm = false;
        this._confirmClearAll = false;
        if (this._search.get_text().length > 0)
            this._search.set_text('');
        this._restoringScroll = true;
        this._refresh();
        this._restoreScroll(showPinnedOnly ? 'pinned' : 'recent');
        this._animateViewChange();
        this._focusSearch();
    }

    _restoreScroll(view) {
        const generation = ++this._scrollGeneration;
        this._cancelScrollRestore();
        const target = this._viewScroll[view] ?? 0;
        const adjustment = this._listScroll.vadjustment;
        const apply = () => {
            if (this._destroyed || generation !== this._scrollGeneration)
                return;
            const maximum = Math.max(0, adjustment.upper - adjustment.page_size);
            const next = Math.min(target, maximum);
            if (Math.abs(adjustment.value - next) > 0.5)
                adjustment.value = next;
        };
        apply();
        if (target <= 0) {
            this._restoringScroll = false;
            return;
        }
        this._scrollUpperId = adjustment.connect('notify::upper', apply);
        this._scrollTimeout = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            350,
            () => {
                this._scrollTimeout = 0;
                apply();
                this._restoringScroll = false;
                this._cancelScrollRestore();
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _cancelScrollRestore() {
        if (this._scrollUpperId) {
            this._listScroll.vadjustment.disconnect(this._scrollUpperId);
            this._scrollUpperId = 0;
        }
        if (this._scrollTimeout) {
            GLib.source_remove(this._scrollTimeout);
            this._scrollTimeout = 0;
        }
    }

    _applyListHeight() {
        const monitorHeight = Main.layoutManager.primaryMonitor?.height ?? 768;
        const available = Math.max(160, monitorHeight - 260);
        this._listScroll.style = `max-height: ${Math.min(380, available)}px;`;
    }

    _animateViewChange() {
        if (!this._themeSettings.enable_animations)
            return;
        this._listScroll.opacity = 0;
        this._listScroll.ease({
            opacity: 255,
            duration: 120,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _renderHeader() {
        const query = this._query();
        const pinnedView = this._showPinnedOnly;
        const privateMode = this._settings.get_boolean('private-mode');
        const captureEnabled = this._settings.get_boolean('capture-enabled');

        this._recentToolbar.visible = !pinnedView;
        this._pinnedHeader.visible = pinnedView;
        this._pinnedSearchRow.visible = pinnedView;
        this._sectionHeader.visible = !pinnedView;
        this._backButton.visible = pinnedView;
        this._pinnedSettingsButton.visible = pinnedView;

        if (pinnedView) {
            if (this._searchPill.get_parent() !== this._pinnedSearchRow) {
                this._searchPill.get_parent()?.remove_child(this._searchPill);
                this._pinnedSearchRow.add_child(this._searchPill);
            }
            this._search.hint_text = 'Search pinned items…';
            this._search.accessible_name = 'Search pinned items';
        } else {
            if (this._searchPill.get_parent() !== this._recentToolbar) {
                this._searchPill.get_parent()?.remove_child(this._searchPill);
                this._recentToolbar.insert_child_at_index(this._searchPill, 0);
            }
            this._search.hint_text = 'Search clipboard…';
            this._search.accessible_name = 'Search clipboard';
        }
        this._searchHint.visible = !pinnedView && query.length === 0;

        const warning = privateMode || !captureEnabled;
        const statusText = privateMode ? 'Private' : 'Capture off';
        for (const [pill, label] of [
            [this._capturePill, this._captureLabel],
            [this._pinnedStatusPill, this._pinnedStatusLabel],
        ]) {
            pill.remove_style_class_name('cliporium-status-warning');
            if (warning) {
                label.text = statusText;
                pill.visible = true;
                pill.add_style_class_name('cliporium-status-warning');
            } else {
                pill.visible = false;
            }
        }

        this._recentTitle.text = query.length > 0 ? 'Results' : 'Recent';
        this._manageButton.visible = !pinnedView && query.length === 0;
        this._clearButton.visible = !pinnedView && query.length === 0 &&
            this._items.length > 0;

        this._pinnedTitle.text = 'Pinned items';
        this._pinnedSubtitle.text = query.length > 0
            ? this._countText(this._pinnedItems.length, 'match', 'matches')
            : this._countText(this._pinnedItems.length, 'saved item',
                'saved items');

        if (!this._historyReady) {
            this._footerCount.text = 'Loading…';
            this._footerHints.visible = false;
        } else if (pinnedView) {
            this._footerCount.text =
                'Select an item to copy · Use the menu to unpin or delete';
            this._footerHints.visible = false;
        } else {
            const total = this._items.length;
            const totalText = query.length > 0
                ? this._countText(total, 'match', 'matches')
                : this._countText(total, 'item', 'items');
            const shown = this._visibleItems.length;
            this._footerCount.text = shown < total
                ? `${totalText} · Showing ${shown}`
                : totalText;
            this._footerHints.visible = true;
        }
    }

    _renderConfirm() {
        const query = this._query();
        const visible = this._showClearConfirm && query.length === 0;
        this._confirmBar.visible = visible;
        if (!visible)
            return;

        this._confirmBar.remove_style_class_name('cliporium-confirm-danger');
        if (this._confirmClearAll) {
            this._confirmLabel.text = 'Delete every clipboard item, including pinned items?';
            this._confirmPrimary._cliporiumLabel.text = 'Delete all';
            this._confirmPrimary.visible = true;
            this._confirmSecondary.visible = false;
            this._confirmBar.add_style_class_name('cliporium-confirm-danger');
        } else {
            const unpinned = this._items.filter(item => !item.pinned).length;
            this._confirmLabel.text = unpinned > 0
                ? `Clear ${this._countText(unpinned, 'unpinned item', 'unpinned items')}?`
                : 'No unpinned items. Clear all items instead?';
            this._confirmPrimary._cliporiumLabel.text = 'Clear unpinned';
            this._confirmPrimary.visible = unpinned > 0;
            this._confirmSecondary.visible = true;
        }
    }

    _renderList() {
        for (const child of this._listBox.get_children())
            child.destroy();
        this._rowActors.clear();

        let emptyText = '';
        if (!this._historyReady)
            emptyText = 'Loading clipboard history…';
        else if (this._visibleItems.length === 0)
            emptyText = this._emptyText();

        if (emptyText) {
            const empty = new St.BoxLayout({
                vertical: true,
                style_class: 'cliporium-empty',
                x_expand: true,
            });
            empty.add_child(new St.Icon({
                icon_name: this._historyReady
                    ? 'edit-paste-symbolic'
                    : 'content-loading-symbolic',
                icon_size: 24,
                style_class: 'cliporium-empty-icon',
            }));
            empty.add_child(new St.Label({
                text: emptyText,
                style_class: 'cliporium-empty-label',
            }));
            this._listBox.add_child(empty);
        } else {
            for (const item of this._visibleItems) {
                const {wrapper, row} = this._buildRow(item);
                this._listBox.add_child(wrapper);
                this._rowActors.set(item.id, row);
            }
        }

    }

    _emptyText() {
        const query = this._query();
        if (query.length > 0) {
            if (this._showPinnedOnly)
                return `No pinned matches for “${query.trim()}”.`;
            return `No matches for “${query.trim()}”.`;
        }
        if (this._showPinnedOnly)
            return 'No pinned items yet. Pin an item from Recent.';
        if (this._pinnedItems.length > 0)
            return 'All items are pinned. Open Manage pins.';
        return 'No clipboard items yet. Copy text or an image to start.';
    }

    _buildRow(item) {
        const wrapper = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style_class: 'cliporium-row-wrap',
        });

        const row = new St.BoxLayout({
            style_class: 'cliporium-row',
            x_expand: true,
            reactive: true,
            track_hover: true,
            can_focus: false,
        });

        const icon = new St.Bin({
            style_class: item.kind === 'image'
                ? 'cliporium-row-icon cliporium-row-thumb'
                : 'cliporium-row-icon',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            child: item.kind === 'image'
                ? this._imageThumbnail(item)
                : new St.Icon({
                    icon_name: iconForItem(item),
                    icon_size: 16,
                }),
        });
        row.add_child(icon);

        const content = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style_class: 'cliporium-row-content',
        });
        const title = new St.Label({
            text: titleForItem(item),
            style_class: 'cliporium-row-title',
            x_expand: true,
        });
        this._ellipsize(title);
        const meta = new St.Label({
            text: metaForItem(item),
            style_class: 'cliporium-row-meta',
            x_expand: true,
        });
        this._ellipsize(meta);
        content.add_child(title);
        content.add_child(meta);
        row.add_child(content);

        const pinButton = this._iconButton(
            item.pinned ? 'starred-symbolic' : 'non-starred-symbolic',
            item.pinned ? 'Unpin item' : 'Pin item',
            () => {
                this._selectedId = item.id;
                this._setPinned(item, !item.pinned);
            },
            item.pinned
                ? 'cliporium-row-action cliporium-row-action-pinned'
                : 'cliporium-row-action'
        );
        const moreButton = this._iconButton(
            'view-more-symbolic',
            'Item actions',
            () => this._toggleActions(item),
            'cliporium-row-action'
        );
        row.add_child(pinButton);
        row.add_child(moreButton);

        this._connectActor(row, 'button-press-event', (_actor, event) => {
            return this._onRowPress(
                item,
                global.stage.get_event_actor(event),
                event.get_button(),
                pinButton,
                moreButton
            );
        });

        wrapper.add_child(row);

        if (this._actionsId === item.id) {
            const actions = new St.BoxLayout({
                style_class: 'cliporium-actions',
                x_expand: true,
            });
            actions.add_child(this._actionButton(
                'object-select-symbolic',
                'Copy',
                () => this._copy(item)
            ));
            actions.add_child(this._actionButton(
                item.pinned ? 'non-starred-symbolic' : 'starred-symbolic',
                item.pinned ? 'Unpin' : 'Pin',
                () => {
                    this._selectedId = item.id;
                    this._setPinned(item, !item.pinned);
                }
            ));
            actions.add_child(this._actionButton(
                'edit-delete-symbolic',
                'Delete',
                () => this._delete(item),
                'cliporium-action-button cliporium-action-danger'
            ));
            wrapper.add_child(actions);
        }

        return {wrapper, row};
    }

    _imageThumbnail(item) {
        const fallback = iconName => new St.Icon({
            icon_name: iconName,
            icon_size: 16,
        });
        if (!this._imageStore.exists(item.blob_path))
            return fallback('image-missing-symbolic');

        try {
            const {scaleFactor} = St.ThemeContext.get_for_stage(global.stage);
            const file = Gio.File.new_for_path(
                this._imageStore.pathFor(item.blob_path)
            );
            const actor = St.TextureCache.get_default().load_file_async(
                file,
                -1,
                Math.max(1, Math.round(34 * scaleFactor)),
                1,
                scaleFactor
            );
            if (!actor)
                return fallback('image-missing-symbolic');
            actor.width = 34;
            actor.height = 34;
            actor.contentGravity = Clutter.ContentGravity.RESIZE_ASPECT;
            return actor;
        } catch {
            return fallback('image-missing-symbolic');
        }
    }

    _openPreview(item) {
        if (!item || item.kind !== 'image')
            return;
        this._previewId = item.id;
        this._selectedId = item.id;
        this._actionsId = null;
        this._showClearConfirm = false;
        this._confirmClearAll = false;
        this._render();
        if (this._previewFocusTimeout)
            GLib.source_remove(this._previewFocusTimeout);
        this._previewFocusTimeout = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._previewFocusTimeout = 0;
            if (!this._destroyed && this._previewId)
                this._previewBack.grab_key_focus();
            return GLib.SOURCE_REMOVE;
        });
    }

    _closePreview() {
        if (!this._previewId)
            return;
        this._previewId = null;
        this._previewImageId = null;
        this._render();
        this._focusSearch();
    }

    _previewItem() {
        return this._previewId
            ? this._history.getItem(this._previewId)
            : null;
    }

    _renderPreview() {
        const item = this._previewItem();
        if (!item) {
            this._previewId = null;
            this._previewImageId = null;
            this._previewBox.visible = false;
            this._topArea.visible = true;
            this._sectionHeader.visible = !this._showPinnedOnly;
            this._listScroll.visible = true;
            return;
        }

        this._previewBox.visible = true;
        this._topArea.visible = false;
        this._sectionHeader.visible = false;
        this._confirmBar.visible = false;
        this._listScroll.visible = false;

        this._previewTitle.text = titleForItem(item);
        this._previewMeta.text = metaForItem(item);
        this._previewPin._cliporiumLabel.text = item.pinned
            ? 'Unpin image'
            : 'Pin image';
        this._previewPin.accessible_name = item.pinned
            ? 'Unpin image'
            : 'Pin image';
        this._previewPin._cliporiumIcon.icon_name = item.pinned
            ? 'non-starred-symbolic'
            : 'starred-symbolic';

        this._renderPreviewImage(item);
        this._footerCount.text = 'Image preview';
        this._footerHints.visible = false;
    }

    _renderPreviewImage(item) {
        if (this._previewImageId === item.id &&
            this._previewImageBin.get_child())
            return;
        this._previewImageId = item.id;

        const old = this._previewImageBin.get_child();
        if (old)
            old.destroy();

        const unavailable = () => {
            const box = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                y_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'cliporium-preview-missing',
            });
            box.add_child(new St.Icon({
                icon_name: 'image-missing-symbolic',
                icon_size: 36,
                style_class: 'cliporium-preview-missing-icon',
            }));
            box.add_child(new St.Label({
                text: 'Image unavailable',
                style_class: 'cliporium-preview-missing-label',
            }));
            this._previewImageBin.set_child(box);
            this._previewCopy.reactive = false;
            this._previewOpen.reactive = false;
            this._previewCopy.opacity = 120;
            this._previewOpen.opacity = 120;
        };

        if (!this._imageStore.exists(item.blob_path)) {
            unavailable();
            return;
        }

        this._previewCopy.reactive = true;
        this._previewOpen.reactive = true;
        this._previewCopy.opacity = 255;
        this._previewOpen.opacity = 255;

        try {
            const {scaleFactor} = St.ThemeContext.get_for_stage(global.stage);
            const file = Gio.File.new_for_path(
                this._imageStore.pathFor(item.blob_path)
            );
            const actor = St.TextureCache.get_default().load_file_async(
                file,
                -1,
                Math.max(1, Math.round(260 * scaleFactor)),
                1,
                scaleFactor
            );
            if (!actor) {
                unavailable();
                return;
            }
            actor.width = 360;
            actor.height = 260;
            actor.contentGravity = Clutter.ContentGravity.RESIZE_ASPECT;
            actor.x_expand = true;
            actor.y_expand = true;
            this._previewImageBin.set_child(actor);
        } catch {
            unavailable();
        }
    }

    _copyPreview() {
        const item = this._previewItem();
        if (item)
            this._copy(item);
    }

    _openPreviewImage() {
        const item = this._previewItem();
        if (!item)
            return;
        if (!this._imageStore.exists(item.blob_path)) {
            this._setNotice(
                'The image file for this item is missing.',
                true,
                4000
            );
            return;
        }
        try {
            const file = Gio.File.new_for_path(
                this._imageStore.pathFor(item.blob_path)
            );
            Gio.AppInfo.launch_default_for_uri(file.get_uri(), null);
        } catch (error) {
            this._setNotice(
                `Could not open image: ${error.message}`,
                true,
                4000
            );
        }
    }

    _togglePreviewPin() {
        const item = this._previewItem();
        if (item)
            this._setPinned(item, !item.pinned);
    }

    _onRowPress(item, source, button, pinButton, moreButton) {
        if (button !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;
        if (source && (this._isInside(source, pinButton) ||
            this._isInside(source, moreButton))) {
            return Clutter.EVENT_PROPAGATE;
        }
        this._selectedId = item.id;
        if (item.kind === 'image')
            this._openPreview(item);
        else
            this._copy(item);
        return Clutter.EVENT_STOP;
    }

    _actionButton(iconName, label, callback,
        styleClass = 'cliporium-action-button') {
        const box = new St.BoxLayout({style_class: 'cliporium-action-content'});
        const icon = new St.Icon({icon_name: iconName, icon_size: 13});
        const labelActor = new St.Label({
            text: label,
            style_class: 'cliporium-action-label',
        });
        box.add_child(icon);
        box.add_child(labelActor);
        const button = new St.Button({
            style_class: styleClass,
            can_focus: true,
            reactive: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            accessible_name: label,
            child: box,
        });
        button._cliporiumIcon = icon;
        button._cliporiumLabel = labelActor;
        this._connectActor(button, 'clicked', callback);
        this._wireButton(button);
        return button;
    }

    _renderNotice() {
        if (!this._notice)
            return;
        const text = this._noticeText || this._persistentNotice ||
            this._shortcutWarning;
        if (!text) {
            this._notice.visible = false;
            return;
        }
        this._notice.visible = true;
        this._noticeLabel.text = text;
        const warning = this._noticeWarning ||
            Boolean(this._persistentNotice) ||
            Boolean(this._shortcutWarning);
        this._noticeIcon.icon_name = warning
            ? 'dialog-warning-symbolic'
            : 'dialog-information-symbolic';
        this._notice.remove_style_class_name('cliporium-notice-warning');
        if (warning)
            this._notice.add_style_class_name('cliporium-notice-warning');
    }

    _setNotice(text, warning = false, timeout = NOTICE_TIMEOUT) {
        if (this._noticeTimeout) {
            GLib.source_remove(this._noticeTimeout);
            this._noticeTimeout = 0;
        }
        this._noticeText = text;
        this._noticeWarning = warning;
        if (timeout > 0) {
            this._noticeTimeout = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                timeout,
                () => {
                    this._noticeTimeout = 0;
                    this._noticeText = '';
                    this._noticeWarning = false;
                    this._renderNotice();
                    return GLib.SOURCE_REMOVE;
                }
            );
        }
        this._renderNotice();
    }

    _clearTransientNotice() {
        if (this._noticeTimeout) {
            GLib.source_remove(this._noticeTimeout);
            this._noticeTimeout = 0;
        }
        this._noticeText = '';
        this._noticeWarning = false;
        this._renderNotice();
    }

    _dismissNotice() {
        if (this._noticeTimeout) {
            GLib.source_remove(this._noticeTimeout);
            this._noticeTimeout = 0;
        }
        this._noticeText = '';
        this._noticeWarning = false;
        this._persistentNotice = '';
        this._shortcutWarning = '';
        this._renderNotice();
    }

    _ellipsize(label) {
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        label.clutter_text.line_wrap = false;
        label.clutter_text.single_line_mode = true;
    }

    _countText(count, singular, plural) {
        return `${count} ${count === 1 ? singular : plural}`;
    }

    _applyTheme() {
        const light = this._themeSettings.color_scheme ===
            St.SystemColorScheme.PREFER_LIGHT;
        for (const actor of [this.menu.box, this._card]) {
            actor.remove_style_class_name('cliporium-dark');
            actor.remove_style_class_name('cliporium-light');
            actor.add_style_class_name(light
                ? 'cliporium-light'
                : 'cliporium-dark');
        }
    }

    _selectionIndex() {
        return this._selectionItems.findIndex(item => item.id === this._selectedId);
    }

    _moveSelection(delta) {
        if (this._selectionItems.length === 0)
            return;
        const index = this._selectionIndex();
        const next = index < 0
            ? (delta > 0 ? 0 : this._selectionItems.length - 1)
            : (index + delta + this._selectionItems.length) %
                this._selectionItems.length;
        this._selectedId = this._selectionItems[next].id;
        this._applySelection();
    }

    _moveSelectionTo(index) {
        if (this._selectionItems.length === 0)
            return;
        const bounded = Math.max(0, Math.min(index,
            this._selectionItems.length - 1));
        this._selectedId = this._selectionItems[bounded].id;
        this._applySelection();
    }

    _applySelection() {
        for (const actor of this._rowActors.values())
            actor.remove_style_class_name('cliporium-selected');

        const ids = new Set(this._selectionItems.map(item => item.id));
        if (!this._selectedId || !ids.has(this._selectedId))
            this._selectedId = this._selectionItems[0]?.id ?? null;
        if (!this._selectedId)
            return;

        const row = this._rowActors.get(this._selectedId);
        if (row) {
            row.add_style_class_name('cliporium-selected');
            if (!this._restoringScroll)
                this._ensureVisible(this._listScroll, row);
        }
    }

    _ensureVisible(scrollView, actor) {
        if (!this.menu.isOpen)
            return;
        try {
            AnimationUtils.ensureActorVisibleInScrollView(scrollView, actor);
        } catch {
        }
    }

    _selectedItem() {
        return this._selectionItems.find(item => item.id === this._selectedId) ??
            null;
    }

    _copySelected() {
        const item = this._selectedItem() ?? this._selectionItems[0];
        if (item)
            this._copy(item);
    }

    _copyPinned(index) {
        const item = this._pinnedItems[index - 1];
        if (item)
            this._copy(item);
    }

    _copy(item) {
        payloadForItem(item, this._imageStore).then(payload => {
            if (this._destroyed)
                return;
            if (!payload) {
                this._setNotice(
                    'The image file for this item is missing.',
                    true,
                    4000
                );
                return;
            }
            this._clipboard.set_content(CLIPBOARD, payload.mime, payload.bytes);
            this.menu.close();
        }).catch(error => {
            if (this._destroyed)
                return;
            this._setNotice(
                `Could not copy: ${error.message}`,
                true,
                4000
            );
        });
    }

    _togglePinSelected() {
        const item = this._selectedItem();
        if (item)
            this._setPinned(item, !item.pinned);
    }

    _setPinned(item, pinned) {
        if (pinned && !item.pinned &&
            this._history.pinnedCount >= this._history.maxPinned) {
            this._setNotice(
                `Pinned limit reached (${this._history.maxPinned}). Unpin an item first.`,
                true,
                4000
            );
            return;
        }
        if (!this._history.setPinned(item.id, pinned))
            return;
        this._selectedId = item.id;
        this._storage.scheduleSave();
        this._setNotice(pinned ? 'Pinned.' : 'Item unpinned.');
        this._refresh();
    }

    _toggleActions(item) {
        this._selectedId = item.id;
        this._actionsId = this._actionsId === item.id ? null : item.id;
        this._refresh();
    }

    _deleteSelected() {
        const item = this._selectedItem();
        if (!item)
            return;
        if (item.pinned && this._rowActors.has(item.id) &&
            this._actionsId !== item.id) {
            this._toggleActions(item);
            return;
        }
        this._delete(item);
    }

    _delete(item) {
        const index = this._selectionItems.findIndex(
            candidate => candidate.id === item.id
        );
        const neighbour = this._selectionItems[index + 1] ??
            this._selectionItems[index - 1] ??
            null;
        this._pendingSelectionId = neighbour?.id ?? null;

        if (!this._history.delete(item.id))
            return;
        if (this._actionsId === item.id)
            this._actionsId = null;
        this._storage.scheduleSave();
        this._setNotice('Item deleted.');
        this._refresh();
    }

    _clearUnpinned() {
        const count = this._history.size - this._history.pinnedCount;
        this._history.clearUnpinned();
        this._showClearConfirm = false;
        this._confirmClearAll = false;
        this._selectedId = null;
        this._pendingSelectionId = null;
        this._storage.scheduleSave();
        this._setNotice(`Cleared ${this._countText(count, 'unpinned item',
            'unpinned items')}.`);
        this._refresh();
    }

    _clearAll() {
        this._history.clearAll();
        this._showClearConfirm = false;
        this._confirmClearAll = false;
        this._selectedId = null;
        this._pendingSelectionId = null;
        this._storage.scheduleSave();
        this._setNotice('Clipboard history cleared.');
        this._refresh();
    }

    _isInside(actor, ancestor) {
        let current = actor;
        while (current) {
            if (current === ancestor)
                return true;
            current = current.get_parent?.() ?? null;
        }
        return false;
    }

    disable() {
        if (this._disabled)
            return;
        this._disabled = true;
        this._destroyed = true;

        for (const [actor, id] of this._actorSignalIds) {
            try {
                actor.disconnect(id);
            } catch {
            }
        }
        this._actorSignalIds = [];

        this._storage.destroy();

        if (this._shortcutBound) {
            Main.wm.removeKeybinding(KEYBINDING_NAME);
            this._shortcutBound = false;
        }

        if (this._selectionId) {
            this._selection.disconnect(this._selectionId);
            this._selectionId = 0;
        }

        if (this._themeSettingsId) {
            this._themeSettings.disconnect(this._themeSettingsId);
            this._themeSettingsId = 0;
        }

        for (const id of this._settingsIds)
            this._settings.disconnect(id);
        this._settingsIds = [];

        for (const id of [
            this._captureTimeout,
            this._focusTimeout,
            this._searchTimeout,
            this._noticeTimeout,
            this._scrollTimeout,
            this._previewFocusTimeout,
        ]) {
            if (id)
                GLib.source_remove(id);
        }
        this._captureTimeout = 0;
        this._focusTimeout = 0;
        this._searchTimeout = 0;
        this._noticeTimeout = 0;
        this._scrollTimeout = 0;
        this._previewFocusTimeout = 0;
        this._cancelScrollRestore();
    }

    destroy() {
        this.disable();
        super.destroy();
    }
});
