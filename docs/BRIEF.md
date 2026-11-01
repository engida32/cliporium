# Brief: Cliporium, an Ubuntu clipboard manager

> **Superseded architecture note (2026-11-01):** The first release is a
> self-contained GJS GNOME Shell extension with no required daemon, SQLite, or
> bundled binaries. This brief describes the original daemon-backed product
> plan. The Rust workspace remains in the repository as an optional future
> desktop application. See `docs/ubuntu_clip_requirements.md`,
> `docs/requirements-compliance.md`, and `README.md` for the release contract.

Status: approved
Date: 2026-11-01
Project root: `/home/emmrc-02/personal-works/ubuntu clipy`
Design sources: `docs/Ubuntu_Clip_Implementation_Blueprint.pdf`, `docs/Ubuntu_Clip_Implementation_Blueprint.docx`, `docs/design/mockup.png`
Working title: **Cliporium** (recommended; pending confirmation). The blueprint title "Ubuntu Clip" stays in the design archive until the rename is confirmed. The folder path stays as it is for now.

## Naming

The working name is **Cliporium**. The name reads as a place for clips, is easy to type, and does not use the Ubuntu trademark. I checked GitHub, crates.io, and npm for direct collisions; no clipboard manager uses Cliporium. This is not a trademark or domain clearance.

Alternatives:

- **Clipique**: a clip boutique. Elegant and short, but the pronunciation is less obvious.
- **Clipdepot**: a store for clips. Sturdy and reliability-focused, but more utilitarian.
- **Clipwarden**: a guardian of clips. Strong reliability tone, but it may imply security guarantees the app does not make.

Names I rejected because they are already used by clipboard tools: ClipShelf, ClipNest, ClipDock, ClipDeck, ClipHaven, ClipHarbor, ClipVault, ClipKeeper, PasteShelf, ClipWharf, ClipStead.

## Goal

Turn the blueprint and mockup into a working, keyboard-first clipboard manager for Ubuntu: it opens on a shortcut, focuses search immediately, keeps pinned and recent clips easy to reach, captures text and images, and never loses committed history after a crash, restart, or upgrade. Open-source the result with a clean Git Flow history, CI, release artifacts, and documentation that another contributor can follow.

## Who it is for

You, on Ubuntu 26.04.1 LTS, GNOME Shell 50.1, Wayland. After v1, other GNOME users who want a reliable clipboard manager that stays local and does not need a cloud account.

## Success signals

- The popup opens from the global shortcut and focuses search in under one second.
- A search over 1,000 items returns the right substring matches in under 50 ms, with no regex crashes.
- Pin, search, navigate, copy, and close all work without a mouse.
- Text and image clips survive `kill -9`, GNOME Shell restart, daemon restart, and reboot.
- A verified backup restores the database and every referenced blob, byte for byte.
- The current extension's 220-item registry and the 9.9 MB backup import without deleting the source files.
- The repository has a green CI pipeline, MIT license, changelog, contribution guide, and release artifacts.

## Non-goals for v1

- Cloud sync, accounts, telemetry, or clipboard sharing across devices.
- OCR, AI summaries, semantic search, or automatic classification.
- Universal Wayland support or guaranteed synthetic paste into every application.
- A full GTK4 workspace window. v1 is the panel popup and preferences only.
- Encrypted backups. Defer to v1.1 with a reviewed format, not custom cryptography.
- Rewriting the GNOME Shell extension out of GJS.

## Constraints

