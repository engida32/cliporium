#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BASE="${CLIPORIUM_TOOLBAR_BASE:-/tmp/opencode/cliporium-toolbar-probe}"
REPORT="$BASE/report.txt"
UUID="cliporium@engida32.github.io"

rm -rf "$BASE"
mkdir -p "$BASE/home" "$BASE/data" "$BASE/config" "$BASE/cache" "$BASE/runtime"
chmod 700 "$BASE/runtime"

DEST="$BASE/data/gnome-shell/extensions/$UUID"
mkdir -p "$DEST"
cp -a "$ROOT/extension/metadata.json" "$ROOT/extension/extension.js" \
    "$ROOT/extension/prefs.js" "$ROOT/extension/stylesheet.css" \
    "$ROOT/extension/src" "$ROOT/extension/schemas" "$DEST/"

python3 - "$DEST/extension.js" "$REPORT" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
report = sys.argv[2]
s = path.read_text()
needle = "        this._storage.load();\n    }\n"
patch = '''        this._storage.load();

        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1200, () => {
            const lines = [];
            const write = () => GLib.file_set_contents(
                %r,
                lines.join('\\n') + '\\n'
            );
            const check = (name, condition, detail) => {
                lines.push(`${condition ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
            };
            try {
                this._toggleMenu();
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                    try {
                        const toolbar = this._recentToolbar;
                        const toolbarChildren = toolbar?.get_children?.() ?? [];
                        const settings = this._settingsButton;
                        const labels = [];
                        const collect = actor => {
                            if (!actor)
                                return;
                            if (actor instanceof St.Label && actor.text)
                                labels.push(actor.text);
                            for (const child of actor.get_children?.() ?? [])
                                collect(child);
                        };
                        collect(this._card);

                        check('indicator.icon',
                            this._icon.icon_name === 'edit-copy-symbolic',
                            this._icon.icon_name);
                        check('indicator.name',
                            this.accessible_name ===
                                'Cliporium clipboard history',
                            this.accessible_name ?? 'missing');
                        check('indicator.menu.name',
                            this.menu.actor.accessible_name ===
                                'Cliporium clipboard history',
                            this.menu.actor.accessible_name ?? 'missing');
                        check('menu.open', this.menu.isOpen, String(this.menu.isOpen));
                        check('toolbar.class',
                            toolbar?.get_style_class_name?.() === 'cliporium-toolbar',
                            toolbar?.get_style_class_name?.() ?? 'missing');
                        check('toolbar.children', toolbarChildren.length === 2,
                            String(toolbarChildren.length));
                        check('toolbar.height', toolbar.height <= 34,
                            `${toolbar.height}px`);
                        check('search.height', this._searchPill.height <= 34,
                            `${this._searchPill.height}px`);
                        check('settings.height', settings.height <= 34,
                            `${settings.height}px`);
                        check('settings.focusable', settings.can_focus === true,
                            String(settings.can_focus));
                        check('brand.absent',
                            !labels.some(text => text === 'Cliporium'),
                            labels.filter(text => text === 'Cliporium').join(',') || 'none');
                        const keyFocus = global.stage.get_key_focus();
                        check('search.focus',
                            keyFocus === this._search ||
                                keyFocus === this._search.get_clutter_text(),
                            keyFocus?.constructor?.name ?? 'none');
                        check('search.ring',
                            this._searchPill.get_style_class_name().includes(
                                'cliporium-search-focused'
                            ),
                            this._searchPill.get_style_class_name());
                        check('search.hint',
                            this._searchHint.text === 'Ctrl+K' &&
                                this._searchHint.visible === true,
                            `${this._searchHint.text}/${this._searchHint.visible}`);
                        for (const [name, actor] of [
                            ['settings', settings],
                            ['manage', this._manageButton],
                            ['clear', this._clearButton],
                            ['back', this._backButton],
                            ['pinned.settings', this._pinnedSettingsButton],
                        ]) {
                            check(`${name}.name`,
                                typeof actor.accessible_name === 'string' &&
                                    actor.accessible_name.length > 0,
                                actor.accessible_name ?? 'missing');
                            check(`${name}.focusable`, actor.can_focus === true,
                                String(actor.can_focus));
                        }
                        check('section.title', this._recentTitle.text === 'Recent',
                            this._recentTitle.text);
                        check('footer.count', this._footerCount.text.length > 0,
                            this._footerCount.text);
                        check('footer.visible', this._footerCount.visible === true,
                            String(this._footerCount.visible));
                        check('footer.hints', this._footerHints.visible === true,
                            String(this._footerHints.visible));
                        check('manage.visible', this._manageButton.visible === true,
                            String(this._manageButton.visible));
                        check('clear.visible', this._clearButton.visible === true,
                            String(this._clearButton.visible));
                        check('back.hidden', this._backButton.visible === false,
                            String(this._backButton.visible));
                        check('pinned.header.hidden',
                            this._pinnedHeader.visible === false,
                            String(this._pinnedHeader.visible));
                        check('pinned.search.hidden',
                            this._pinnedSearchRow.visible === false,
                            String(this._pinnedSearchRow.visible));
                        check('list.height.style',
                            this._listScroll.style.includes('max-height'),
                            this._listScroll.style);
                        check('list.rows', this._rowActors.size > 0,
                            String(this._rowActors.size));

                        const firstRow = this._rowActors.values().next().value;
                        const pinButton = firstRow.get_child_at_index(
                            firstRow.get_n_children() - 2
                        );
                        const moreButton = firstRow.get_child_at_index(
                            firstRow.get_n_children() - 1
                        );
                        const firstItem = this._visibleItems[0];
                        check('stage.event_actor.api',
                            typeof global.stage.get_event_actor === 'function',
                            typeof global.stage.get_event_actor);
                        const pinResult = this._onRowPress(
                            firstItem,
                            pinButton,
                            Clutter.BUTTON_PRIMARY,
                            pinButton,
                            moreButton
                        );
                        check('row.pin.propagates',
                            pinResult === Clutter.EVENT_PROPAGATE,
                            String(pinResult));
                        const moreResult = this._onRowPress(
                            firstItem,
                            moreButton,
                            Clutter.BUTTON_PRIMARY,
                            pinButton,
                            moreButton
                        );
                        check('row.more.propagates',
                            moreResult === Clutter.EVENT_PROPAGATE,
                            String(moreResult));
                        const secondaryResult = this._onRowPress(
                            firstItem,
                            pinButton,
                            Clutter.BUTTON_SECONDARY,
                            pinButton,
                            moreButton
                        );
                        check('row.secondary.propagates',
                            secondaryResult === Clutter.EVENT_PROPAGATE,
                            String(secondaryResult));

                        check('card.classes',
                            this._card.get_children().every(
                                child => typeof child.get_style_class_name === 'function'
                            ),
                            String(this._card.get_children().length));

                        const pump = (milliseconds = 0) => {
                            const deadline =
                                GLib.get_monotonic_time() + milliseconds * 1000;
                            do {
                                for (let index = 0; index < 20; index++)
                                    GLib.MainContext.default().iteration(false);
                                if (milliseconds === 0)
                                    break;
                            } while (GLib.get_monotonic_time() < deadline);
                        };
                        this._listScroll.vadjustment.value = 120;
                        pump();
                        check('recent.scroll.set',
                            Math.abs(this._listScroll.vadjustment.value - 120) < 1,
                            String(this._listScroll.vadjustment.value));
                        this._manageButton.emit('clicked', this._manageButton);
                        pump();
                        check('pinned.view', this._showPinnedOnly === true,
                            String(this._showPinnedOnly));
                        check('pinned.scroll',
                            Math.abs(this._listScroll.vadjustment.value) < 1,
                            String(this._listScroll.vadjustment.value));
                        check('pinned.title',
                            this._pinnedTitle.text === 'Pinned items',
                            this._pinnedTitle.text);
                        check('pinned.subtitle',
                            this._pinnedSubtitle.text.includes('saved items'),
                            this._pinnedSubtitle.text);
                        check('pinned.header',
                            this._pinnedHeader.visible === true,
                            String(this._pinnedHeader.visible));
                        check('pinned.back', this._backButton.visible === true,
                            String(this._backButton.visible));
                        check('pinned.manage.hidden',
                            this._manageButton.visible === false,
                            String(this._manageButton.visible));
                        check('pinned.section.hidden',
                            this._sectionHeader.visible === false,
                            String(this._sectionHeader.visible));
                        check('pinned.search',
                            this._pinnedSearchRow.visible === true &&
                                this._search.hint_text === 'Search pinned items…',
                            `${this._pinnedSearchRow.visible}/${this._search.hint_text}`);
                        check('pinned.search.hint.hidden',
                            this._searchHint.visible === false,
                            String(this._searchHint.visible));
                        check('pinned.footer',
                            this._footerCount.text.includes('Select an item to copy') &&
                                this._footerHints.visible === false,
                            `${this._footerCount.text}/${this._footerHints.visible}`);
                        check('pinned.rows', this._rowActors.size === 20,
                            String(this._rowActors.size));

                        this._search.set_text('git');
                        this._refresh();
                        check('pinned.search.scope',
                            this._visibleItems.length === 20 &&
                                this._visibleItems.every(item => item.pinned),
                            `${this._visibleItems.length}/${this._visibleItems.filter(item => item.pinned).length}`);
                        check('pinned.search.title',
                            this._pinnedSubtitle.text === '20 matches',
                            this._pinnedSubtitle.text);
                        this._search.set_text('');
                        this._refresh();

                        this._backButton.emit('clicked', this._backButton);
                        pump(500);
                        check('recent.restored', this._recentTitle.text === 'Recent',
                            this._recentTitle.text);
                        check('recent.scroll',
                            Math.abs(this._listScroll.vadjustment.value - 120) < 1,
                            String(this._listScroll.vadjustment.value));
                        check('recent.manage', this._manageButton.visible === true,
                            String(this._manageButton.visible));
                        check('recent.clear', this._clearButton.visible === true,
                            String(this._clearButton.visible));
                        check('recent.search',
                            this._search.hint_text === 'Search clipboard…' &&
                                this._searchHint.visible === true,
                            `${this._search.hint_text}/${this._searchHint.visible}`);

                        this._search.set_text('git');
                        this._refresh();
                        check('search.title', this._recentTitle.text === 'Results',
                            this._recentTitle.text);
                        check('search.manage.hidden',
                            this._manageButton.visible === false,
                            String(this._manageButton.visible));
                        check('search.clear.hidden',
                            this._clearButton.visible === false,
                            String(this._clearButton.visible));
                        check('search.count',
                            this._footerCount.text.includes('matches'),
                            this._footerCount.text);
                        this._search.set_text('');
                        this._refresh();

                        this._clearButton.emit('clicked', this._clearButton);
                        check('confirm.visible', this._confirmBar.visible === true,
                            String(this._confirmBar.visible));
                        this._showClearConfirm = false;
                        this._renderConfirm();

                        const originalAddKeybinding = Main.wm.addKeybinding;
                        this._settings.set_strv('toggle-popup', ['<Super>v']);
                        Main.wm.addKeybinding = () => Meta.KeyBindingAction.NONE;
                        this._bindShortcut();
                        check('shortcut.warning',
                            (this._shortcutWarning ?? '').includes('Shortcut'),
                            this._shortcutWarning ?? 'missing');
                        check('shortcut.notice',
                            this._noticeLabel.text.includes('Shortcut'),
                            this._noticeLabel.text);
                        Main.wm.addKeybinding = originalAddKeybinding;
                        this._settings.set_strv('toggle-popup', []);
                        this._shortcutWarning = '';
                        this._renderNotice();

                        check('menu.size', this.menu.box.width > 0 && this.menu.box.height > 0,
                            `${this.menu.box.width}x${this.menu.box.height}`);
                        check('card.size', this._card.width > 0 && this._card.height > 0,
                            `${this._card.width}x${this._card.height}`);
                        check('card.fill',
                            this._card.width >= this._section.actor.width - 2,
                            `card=${this._card.width} host=${this._section.actor.width} menu=${this.menu.box.width}`);
                    } catch (error) {
                        lines.push(`FAIL run: ${error.message}`);
                        lines.push(error.stack ?? '');
                    }
                    write();
                    return GLib.SOURCE_REMOVE;
                });
            } catch (error) {
                lines.push(`FAIL run: ${error.message}`);
                lines.push(error.stack ?? '');
                write();
            }
            return GLib.SOURCE_REMOVE;
        });
    }
''' % report
if needle not in s:
    raise SystemExit('needle not found')
