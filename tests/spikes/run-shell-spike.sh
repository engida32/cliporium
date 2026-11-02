#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BASE="${CLIPORIUM_SPIKE_BASE:-/tmp/opencode/cliporium-phase0-spike}"
REPORT="$BASE/report.txt"
UUID="cliporium-spike@local"

rm -rf "$BASE"
mkdir -p "$BASE/home" "$BASE/data" "$BASE/config" "$BASE/cache" "$BASE/runtime"
chmod 700 "$BASE/runtime"

DEST="$BASE/data/gnome-shell/extensions/$UUID"
mkdir -p "$DEST"
cp "$ROOT/tests/spikes/shell-spike-extension.js" "$DEST/extension.js"
cat > "$DEST/metadata.json" <<'JSON'
{
  "uuid": "cliporium-spike@local",
  "name": "Cliporium Spike",
  "description": "Temporary Shell API spike for Cliporium.",
  "shell-version": ["50"]
}
JSON

export BASE
export CLIPORIUM_SPIKE_REPORT="$REPORT"

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
gsettings set org.gnome.shell enabled-extensions "['cliporium-spike@local']"
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
    if [ -f "$CLIPORIUM_SPIKE_REPORT" ] && grep -qE '^(SUMMARY|FAIL run)' "$CLIPORIUM_SPIKE_REPORT"; then
        break
    fi
    sleep 0.25
done

if [ ! -f "$CLIPORIUM_SPIKE_REPORT" ]; then
    echo "SPIKE_FAIL: no report" >&2
    echo "--- shell log ---" >&2
    grep -Ei 'spike|JS ERROR|warning|critical' "$BASE/shell.log" | tail -n 80 >&2 || true
    exit 1
fi

cat "$CLIPORIUM_SPIKE_REPORT"

if ! grep -q '^SUMMARY ' "$CLIPORIUM_SPIKE_REPORT"; then
    echo "SPIKE_FAIL: incomplete report" >&2
    echo "--- shell log ---" >&2
    grep -Ei 'spike|JS ERROR|abort|segmentation|critical' "$BASE/shell.log" | tail -n 80 >&2 || true
    exit 1
fi

if grep -q '^FAIL ' "$CLIPORIUM_SPIKE_REPORT"; then
    echo "SPIKE_FAIL: one or more checks failed" >&2
    exit 1
fi

echo "SPIKE_OK"
INNER
