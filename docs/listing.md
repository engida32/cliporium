# GNOME Extensions listing draft

Status: draft for review. Do not submit until the live gates in
`docs/live-verification.md` pass and at least one screenshot is attached.

## Listing name

Cliporium

## Summary

Local clipboard history for GNOME Shell with search, pins, and image previews.

## Description

Cliporium keeps recent clipboard text and images on this device, so you can find
and reuse something you copied earlier without switching applications.

- Search recent text and images from a keyboard-first popup.
- Pin important items and keep them out of the normal history limit.
- Preview images before copying or opening them.
- Use private mode or turn capture off when you do not want an item stored.
- Keep history local. Cliporium does not use the network, telemetry, or
  analytics, and it does not log clipboard contents.

Cliporium is designed for GNOME Shell 50 on Wayland. It supports plain text and
PNG or JPEG images. The default limits are 100 recent items, 64 KiB of text, and
8 MiB per image. Images larger than 8192 pixels on either side or 16 megapixels
are rejected before decoding.

## Screenshot set

Capture these after clearing sensitive clipboard history:

1. The panel icon with the popup closed.
2. The main popup with text and image rows, search focused.
3. The Pinned items view with search scoped to pins.
4. The image preview with Copy, Open, Pin, and Close actions.
5. Preferences with the shortcut and history limit visible.

Use a neutral desktop background and no real clipboard contents. Store the final
images outside the extension package.

## Reviewer notes

- The extension reads clipboard text and images only to build local history.
- The shortcut is unset by default and is configured in Preferences.
- History is stored under `$XDG_DATA_HOME/cliporium`.
- Uninstalling the extension does not delete history. The README documents the
  optional removal command.
- The package contains GJS source and a GSettings schema. It contains no binary
  executables, libraries, telemetry, or minified code.

## Installation copy

After approval, install from GNOME Extensions or Extension Manager. For a local
release ZIP:

```sh
gnome-extensions install --force \
  cliporium@engida32.github.io.shell-extension.zip
gnome-extensions enable cliporium@engida32.github.io
```

Log out and back in after installing on Wayland.