s = s.replace(needle, patch, 1)
path.write_text(s)
PY

glib-compile-schemas "$DEST/schemas"
mkdir -p "$BASE/data/cliporium"
python3 - "$BASE/data/cliporium/history.json" <<'PYJSON'
import json
import sys
import time

now = int(time.time() * 1000)
items = []
for index in range(177):
    pinned = index < 20
    items.append({
        'id': f'item-{index}',
        'kind': 'text',
        'text': f'git status --short {index}',
        'preview': f'git status --short {index}',
        'created_at': now - index * 60000,
        'pinned': pinned,
        'source_app': 'org.gnome.Terminal.desktop',
    })
with open(sys.argv[1], 'w', encoding='utf-8') as handle:
    json.dump({'version': 1, 'items': items}, handle)
PYJSON

export BASE
export REPORT

dbus-run-session -- bash -s <<'INNER'
set -euo pipefail
export HOME="$BASE/home"
export XDG_DATA_HOME="$BASE/data"
export XDG_CONFIG_HOME="$BASE/config"
export XDG_CACHE_HOME="$BASE/cache"
export XDG_RUNTIME_DIR="$BASE/runtime"
export XDG_DATA_DIRS=/usr/local/share:/usr/share
export GSETTINGS_BACKEND=keyfile
gsettings set org.gnome.shell disable-user-extensions false
gsettings set org.gnome.shell enabled-extensions "['cliporium@engida32.github.io']"
gsettings set org.gnome.shell disable-extension-version-validation true
if [ -n "${CLIPORIUM_TEXT_SCALE:-}" ]; then
    gsettings set org.gnome.desktop.interface text-scaling-factor "$CLIPORIUM_TEXT_SCALE"
