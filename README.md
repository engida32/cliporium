# Cliporium

Cliporium is a clipboard history for GNOME 50 on Wayland. The Shell extension owns the popup and clipboard access. A Rust daemon owns SQLite, full-text search, image blobs, and backups.

Phase 0 is a working spike, not a finished product. Storage, search, backup, and the D-Bus round trip are covered by tests. The extension packs and installs, but the live popup still needs a check in a logged-in GNOME 50 Wayland session.

## What works

- Text captures are stored in SQLite with SHA-256 deduplication.
- Images are written to a content-addressed blob store and fetched over D-Bus.
- Search uses SQLite FTS5 with the trigram tokenizer, so `rown` finds `brown`.
- Backups use the SQLite online backup API and pass an integrity check before restore.
- The panel button opens a 420 px popup with a search field. Escape closes it.
- The daemon exposes `Ping`, `CaptureText`, `CaptureImage`, `Search`, `Recent`, `GetBlob`, `SetPinned`, and `Delete`.

## Requirements

- Ubuntu 26.04 or another distribution with GNOME Shell 50 on Wayland.
- Rust 1.89 or newer.
- GJS 1.88 or newer.
- `gnome-extensions`, `dbus-run-session`, and the usual GNOME Shell development tools for packing.

## Build

```sh
cargo build --release
gnome-extensions pack --force --out-dir dist extension
```

The daemon binary is `target/release/cliporium-daemon`. The extension bundle is `dist/cliporium@cliporium.github.io.shell-extension.zip`.

## Install for development

```sh
mkdir -p ~/.local/bin
install -m 755 target/release/cliporium-daemon ~/.local/bin/cliporium-daemon
install -d ~/.config/systemd/user
install -m 644 packaging/systemd/cliporium.service ~/.config/systemd/user/cliporium.service
systemctl --user daemon-reload
systemctl --user enable --now cliporium.service
gnome-extensions install --force dist/cliporium@cliporium.github.io.shell-extension.zip
gnome-extensions enable cliporium@cliporium.github.io
```

On Wayland, a newly installed extension may need a session restart before GNOME Shell loads it.

## Privacy

Cliporium stores clipboard history on the local machine. The default paths are:

- `$XDG_DATA_HOME/cliporium/cliporium.sqlite3`
- `$XDG_DATA_HOME/cliporium/blobs/`
- `$XDG_CONFIG_HOME/cliporium/config.toml`
- `$XDG_STATE_HOME/cliporium/`

There is no network code in the daemon or the extension. Nothing is uploaded. Backups are local files that you create. Delete the data directory to remove all history.

## Architecture

```text
GNOME Shell extension (GJS, St)
  capture via Meta.Selection
  anchored popup and search
        |
        | D-Bus, io.github.cliporium.Cliporium
        v
Rust daemon (tokio, zbus)
  SQLite + FTS5
  SHA-256 blob store
  online backup and restore
```

The split exists because `Meta.Selection` and panel anchoring live inside the Shell process, while durable storage and crash-safe writes belong in a separate service that can outlive a Shell restart.

## Test

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
dbus-run-session -- cargo test --workspace
```

The D-Bus test needs an isolated session bus, which is why it runs under `dbus-run-session`.

## Status and known limits

- Live popup behavior on GNOME 50 Wayland is still a manual check.
- The extension captures text and images, but image previews and pin gestures are Phase 1 work.
- `Enter` copies the first result. The final product will copy the focused result.
- The D-Bus name and repository URL use `OWNER` placeholders until the public repository exists.
- A legacy registry parser exists and is tested. Automatic import is not wired to the daemon yet.

## License

MIT. See `LICENSE`.
