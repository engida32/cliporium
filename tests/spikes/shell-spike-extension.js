import Clutter from 'gi://Clutter';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP4z8DAAMIM////ZwAAHu8E/KPItPcAAAAASUVORK5CYII=';
const REPORT = GLib.getenv('CLIPORIUM_SPIKE_REPORT') ??
    '/tmp/opencode/cliporium-phase0-report.txt';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path fill="currentColor" d="M3 2h8a1 1 0 0 1 1 1v1h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm2 3v8h7V5H5Z"/></svg>';

function writeReport(lines) {
    GLib.file_set_contents(REPORT, `${lines.join('\n')}\n`);
}

export default class SpikeExtension extends Extension {
    enable() {
        this._timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 900, () => {
            this._timeout = 0;
            this._run().catch(error => {
                let prior = '';
                try {
                    const [, contents] = GLib.file_get_contents(REPORT);
                    prior = new TextDecoder().decode(contents).trimEnd();
                } catch {
                    prior = '';
                }
                writeReport([
                    ...(prior ? [prior] : []),
                    `FAIL run: ${error.message}`,
                    error.stack ?? '',
                ]);
            });
            return GLib.SOURCE_REMOVE;
        });
    }

    disable() {
        if (this._timeout) {
            GLib.source_remove(this._timeout);
            this._timeout = 0;
        }
    }

    async _run() {
        const lines = [];
        let fails = 0;

        const pass = (name, value) => {
            lines.push(`PASS ${name}: ${value}`);
            writeReport(lines);
        };
        const fail = (name, error) => {
            fails += 1;
            lines.push(`FAIL ${name}: ${error.message ?? error}`);
            writeReport(lines);
        };
        const info = (name, value) => {
            lines.push(`INFO ${name}: ${value}`);
            writeReport(lines);
        };
        const check = (name, fn) => {
            try {
                pass(name, fn());
            } catch (error) {
                fail(name, error);
            }
        };
        info('shell.version', Config.PACKAGE_VERSION);
        info('session.type', GLib.getenv('XDG_SESSION_TYPE') ?? 'unknown');
        info('report.path', REPORT);
        writeReport(lines);

        check('gdkpixbuf.import', () => 'present');
        check('gdkpixbuf.formats', () => {
            const names = GdkPixbuf.Pixbuf.get_formats().map(format => format.get_name());
            return names.includes('png') && names.includes('jpeg')
                ? `png,jpeg present (${names.length} formats)`
                : 'png or jpeg missing';
        });

        const pngBytes = GLib.Bytes.new(GLib.base64_decode(PNG_B64));
        let pixbuf = null;
        check('gdkpixbuf.decode.png', () => {
            const stream = Gio.MemoryInputStream.new_from_bytes(pngBytes);
            pixbuf = GdkPixbuf.Pixbuf.new_from_stream(stream, null);
            return `${pixbuf.get_width()}x${pixbuf.get_height()}`;
        });
        check('gdkpixbuf.scale', () => {
            if (!pixbuf)
                throw new Error('no decoded pixbuf');
            const scaled = pixbuf.scale_simple(40, 40, GdkPixbuf.InterpType.BILINEAR);
            if (!scaled)
                throw new Error('scale returned null');
            return `${scaled.get_width()}x${scaled.get_height()}`;
        });

        const clipboard = St.Clipboard.get_default();
        check('st.clipboard.get_default', () => clipboard ? 'present' : 'missing');
        check('st.clipboard.get_content', () =>
            typeof clipboard.get_content === 'function' ? 'present' : 'missing');
        check('st.clipboard.set_content', () =>
            typeof clipboard.set_content === 'function' ? 'present' : 'missing');
        check('st.clipboard.types', () =>
            typeof St.ClipboardType.CLIPBOARD !== 'undefined' ? 'present' : 'missing');

        check('clipboard.text.set', () => {
            clipboard.set_content(
                St.ClipboardType.CLIPBOARD,
                'text/plain;charset=utf-8',
                GLib.Bytes.new(new TextEncoder().encode('cliporium phase 0'))
            );
            return 'ok';
        });

        const sampleUri = Gio.File.new_for_path(
            GLib.build_filenamev([GLib.get_user_data_dir(), 'cliporium-spike', 'sample file.txt'])
        ).get_uri();

        check('clipboard.uri-list.set', () => {
            clipboard.set_content(
                St.ClipboardType.CLIPBOARD,
                'text/uri-list',
                GLib.Bytes.new(new TextEncoder().encode(`${sampleUri}\r\n`))
            );
            return 'ok';
        });
        check('clipboard.gnome-copied-files.set', () => {
            clipboard.set_content(
                St.ClipboardType.CLIPBOARD,
                'x-special/gnome-copied-files',
                GLib.Bytes.new(new TextEncoder().encode(`copy\n${sampleUri}`))
            );
            return 'ok';
        });

        info('clipboard.read.headless', 'skipped: get_content aborts headless Shell');

        check('gio.appinfo.get_default_for_type', () =>
            typeof Gio.AppInfo.get_default_for_type === 'function' ? 'present' : 'missing');
        check('gio.appinfo.get_default_for_uri_scheme', () =>
            typeof Gio.AppInfo.get_default_for_uri_scheme === 'function' ? 'present' : 'missing');
        check('gio.appinfo.launch_default_for_uri', () =>
            typeof Gio.AppInfo.launch_default_for_uri === 'function' ? 'present' : 'missing');
        info('gio.appinfo.image', (() => {
            try {
                return Gio.AppInfo.get_default_for_type('image/png', false)?.get_name() ?? 'none';
            } catch (error) {
                return `ERR ${error.message}`;
            }
        })());
        info('gio.appinfo.file', (() => {
            try {
                return Gio.AppInfo.get_default_for_uri_scheme('file')?.get_name() ?? 'none';
            } catch (error) {
                return `ERR ${error.message}`;
            }
        })());

        const iconPath = GLib.build_filenamev([
            GLib.get_user_data_dir(),
            'cliporium-spike',
            'cliporium-symbolic.svg',
        ]);
        GLib.mkdir_with_parents(GLib.path_get_dirname(iconPath), 0o700);
        GLib.file_set_contents(iconPath, SVG);
        check('st.icon.file-gicon', () => {
            const gicon = Gio.icon_new_for_string(iconPath);
            const icon = new St.Icon({gicon, icon_size: 16});
            const resolved = typeof icon.get_gicon === 'function'
                ? icon.get_gicon()
                : icon.gicon;
            if (!resolved)
                throw new Error('gicon not set');
            return `loaded ${iconPath}`;
        });
        info('st.icon-theme', typeof St.IconTheme === 'function'
            ? 'present'
            : 'missing (use file GIcon)');
        check('st.texture-cache', () =>
            typeof St.TextureCache === 'function' &&
            typeof St.TextureCache.get_default === 'function'
                ? 'present'
                : 'missing');
        check('st.image-content', () =>
            typeof St.ImageContent === 'function' ? 'present' : 'missing');

        const stSettings = St.Settings.get();
        check('st.enable-animations', () => String(stSettings.enable_animations));
        const actor = new St.Widget();
        check('clutter.actor.ease', () => typeof actor.ease);
        check('clutter.actor.ease_property', () => typeof actor.ease_property);
        check('clutter.timeline', () => {
            const timeline = new Clutter.Timeline({duration: 100});
            return typeof timeline.start === 'function' ? 'present' : 'missing';
        });

        if (GLib.getenv('CLIPORIUM_SPIKE_IMAGE') === '1') {
            info('clipboard.image.set.start', 'before');
            check('clipboard.image.set', () => {
                clipboard.set_content(
                    St.ClipboardType.CLIPBOARD,
                    'image/png',
                    pngBytes
                );
                return `${pngBytes.get_size()} bytes`;
            });
            info('clipboard.image.set.done', 'after');
        }

        lines.push(`SUMMARY fails=${fails}`);
        writeReport(lines);
    }
}
