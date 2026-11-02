# Brief: Cliporium popup, pinned manager, files, and images

Status: implemented for Release 1. Kept as the design brief.

## Goal

Make the Cliporium popup faster to scan and more useful for real clipboard work. Search moves to the top, the pinned shelf becomes a dedicated manager, text and file clips get readable previews, and image clips get thumbnails and a preview layer. The panel icon should look intentional, and the whole flow should stay local, keyboard-first, and accessible.

## Who it is for

A keyboard-first GNOME Shell user who copies commands, paths, links, files, and screenshots all day. They open the popup briefly, often with one hand on the keyboard, and need to find or copy an item without scanning a wall of icons or guessing what a button does.

## Success signals

- The popup opens with a single compact top row: search field and settings button. There is no app name, logo, item count, or close button in that row.
- The search row is at most 34 px tall and aligns with 32 to 34 px icon buttons. At least one more list row is visible at the same screen height.
- The pinned shelf is gone. A `Manage pins` action opens a dedicated view with every pinned item as a full row.
- The Recent heading pairs Manage pins with a visually secondary Clear action. Clear always requires confirmation.
- Text rows show a readable two-line preview with sensible truncation. File rows show the absolute filesystem path when one exists.
- Image rows show real thumbnails, are only slightly taller than text rows, and open a larger preview when the thumbnail or row is clicked.
- Image preview exposes Copy image, Open image, Pin image, and More actions. Escape closes the preview before it closes the popup.
- Row metadata includes content type, file size or image dimensions where relevant, source application, and timestamp.
- Search filters instantly across text, absolute paths, URLs, pinned items, and image labels.
- The panel indicator uses a bundled symbolic icon, follows panel foreground color, and falls back to a built-in icon if the asset fails.
- Light and dark themes meet WCAG AA for normal text and visible focus states.
- Missing files, unsupported formats, failed captures, and storage errors produce a clear state instead of a crash or silent loss.
- Only one Cliporium extension UUID is installed. No `Type name CliporiumIndicator is already registered` error appears.
- Existing text capture, pinning, search, keyboard shortcuts, clear confirmation, themes, and storage recovery still pass their tests.
- The package passes the GNOME Extensions review checklist for metadata, schema, lifecycle, and permissions.

## Non-goals

- No OCR, machine vision, automatic tagging, or cloud image analysis in this pass unless question 1 changes that.
- No network calls, sync, accounts, or telemetry.
- No image editing, annotation, cropping, or format conversion UI.
- No full GTK4, Rust, or SQLite desktop app.
- No new runtime dependency outside GNOME Shell 50, GJS, St, Clutter, GLib, Gio, and GdkPixbuf.
- No backup and restore in this pass unless question 2 changes that. The current extension has no backup feature.

## Constraints

- Target: Ubuntu 26.04 with GNOME Shell 50.1, Wayland, GJS extension only.
- The popup is 420 px wide. The list currently caps at 100 visible rows (`extension/extension.js:26`, `:774`), and the search pill is 38 px tall (`extension/stylesheet.css:128`).
- Clipboard reading is text-only today (`extension/src/clipboard.js:17`). History format is version 1 and rejects any non-text kind (`extension/src/history.js:21`, `:89`). Search matches `item.text` only (`extension/src/search.js:8`).
- Copy is text-only (`extension/extension.js:1286`). Images and files need MIME-aware copy paths.
- The current worktree already contains the uncommitted popup rewrite. This brief builds on that tree, not on `HEAD`.
- Exactly one extension UUID may be installed. The old `cliporium@cliporium.github.io` copy was removed after it blocked the new UUID.

## Current state and findings

The screenshot confirms the new popup is live. The remaining problems are structural.

