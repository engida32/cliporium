#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BASE="${CLIPORIUM_IMAGE_BASE:-/tmp/opencode/cliporium-image-probe}"
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

                        const item = this._visibleItems[0];
                        check('image.loaded', item?.kind === 'image',
                            item?.kind ?? 'missing');
                        check('image.title', labels.includes('Image'),
                            labels.join(' | '));
                        check('image.meta',
                            labels.some(text => text.includes('PNG') &&
                                text.includes('2 × 2') && text.includes('77 B')),
                            labels.join(' | '));

                        const row = item ? this._rowActors.get(item.id) : null;
                        const icon = row?.get_child_at_index?.(0);
                        check('image.thumb.class',
                            icon?.get_style_class_name?.().includes(
                                'cliporium-row-thumb'
                            ) === true,
                            icon?.get_style_class_name?.() ?? 'missing');
                        check('image.thumb.child', icon?.get_child?.() !== null,
                            String(icon?.get_child?.() ?? 'none'));
                        const thumb = icon?.get_child?.();
                        check('image.thumb.content',
                            thumb?.content !== null && thumb?.content !== undefined,
                            `${thumb?.constructor?.name ?? 'none'} content=${thumb?.content ? 'yes' : 'no'} size=${thumb?.width}x${thumb?.height}`);

                        const realClipboard = this._clipboard;
                        const rowCopies = [];
                        this._clipboard = {
                            set_content: (...args) => rowCopies.push(args),
                        };
                        this._onRowPress(item, null, Clutter.BUTTON_PRIMARY, null, null);
                        this._clipboard = realClipboard;
                        check('image.preview.rowpress',
                            this._previewBox?.visible === true &&
                                rowCopies.length === 0,
                            `${this._previewBox?.visible} copies=${rowCopies.length}`);
                        check('image.preview.list.hidden',
                            this._listScroll.visible === false,
                            String(this._listScroll.visible));
                        check('image.preview.title',
                            this._previewTitle?.text === 'Image',
                            this._previewTitle?.text ?? 'missing');
                        const previewDeadline = GLib.get_monotonic_time() + 300000;
                        while (GLib.get_monotonic_time() < previewDeadline) {
                            while (GLib.MainContext.default().pending())
                                GLib.MainContext.default().iteration(false);
                            GLib.usleep(10000);
                        }
                        const previewActor = this._previewImageBin?.get_child?.();
                        check('image.preview.image',
                            previewActor?.content !== null && previewActor?.content !== undefined,
                            `${previewActor?.constructor?.name ?? 'none'} content=${previewActor?.content ? 'yes' : 'no'}`);
                        check('image.preview.meta',
                            this._previewMeta?.text?.includes('2 × 2') === true,
                            this._previewMeta?.text ?? 'missing');
                        this._previewPin.emit('clicked', this._previewPin);
                        check('image.preview.pin',
                            this._previewItem()?.pinned === true &&
                                this._previewBox.visible === true,
                            `pinned=${this._previewItem()?.pinned} visible=${this._previewBox.visible}`);
                        this._previewPin.emit('clicked', this._previewPin);
                        check('image.preview.unpin',
                            this._previewItem()?.pinned === false &&
                                this._previewBox.visible === true,
                            `pinned=${this._previewItem()?.pinned} visible=${this._previewBox.visible}`);
                        labels.length = 0;
                        collect(this._card);
                        check('image.preview.actions',
                            ['Copy image', 'Open image', 'Pin image', 'Close preview']
                                .every(text => labels.includes(text)),
                            labels.join(' | '));
                        this._onKeyPress({
                            get_key_symbol: () => Clutter.KEY_Escape,
                            get_state: () => 0,
                        });
                        check('image.preview.escape',
                            this._previewId === null && this._listScroll.visible === true,
                            `preview=${this._previewId ?? 'none'} list=${this._listScroll.visible}`);

                        this._search.set_text('png');
                        this._refresh();
                        check('image.search',
                            this._visibleItems.length === 1 &&
                                this._visibleItems[0].kind === 'image',
                            `${this._visibleItems.length}/${this._visibleItems[0]?.kind}`);
                        this._search.set_text('');
                        this._refresh();

                        let payload = null;
                        this._clipboard = {
                            set_content: (_type, mime, bytes) => {
                                payload = {mime, size: bytes.get_size()};
                            },
                        };
                        this._copy(item);
                        this._clipboard = realClipboard;
                        check('image.copy.mime', payload?.mime === 'image/png',
                            payload?.mime ?? 'missing');
                        check('image.copy.bytes', payload?.size > 0,
                            String(payload?.size ?? 0));
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
mkdir -p "$BASE/data/cliporium/images"
python3 - "$BASE/data/cliporium" <<'PYJSON'
import base64
import hashlib
import json
import sys
import time
from pathlib import Path

root = Path(sys.argv[1])
png = base64.b64decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP4z8DAAMIM////ZwAAHu8E/KPItPcAAAAASUVORK5CYII='
)
sha = hashlib.sha256(png).hexdigest()
(root / 'images' / f'{sha}.png').write_bytes(png)
now = int(time.time() * 1000)
items = [{
    'id': 'image-1',
    'kind': 'image',
    'text': '',
    'preview': 'Image',
    'mime': 'image/png',
    'byte_size': len(png),
    'blob_path': f'images/{sha}.png',
    'sha256': sha,
    'width': 2,
    'height': 2,
    'created_at': now,
    'pinned': False,
    'source_app': 'org.gnome.Screenshot.desktop',
}]
with open(root / 'history.json', 'w', encoding='utf-8') as handle:
    json.dump({'version': 2, 'items': items}, handle)
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
    echo "PROBE_FAIL: image checks failed" >&2
    exit 1
fi

if grep -Eqi 'Theme parsing error|st-css.*error' "$BASE/shell.log"; then
    echo "PROBE_FAIL: stylesheet parse error" >&2
    grep -Ei 'Theme parsing error|st-css.*error' "$BASE/shell.log" >&2 || true
    exit 1
fi

echo "PROBE_OK"
INNER
