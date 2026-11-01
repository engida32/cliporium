# Cliporium

Cliporium is a local clipboard history extension for GNOME Shell 50. It runs
entirely inside the Shell process, stores plain text history in your user data
directory, and never sends clipboard data anywhere.

The first release is a self-contained GJS extension. No daemon, external
script, bundled binary, or database is required.

## Features

- Captures plain text from the clipboard after you enable the extension.
- Deduplicates repeated text and moves the existing item to the top.
- Search as you type, with the search field focused when the popup opens.
- Keyboard navigation, Enter to restore, Escape to clear or close.
- Pin and unpin up to 100 items. Pinned items survive history trimming.
- Delete one item, clear unpinned history, or clear everything with a
  two-step confirmation.
- Private mode and a separate capture on/off switch.
- Configurable history limit, content-size limit, retention period, panel
  indicator visibility, and optional keyboard shortcut. The shortcut is unset
  by default.
- Atomic writes, load validation, and recovery from missing, malformed, or
  incompatible history files.

## Requirements

- GNOME Shell 50 on the Wayland session shipped with Ubuntu 26.04. This release
  does not support an X11 session; the target host has no X11 session files and
  `gnome-shell --help` exposes no X11 option.
- GJS 1.88 or newer for development.
- `gnome-extensions` from GNOME Shell for packing and installing.

## Install from source

```sh
mkdir -p dist
gnome-extensions pack --force \
  --extra-source=src \
  --extra-source=LICENSE \
  --schema=schemas/org.gnome.shell.extensions.cliporium.gschema.xml \
  --out-dir=dist extension
gnome-extensions install --force \
  dist/cliporium@engida32.github.io.shell-extension.zip
gnome-extensions enable cliporium@engida32.github.io
```

A newly installed extension may need a logout or a Shell restart before the
running session loads it.

Open the preferences window to set a keyboard shortcut:

```sh
gnome-extensions prefs cliporium@engida32.github.io
```

## Usage

Click the clipboard icon in the panel, or use the shortcut you configured. Type
to filter, use Up and Down to move, press Enter to copy the selected item, and
press Escape to clear the query or close the popup.

The item submenu also exposes Copy, Pin or Unpin, and Delete. The Clear history
submenu has separate actions for unpinned items and for all items.

## Storage and privacy

History is stored at:

```text
$XDG_DATA_HOME/cliporium/history.json
```

The extension reads clipboard text to provide local history. It does not use the
network, telemetry, or analytics, and it does not log clipboard contents.
Clipboard history can contain sensitive information. Use private mode or turn
capture off when you do not want an item stored. Clear history from the popup, or
remove the data directory to delete everything.

## Development

```sh
gjs -m tests/history.test.js
gjs -m tests/storage.test.js
gjs -m tests/bench_history.js
node --check extension/extension.js
node --check extension/prefs.js
for file in extension/src/*.js; do node --check "$file"; done
```

The repository also contains a Rust workspace for a possible future desktop
application. It is not part of the extension package and is not required for
the GNOME release.

## Architecture

```text
extension/
  extension.js        extension lifecycle, indicator, popup, keyboard handling
  prefs.js            Adwaita preferences window
  src/clipboard.js    guarded clipboard text reader
  src/history.js      history model, dedupe, pinning, limits, retention
  src/search.js       query matching
  src/storage.js      atomic JSON persistence and recovery
  schemas/            GSettings schema
  stylesheet.css      popup styling
tests/                GJS unit tests
```

The Shell process only imports Shell, St, Clutter, Meta, GLib, and GObject
modules. The preferences process only imports GTK, GDK, Adwaita, Gio, and GLib
modules.

## Compatibility and limits

- Tested headlessly on GNOME Shell 50.1 Wayland. A live logged-in session check
  is still open.
- Plain text only. Images, application exclusions, and extension-side backup and
  restore are not implemented.
- The extension stores JSON with atomic replacement. It does not claim SQLite
  durability or transactional guarantees.
- GNOME Extensions review is not guaranteed.

## Publishing

GNOME Extensions is the review and distribution authority. Extension Manager is
a client that installs from GNOME Extensions. The release steps are documented
in [`docs/publishing.md`](docs/publishing.md).

The metadata URL and UUID use the `engida32` account namespace. The public
repository is <https://github.com/engida32/cliporium>; `develop` is the default
branch until the first release. Replacing the URL with a different owner
requires updating `metadata.json` and the pack command.

## License

MIT. See [`LICENSE`](LICENSE). MIT is compatible with the GPL-2.0-or-later terms
used by GNOME Shell.