- The brand header consumes a full row for a logo, title, count, settings, and close (`extension/extension.js:167`). Search sits below it (`:227`).
- Search is 38 px tall while the icon buttons are 30 px (`extension/stylesheet.css:128`, `:105`). They do not share a visual baseline.
- At 20 pins the shelf renders as unlabeled icon squares. The shelf and chips are defined at `extension/extension.js:253` and `:880`, with a 42 px scroll cap and 190 px chip cap (`extension/stylesheet.css:269`, `:278`). The labels exist for two pins in the headless probe but disappear when the shelf is overfull.
- “Manage” is plain text and only toggles pinned-only mode. It does not communicate that a full manager exists.
- The list caps at 100 visible items while the header reports 177. The note `Showing 100 of 177 items, search to narrow` (`extension/extension.js:977`) makes search a workaround for browsing.
- Row titles ellipsize without a reliable way to read the full value. Long paths are common in the screenshot.
- The footer has room for only three hints. Image preview needs a fourth hint.
- The indicator hardcodes `edit-paste-symbolic` (`extension/extension.js:93`), and the header repeats the same icon (`:174`). There is no bundled icon asset or fallback logic.
- Accent text uses `#E95420` on both themes. That is about 3.5:1 on light `#FBFAF8` and 3.9:1 on dark `#2D2A28`, below AA for normal text. Use `#C2410C` for light text and `#FF8A5B` for dark text; keep `#E95420` for fills and focus rings.
- Image support is not a small UI addition. It changes clipboard reading, history schema, search, copy, storage cleanup, row rendering, and preview state.
- File support needs `text/uri-list` and possibly `x-special/gnome-copied-files`. A file item needs a path, URI, MIME, size, and existence check.
- `History._prune` filters items but storage does not delete image files (`extension/src/history.js:195`). Deleting or clearing items would orphan image bytes unless storage learns which files were removed.
- Image metadata in `history.json` and image bytes on disk are two storage writes. A crash between them can leave orphan files or missing previews. Reconciliation is required.
- The extension has no backup or restore path today. If it stays out of scope, the test plan must say so instead of implying a feature that does not exist.

## Requirement decisions

| # | Request | Decision |
|---|---|---|
| 1 | Remove app name, logo, and count | Remove all three from the header. Show the count in the footer. |
| 2 | Search and settings in one row | One 34 px toolbar: search grows, settings is a 32 to 34 px icon button, and there is no close button. Escape and click-outside close the popup. |
| 3 | Remove pinned shelf | Remove the shelf and its horizontal chip scroller. |
| 4 | Manage pins view | Add a `Manage pins` action that opens a dedicated pinned-items view with full rows and a back control. |
| 5 | Improve Recent heading and actions | Recent heading shows `Manage pins` as the primary action and a muted `Clear` action. The count moves to the footer. |
| 6 | Row spacing and hierarchy | Text rows use a two-line preview and one metadata line. File rows use a path line and metadata. Image rows use a compact thumbnail and metadata. |
| 7 | Real image thumbnails | Store a generated thumbnail and show it in the row. Use a broken-image state when decoding fails. |
| 8 | Compact image rows | Target text rows at 52 to 56 px and image rows at 60 to 64 px, with a 40 px thumbnail. Tune after the headless probe. |
| 9 | Absolute file paths | Parse `text/uri-list`, store the decoded absolute path, and show it. Copy restores the file URI list. |
| 10 | Click thumbnail to preview | Clicking an image row or thumbnail opens preview. Text and file rows still copy on click. |
| 11 | Separate image actions | Preview and row actions expose Copy image, Open image, Pin image, and More. Delete, copy path, and metadata live under More where needed. |
| 12 | Multi-line text previews | Show up to two lines with ellipsis and preserve the full value in a tooltip or detail view. |
| 13 | Metadata | Show content type, file size or image dimensions, source app, and relative timestamp. Keep it to one secondary line. |
| 14 | Action clarity | Use recognizable symbolic icons, tooltips, and accessible names for pin, copy, delete, open, and more. |
| 15 | Clear history | Keep Clear in the Recent header, visually secondary, with the two-step confirmation. |
| 16 | Footer | Left: item count. Right: keyboard hints, limited to the most useful ones. |
| 17 | Accessibility | Check contrast, font sizes, focus rings, keyboard order, and screen reader labels in both themes. |
| 18 | Instant search | Match text, absolute paths, URLs, pinned items, file names, and image labels. Keep results instant on 1,000 items. |
| 19 | Image capture | Read common image MIME types, preserve the original bytes, and restore them with the original MIME. |
| 20 | Local storage | Store JSON and image files locally. Add per-image and total-cache limits, permission 0600, and automatic cleanup. |
| 21 | Privacy | Keep everything local. Private mode and capture-off continue to work. Never log clipboard contents. |
| 22 | Error handling | Handle unsupported MIME, failed capture, missing image or file, unreadable storage, and failed preview/copy with a visible state. |
| 23 | GNOME compatibility | Use supported St, Clutter, GLib, Gio, and GdkPixbuf APIs. Verify enable, disable, and destroy paths. |
| 24 | Extension review | Audit metadata, shell versions, schema, URL, icon packaging, lifecycle, and review-policy risks. |
| 25 | Testing | Cover text, images, files, URLs, pins, search, privacy, install, package, and headless UI states. Backup and restore are tested only if question 2 includes them. |

