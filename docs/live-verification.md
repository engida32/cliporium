# Live verification checklist

Run this after logging out and back in. It closes the two release gates that
headless tests cannot: behavior in a logged-in GNOME 50 Wayland session and a
clean install from the submission package. Record one result per row and attach
the screenshot paths. Do not upload the package until every required row passes.

## Before you log out

Work from the repository root:

```sh
cd "/home/emmrc-02/personal-works/ubuntu clipy"
gnome-shell --version
gnome-extensions info cliporium@engida32.github.io
git status --short
```

Expect `GNOME Shell 50.1`, `Enabled: Yes`, and `State: ACTIVE`. The worktree
should be clean before you build the submission package.

Back up the live history before touching the installed extension:

```sh
stamp=$(date +%Y%m%d-%H%M%S)
cp -a "$HOME/.local/share/cliporium" "$HOME/.local/share/cliporium.pre-live-$stamp"
printf '%s\n' "$HOME/.local/share/cliporium.pre-live-$stamp"
```

The backup contains clipboard text and images. Delete it after the check
passes.

Record the current settings so you can spot a regression:

```sh
gsettings --schemadir \
  "$HOME/.local/share/gnome-shell/extensions/cliporium@engida32.github.io/schemas" \
  list-recursively org.gnome.shell.extensions.cliporium
```

Build and inspect the submission package:

```sh
make pack
unzip -l dist/cliporium@engida32.github.io.shell-extension.zip
```

The archive should contain `metadata.json`, `extension.js`, `prefs.js`,
`stylesheet.css`, `LICENSE`, the schema XML, and the modules under `src/`. It
must not contain Rust files, databases, blobs, or local history.

Install over the current copy to test the upgrade path:

```sh
gnome-extensions install --force \
  dist/cliporium@engida32.github.io.shell-extension.zip
gnome-extensions enable cliporium@engida32.github.io
```

Log out from the system menu, then log back in to the same Wayland session. Do
not use `Alt+F2` and `r`; Wayland does not expose a Shell restart. Locking and
unlocking is not enough: the `gnome-shell` process keeps running, so it keeps
the old extension module. Confirm that the `gnome-shell` PID changed.

## Upgrade session checks

Run these after the first login. Leave the existing history in place.

- [ ] `gnome-extensions info cliporium@engida32.github.io` reports `Enabled: Yes`
      and `State: ACTIVE`.
- [ ] Only one Cliporium UUID exists:
      `ls ~/.local/share/gnome-shell/extensions | grep cliporium`.
- [ ] The panel shows the copy glyph. If Orca or an AT-SPI inspector is
      available, it reports `Cliporium clipboard history`.
- [ ] The popup opens from the panel icon.
- [ ] Search receives focus when the popup opens.
- [ ] Typing filters the list, and an empty query restores it.
- [ ] `Enter` copies the selected text and pastes into another application.
- [ ] `Ctrl+K`, `Ctrl+P`, `Ctrl+1` through `Ctrl+9`, `Delete`, `Up`, `Down`,
      `Home`, and `End` behave as documented in the README.
- [ ] The pin button pins and unpins without closing the popup.
- [ ] `Manage pins` opens the pinned view; search is scoped to pinned items;
      Back returns to Recent.
- [ ] Clear shows the two-step confirmation, and cancelling leaves history
      intact.
- [ ] Copy a text string, wait for capture, and confirm it appears at the top.
- [ ] Copy a real image, confirm the thumbnail and metadata, then open the
      preview.
- [ ] Preview actions work: Copy image, Open image, Pin image, and Escape.
- [ ] Paste the captured image into another application.
- [ ] Turn private mode on, copy a known string, and confirm it is not stored.
- [ ] Turn capture off, copy a known string, and confirm it is not stored.
- [ ] Open Preferences, set a shortcut, close and reopen Preferences, and
      confirm the shortcut survives.
- [ ] Trigger the shortcut and confirm the popup opens.
- [ ] Try a modifier-only shortcut, `Escape`, `Backspace`, and a duplicate
      binding in the shortcut editor. Invalid input must not bind.
- [ ] If a conflicting accelerator is available, confirm the popup shows the
      unavailable-shortcut warning instead of failing silently.
- [ ] Change the history limit, close Preferences, and confirm the new value is
      still set.
- [ ] Run `gnome-extensions disable` and `gnome-extensions enable`. The Shell
      stays up, one indicator returns, and history is intact.
- [ ] Check `journalctl --user -b` for Cliporium errors. No clipboard contents
      should appear in the log.
- [ ] Existing history and settings from before the upgrade are present.

## Clean install check

Use a disposable GNOME account or a disposable VM. Do not use your daily
account for this check.

- [ ] Install the same ZIP with `gnome-extensions install --force`.
- [ ] Enable the extension and log out and back in.
- [ ] The first popup shows the empty state, not stale history.
- [ ] Copy text and confirm capture.
- [ ] Copy an image and confirm capture and preview.
- [ ] Set a shortcut and confirm it opens the popup.
- [ ] Disable, enable, then uninstall the extension. The Shell stays up.
- [ ] Reinstall the ZIP and confirm the package still activates.

If you cannot use a disposable account, run the clean install on the daily
account only after the backup above. Move the live data aside, test, then remove
the test data and restore the backup:

```sh
gnome-extensions disable cliporium@engida32.github.io
gnome-extensions uninstall cliporium@engida32.github.io
clean="$HOME/.local/share/cliporium.pre-clean-$(date +%Y%m%d-%H%M%S)"
mv "$HOME/.local/share/cliporium" "$clean"
printf '%s\n' "$clean"
gnome-extensions install --force \
  dist/cliporium@engida32.github.io.shell-extension.zip
gnome-extensions enable cliporium@engida32.github.io
```