fi
: > "$BASE/shell.log"
gnome-shell --headless --wayland --no-x11 --virtual-monitor 1024x768 \
    >"$BASE/shell.out" 2>"$BASE/shell.log" &
SHELL_PID=$!
cleanup() {
    kill "$SHELL_PID" 2>/dev/null || true
    wait "$SHELL_PID" 2>/dev/null || true
}
trap cleanup EXIT

for _ in $(seq 1 80); do
    if [ -f "$REPORT" ] && grep -qE '^(PASS|FAIL)' "$REPORT"; then
        break
    fi
    sleep 0.25
done

if [ ! -f "$REPORT" ]; then
    echo "PROBE_FAIL: no report" >&2
    grep -Ei 'cliporium|JS ERROR|st-css|css|warning|critical' "$BASE/shell.log" |
        tail -n 80 >&2 || true
    exit 1
fi

cat "$REPORT"

if grep -q '^FAIL ' "$REPORT"; then
    echo "PROBE_FAIL: toolbar checks failed" >&2
    exit 1
fi

if grep -Eqi 'Theme parsing error|st-css.*error' "$BASE/shell.log"; then
    echo "PROBE_FAIL: stylesheet parse error" >&2
    grep -Ei 'Theme parsing error|st-css.*error' "$BASE/shell.log" >&2 || true
    exit 1
fi

echo "PROBE_OK"
INNER
