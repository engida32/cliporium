# Requirements compliance

This matrix maps `docs/ubuntu_clip_requirements.md` to the current
implementation. It separates what is implemented and tested from what remains
open. Line references are from the current tree.

Status values:

- **Met**: implemented and supported by a test or direct run.
- **Partial**: implemented, but a required test or release condition is open.
- **Not implemented**: omitted, usually because the standard makes it optional.

## 2.1 Clipboard capture

| Requirement | Status | Evidence |
| --- | --- | --- |
| Capture supported content after enable | Met | `extension/extension.js:221` listens for `owner-changed`; `extension/extension.js:275` reads the clipboard. A headless xclip copy stored one item. |
| Keep content local | Met | `extension/src/storage.js:14` writes under `$XDG_DATA_HOME/cliporium`. No network module is imported. |
| Plain text minimum | Met | `extension/src/clipboard.js:4` lists text MIME types. `extension/src/history.js:102` stores text. |
| Handle empty content | Met | `tests/history.test.js` covers empty and blank text. `extension/src/clipboard.js:89` returns null for empty or invalid content. |
| Avoid duplicate consecutive entries | Met | `extension/src/history.js:102` moves an existing match to the top and refreshes its metadata. `tests/history.test.js` covers the duplicate path. |
| Configurable history limit | Met | Schema key `history-limit`; `extension/src/history.js:192` applies the limit. |
| Pause or private mode | Met | `extension/extension.js:840-841` and `extension/extension.js:924-925` block capture. Headless private-mode run stored nothing and kept the Shell alive. |
| Read failures must not crash | Met | `extension/src/clipboard.js` catches read and timeout failures and copies clipboard bytes out of the callback before the source is released. After the fix, live text and image captures completed without a Shell crash. |
| Images only after testing | Partial | `extension/src/clipboard.js` reads `image/png` and `image/jpeg`; `extension/src/history.js` stores image metadata and `extension/src/image-store.js` writes content-addressed files. Unit tests and `tests/headless-image-probe.sh` cover the model, rendering, search, and copy payload. Live image capture passed after the callback-bytes copy fix. Image preview and paste into another application remain open. |
| Content-size limit | Met | Schema key `max-content-size`; `extension/src/clipboard.js:71` rejects oversized data. A 3 KB copy against a 1 KB limit stored nothing and the Shell stayed alive. |
| Application exclusions | Not implemented | Optional. |
| No capture in private mode | Met | Headless private-mode run. |

## 2.2 Clipboard history popup

| Requirement | Status | Evidence |
| --- | --- | --- |
| Open from panel indicator | Met | `extension/extension.js:23` adds the indicator; the headless AT-SPI tree exposed the Cliporium menu. |
| Compact layout | Met | `extension/stylesheet.css` sets a 420 px width. |
| Focus search immediately | Met | `extension/extension.js:155` focuses the entry 50 ms after open. AT-SPI showed a focused text node. |
| Newest first | Met | `extension/src/history.js:163` sorts pinned first and newest first. AT-SPI order was gamma, delta, beta, alpha. |
| Small content-type icons | Met | Text rows use a symbolic content icon; image rows use a real thumbnail through `St.TextureCache`. |
| Image preview | Met | Clicking an image row or thumbnail opens a preview with Copy image, Open image, Pin image, and Close preview. Escape closes the preview before the popup. The preview shows the image at up to 360 × 260 with aspect preservation, and falls back to an unavailable state when the blob is missing. |
| Distinguish pinned | Met | `extension/extension.js:373` sets a DOT ornament; labels add `Pinned`. AT-SPI showed `gamma sample · Pinned`. |
| Useful empty state | Met | `extension/extension.js:404` shows a no-items message and a query-specific no-match message. |
| Light and dark appearance | Met | Uses St theme colours and `rgba()` selection styling; no hard-coded light-only backgrounds. |
| Common display scaling | Partial | The popup is a fixed 420 px and uses St metrics. No fractional-scaling run has been recorded. |

## 2.3 Search and navigation