- Target Ubuntu 26.04 LTS, GNOME Shell 50, Wayland first. X11 is best-effort, not a v1 release gate.
- The installed extension proves clipboard capture through `Meta.Selection` inside the Shell process (`extension.js:999-1083`). A standalone Rust process cannot portably observe clipboard changes on this Wayland session.
- A separate GTK4 window cannot reliably anchor under the panel on Wayland. The popup stays in the Shell extension, built with St/Clutter.
- Rust 1.97.1 is installed. GJS 1.88.0 and the GTK4/Adw typelibs are present. `pkg-config` does not see GTK4 or Libadwaita development headers, so a Rust GTK4 build would need new packages. v1 avoids that by using GJS for preferences.
- SQLite 3.46.1 is installed. FTS5 and the trigram tokenizer are available; this was checked with a live query.
- The current extension is MIT licensed (`LICENSE.rst`). Reuse is allowed if the original copyright notice is preserved.
- The project directory has no git repository yet.
- No real clipboard contents go into git. Tests use synthetic fixtures. The local migration test reads the user's files but writes to a temporary data directory.

## What I checked

- The blueprint PDF (7 pages) and the embedded mockup.
- The installed extension at `/home/emmrc-02/.local/share/gnome-shell/extensions/clipboard-indicator@tudmotu.com/`.
- Capture code at `extension.js:999-1083`, source-app lookup at `extension.js:1008-1009`, restore at `extension.js:1910-1915`.
- Registry format at `registry.js:15-17`, `registry.js:46-70`, `registry.js:81-83`, `registry.js:170-190`.
- The current registry: 220 items, 20 favorites, 26 PNG images, 2 GIF images.
- The recovery backup: 118 items, 18 favorites, 14 PNG images. It is a valid JSON array.
- The recovery folder: `/home/emmrc-02/clipboard-indicator-recovery-2026-10-29/`.

## Design review

### What is strong

The reliability model is the best part of the blueprint. SQLite WAL, `synchronous=FULL`, content-addressed blobs, commit ordering, startup checks, staged restore, and a failure matrix are the right foundations. The mockup also has a clear hierarchy: search first, pinned shelf, recent list, keyboard footer. The visual language is recognisably Ubuntu without copying a web dashboard.

### What I would change

1. **Capture moves into the extension.** The blueprint says the Rust service owns capture. On GNOME Wayland, the proven path is the Shell extension's `Meta.Selection` owner-changed signal. The Rust daemon should own storage, search, backup, recovery, and retention, and receive captures over D-Bus. This is the largest architectural correction.
2. **The popup stays in St, not GTK4.** A separate GTK4 window cannot anchor under the panel on Wayland. Keeping the popup inside the extension preserves the mockup's anchored position, outside-click dismissal, and focus behaviour. GTK4/Libadwaita remains the toolkit for `prefs.js`.
3. **"Paste" becomes "Copy".** Synthetic paste is not guaranteed on Wayland. Enter restores the item to the clipboard and closes the popup. The UI then shows "Copied. Press Ctrl+V." The footer says `Enter Copy`, not `Enter Paste`.
4. **"Manage" in the pinned shelf goes away.** It implies a separate mode, which the blueprint says pinning is not. Pinning stays on the row action and `Ctrl+P`.
5. **"Clear" moves out of the Recent header.** A destructive action beside a section header is easy to misclick. Clear history belongs in the overflow menu with a confirmation and an undo path.
6. **Pin uses `Ctrl+P`, not `P`.** Search has focus on open, so a bare `P` must type. `Ctrl+P` works from anywhere in the popup.
7. **The pinned shelf keeps its horizontal design, but keyboard behaviour is explicit.** Left and Right move within the shelf. Up and Down move between the shelf and the recent list. A vertical pinned group is a possible v1.1 change after a usability test.
8. **The popup width follows the blueprint, not the mockup's presentation scale.** Target 420 px wide and 560 to 640 px tall, adaptive to screen height. The mockup is a presentation image, not a pixel spec.
9. **The product name should not use "Ubuntu" without permission.** "Cliporium" avoids Canonical trademark risk and still reads as an Ubuntu-native tool.
10. **Source app is best-effort.** The extension can read the focused window's `wm_class` at capture time (`extension.js:1008-1009`). That is not proof of the clipboard owner, so exclusions and labels must treat it as a hint.