## Proposed interaction contract

### Header

- One 34 px row.
- Search field on the left, flexible width.
- Settings icon button on the right. No close button.
- No brand, logo, or count.
- The item count moves to the footer.
- A `Private` or `Capture off` status appears as a compact pill, not as a title.

### Recent and pinned

- Recent header shows `Recent`; the count lives in the footer.
- `Manage pins` is a text button with a pin icon on the right of the Recent header.
- Clear is a muted text button beside Manage pins.
- The dedicated pinned view replaces the list body, not the whole popup.
- Pinned view header: back control, `Pinned items` title, saved-item subtitle, and settings.
- Each pinned row is a full row with copy, unpin, and delete. Optional reorder actions can live under More.

### Row anatomy

Text row:

- Line 1: up to two lines of readable text with ellipsis.
- Line 2: type, source app, and relative time.
- Hover or selection reveals pin, copy, and more actions.

File row:

- Line 1: absolute path with the file name emphasized.
- Line 2: file type, size, source app, and relative time.
- Missing file shows an unavailable badge and keeps delete available.

Image row:

- 40 px thumbnail on the left.
- Title: `Image 1920×1080` or the source app name.
- Metadata: size, source app, and relative time.
- Click opens preview. Copy, Open, Pin, and More are explicit actions.

URL row:

- Line 1: URL.
- Line 2: type, source app, and relative time.
- Click copies as before.

### Image preview

- Opens over the list inside the popup.
- Shows the image at the largest size that fits the popup.
- Header: title, dimensions, and close.
- Actions: Copy image, Open image, Pin image, More.
- Escape closes the preview and returns to the list.
- If the image file is missing or cannot decode, show a clear unavailable state with Copy path or Delete.

### File clips

- Capture `text/uri-list` and `x-special/gnome-copied-files` when available.
- Store the decoded absolute path, file URI, MIME, size, and existence.
- Search by path and file name.
- Copy restores the original URI list. If the original payload is unavailable, write a `text/uri-list` with the saved URI.
- Open uses the desktop default handler and shows a message if no handler exists.

### Accessibility

- Minimum 4.5:1 contrast for normal text; 3:1 for large text and UI boundaries.
- Use `#C2410C` for light-theme accent text and `#FF8A5B` for dark-theme accent text; keep `#E95420` for fills and focus rings.
- Visible focus ring on search, row actions, settings, and preview controls.
- Logical tab order and Escape behavior in every state.
- Tooltips and accessible names for icon-only buttons.
- Test at 1.0x and 1.25x text scaling.

### Storage and errors

- History format version 2. Load version 1 and migrate in memory.
- Image files live under `~/.local/share/cliporium/images/`.
- Thumbnails live under the same directory with a clear suffix.
- Image writes use a temp file, rename, and 0600 permissions.
- Prune, delete, and clear remove related image files.
- Load reconciliation removes orphan files and marks missing files unavailable.
- Image limits: 5 MB per image and 100 MB total cache by default.
- Storage errors surface a visible notice and keep prior data intact.

## Advanced recommendations triage

