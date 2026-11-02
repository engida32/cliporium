#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BASE="${CLIPORIUM_CLEAN_BASE:-/tmp/opencode/cliporium-clean-probe}"
UUID="cliporium@engida32.github.io"
ZIP="$ROOT/dist/$UUID.shell-extension.zip"

case "$BASE" in
    /tmp/opencode/*) ;;
    *)
        echo "CLIPORIUM_CLEAN_BASE must be under /tmp/opencode: $BASE" >&2
        exit 2
        ;;
esac

rm -rf "$BASE"
mkdir -p "$BASE/home" "$BASE/data" "$BASE/config" "$BASE/cache" "$BASE/runtime"
chmod 700 "$BASE/runtime"

export HOME="$BASE/home"
export XDG_DATA_HOME="$BASE/data"
export XDG_CONFIG_HOME="$BASE/config"
export XDG_CACHE_HOME="$BASE/cache"
export XDG_RUNTIME_DIR="$BASE/runtime"
export XDG_DATA_DIRS=/usr/local/share:/usr/share
export GSETTINGS_BACKEND=keyfile

gnome-extensions install --force "$ZIP"
test -f "$XDG_DATA_HOME/gnome-shell/extensions/$UUID/metadata.json"
test -d "$XDG_DATA_HOME/gnome-shell/extensions/$UUID/src"
test -f "$XDG_DATA_HOME/gnome-shell/extensions/$UUID/schemas/gschemas.compiled"
echo "PASS clean-install.files"

gsettings set org.gnome.shell disable-user-extensions false
gsettings set org.gnome.shell enabled-extensions "['$UUID']"
gsettings set org.gnome.shell disable-extension-version-validation true

export BASE UUID
dbus-run-session -- bash -s <<'INNER'
set -euo pipefail
export HOME="$BASE/home"
export XDG_DATA_HOME="$BASE/data"
export XDG_CONFIG_HOME="$BASE/config"
export XDG_CACHE_HOME="$BASE/cache"
export XDG_RUNTIME_DIR="$BASE/runtime"
export XDG_DATA_DIRS=/usr/local/share:/usr/share
export GSETTINGS_BACKEND=keyfile

gnome-shell --headless --wayland --no-x11 --virtual-monitor 1024x768 \
    >"$BASE/shell.out" 2>"$BASE/shell.log" &
SHELL_PID=$!
cleanup() {
    kill "$SHELL_PID" 2>/dev/null || true
    wait "$SHELL_PID" 2>/dev/null || true
}
trap cleanup EXIT

for _ in $(seq 1 80); do
    if gnome-extensions list 2>/dev/null | grep -qx "$UUID"; then
        break
    fi
    sleep 0.25
done

if ! gnome-extensions list 2>/dev/null | grep -qx "$UUID"; then
    echo "PROBE_FAIL: shell did not see the installed extension" >&2
    tail -n 80 "$BASE/shell.log" >&2 || true
    exit 1
fi
echo "PASS clean-install.shell-sees-extension"

info=$(gnome-extensions info "$UUID")
printf '%s\n' "$info"
printf '%s\n' "$info" | grep -q 'Enabled: Yes'
printf '%s\n' "$info" | grep -q "Path: $XDG_DATA_HOME/gnome-shell/extensions/$UUID"
echo "PASS clean-install.enabled"

gnome-extensions disable "$UUID" || true
gnome-extensions uninstall "$UUID"
test ! -e "$XDG_DATA_HOME/gnome-shell/extensions/$UUID"
echo "PASS clean-uninstall.removed"
INNER

echo "PASS clean-install-probe"