## Architecture

### Process model

```text
GNOME Shell 50 (Wayland)
  cliporium-extension (GJS)
    panel indicator
    global shortcut
    Meta.Selection capture
    St popup: search, pinned shelf, recent list, footer
    image spool writer

        D-Bus: io.github.<owner>.Cliporium

  cliporium-daemon (Rust, systemd user service)
    versioned D-Bus API
    SQLite + FTS5 trigram
    content-addressed blob store
    retention and garbage collection
    backup, restore, export, import
    migration from Clipboard Indicator

        disk

  $XDG_DATA_HOME/cliporium/cliporium.sqlite3
  $XDG_DATA_HOME/cliporium/blobs/sha256/...
  $XDG_CONFIG_HOME/cliporium/config.toml
  $XDG_STATE_HOME/cliporium/state.json
  $XDG_STATE_HOME/cliporium/logs/
```

Preferences run as `prefs.js` inside the GNOME Extensions process using GJS plus GTK4/Adw. They talk to the daemon over D-Bus. v1 has two long-running processes, the extension and the daemon. There is no separate Rust UI binary.

### Why this differs from the blueprint

The blueprint's "Rust service owns capture" and "GTK4 popup anchored to the panel" cannot both hold on GNOME 50 Wayland. The extension is the only component with access to `Meta.Selection` and the panel's layout. The daemon remains the owner of durability and search. This split keeps the Shell layer thin in responsibility, even though it owns the popup UI.

### D-Bus boundary

Use `io.github.<owner>.Cliporium` on the session bus, with `org.freedesktop.DBus.Properties` for status. Version the interface independently from the on-disk schema.

Core methods:

- `Capture(mime, bytes, source_app, spool_path)` returns the clip id and whether it was a duplicate.
- `List(limit, offset)` and `Search(query, limit)` return clip records.
- `Pin(id, pinned)`, `Delete(id)`, `Clear()` return a result.
- `GetStatus()` returns item count, private mode, last backup, disk state, and capture pause state.
- `BackupNow()` returns the snapshot path. `Restore(bundle)` returns a result.
- `Export(path)` and `Import(path)` for portable bundles.
- `GetConfig()` and `SetConfig(toml)` for preferences.

Signals: `Changed`, `CaptureSaved`, `Error(code, message)`.

Text goes through D-Bus directly with a size cap. Images and other large payloads are written by the extension to `$XDG_RUNTIME_DIR/cliporium/spool/<uuid>` with mode `0600`, then the path is sent. The daemon validates the file, hashes it, and moves it into the blob store. The spool is cleared on startup. If spool transfer proves unreliable, the fallback is a bounded D-Bus byte array with a smaller cap.

### Storage

SQLite database at `$XDG_DATA_HOME/cliporium/cliporium.sqlite3`.

Settings: WAL, `foreign_keys=ON`, `synchronous=FULL`, `busy_timeout=5000`, `wal_autocheckpoint=1000`, `journal_size_limit` set to a bounded value. One serialized writer connection, separate read connections.

Tables:

- `clips`: id, created_at, updated_at, mime_type, kind, preview, text_content, blob_hash, byte_size, content_hash, source_app, pinned, sensitive, capture_status, schema_version.
- `blobs`: hash, byte_size, mime_type, created_at, last_seen_at. This supports reference counting and garbage collection.
- `clips_fts`: FTS5 external-content table over text_content, preview, and source_app, using `tokenize='trigram'`.
- `schema_migrations`: version, applied_at.
- `migrations`: source path, source mtime, source hash, imported_at, item count. This makes the importer idempotent.

Deduplicate by `content_hash`. Pinned items are exempt from automatic age and count retention. Large binary payloads never go into SQLite.

### Search