| Requirement | Status | Evidence |
| --- | --- | --- |
| Search as the user types | Met | `extension/extension.js:105` connects `text-changed`; a 120 ms debounce calls `_refresh`. Hooked run: `beta` showed one result, `zzz` showed none. |
| Focus on open | Met | Same as 2.2. |
| Keyboard navigation | Met | `extension/extension.js:176` and `:180` move the selection. Handler logic is covered by inspection; no physical key injection was available. |
| Enter restores selected | Met | `extension/extension.js:172` calls `_activateSelected`; `extension/extension.js:459` writes the item to the clipboard. Hooked run copied `gamma sample` and xclip read it back. |
| Escape clears then closes | Met | `extension/extension.js:163` clears a non-empty query first and closes on the next press. The hook recorded `{query: "", open: true}` then `{query: "", open: false}`. |
| Mouse selection works | Met | Standard `PopupMenu` items with `activate` handlers; no custom pointer handling. Not separately scripted. |
| Responsive at maximum history | Partial | `tests/bench_history.js`: at 500 items, load median 1.8 ms and query median 0.13 ms. The popup renders at most 100 rows (`MAX_VISIBLE_ITEMS` in `extension/extension.js:29`); popup render latency is not instrumented. |

## 2.4 Pinning and item actions

| Requirement | Status | Evidence |
| --- | --- | --- |
| Pin and unpin | Met | `extension/src/history.js:134`; `tests/history.test.js` covers pinning and trimming. Unpin uses the same method with `false`. |
| Pinned survive trimming | Met | `tests/history.test.js` asserts a pinned item survives later captures. |
| Restore, delete, inspect | Met | `extension/extension.js:376` copy, `:384` delete. Text is shown as the first line of the item label. |
| Clear unpinned | Met | `extension/extension.js:482`; `tests/history.test.js` covers `clearUnpinned`. |
| Clear all with confirmation | Met | `extension/extension.js:123` creates a warning row and a separate confirm row; `:488` clears all. `tests/history.test.js` covers the model. |

## 2.5 Preferences

| Requirement | Status | Evidence |
| --- | --- | --- |
| GNOME-native preferences | Met | `extension/prefs.js:9` uses `Adw.PreferencesWindow`. The prefs process launched with no Cliporium JS errors under a headless Shell plus Xwayland. |
| Maximum history entries | Met | `extension/prefs.js:41`. |
| Theme selection if custom theme | Not implemented | The extension follows the system theme; it does not implement a custom theme. |
| Private mode | Met | `extension/prefs.js:35`. |
| Capture enabled/disabled | Met | `extension/prefs.js:27`. |
| User-configurable shortcut | Met | `extension/prefs.js:100` shows the shortcut; `:199` validates it; the default is an empty list. |
| Image storage toggle if images supported | Not implemented | Images are captured; there is no separate image-only capture toggle. The standard makes this optional. |
| Maximum content size | Met | `max-content-size` for text and `max-image-size` for images, both exposed in preferences. |
| Retention | Met | `extension/prefs.js:67`; `extension/src/history.js:183` applies it. |
| Application exclusions if supported | Not implemented | Optional. |
| Panel indicator visibility | Met | `extension/prefs.js:87`; `extension/extension.js:208` applies it. |
| No default clipboard shortcut | Met | Schema default is an empty string list. |

## 2.6 Storage and recovery

| Requirement | Status | Evidence |
| --- | --- | --- |
| Local application data area | Met | `extension/src/storage.js:14`. |
| Temp file and replace | Met | `extension/src/storage.js:147` uses `replace_contents_bytes_async` with `REPLACE_DESTINATION`. `tests/storage.test.js` verifies the saved file. `extension/src/image-store.js` uses the same asynchronous replacement for image blobs. |
| Validate on load | Met | `extension/src/history.js:78` validates format and items. `tests/storage.test.js` covers malformed input. |
| Recover missing, malformed, partial | Met | Missing file starts empty at `extension/src/storage.js:54`; malformed or incompatible data is backed up at `:106`. Partial-write recovery follows from the atomic replace and is not separately fault-injected. |
| Avoid blocking Shell UI | Partial | History file reads and writes are async. Image blob writes use `replace_contents_bytes_async`; image decode remains synchronous and is bounded by the dimension and byte limits. |
| Bound storage | Met | History, text-size, image-size, and retention limits in `extension/src/history.js`. |
| User-accessible clear | Met | Popup Clear actions delete queued image blobs after the history save succeeds. |
| Do not claim SQLite durability | Met | README describes atomic JSON, not SQLite transactions. |

