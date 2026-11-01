# Phase 0 compatibility report

Date: 2026-11-01

Phase 0 proves the storage and process boundary. One acceptance item remains: the live popup check in a logged-in GNOME 50 Wayland session. I did not enable the extension in your desktop session, so I am not claiming that check.

## Environment

| Item | Value |
| --- | --- |
| OS | Ubuntu 26.04.1 LTS |
| Kernel | 7.0.0-42-generic |
| Session | Wayland |
| GNOME Shell | 50.1 |
| GJS | 1.88.0 |
| Rust | 1.97.1 |
| Cargo | 1.97.1 |
| System SQLite | 3.46.1 |
| Bundled SQLite | libsqlite3-sys 0.39.1, FTS5 enabled |
| D-Bus | zbus 6.2.0 |
| SQLite crate | rusqlite 0.41.1 |

## Verified

| Check | Command | Result |
| --- | --- | --- |
| Format | `cargo fmt --all --check` | clean |
| Clippy | `cargo clippy --workspace --all-targets -- -D warnings` | clean |
| Workspace tests | `dbus-run-session -- cargo test --workspace` | 9 passed |
| Trigram search | `cargo test -p clip-store trigram` | 1 passed |
| Legacy registry fixture | `cargo test -p clip-store legacy_registry` | 1 passed |
| Backup and restore | `cargo test -p clip-backup backup_restore` | 1 passed |
| D-Bus round trip | `dbus-run-session -- cargo test -p cliporium-daemon dbus_roundtrip` | 1 passed |
| Extension pack | `gnome-extensions pack --force --out-dir dist extension` | 3 files, 11866 bytes |
| JS syntax | `node --input-type=module --check < extension/extension.js` | exit 0 |
| Tracked data scan | `git ls-files` plus a path scan | no database, blobs, registry, env, or key files; the only PNG is `docs/design/mockup.png` |

The daemon binary was also exercised with `gdbus` on an isolated session bus. It returned `('pong',)` for `Ping`, stored a text capture, returned the item from `Search`, and created `cliporium.sqlite3`. A second run sent an `image/png` payload through `CaptureImage`; the daemon wrote `blobs/sha256/0f/0f4636...` and reported the blob path and mime type from `Recent`.

FTS5 trigram search passed on a phrase where the query `rown` matched the word `brown`. Short queries use an `instr` fallback because the trigram tokenizer needs at least three characters.

Backup uses the SQLite online backup API, runs an integrity check on the destination, and restores through a temporary file. The test verifies row count, FTS matches, restore integrity, and search after restore.

The legacy fixture is a JSON array in the Clipboard Indicator registry shape. The parser reads `favorite`, `mimetype`, `contents`, and `tag`. The importer takes text entries, skips image and empty entries, and pins favorites. The test covers two text entries, one image entry, and one blank entry.

## Not verified

| Item | Why it remains open |
| --- | --- |
| Popup opens, search receives focus, Escape closes | Requires enabling the extension in the live GNOME Shell session. A Wayland Shell may need a logout or restart before it loads a newly installed extension. |
| Text capture through `Meta.Selection` | The code listens for `owner-changed` and reads `St.Clipboard.get_content`, but no live copy event was exercised. |

The extension code path for text capture follows the current Clipboard Indicator extension, which is installed here and uses `Meta.SelectionType.SELECTION_CLIPBOARD`, `Shell.Global.get().display.focusWindow`, and the callback form of `St.Clipboard.get_content`. That is good evidence for the API shape, not proof that the new extension captures correctly under load.

## Architecture findings

`Meta.Selection` and the panel popup have to stay in the GNOME Shell process. The daemon owns SQLite, FTS5, blob writes, backup, and restore. The extension talks to the daemon over `io.github.cliporium.Cliporium` and keeps no durable state of its own.

The popup is built from `PanelMenu.Button` and `PopupMenu.PopupMenuSection`. The search field gets focus 50 ms after the menu opens. Escape is handled on the search entry and closes the menu. The menu width is set to 420 px in `extension/stylesheet.css`.

Image bytes travel over D-Bus as `ay`. The daemon hashes the bytes with SHA-256, writes a temporary file, renames it into the content-addressed path, and returns an item id. `GetBlob` reads the file back. The D-Bus test and the manual `gdbus` run both exercised this path.

## Assumptions and risks

- `io.github.cliporium.Cliporium` is a placeholder. The public D-Bus name should follow the final repository owner.
- `README.md`, `metadata.json`, the systemd unit, and CI use `OWNER` until the repository is created.
- The extension declares only GNOME Shell 50, as agreed for v1.
- The live UI test can change the verdict on focus timing, popup size, and clipboard capture. Treat those as unproven until the session check.
- A legacy registry parser and text importer exist and are tested. Automatic import is not wired to the daemon or prefs yet. The current registry and recovery backup were not modified.

## Next steps

1. Enable the extension in a GNOME 50 Wayland session and record the popup, focus, Escape, text capture, and image capture results.
2. Run the parser against copies of the 220-item live registry and the 118-item recovery backup, then wire import to the daemon or prefs.
3. Replace the `OWNER` placeholders and confirm the D-Bus name.
4. Add image previews, pin gestures, and the overflow menu after the Phase 0 UI check.