Release 1 covers the core popup, files, images, and the five priority refinements: native GNOME visual language, context-aware actions, keyboard navigation, undo and duplicate detection, and async image handling. Advanced management features move to Release 1.1 so the popup does not become a settings-heavy control panel.

| Recommendation | Release 1 | Later |
|---|---|---|
| Native GNOME styling, spacing, hierarchy, icons, themes, feedback | Yes | |
| Subtle animations | Yes, basic opacity and height transitions | Richer motion later |
| Quick copy and context-aware actions | Yes | |
| Undo deletion and duplicate detection | Yes | |
| Smart grouping | | Release 1.1 |
| Multi-selection and bulk actions | | Release 1.1 |
| Drag and drop to other applications | | Release 1.1 after a feasibility spike |
| Adaptive height, smooth scrolling, persistent view state | Yes | |
| Empty states and settings layout | Yes | |
| Category filters | | Release 1.1 |
| Custom groups for pinned items | | Release 1.1 |
| Automatic expiration for sensitive entries | | Release 1.1 |
| Configurable history and storage limits | Yes | |
| Backup and restore | | Separate plan |
| Async thumbnails and lazy previews | Yes | |
| Background storage, storage usage, crash safety, resource cleanup | Yes | |

The main popup stays focused on finding, previewing, and reusing clips. Pinned management, storage controls, and settings live in dedicated views or preferences.

## Architecture changes

- `extension/extension.js` is already large. Extract `src/ui/row.js`, `src/ui/preview.js`, and `src/ui/pinned-view.js`. Keep state and wiring in `extension.js` for this pass; the builders take callbacks.
- Add `src/item.js` for item normalization, type detection, content hashing, and metadata. `history.js` should not own MIME policy.
- Add `src/image-store.js` for image bytes, thumbnails, permissions, cleanup, and orphan reconciliation. `history.js` keeps the index; `storage.js` keeps the JSON.
- Make `History` return removed items when it prunes, deletes, or clears. The storage layer then removes related image files instead of guessing.
- Add a deletion buffer for undo. It holds the item and its image files until the undo window closes.
- Store a content hash and a precomputed lowercase `search_text` on every item. Search then covers text, paths, URLs, file names, image labels, and source app without reparsing each row.
- Make copy MIME-aware: text to text, file to URI list, image to its original MIME.
- Keep storage writes asynchronous and serialized. Image files use temp plus rename; JSON stays atomic. Reconciliation runs after load.
- Keep the current one-UUID deployment rule. Pack the icon and all `src/` modules explicitly.

## Review focus

- Clipboard MIME edge cases: empty bytes, oversized images, multiple file URIs, unsupported image formats, and malformed URI lists.
- Storage failure: disk full, permission denied, a crash between image write and JSON write, and a corrupt history file.
- Shell lifecycle: disable or enable while the popup or preview is open, leaked timeouts, and image textures not released.
- Keyboard and focus: text scaling, focus trapped in preview, Escape order, and every action reachable without a mouse.
- Performance: 1,000 text items, 100 image rows, scrolling while thumbnails load, and no Shell freeze.

## Final plan

### Release 1 scope

Release 1 is one working, testable product: the compact popup, Recent and Pinned views, text, file, and image clips, image preview, storage migration, accessibility, icon, packaging, and verification. It does not include multi-select, drag and drop, custom groups, smart grouping, automatic expiration, or backup and restore.

### Phase 0: baseline and feasibility spikes

Files: `extension/src/clipboard.js`, `extension/src/history.js`, new `extension/src/image-store.js`, `extension/src/thumbnails.js`, tests under `tests/`.

Work:
- Confirm one installed UUID, the source tree is the active build, and the current tests pass.
- Spike `GdkPixbuf` inside a headless Shell process for decode and scale.
- Spike `St.Clipboard.get_content` and `set_content` for `image/png` and `image/jpeg`.
- Spike `text/uri-list` and `x-special/gnome-copied-files` capture and restore.
- Spike `Gio.AppInfo.launch_default_for_uri` for Open image and Open file.
- Spike a bundled symbolic icon in the panel and confirm foreground recolor.
- Spike `St.Settings.get().enable_animations` and a basic opacity or height transition.