Case-insensitive substring search. Whitespace-separated terms are ANDed. Quoted phrases are supported. Regex is not a user-facing feature in v1. Queries of one or two characters fall back to `LIKE` because the trigram tokenizer needs at least three characters. Search covers text, preview, tags, and source app. Image entries are searchable by preview text and source app, not by pixel content. The extension debounces input by 80 ms and keeps the previous list visible while a query runs.

### Backup and restore

A backup is a directory bundle containing a consistent SQLite snapshot, all referenced blobs, `manifest.json`, SHA-256 checksums, app version, schema version, and creation time.

- Use the SQLite Online Backup API. Do not copy a live WAL database file alone.
- Verify the snapshot with `PRAGMA integrity_check` before publishing it.
- Keep 7 daily and 4 weekly snapshots, plus a manual snapshot.
- Never prune the last verified snapshot.
- `Export` produces a single `.cliporium` archive. `Import` verifies and restores into a staging directory.
- Restore preserves the current data as a pre-restore snapshot, then switches the active directory atomically on the same filesystem.
- If any verification step fails, keep the old active data and report the failure.

External-folder backup and encryption are v1.1.

### Migration from Clipboard Indicator

Read `registry.txt` and `registry.txt~` as JSON arrays. Each item has `favorite`, `mimetype`, and `contents`, plus an optional `tag`.

- Text items become clips with a synthetic `created_at` that preserves registry order, because the registry has no timestamps.
- Image items reference a path in the old cache. Copy the bytes into the blob store, deduplicate by hash, and generate a thumbnail.
- Favorites become pinned.
- Missing image files are skipped and counted in a migration report.
- The importer never moves or deletes old files. It is idempotent and can run again without duplicating items.
- The 220-item current registry and the 118-item recovery backup are the real local fixtures. The repository uses synthetic fixtures only.

### Preferences

`prefs.js` uses GTK4/Adw. Pages: General, History, Backup, Privacy, Shortcuts, About. It reads and writes daemon config through D-Bus. The extension's own GSettings schema holds UI-only preferences such as the panel label mode. Avoid two sources of truth for retention and backup settings.

### Keyboard model

- `Super+Shift+V`: toggle popup. Configurable.
- `Ctrl+K` or `/`: focus search.
- Up/Down: move between rows.
- Left/Right: move within the pinned shelf.
- `Enter`: copy selected item to the clipboard and close.
- `Ctrl+P`: pin or unpin the selected item.
- `Delete`: delete the selected history item.
- `Ctrl+1` through `Ctrl+9`: select pinned items.
- `Escape`: clear a non-empty query, then close.
- `Shift+F10` or the Menu key: open the selected row's actions.

The global shortcut uses the extension's keybinding in v1. The Global Shortcuts portal is documented as an alternative, but it is not required while the extension already owns the panel and capture.

### Popup layout

- 420 px wide, 560 to 640 px tall, adaptive.
- Header: icon, "Cliporium", item count, overflow, close.
- Search field: focused on open, with a `Ctrl+K` hint.
- Pinned shelf: horizontal chips with icon and truncated title. Full text in the accessible label and tooltip.
- Recent list: icon, one or two preview lines, relative time, pin and overflow actions. Selected row has a subtle Ubuntu orange leading accent and a visible focus ring.
- Footer: `↑↓ Navigate`, `Enter Copy`, `Ctrl+P Pin`, `Esc Close`.
- Overflow: Private mode, Back up now, Restore, Export, Clear history, Settings. Clear history asks for confirmation and offers undo.
- Empty states: no history, no results, private mode on, daemon offline, disk full, backup failed, restore failed.
- Motion: a short opacity and scale transition on open, disabled when the system asks for reduced motion.

### Accessibility

Every interactive element gets an accessible name and role. Row actions are reachable from the keyboard, not only by hover. Focus is visible in both themes. Contrast targets WCAG AA. Text scales with the system font. The popup announces the result count and state changes. Test with Orca and keyboard-only use.

### Privacy and security

