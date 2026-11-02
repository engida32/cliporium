# Phase 0 compatibility report

> **Superseded architecture note (2026-11-01):** Phase 0 proved the Rust daemon
> and SQLite boundary. That boundary is no longer the first-release
> architecture. The release is now a self-contained GJS extension. See
> `docs/requirements-compliance.md` for current evidence and open gaps. The
> daemon remains an optional future desktop application.

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
| Workspace tests | `dbus-run-session -- cargo test --workspace` | pass |
| Trigram search | `cargo test -p clip-store trigram` | 1 passed |
| Legacy registry fixture | `cargo test -p clip-store legacy_registry` | 1 passed |
| Store hardening | `cargo test -p clip-store` | 15 passed |
| Backup and restore | `cargo test -p clip-backup` | 11 passed |
| D-Bus round trip | `dbus-run-session -- cargo test -p cliporium-daemon dbus_roundtrip` | 1 passed |
| Extension pack | `gnome-extensions pack --force --extra-source=src --extra-source=LICENSE --out-dir dist extension` | 16 entries, 28929 bytes |
| Extension unit tests | `gjs -m tests/*.test.js` | 8 suites passed |
| Headless UI probes | toolbar, pinned, image, and 2x toolbar | pass |
| JS syntax | `node --input-type=module --check < extension/extension.js` | exit 0 |
| Tracked data scan | `git ls-files` plus a path scan | no database, blobs, registry, env, or key files; the only PNG is `docs/design/mockup.png` |

The daemon binary was also exercised with `gdbus` on an isolated session bus. It returned `('pong',)` for `Ping`, stored a text capture, returned the item from `Search`, and created `cliporium.sqlite3`. A second run sent an `image/png` payload through `CaptureImage`; the daemon wrote `blobs/sha256/0f/0f4636...` and reported the blob path and mime type from `Recent`.

FTS5 trigram search passed on a phrase where the query `rown` matched the word `brown`. Short queries use an `instr` fallback because the trigram tokenizer needs at least three characters.

Backup uses the SQLite online backup API and writes a bundle with the database, referenced image blobs, and a checksum manifest. Restore verifies every file before staging a private copy, removes SQLite sidecars, and keeps a pre-restore directory. Tests cover a clean-directory restore, tamper rejection, failed-backup preservation, sidecar handling, and private file modes. The `cliporium-backup` CLI exposes `create`, `verify`, and `restore`, and its integration tests exercise the real binary.

`clip-store` now hardens the Rust data path: 0700 directories, 0600 database and blobs, `quick_check` on open, a schema-version guard, bounded text and image input with PNG/JPEG signature checks, atomic blob writes with fsync, and startup orphan reconciliation. Tests cover permissions, limits, delete ordering, and reconciliation.

The extension polish pass uses `edit-copy-symbolic` with an accessible name, keeps stylesheet text at 11px or larger, warns when a shortcut cannot be bound by checking the `addKeybinding` return value, removes the duplicate image-store method, and runs all GJS suites plus GNOME 50-gated headless probes in CI.

The legacy fixture is a JSON array in the Clipboard Indicator registry shape. The parser reads `favorite`, `mimetype`, `contents`, and `tag`. The importer takes text entries, skips image and empty entries, and pins favorites. The test covers two text entries, one image entry, and one blank entry.

## Not verified

| Item | Why it remains open |
| --- | --- |
| Popup focus, Escape, and keyboard actions | The popup opened and search filtered through AT-SPI in the live GNOME 50.1 session. Synthetic keyboard injection did not reach the popup, so focus, Enter, Escape, pin, and clear remain unverified. |
| Text and image paste | Live text and image capture passed. Restoring the selected item to another application was not exercised. |
| Shortcut conflict with a real binding | The headless probe covers the `Meta.KeyBindingAction.NONE` path; a real conflicting binding still needs a manual check. |

The extension code path for text capture follows the current Clipboard Indicator extension, which is installed here and uses `Meta.SelectionType.SELECTION_CLIPBOARD`, `Shell.Global.get().display.focusWindow`, and the callback form of `St.Clipboard.get_content`. That is good evidence for the API shape, not proof that the new extension captures correctly under load.

## Architecture findings

`Meta.Selection` and the panel popup have to stay in the GNOME Shell process. The daemon owns SQLite, FTS5, blob writes, backup, and restore. The extension talks to the daemon over `io.github.cliporium.Cliporium` and keeps no durable state of its own.

The popup is built from `PanelMenu.Button` and `PopupMenu.PopupMenuSection`. The search field gets focus 50 ms after the menu opens. Escape is handled on the search entry and closes the menu. The menu width is set to 420 px in `extension/stylesheet.css`.

Image bytes travel over D-Bus as `ay`. The daemon hashes the bytes with SHA-256, writes a temporary file, renames it into the content-addressed path, and returns an item id. `GetBlob` reads the file back. The D-Bus test and the manual `gdbus` run both exercised this path.

## Assumptions and risks

- `io.github.cliporium.Cliporium` is a placeholder. The public D-Bus name should follow the final repository owner.
- The public repository is `engida32/cliporium`; the planned `OWNER` placeholders were replaced before release.
- The extension declares only GNOME Shell 50, as agreed for v1.
- The live check confirmed upgrade activation, popup layout, search, text and image capture, private mode, capture-off suppression, shortcut opening, and disable/enable. Keyboard focus, paste, pins, clear, clean install, and screenshots remain open.
- A legacy registry parser and text importer exist and are tested. Automatic import is not wired to the daemon or prefs yet. The current registry and recovery backup were not modified.

## Next steps

1. Run `docs/live-verification.md` in a GNOME 50 Wayland session and record the popup, focus, Escape, text capture, and image capture results.
2. Run the parser against copies of the 220-item live registry and the 118-item recovery backup, then wire import to the daemon or prefs.
3. Confirm the public repository name and D-Bus naming; the released extension uses the `engida32` namespace and does not use the daemon.
4. Add image previews, pin gestures, and the overflow menu after the Phase 0 UI check.