## 2.7 Backup and restore

Not implemented. The standard makes this optional for the extension. The Rust
workspace has backup code, but it is outside the extension package and is not a
release dependency.

## 3 Privacy and security

| Requirement | Status | Evidence |
| --- | --- | --- |
| Disclose clipboard access | Met | `extension/metadata.json` description says Cliporium reads clipboard text and never sends it anywhere. |
| Explain what is stored and where | Met | README privacy section names `$XDG_DATA_HOME/cliporium/history.json`. |
| Keep data local | Met | No network APIs are imported in `extension/`. |
| No third-party transmission | Met | Same inspection. |
| No telemetry | Met | No telemetry library or network call in the extension. |
| Do not log clipboard contents | Met | No `console.log` of item text. Status messages report counts, limits, and recovery warnings only. |
| Private mode | Met | Headless private-mode run. |
| Easy clear | Met | Popup actions. |
| Bounded retention and size | Met | History, size, and retention limits. |
| Do not overclaim exclusions | Met | Exclusions are not implemented or claimed. |
| Treat backups as sensitive | Met | Recovery backups are local and are described as local copies. |

## 4.1 Clipboard-specific review rules

| Requirement | Status | Evidence |
| --- | --- | --- |
| Disclose clipboard access | Met | Metadata description. |
| No sharing without user action | Met | Clipboard reads are local; the only write is the user-triggered Copy action. |
| No default clipboard shortcut | Met | Empty schema default. |
| Understandable behavior | Met | README and preferences describe capture, private mode, and limits. |

## 4.2 Packaging and dependencies

| Requirement | Status | Evidence |
| --- | --- | --- |
| No bundled binaries or libraries | Met | The package is JavaScript, CSS, XML, and the license. No daemon is required. |
| No external script or daemon | Met | `extension/extension.js` has no D-Bus or daemon calls. |
| Explicit external dependencies | Met | None. |
| Prefer GJS and platform APIs | Met | GJS, St, Shell, Gio, and GLib. |
| Self-contained first release | Met | The extension owns capture, history, storage, search, and UI. |

## 4.3 Code quality

| Requirement | Status | Evidence |
| --- | --- | --- |
| Readable, not minified | Met | Source is unminified ES modules. |
| No excessive logging | Met | No debug logging in the extension. |
| No telemetry | Met | None. |
| Remove dead and development files | Partial | The Rust workspace remains in the repository as an optional desktop app and is not packed. The compliance and publishing docs are development files outside the package. |
| Attribution and licenses | Met | MIT `LICENSE` is included in the package with `--extra-source=LICENSE`. |
| Maintainer can explain the code | Partial | This is a human process requirement. The implementation and tests are documented, but the maintainer must still be able to explain it in review. |

## 4.4 Extension lifecycle

| Requirement | Status | Evidence |
| --- | --- | --- |
| Create during `enable()` | Met | `extension/extension.js:23` constructs the indicator; its constructor creates settings, storage, and signals. |
| Clean up during `disable()` | Met | `extension/extension.js:28` destroys the indicator; `:494` disconnects signals, timers, storage, and the keybinding. |
| No background activity after disable | Met | Storage uses a `Gio.Cancellable` and cancels pending I/O at `extension/src/storage.js:96`. |
| No Shell changes before enable | Met | Module scope defines constants and a GObject class; no instances or signals. |
| Separate prefs code | Met | `prefs.js` imports no Shell, Clutter, Meta, or St. |
| No GTK in Shell | Met | `extension.js` imports no GTK, GDK, or Adw. |

## 4.5 Metadata and settings schema