Local only. No network calls, no telemetry. Logs never include clipboard text, image bytes, or secrets. Directories are `0700`, files are `0600`. Private mode pauses capture and hides history. App exclusions are best-effort. Sensitive-content detection is best-effort and never marketed as a vault. The README states the threat model plainly: any process running as the same user may access local data.

### Reliability and crash tests

- 100 `kill -9` cycles during capture. Committed items survive. Startup GC removes unreferenced blobs and temp files.
- Forced termination between blob rename and database commit leaves an orphan blob, never a dangling reference.
- Corrupt database: quarantine, attempt verified backup, preserve damaged files.
- Missing blob: mark the item unavailable, report it, attempt recovery.
- Disk full: pause capture, keep old history, show an actionable warning, never claim a save succeeded.
- Shell restart: extension reloads and reconnects; daemon and database stay up.
- Upgrade interruption: keep a pre-upgrade snapshot and a migration marker.

## Repository and open source

### Git Flow

Use Git Flow as requested:

- `main`: stable releases.
- `develop`: integration branch.
- `feature/*`: one feature or fix per branch.
- `release/*`: release preparation.
- `hotfix/*`: urgent fixes from `main`.

Conventional Commits. SemVer tags such as `v0.1.0`. `git-cliff` generates `CHANGELOG.md`. PRs target `develop`; releases merge to `main` and tag. Require CI and a self-review checklist. Use DCO `Signed-off-by` lines, not a CLA.

### License and attribution

MIT for the new code. The current Clipboard Indicator is MIT (`LICENSE.rst`). If any of its code is reused, keep the original copyright notice in `NOTICE` and in the source file header. The README credits the original project as inspiration.

### Repository layout

```text
cliporium/
  Cargo.toml
  crates/
    clip-core/
    clip-store/
    clip-backup/
    clip-ipc/
  services/
    cliporium-daemon/
  extension/
    metadata.json
    extension.js
    prefs.js
    stylesheet.css
    schemas/
  packaging/
    systemd/
    debian/
  tests/
    crash/
    backup/
    migration/
    platform/
  docs/
    BRIEF.md
    design/
    adr/
  .github/
    workflows/
    ISSUE_TEMPLATE/
    PULL_REQUEST_TEMPLATE.md
  LICENSE
  NOTICE
  README.md
  CONTRIBUTING.md
  CODE_OF_CONDUCT.md
  SECURITY.md
  CHANGELOG.md
```

### CI

- `cargo fmt --check`
- `cargo clippy -- -D warnings`
- `cargo test`
- `cargo deny check`
- FTS5 trigram integration test
- crash and backup integration tests
- `gnome-extensions pack` validation
- Markdown link check

Run CI on the oldest supported Ubuntu container and a manual target test on 26.04. Do not claim GNOME 48 or 49 support until someone runs the extension there.

### Release

- Daemon `.deb` built with `cargo-deb`.
- Extension zip built with `gnome-extensions pack`.
- `SHA256SUMS`, changelog, and install notes on GitHub Releases.
- Independent versions for the daemon, the extension, the D-Bus API, and the database schema.
- First release target: `v0.1.0`, text and image capture, pins, search, copy, local backup and restore, and migration.

## Roadmap

### Phase 0: platform spike and repository scaffold

Prove the risky parts before building the full product:

- capture through `Meta.Selection` in a minimal extension;
- a D-Bus round trip to a minimal Rust daemon;
- an anchored St popup that focuses search and closes on Escape;
- copy-to-clipboard without synthetic paste;
- image spool transfer;
- SQLite FTS5 trigram in the chosen Rust binding;
- a 100-item backup and restore.

Deliver a short compatibility report and the repository scaffold with `main`, `develop`, and CI. This is the first unit.

### Phase 1: storage core

Schema, migrations, blob store, hashing, deduplication, retention, FTS5 search, and crash tests.

### Phase 2: daemon and D-Bus

Versioned API, systemd user service, spool validation, startup recovery, status and error signals.

