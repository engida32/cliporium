# Phase 0 Shell API spikes

Release 1 depends on APIs that are easy to get wrong in GJS. I ran a temporary
extension inside a headless GNOME Shell 50.1 session, then recorded what worked
and what did not. The spike files live in `tests/spikes/`:

- `tests/spikes/shell-spike-extension.js`
- `tests/spikes/run-shell-spike.sh`

Run it with:

```bash
bash tests/spikes/run-shell-spike.sh
CLIPORIUM_SPIKE_IMAGE=1 bash tests/spikes/run-shell-spike.sh
```

The runner uses an isolated `dbus-run-session`, `HOME`, and `XDG_*` tree under
`/tmp/opencode/cliporium-phase0-spike`. It starts `gnome-shell --headless
--wayland`, waits for a `SUMMARY` line, and fails on any `FAIL` line.

## Results

| Check | Result |
|---|---|
| GNOME Shell version | `50.1` |
| Session type | `wayland` |
| GdkPixbuf import | present |
| GdkPixbuf formats | 27 formats, including `png` and `jpeg` |
| Decode the 2x2 PNG fixture | `2x2` |
| Scale with `scale_simple` | `40x40` |
| `St.Clipboard.get_default` | present |
| `St.Clipboard.get_content` | present |
| `St.Clipboard.set_content` | present |
| `St.ClipboardType.CLIPBOARD` | present |
| Set `text/plain;charset=utf-8` | ok |
| Set `image/png` | ok, 77 bytes |
| Set `text/uri-list` | ok |
| Set `x-special/gnome-copied-files` | ok |
| Read clipboard in headless Shell | skipped, see limitation |
| `Gio.AppInfo.get_default_for_type` | present |
| `Gio.AppInfo.get_default_for_uri_scheme` | present |
| `Gio.AppInfo.launch_default_for_uri` | present |
| Default image app for `image/png` | `Image Viewer` |
| Default app for the `file` URI scheme | none in the headless session |
| `St.Icon` with a file GIcon | loaded a bundled SVG |
| `St.IconTheme` | present, but the spike does not rely on it |
| `St.TextureCache` | present |
| `St.ImageContent` | present |
| `St.Settings.get().enable_animations` | `true` |
| `Clutter.Actor.ease` | present |
| `Clutter.Actor.ease_property` | present |
| `Clutter.Timeline` | present |

Both runs ended with `SUMMARY fails=0`.

## Limitation: clipboard reads abort headless Shell

`St.Clipboard.set_content` works for text, image, URI list, and copied-files
payloads. `St.Clipboard.get_content` is different. Calling it in the headless
session aborts the Shell before the callback runs. The crash happened on the
first text read, not on image decoding or image writes.

The extension already uses `get_content` in a live session, so the API is not
suspect. The headless test environment is. A separate `wl-paste` client cannot
replace the read either: the headless seat has no keyboard, and `wl-copy` and
`wl-paste` both exit with status 1 before they reach the clipboard.

Implication: Phase 2 must verify clipboard round trips in a logged-in session.
The headless suite can verify API presence and set calls, but not a read-back.
Do not treat a passing headless run as proof that image or file copy works.

## Implications for implementation

- Use `GdkPixbuf` plus `Gio.MemoryInputStream` to decode clipboard PNG bytes and
  `scale_simple` to build thumbnails. Both paths work in the Shell process.
- Use `St.ImageContent` and `St.TextureCache` for preview surfaces. The spike
  confirmed both are available.
- Load the bundled symbolic icon with `Gio.icon_new_for_string(path)` and pass
  it to `St.Icon`. Do not require `St.IconTheme`.
- Gate animation on `St.Settings.get().enable_animations` and use the present
  `Clutter` ease APIs.
- For image open, prefer `Gio.AppInfo.get_default_for_type('image/png', false)`
  and fall back to `Gio.AppInfo.launch_default_for_uri`. The headless session
  found Image Viewer for `image/png`. The `file` URI scheme had no default app
  in that session, so file open still needs a live check.
- Copy paths should set the intended MIME and payload. Image copy, file URI
  list, and the GNOME copied-files payload all reached `set_content` without an
  error. The clipboard contents themselves still need live verification.

## Open verification

- [ ] Read back text, image/png, text/uri-list, and
      x-special/gnome-copied-files in a logged-in GNOME Shell session.
- [ ] Confirm that a pasted image lands in a normal application, not only in
      Cliporium.
- [ ] Confirm that a pasted file list restores the original file paths and that
      opening a file from the preview selects a sensible default application.