| Requirement | Status | Evidence |
| --- | --- | --- |
| Valid `metadata.json` | Met | Required keys are present. Deprecated `version` and unused `gettext-domain` were removed. |
| Unique UUID in required form | Met | `cliporium@engida32.github.io`. The `engida32` GitHub account exists. |
| Real project URL | Met | `https://github.com/engida32/cliporium` is public and returns HTTP 200. |
| Only tested Shell versions | Met | `shell-version` lists only `50`. Headless testing used GNOME Shell 50.1. |
| Schema in package | Met | Pack command uses `--schema=schemas/org.gnome.shell.extensions.cliporium.gschema.xml`; `gnome-extensions install` compiles it. |
| Schema ID base | Met | `org.gnome.shell.extensions.cliporium`. |
| Schema path base | Met | `/org/gnome/shell/extensions/cliporium/`. |
| Filename matches ID | Met | `org.gnome.shell.extensions.cliporium.gschema.xml`. |
| Compatible license included | Met | MIT, compatible with GPL-2.0-or-later; `extension/LICENSE` is packed. |

## 4.6 Review and maintenance

| Requirement | Status | Evidence |
| --- | --- | --- |
| Functional and stable | Partial | Unit, lifecycle, capture, search, restore, private-mode, size-limit, image-dimension, asynchronous image-write, upgrade, and removal tests pass. Live GNOME 50.1 checks passed for activation, popup, search, text and image capture, private mode, capture off, shortcut, accessible name, and the startup-capture fix. Keyboard focus, paste, pins, clear, live clean install, and screenshots remain open. Shortcut conflict handling is covered by the headless toolbar probe. The headless clean install and uninstall probe passes in an isolated GNOME 50.1 session. |
| Differentiate from existing extensions | Partial | README describes the product. Listing copy and a screenshot plan are drafted in `docs/listing.md`; a public comparison is still not written. |
| Public repository and issue tracker | Met | Public repository at `https://github.com/engida32/cliporium`; `develop` is the default branch until the first release. |
| Respond to review feedback | Partial | Process requirement, not yet exercised. |
| Approval not guaranteed | Met | Stated in `docs/publishing.md`. |

## 5.1 Standalone GJS architecture

Met. The extension is self-contained. Suggested modules are partly combined:
popup and keyboard handling live in `extension.js`, pinning and privacy logic live
in `history.js` and `extension.js`, and recovery lives in `storage.js`. The
standard labels these as suggested components, not mandatory file boundaries.

## 6 Compatibility

| Requirement | Status | Evidence |
| --- | --- | --- |
| Target version defined | Met | GNOME Shell 50, Ubuntu 26.04. |
| Test target Ubuntu and GNOME | Partial | GNOME Shell 50.1 Wayland headless tests passed, and a live GNOME 50.1 session passed the upgrade, popup, search, capture, private-mode, shortcut, and enable/disable checks. A clean install and uninstall pass in an isolated headless GNOME 50.1 session. Keyboard and live logged-in clean-install checks remain open. |
| Install, enable, disable, upgrade, removal | Met | Install, enable, disable, and three enable/disable cycles passed. An in-place file upgrade preserved the `history-limit=37` setting, loaded the new stylesheet payload, and enabled cleanly. Removing the extension directory left the Shell alive with no Cliporium errors. |
| Wayland and X11 | Met | Wayland headless tested. The Ubuntu 26.04 / GNOME 50 target host has no X11 session files and `gnome-shell --help` has no X11 option, so X11 is documented as unsupported for this release. |
| Document limits | Met | README and this file. |
| No other desktop claims | Met | No KDE, Cinnamon, XFCE, or other claims. |

## 7 Performance and reliability

| Requirement | Status | Evidence |
| --- | --- | --- |
| Immediate popup | Partial | Headless popup opened and AT-SPI saw it. No timing instrumentation. |
| Responsive search at limit | Met | `tests/bench_history.js`: `getItems('needle3')` median 0.13 ms at 500 items. This measures the model, not the UI render. |
| Large items do not freeze | Met | 3 KB against a 1 KB limit was rejected; Shell stayed alive. |
| Non-blocking storage | Met | Async I/O. |
| Invalid data does not prevent load | Met | Malformed-file test recovered and loaded. |
| Errors without clipboard text | Met | Messages contain counts, limits, and paths, not item text. |
| Disable cleans up | Met | Lifecycle code and three-cycle run. |
| Repeated cycles no duplicates | Met | Three disable/enable cycles produced one indicator state each time, no errors. |
| History consistent after restart | Met | Seeded history loaded in a fresh Shell and rendered four items. |

