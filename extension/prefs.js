import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class CliporiumPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        const captureGroup = new Adw.PreferencesGroup({
            title: _('Capture'),
            description: _('Clipboard text stays on this computer. Cliporium never sends it anywhere.'),
        });
        page.add(captureGroup);

        const captureRow = new Adw.SwitchRow({
            title: _('Capture clipboard'),
            subtitle: _('Store text copied while the extension is enabled.'),
        });
        settings.bind('capture-enabled', captureRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        captureGroup.add(captureRow);

        const privateRow = new Adw.SwitchRow({
            title: _('Private mode'),
            subtitle: _('Pause capture without disabling the extension.'),
        });
        settings.bind('private-mode', privateRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        captureGroup.add(privateRow);

        const limitRow = this._spinRow({
            settings,
            key: 'history-limit',
            title: _('History limit'),
            subtitle: _('Number of unpinned items to keep.'),
            lower: 10,
            upper: 500,
            step: 10,
            value: settings.get_int('history-limit'),
            toSetting: value => Math.round(value),
        });
        captureGroup.add(limitRow);

        const sizeRow = this._spinRow({
            settings,
            key: 'max-content-size',
            title: _('Maximum item size'),
            subtitle: _('Larger text is ignored. Value is in kibibytes.'),
            lower: 1,
            upper: 1024,
            step: 1,
            value: Math.round(settings.get_int('max-content-size') / 1024),
            toSetting: value => Math.round(value) * 1024,
        });
        captureGroup.add(sizeRow);

        const retentionRow = this._spinRow({
            settings,
            key: 'retention-days',
            title: _('Retention'),
            subtitle: _('Days to keep unpinned items. Zero keeps them until the history limit is reached.'),
            lower: 0,
            upper: 3650,
            step: 1,
            value: settings.get_int('retention-days'),
            toSetting: value => Math.round(value),
        });
        captureGroup.add(retentionRow);

        const appearanceGroup = new Adw.PreferencesGroup({
            title: _('Appearance'),
        });
        page.add(appearanceGroup);

        const indicatorRow = new Adw.SwitchRow({
            title: _('Show panel indicator'),
            subtitle: _('Show the Cliporium button in the top panel.'),
        });
        settings.bind('show-indicator', indicatorRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        appearanceGroup.add(indicatorRow);

        const shortcutGroup = new Adw.PreferencesGroup({
            title: _('Keyboard'),
            description: _('No shortcut is set by default.'),
        });
        page.add(shortcutGroup);

        const shortcutRow = new Adw.ActionRow({
            title: _('Open clipboard popup'),
        });
        const shortcutLabel = new Gtk.ShortcutLabel({
            accelerator: settings.get_strv('toggle-popup')[0] ?? '',
            disabled_text: _('Disabled'),
            valign: Gtk.Align.CENTER,
        });
        shortcutRow.add_suffix(shortcutLabel);

        const setButton = new Gtk.Button({
            label: _('Set…'),
            valign: Gtk.Align.CENTER,
        });
        setButton.connect('clicked', () => {
            this._captureShortcut(window, settings, shortcutLabel);
        });
        shortcutRow.add_suffix(setButton);

        const clearButton = new Gtk.Button({
            icon_name: 'edit-clear-symbolic',
            tooltip_text: _('Clear shortcut'),
            valign: Gtk.Align.CENTER,
        });
        clearButton.connect('clicked', () => {
            settings.set_strv('toggle-popup', []);
            shortcutLabel.set_accelerator('');
        });
        shortcutRow.add_suffix(clearButton);
        shortcutGroup.add(shortcutRow);

        const changedId = settings.connect('changed::toggle-popup', () => {
            shortcutLabel.set_accelerator(settings.get_strv('toggle-popup')[0] ?? '');
        });
        window.connect('destroy', () => settings.disconnect(changedId));
    }

    _spinRow({settings, key, title, subtitle, lower, upper, step, value,
        toSetting}) {
        const adjustment = new Gtk.Adjustment({
            lower,
            upper,
            step_increment: step,
            page_increment: step * 5,
            value,
        });
        const row = new Adw.SpinRow({
            title,
            subtitle,
            adjustment,
        });
        const valueId = row.connect('notify::value', () => {
            settings.set_int(key, toSetting(row.get_value()));
        });
        const changedId = settings.connect(`changed::${key}`, () => {
            const stored = key === 'max-content-size'
                ? Math.round(settings.get_int(key) / 1024)
                : settings.get_int(key);
            if (row.get_value() !== stored)
                row.set_value(stored);
        });
        row.connect('destroy', () => {
            row.disconnect(valueId);
            settings.disconnect(changedId);
        });
        return row;
    }

    _captureShortcut(parent, settings, label) {
        const dialog = new Gtk.Window({
            modal: true,
            transient_for: parent,
            title: _('Set shortcut'),
        });
        dialog.set_default_size(360, 120);

        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
        });
        box.set_margin_top(24);
        box.set_margin_bottom(24);
        box.set_margin_start(24);
        box.set_margin_end(24);
        box.append(new Gtk.Label({
            label: _('Press the new shortcut.\nPress Backspace to clear, or Escape to cancel.'),
            wrap: true,
        }));
        dialog.set_child(box);

        const controller = new Gtk.EventControllerKey();
        controller.connect('key-pressed', (_controller, keyval, _keycode, state) => {
            if (keyval === Gdk.KEY_Escape) {
                dialog.close();
                return true;
            }
            if (keyval === Gdk.KEY_BackSpace) {
                settings.set_strv('toggle-popup', []);
                label.set_accelerator('');
                dialog.close();
                return true;
            }
            if (!Gtk.accelerator_valid(keyval, state))
                return true;

            const accelerator = Gtk.accelerator_name(keyval, state);
            if (!accelerator)
                return true;
            settings.set_strv('toggle-popup', [accelerator]);
            label.set_accelerator(accelerator);
            dialog.close();
            return true;
        });
        dialog.add_controller(controller);
        dialog.present();
    }
}