Acceptance: each spike returns a pass or a documented fallback. No UI work starts on an unproven API.

### Phase 1: popup shell and visual system

Files: `extension/extension.js`, `extension/stylesheet.css`, `extension/src/display.js`.

Work:
- Replace the brand header and search row with one 34 px toolbar: search and settings.
- Move the count to the footer.
- Keep Clear in the Recent header with two-step confirmation.
- Add `Manage pins` as the primary Recent action.
- Adopt Adwaita surface, border, and text tokens, with Ubuntu orange as the only accent.
- Establish the spacing scale: 4, 8, 12, 16, 24 px. Use 12 px card radius and 10 px row radius.
- Use one symbolic icon family at 16 px inside 30 to 32 px buttons.
- Add hover, pressed, focus, and selected states. Add a visible focus ring.
- Fix the accent text contrast with `#C2410C` on light and `#FF8A5B` on dark.
- Make the popup height adaptive with a sensible maximum.
- Add minimal empty, loading, no-match, and storage-error states.
- Preserve the query and scroll position when switching Recent and Pinned.
- Add basic transitions for view changes and preview, gated by the Shell animation setting.

Acceptance: the top row aligns at 34 px, no brand text remains, the new footer count is visible, both themes pass contrast, and keyboard focus is visible on every control.

### Phase 2: data model and capture

Files: `extension/src/clipboard.js`, `extension/src/history.js`, `extension/src/storage.js`, new `extension/src/image-store.js`, `extension/src/item.js`, `extension/schemas/org.gnome.shell.extensions.cliporium.gschema.xml`, `extension/prefs.js`.

Work:
- Bump history to format version 2 and load version 1.
- Add `kind`, `hash`, `mime`, `image_file`, `thumb_file`, `width`, `height`, `uri`, `path`, and `exists` fields.
- Store image bytes under `~/.local/share/cliporium/images/` with 0600 permissions.
- Write image files with a temp name and rename. Keep the JSON write atomic.
- Reconcile at load: remove orphan files, mark missing files unavailable, and keep the JSON index as truth.
- Extend duplicate detection to images and files using a content hash. Move a duplicate to the top instead of adding a new row.
- Capture text, file URI lists, and common image MIME types.
- Add `max-image-bytes` at 5 MB and `max-image-cache-bytes` at 100 MB.
- Add a deletion buffer for undo and defer image file deletion until the undo window closes.
- Add storage usage and cleanup helpers.
- Update settings groups: Capture, History and storage, Appearance, Keyboard.

Acceptance: text, file, and image round trips work. A version 1 file migrates. Duplicate copies do not grow the list. Orphan images are removed. Missing images and files render an unavailable state. Storage stays within the configured limits.

### Phase 3: rows, pinned manager, and preview

Files: `extension/extension.js`, new `extension/src/ui/row.js`, new `extension/src/ui/preview.js`, new `extension/src/ui/pinned-view.js`, `extension/src/display.js`, `extension/src/search.js`, `extension/src/thumbnails.js`, `extension/stylesheet.css`.

Work:
- Extract the row builder and preview builder from `extension.js` so the file does not grow further.
- Text row: two-line preview, metadata line, pin, copy, more.
- File row: absolute path, file name emphasis, size, type, source app, time, open and more.
- Image row: 40 px thumbnail, dimensions, size, source app, time, copy, open, pin, more.
- Image row click opens preview; text and file rows copy on click.
- Preview: fit the image, Copy image, Open image, Pin image, More, Escape to return.
- Dedicated pinned view: back, count, full rows, unpin, delete, optional reorder under More.
- Search across text, paths, URLs, pinned items, file names, and image labels.
- Replace the 100-item cap with 50-row incremental loading.
- Keep scrolling separate from click activation so a scroll gesture does not copy or open a row.
- Add keyboard support: arrows, Home and End, Enter to copy, Space to preview, Ctrl+P to pin, Delete to delete, Ctrl+Z to undo, Ctrl+1 to 9 for pinned items, Escape to step back.
- Add tooltips and accessible names to icon buttons.
- Load thumbnails asynchronously and cancel them on view close or destroy.
- Add an inline Undo notice for delete and clear.