Log out and back in, then run the clean install checks above. After the clean
test:

```sh
gnome-extensions disable cliporium@engida32.github.io
gnome-extensions uninstall cliporium@engida32.github.io
rm -rf "$HOME/.local/share/cliporium"
clean=$(ls -dt "$HOME"/.local/share/cliporium.pre-clean-* | head -n 1)
mv "$clean" "$HOME/.local/share/cliporium"
gnome-extensions install --force \
  dist/cliporium@engida32.github.io.shell-extension.zip
gnome-extensions enable cliporium@engida32.github.io
```

## Screenshots

Clear sensitive clips first. Capture the panel icon, the main popup with text
and image rows, the pinned view, and the image preview. With `grim` installed:

```sh
mkdir -p "$HOME/Pictures/cliporium-live"
sleep 8; grim "$HOME/Pictures/cliporium-live/popup.png"
```

Open the popup within the eight seconds. Repeat for each view. Check every
screenshot for clipboard contents you do not want to publish.

## Results

Run date: 2026-11-02. GNOME Shell 50.1 on Wayland. The history held 222 items
and 22 pins at the start. The capture-off probe created during the run was
removed afterward.

| Gate | Result | Evidence |
| --- | --- | --- |
| Upgrade activation | PASS | `gnome-extensions info` reported one UUID, `Enabled: Yes`, `State: ACTIVE`; history and pins survived logout and login. |
| Panel icon and accessible name | PASS | After a true logout, AT-SPI exposed `Cliporium clipboard history` on the panel menu and open popup. The source and headless probe use `edit-copy-symbolic`. |
| Text capture and paste | PARTIAL | A `wl-copy` text probe was deduplicated and moved to the first unpinned slot. Paste was not verified because synthetic Enter did not reach the Shell popup. |
| Image capture, preview, and paste | PARTIAL | A 630-byte PNG copied through `wl-copy --type image/png` was captured and moved to the first unpinned slot. Preview and paste were not verified. |
| Search and keyboard | PARTIAL | Search passed through AT-SPI `EditableText`; the list went from 100 rows to 1 row and the footer changed to `1 match`, then returned to `222 items · Showing 100`. Keyboard focus, typing, Enter, and Escape were not verified because injection did not reach the popup. |
| Pins and clear | NOT RUN | Requires working keyboard or pointer injection, or manual interaction. |
| Preferences and shortcut | PARTIAL | `<Super>v` opened the popup through a uinput virtual keyboard. The Preferences UI was not exercised. |
| Shortcut conflict warning | PASS (headless) | The extension now checks the return value of `Main.wm.addKeybinding` against `Meta.KeyBindingAction.NONE`. The toolbar probe mocks that result and confirms the warning and notice text. A real conflicting binding still needs a manual check. |
| Private mode and capture off | PASS | Both settings suppressed live capture. With capture off, a probe was copied, capture was re-enabled, and the extension was disabled/enabled; the probe stayed absent. |
| Disable and enable | PASS | Disable produced `INACTIVE`; enable produced `ACTIVE`; history stayed intact. The same run exposed P3-4. |
| Logs clean | PASS | No Cliporium JavaScript errors. One `Keystring synthesis failure` line came from the AT-SPI injection attempt. |
| Image dimension cap | PASS (headless) | `tests/image-utils.test.js` reads PNG and JPEG headers and rejects a 10000 × 10000 PNG before decode. `tests/image-store.test.js` covers asynchronous `saveAsync` writes and 0600 permissions. |
| Clean install | PARTIAL (headless) | `tests/headless-clean-install-probe.sh` installed the packed ZIP under a temporary `HOME` and `XDG_DATA_HOME` in GNOME Shell 50.1, confirmed the files and compiled schema, confirmed the Shell saw the UUID with `Enabled: Yes`, then uninstalled it and confirmed the directory was removed. The live logged-in account check is still open. |
| Uninstall and reinstall | PARTIAL (headless) | The headless clean-install probe uninstalled the extension and confirmed removal. Reinstall in a live logged-in GNOME 50 session is still open. |
| Screenshots | BLOCKED | `grim` reported the compositor does not support `wlr-screencopy-unstable-v1`. `org.gnome.Shell.Screenshot` was not provided by any service file. The desktop portal reported that the screenshot backend requires an access implementation. `org.gnome.Shell.Screencast` returned `All pipelines failed to start`. |

Live findings:

- `org.gnome.desktop.interface toolkit-accessibility` was enabled for AT-SPI
  testing and restored to `false` afterward.
- The popup opened at about `(1492, 32, 422, 545)` in AT-SPI screen coordinates.
- Search filtering was proven through `Atspi.EditableText`, not physical keys.
- Global shortcut handling works; per-widget keyboard focus and edit actions
  remain unproven in this session.
- P3-4 is fixed and verified: `_onHistoryLoaded` no longer captures the
  current clipboard. After a true logout and reload, the capture-off probe
  stayed absent through re-enable.
- The shortcut warning was fixed after the live run. GNOME Shell 50 reports
  an invalid binding by returning `Meta.KeyBindingAction.NONE`; it does not
  throw. The toolbar probe now covers that path.
- View scroll restoration now survives the layout settle after switching
  between Recent and Pinned. The toolbar probe sets the recent view to 120,
  switches views, and confirms the value returns to 120.

Do not treat the keyboard, pin, clear, preview-paste, live clean-install, live
uninstall and reinstall, or screenshot rows as complete. Finish those before
uploading the package. The headless clean-install and image-cap rows are
reproducible with `make clean-install` and `make test`.