### Phase 3: extension popup

Search, pinned shelf, recent list, keyboard model, accessibility, light and dark themes, empty and error states.

### Phase 4: migration, backup, and restore

Importer, verified snapshots, staged restore, export and import, migration report.

### Phase 5: hardening and release

Packaging, CI release workflow, docs, screenshots, install and upgrade tests, `v0.1.0`.

## Acceptance criteria

- [ ] Popup opens from the shortcut and search has focus in under one second.
- [ ] Search over 1,000 items returns correct substring matches in under 50 ms.
- [ ] No user input reaches `new RegExp`; malformed queries do not crash the popup.
- [ ] Keyboard-only path works: open, search, navigate, pin, copy, close.
- [ ] Text and image captures survive `kill -9`, Shell restart, daemon restart, and reboot.
- [ ] 100 kill cycles leave no corrupt database and no dangling blob references.
- [ ] Corrupt database and missing blob tests produce a recovery report and preserve the old data.
- [ ] A verified backup restores the database and every referenced blob byte for byte.
- [ ] The 220-item registry and the 118-item backup import with a report and no source deletion.
- [ ] Private mode pauses capture and hides history.
- [ ] Logs contain no clipboard text or image bytes.
- [ ] Light and dark themes pass contrast, focus, and screen-reader checks.
- [ ] CI is green, the repo has Git Flow branches, and `v0.1.0` artifacts install on 26.04.

## Assumptions

- The product name is Cliporium and the license is MIT. Falsified if you want "Ubuntu Clip" or another license.
- v1 targets GNOME 50 on Ubuntu 26.04 Wayland. Falsified if you need GNOME 48 or 49 in the first release.
- The popup stays in St and the daemon stays in Rust. Falsified if you require a GTK4 popup and accept a standalone, compositor-placed window.
- v1 captures text and images. Falsified if you choose text-only.
- The pinned shelf stays horizontal as drawn. Falsified if you prefer a vertical pinned group.
- Automatic, non-destructive import from the current extension is wanted. Falsified if you want a clean start.
- Enter copies and closes, with a "Press Ctrl+V" hint. Falsified if a supported synthetic-paste integration is proven on the target.
- Image spool transfer is reliable enough for v1. Falsified if GJS spool writes or daemon validation fail; the fallback is a bounded D-Bus payload.
- FTS5 trigram is available in the chosen Rust SQLite build. Verified on system SQLite 3.46.1; falsified if the Rust binding lacks it.
- GJS plus GTK4/Adw is acceptable for preferences. Falsified if you require a Rust preferences binary.

## Open questions

- GitHub owner for `io.github.<owner>.Cliporium` -> default: use a placeholder and rename before the first release.
- Rename "Ubuntu Clip" to "Cliporium" -> default: yes, Cliporium as the working name.
- Pinned shelf: horizontal or vertical -> default: horizontal as designed; revisit after a usability test.
- Support matrix: GNOME 50 only or 48 to 50 -> default: GNOME 50 first, older versions community-tested.
- External backup folder in v1 or v1.1 -> default: v1.1.
- Encrypted backups in v1 or v1.1 -> default: v1.1.
- Preferences in GJS or Rust -> default: GJS plus GTK4/Adw.
- Keep the PDF and DOCX in the repository -> default: yes, under `docs/`.
- Include the earlier static mock at `/home/emmrc-02/clipboard-redesign/mock/index.html` as a secondary reference -> default: link it from the design notes, do not copy it.

## First unit

Phase 0: prove capture, D-Bus, the anchored St popup, image spooling, FTS5 trigram, and backup and restore on this exact GNOME 50 Wayland session. Then scaffold the repository with `main`, `develop`, CI, and the docs. No product feature work starts until the spike passes or its failure changes the architecture.

## Approval

This brief is the contract. Reply `approve` to start Phase 0, or list the changes you want. I will not write implementation code until you approve this version.