## 8 Testing

| Test group | Status | Evidence |
| --- | --- | --- |
| Capture text | Met | Headless xclip capture. |
| Ignore empty | Met | Unit test. |
| Avoid duplicates | Met | Unit test. |
| Search partial text | Met | Unit test and live debounce hook. |
| Keyboard navigation | Partial | Handler inspection; no physical key injection. |
| Restore selected | Met | Hooked copy and xclip read-back. |
| Pin and unpin | Met | Unit test for pin; unpin uses the same method. |
| Delete | Met | Unit test. |
| Clear unpinned | Met | Unit test. |
| Clear all | Met | Unit test and confirmation UI. |
| History and size limits | Met | Unit tests and live oversized copy. |
| Private mode | Met | Headless run. |
| Restart and load | Met | Seeded fresh Shell. |
| Repeated disable/enable | Met | Three cycles. |
| Missing, malformed, partial storage | Partial | Missing and malformed tested; partial atomic-write failure not fault-injected. |
| Large clipboard content | Met | Live oversized copy. |
| Image dimension cap | Met | `tests/image-utils.test.js` rejects a 10000 × 10000 PNG before decode and reads PNG and JPEG headers. |
| Asynchronous image write | Met | `tests/image-store.test.js` covers `saveAsync` and private file permissions. |
| Clipboard failure | Partial | Code has timeout and catch paths; no forced failure test. |
| Cleanup of signals, timers, UI | Met | Lifecycle review and three-cycle run. |
| Storage errors do not crash | Met | Malformed recovery and capture runs kept the Shell alive. |
| No network transmission | Met | No network APIs imported. |
| No clipboard logs | Met | Code inspection. |
| Preferences open and save | Partial | Prefs launched with no Cliporium errors; saving each control was not scripted. |
| Display scaling | Partial | The headless toolbar probe passes at 200% text scaling; fractional display scaling is still untested. |

## 9 Release checklist

### Before development is complete

- [x] Initial GNOME Shell target selected: 50.
- [x] Product scope frozen for the extension release.
- [x] Clipboard capture and restore work in headless Wayland tests.
- [x] Popup is compact and keyboard-friendly by inspection.
- [x] Search is focused on open.
- [x] Pinning and deletion work in the model and UI wiring.
- [x] Private mode is tested.
- [x] History and content-size limits are enforced.
- [x] Storage recovery is tested for missing and malformed files.
- [x] No external transmission.
- [x] No clipboard contents in logs.

### Before GNOME Extensions submission

- [x] `metadata.json` is valid.
- [x] UUID is formatted correctly and uses an existing account namespace.
- [x] Repository URL is real and publicly accessible.
- [x] Only tested Shell versions are listed.
- [x] Schema ID and path follow the requirements.
- [x] Schema is included and compiles.
- [x] License is included and compatible.
- [x] Clipboard access is disclosed.
- [x] No default clipboard shortcut.
- [x] No bundled binaries or libraries.
- [x] No telemetry or unnecessary external dependency.
- [x] Enable/disable lifecycle cleanup is implemented.
- [x] Source is readable and not minified.
- [ ] Screenshots are prepared. Listing copy and the shot list are drafted in
      `docs/listing.md`.
- [ ] Package tested from a clean install in a live logged-in GNOME 50 session.
      Use `docs/live-verification.md` and record the result.
- [ ] Maintainer is prepared to respond to review feedback.

## Remaining work

1. Finish `docs/live-verification.md`: upgrade, popup, search, text and image
   capture, private mode, capture off, shortcut, and disable/enable passed.
   Keyboard focus, Enter, Escape, pins, clear, a real shortcut conflict, and the
   live logged-in clean install and reinstall remain open. The isolated headless
   clean install and uninstall pass.
2. Capture screenshots. The listing description and shot list are drafted in
   `docs/listing.md`; this host has no working screenshot path.
3. Upload to extensions.gnome.org and respond to review.