Acceptance: 20 pinned items are readable and manageable. A 177-item history is reachable by scrolling. Image preview and copy work without freezing the Shell. Every action works with the keyboard.

### Phase 4: indicator, preferences, and packaging

Files: `extension/extension.js`, `extension/prefs.js`, `extension/metadata.json`, new `extension/icons/cliporium-symbolic.svg`, `README.md`, `.github/workflows/ci.yml`.

Work:
- Add the bundled stacked-cards symbolic icon and fallback to `edit-paste-symbolic`.
- Add image limits, file capture, image capture, storage usage, and cleanup controls to preferences.
- Audit metadata, shell versions, schema, URL, icon packaging, and lifecycle.
- Add the icon to the pack command and CI inventory.
- Update README and the extension description for image and file support.

Acceptance: the panel icon recolors correctly, preferences save and reload, the package contains the icon and all source modules, and the extension review checklist passes.

### Phase 5: verification and release

Files: `tests/`, `scripts/`, headless probe scripts, `README.md`.

Work:
- Unit tests: text, file, image, duplicate, migration, cleanup, missing file, corrupt image, search, undo.
- Headless Shell probes: toolbar geometry, 20 pins, 177 items, image row, preview, light and dark, focus, icon fallback, one UUID.
- Performance checks: 1,000 text items, 100 image rows, thumbnail load cancellation, storage write retry.
- Live session check on Ubuntu 26.04: install, enable, capture, preview, copy, pin, clear, undo, disable, enable, uninstall.
- Package and inspect the zip.
- Run extension review and fix blockers.
- Do not commit unless asked.

Acceptance: all tests pass, the headless probes report the expected geometry and states, the live session shows the new UI, and the package installs cleanly with one UUID.

### Release 1.1 backlog

- Multi-selection and bulk delete, pin, and export.
- Drag and drop into other applications after a Shell API spike.
- Category filters for Text, Images, Files, URLs, and Pinned.
- Custom groups for pinned items.
- Smart grouping of similar entries.
- Automatic expiration for sensitive entries.
- Backup and restore as a separate storage and preferences plan.
- Full storage dashboard beyond the usage readout.

## Assumptions

- “Image recognition” means recognizing image clips and showing them, not OCR. Falsified if you need text extracted from screenshots.
- Clicking a text or file row copies it; clicking an image row previews it. Falsified if you want every row click to open a detail view.
- A dedicated pinned view inside the popup is enough. Falsified if you want a separate window.
- A custom monochrome symbolic indicator is acceptable. Falsified if you want the colored brand mark or a built-in icon only.
- GdkPixbuf is available inside the Shell process for thumbnails. Falsified if the Shell cannot load it.
- `St.Settings.get().enable_animations` controls transitions. Falsified if the Shell 50 API differs.
- Release 1 is the core scope above; advanced management is Release 1.1. Falsified if you want multi-select, groups, categories, drag and drop, or backup in the same pass.
- 5 MB per image and 100 MB cache are reasonable defaults. Falsified if you copy larger images regularly.
- The current dirty worktree is the baseline. Falsified if you want a clean branch or commit first.

## Open questions

1. Release scope: implement Release 1 now and carry the advanced list into Release 1.1, or include selected advanced features in this pass? Default: Release 1 only; multi-select, drag and drop, custom groups, categories, and smart grouping move later.
2. Pinned manager: dedicated view inside the popup, or a separate window? Default: inside the popup with a back control.
3. Backup and restore: include a local export/import now, or defer and document it as absent? Default: defer. It is a separate storage and packaging feature.
4. Close button: removed. Escape and click-outside close the popup.
5. Image scope: capture and preview only, or OCR? Default: capture and preview only.
6. Image and load limits: 5 MB per image, 100 MB cache, 50-row incremental loading. Default: those values, configurable in preferences.

## Inputs

The screenshot was reviewed. No `$CONTEXT_FILES` or `$SELECTION` content arrived, so the findings come from the screenshot and the current repository.
