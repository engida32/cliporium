# Publishing Cliporium

GNOME Extensions (`extensions.gnome.org`) is the review and distribution
authority. Extension Manager is a client that browses and installs from GNOME
Extensions; it does not accept submissions separately.

Sources checked on 2026-11-01:

- [GNOME Shell Extensions Review Guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html)
- [GNOME Extensions upload page](https://extensions.gnome.org/upload/)
- [`gnome-extensions(1)`](https://manpages.opensuse.org/Tumbleweed/gnome-shell/gnome-extensions.1.en.html)
- [GNOME Wiki: Writing extensions](https://wiki.gnome.org/Attic/GnomeShell/Extensions/Writing)

## Before you upload

1. The public repository is `https://github.com/engida32/cliporium`. It exists
   and is publicly readable. `develop` is the default branch. `main` is the
   release branch and may lag `develop` between releases.
2. Confirm that the UUID namespace belongs to the project. The current UUID is
   `cliporium@engida32.github.io`.
3. Confirm that `shell-version` lists only versions actually tested. It currently
   lists `50`.
4. Make sure the description discloses clipboard access. It does.
5. Keep the keyboard shortcut unset by default. The schema default is an empty
   list, and the shortcut is configured only in preferences.
6. Confirm that the package contains no binary executables or libraries, no
   telemetry, and no minified or obfuscated code.
7. Prepare at least one screenshot and user-facing documentation for the
   listing.
8. Run `docs/live-verification.md`, including the clean install in a logged-in
   GNOME 50 session.

## Build the submission package

From the repository root:

```sh
make pack
```

The package is
`dist/cliporium@engida32.github.io.shell-extension.zip`.

Inspect it before uploading:

```sh
unzip -l dist/cliporium@engida32.github.io.shell-extension.zip
```

The ZIP must contain `metadata.json`, `extension.js`, `prefs.js`,
`stylesheet.css`, `LICENSE`, the schema XML under `schemas/`, and the modules
under `src/`. It must not contain the Rust workspace, database files, local
history, screenshots used only for the listing, or development state.

Compile the schema once as a packaging check:

```sh
glib-compile-schemas --strict extension/schemas
```

`gnome-extensions install` compiles the schema during installation; packing only
copies the XML.

CI runs on Ubuntu 24.04, which ships GNOME 46. Treat that as a packaging smoke
test, not a GNOME 50 runtime test. The logged-in GNOME 50 check below is the
release gate.

## Submit

Create an account at <https://extensions.gnome.org/register/> if needed, then use
one of these routes:

### Web upload

1. Sign in at <https://extensions.gnome.org/upload/>.
2. Upload the ZIP.
3. Fill in the listing details, including the description and screenshot.
4. Submit for review.

### Command line

`gnome-extensions upload` can upload one or more packs:

```sh
gnome-extensions upload --accept-tos \
  --user YOUR_USER \
  --password-file /path/to/ego-password \
  dist/cliporium@engida32.github.io.shell-extension.zip
```

Prefer the interactive login over `--password` so the password does not land in
shell history or process listings. The first upload creates version 1. Uploading
the same UUID again adds a later version and goes through review again.

Review results arrive by email. Approval is not guaranteed.

## Extension Manager

Extension Manager reads the GNOME Extensions catalog. Once the extension is
approved and published, it becomes installable through Extension Manager without
a second submission. During development, install the ZIP directly with
`gnome-extensions install`.

## Review-sensitive checks

The current review guidelines require:

- Objects and signal connections are created in `enable()` and released in
  `disable()`.
- The extension does not import GTK, GDK, or Adwaita in the Shell process.
- `prefs.js` does not import Shell, Clutter, Meta, or St.
- The GSettings schema ID starts with `org.gnome.shell.extensions`, the path
  starts with `/org/gnome/shell/extensions`, and the XML filename matches the
  schema ID.
- Clipboard access is disclosed in the description.
- No default clipboard shortcut is shipped.
- No binary executables or libraries are bundled.
- No telemetry is used.
- The code is readable and the maintainer can explain it.
- The license is compatible with GPL-2.0-or-later. Cliporium uses MIT and
  includes `LICENSE` in the package.

## Current blockers

- The live logged-in GNOME 50 Wayland check is still open for keyboard focus,
  Enter and paste, Escape, pin and clear controls, preview actions, and a real
  shortcut conflict. Use `docs/live-verification.md` and record the results
  there.
- Clean install and uninstall pass in an isolated headless GNOME 50.1 session
  with a temporary `HOME` and `XDG_DATA_HOME`. The logged-in clean-install check
  is still open.
- X11 is not supported for this release. The Ubuntu 26.04 / GNOME 50 target host
  has no X11 session files and `gnome-shell --help` has no X11 option.
- Screenshots are blocked on this host. The Shell screenshot service is not
  exported, the portal reports that the screenshot backend needs an access
  implementation, and the Shell screencast service reports
  `All pipelines failed to start`. The listing copy and shot list are drafted in
  `docs/listing.md`.
- An extensions.gnome.org account and upload are not done.
