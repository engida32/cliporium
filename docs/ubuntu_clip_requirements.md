# Ubuntu Clip --- Product & GNOME Extension Requirements

**Document type:** Product requirements and technical specification\
**Project:** Ubuntu Clip\
**Status:** Proposed requirements\
**Target:** GNOME Shell extension, with an optional separate desktop
application\
**Last updated:** 1 November 2026

------------------------------------------------------------------------

## 1. Product vision

Ubuntu Clip is a compact, keyboard-friendly clipboard history manager
for GNOME. It helps users find, pin, and restore previously copied text
and other supported clipboard content.

The first release should be a reliable, privacy-conscious GNOME Shell
extension that can be reviewed and distributed through [GNOME
Extensions](https://extensions.gnome.org/). A more advanced desktop
application may be developed separately for features that require a
background service or more substantial storage infrastructure.

### 1.1 Product goals

-   Make recent clipboard items quick to find and restore.
-   Keep the interface compact and unobtrusive.
-   Make search immediately available when the popup opens.
-   Support pinned/favourite clipboard entries.
-   Store clipboard history locally.
-   Provide clear privacy controls and predictable retention.
-   Support the GNOME Shell versions explicitly tested by the project.
-   Keep the extension maintainable and suitable for public review.

### 1.2 Out of scope for the first extension release

-   Cloud synchronization or sending clipboard data to a remote service.
-   Mandatory external daemons or bundled executable binaries.
-   Cross-device synchronization.
-   Enterprise policy management.
-   Claims of SQLite-level durability from a simple file-based extension
    store.
-   Guaranteed support for every Linux desktop environment.

------------------------------------------------------------------------

## 2. Product requirements

### 2.1 Clipboard capture

**Required**

-   Capture supported clipboard content after the user enables the
    extension and its history feature.
-   Keep captured content on the local device.
-   Support plain text as the minimum viable content type.
-   Handle empty clipboard content safely.
-   Avoid creating duplicate consecutive entries when the content has
    not changed.
-   Apply a configurable history limit.
-   Provide a way to pause capture or enable private mode.
-   Handle clipboard read failures without crashing GNOME Shell.

**Recommended**

-   Add support for images and other content types only after their
    behavior, storage cost, and restore behavior have been tested.
-   Enforce content-size limits.
-   Provide application exclusions where the platform makes reliable
    application identification possible.
-   Do not capture content while private mode is active.

### 2.2 Clipboard history popup

-   Open from a GNOME panel indicator.
-   Use a compact layout that does not cover an unnecessarily large part
    of the screen.
-   Focus the search field immediately when opened.
-   Display the newest items first.
-   Show small content-type icons rather than large text labels.
-   Clearly distinguish pinned items from ordinary history.
-   Provide a useful empty state.
-   Adapt to the current light/dark system appearance.
-   Remain usable at common display scaling settings.

### 2.3 Search and navigation

-   Search clipboard history as the user types.
-   Search should be focused on popup open.
-   Support keyboard navigation through results.
-   Enter should restore the selected item.
-   Escape should clear the search query first when appropriate, then
    close the popup.
-   Mouse selection must also work.
-   Search should remain responsive with the configured maximum history
    size.

### 2.4 Pinning and item actions

-   Users can pin and unpin an item.
-   Pinned items remain available when ordinary history is trimmed.
-   Users can restore, delete, and inspect supported item types.
-   Provide a clear action to remove all unpinned history.
-   Provide a separate action to remove all stored history, including
    pinned entries, with confirmation.

### 2.5 Preferences

Provide a GNOME-native preferences window with settings for:

-   Maximum number of history entries.
-   Theme: follow system, light, or dark, if custom theme selection is
    implemented.
-   Private mode.
-   Clipboard capture enabled/disabled.
-   User-configurable keyboard shortcut.
-   Whether supported images are stored.
-   Maximum content size.
-   Automatic cleanup/retention.
-   Application exclusions, if reliably supported.
-   Panel indicator visibility.

**Keyboard shortcut policy:** The extension must not ship with a default
shortcut for interacting with clipboard data. The shortcut should be
initially unset and configured explicitly by the user.

### 2.6 Storage and recovery

For the extension release:

-   Store data locally in the user's application data/configuration
    area.
-   Use safe file-writing practices, including writing to a temporary
    file and replacing the previous file only after the new data has
    been written successfully.
-   Validate stored data when loading it.
-   Recover gracefully from missing, malformed, or partially written
    data.
-   Avoid blocking the GNOME Shell UI during file operations.
-   Bound storage use through history limits and content-size limits.
-   Provide a user-accessible way to clear history.
-   Do not claim database-grade transactions or SQLite-equivalent
    durability unless that implementation is actually used and tested.

For a future desktop application:

-   A Rust service and SQLite database may be used for stronger storage
    guarantees.
-   Consider SQLite WAL mode, explicit durability settings,
    content-addressed blob storage, integrity checks, verified backups,
    and staged restore.
-   Keep this service optional; it must not be a required dependency of
    the GNOME Extensions submission.

### 2.7 Backup and restore

For the first extension release, backup/restore is optional and should
be included only if it can be implemented and tested safely.

If implemented:

-   Export only to a user-selected local destination.
-   Do not upload clipboard history to a remote service.
-   Validate backup structure before restoring.
-   Do not overwrite current data until validation succeeds.
-   Explain what data will be replaced.
-   Handle interrupted export/import without corrupting the active
    history.

Advanced backup, encryption, and large history management may belong in
the separate desktop application.

------------------------------------------------------------------------

## 3. Privacy and security requirements

Clipboard history can contain sensitive information. Privacy must be a
core product feature, not an afterthought.

-   Clipboard access and monitoring must be clearly disclosed in the
    extension description.
-   Explain what content is captured and where it is stored.
-   Keep clipboard data local in the initial release.
-   Do not transmit clipboard content to third parties.
-   Do not include telemetry or analytics that collect clipboard content
    or user activity.
-   Do not log clipboard contents.
-   Provide private mode or an equivalent capture pause.
-   Make it easy to clear history.
-   Use bounded retention and content-size limits.
-   Avoid collecting content from excluded applications if exclusions
    are implemented.
-   Do not claim that private mode or application exclusions work unless
    they are technically reliable and tested.
-   Treat backup files as sensitive because they may contain the user's
    clipboard history.

### Suggested extension listing disclosure

Use wording like the following only if it accurately describes the
implemented behavior:

> **Clipboard access:** Ubuntu Clip reads clipboard contents to provide
> local clipboard history. Clipboard items are stored on this device and
> are not transmitted to external services. Clipboard history may
> contain sensitive information. Use private mode and available capture
> controls to prevent unwanted items from being stored.

------------------------------------------------------------------------

## 4. GNOME Extensions review requirements

The public review and distribution target is [GNOME
Extensions](https://extensions.gnome.org/). Ubuntu's Extension Manager
is a client used to browse and manage GNOME Shell extensions; it is not
the review authority.

The project must follow the current [GNOME Shell extension review
guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html)
and [extension best
practices](https://gjs.guide/extensions/review-guidelines/best-practices.html).

### 4.1 Clipboard-specific rules

-   Disclose clipboard access in the extension description, whether
    access happens automatically or after user interaction.
-   Do not share clipboard data with third parties without explicit user
    interaction.
-   Do not ship a default keyboard shortcut for interacting with
    clipboard data.
-   Make the extension's clipboard behavior understandable to users and
    reviewers.

### 4.2 Packaging and dependencies

-   Do not bundle binary executables or libraries in the extension
    package.
-   Avoid requiring an external script or daemon.
-   If an external dependency is genuinely necessary, explain why and
    require the user to install it explicitly.
-   Prefer GJS and GNOME platform APIs where practical.
-   Keep the submitted extension self-contained for the initial release.

### 4.3 Code quality

-   Submit readable, reviewable JavaScript; do not minify or obfuscate
    source code.
-   Do not include excessive debug logging.
-   Do not include telemetry.
-   Remove unused code, dead code, and development-only files from the
    release package.
-   Include attribution and comply with licenses for any reused code.
-   The maintainer must understand, test, and be able to explain the
    submitted implementation, including any AI-assisted code.

### 4.4 Extension lifecycle

-   Create extension-owned objects and connect signals during
    `enable()`.
-   Disconnect signals, remove sources, destroy actors, and release
    resources during `disable()`.
-   Do not leave background activity running after the extension is
    disabled.
-   Avoid modifying GNOME Shell state before the extension is enabled.
-   Keep preferences code separate from Shell-process code.
-   Do not import GTK/GDK/Adwaita modules into the GNOME Shell process.
-   Do not import Shell/Clutter/Meta modules into the preferences
    process.

### 4.5 Metadata and settings schema

-   Provide a valid `metadata.json`.
-   Use a unique extension UUID in the required `extension-id@namespace`
    form.
-   Use a real project repository URL.
-   List only GNOME Shell versions that have actually been tested and
    are intended to be supported.
-   Include the GSettings schema in the extension package.
-   Use a schema ID beginning with `org.gnome.shell.extensions`.
-   Use the corresponding schema path under
    `/org/gnome/shell/extensions`.
-   Ensure the schema filename matches the schema ID.
-   Use a license compatible with GNOME Extensions distribution
    requirements, such as GPL-2.0-or-later, and include the license
    file.

### 4.6 Review and maintenance

-   The extension must be functional and stable; fundamental brokenness
    can result in rejection.
-   Check for existing extensions with overlapping functionality and
    make the product's purpose and differences clear.
-   Provide a public source repository, issue tracker, and useful
    documentation.
-   Respond to review feedback and maintain compatibility as GNOME Shell
    versions change.
-   Review approval is not guaranteed.

------------------------------------------------------------------------

## 5. Technical architecture

### 5.1 First release: standalone GJS extension

The first submission should be a self-contained GNOME Shell extension
implemented in GJS.

Suggested components:

-   `extension.js` --- extension entry point and lifecycle.
-   `prefs.js` --- preferences UI.
-   `src/clipboard.js` --- clipboard access abstraction.
-   `src/history.js` --- history model and ordering.
-   `src/storage.js` --- local persistence.
-   `src/search.js` --- filtering and search.
-   `src/popup.js` --- popup UI and keyboard navigation.
-   `src/pinned.js` --- pinned item behavior.
-   `src/privacy.js` --- private mode and capture controls.
-   `src/recovery.js` --- stored-data validation and recovery.
-   `stylesheet.css` --- visual styling.
-   `schemas/` --- GSettings schema.
-   `icons/` --- extension icons.
-   `tests/` --- tests and test fixtures.

### 5.2 Suggested repository structure

``` text
ubuntu-clip-gnome/
├── extension.js
├── metadata.json
├── prefs.js
├── stylesheet.css
├── schemas/
│   └── org.gnome.shell.extensions.ubuntu-clip.gschema.xml
├── src/
│   ├── clipboard.js
│   ├── history.js
│   ├── storage.js
│   ├── search.js
│   ├── popup.js
│   ├── pinned.js
│   ├── privacy.js
│   └── recovery.js
├── icons/
├── locale/
├── tests/
├── LICENSE
├── README.md
└── CHANGELOG.md
```

### 5.3 Metadata template

This is a template. Replace the UUID namespace and repository URL with
real project values, and list only tested GNOME Shell versions.

``` json
{
  "uuid": "ubuntu-clip@your-domain.example",
  "name": "Ubuntu Clip",
  "description": "A local clipboard history manager for GNOME Shell. Accesses the clipboard to capture and restore clipboard history.",
  "shell-version": ["50"],
  "url": "https://github.com/YOUR-ACCOUNT/ubuntu-clip-gnome",
  "settings-schema": "org.gnome.shell.extensions.ubuntu-clip"
}
```

### 5.4 Future desktop application

A separate desktop application can provide capabilities that are
difficult or unsuitable to include in a GNOME Shell extension:

-   Rust background service.
-   SQLite-backed history.
-   Content-addressed storage for large items.
-   Stronger crash recovery and integrity verification.
-   Verified backup and staged restore.
-   Optional encryption.
-   Additional desktop-environment adapters.
-   DEB, RPM, Arch, and Flatpak packaging.

The GNOME extension should continue to work without this application
unless a future, separately reviewed design explicitly changes that
requirement.

------------------------------------------------------------------------

## 6. Compatibility requirements

-   Define the initial target GNOME Shell version before implementation.
-   Test on the target Ubuntu release and GNOME Shell version.
-   Test installation, enable, disable, upgrade, and removal.
-   Test on Wayland and X11 where supported by the target GNOME version.
-   Document any platform limitations.
-   Add support for additional GNOME versions only after testing them.
-   Do not claim support for KDE, Cinnamon, XFCE, or other desktop
    environments from the GNOME extension itself. Those require separate
    integrations or a separate desktop application.

------------------------------------------------------------------------

## 7. Performance and reliability requirements

-   Opening the popup should feel immediate.
-   Search should remain responsive at the configured history limit.
-   Large clipboard items must not freeze GNOME Shell.
-   Storage operations should avoid blocking the Shell UI.
-   Invalid stored data must not prevent the extension from loading.
-   Errors should be handled gracefully and reported without exposing
    clipboard contents.
-   Disabling the extension must clean up its UI and event handlers.
-   Repeated enable/disable cycles must not create duplicate indicators
    or signal handlers.
-   History and pinned entries must remain consistent after normal
    restart and recovery.

------------------------------------------------------------------------

## 8. Testing requirements

### Functional tests

-   Capture plain text.
-   Ignore empty content.
-   Avoid duplicate consecutive entries.
-   Search by partial text.
-   Navigate results using the keyboard.
-   Restore the selected item.
-   Pin and unpin entries.
-   Delete individual entries.
-   Clear unpinned history.
-   Clear all history.
-   Enforce history and size limits.
-   Toggle private mode and verify that new content is not captured
    while it is active.

### Reliability tests

-   Restart GNOME Shell/session and verify stored history loads.
-   Disable and re-enable the extension repeatedly.
-   Test missing, malformed, and partially written storage files.
-   Test large clipboard content.
-   Test clipboard access failures.
-   Verify cleanup of signals, timers, and UI objects.
-   Verify that storage errors do not crash the Shell.

### Privacy tests

-   Confirm clipboard data is not sent over the network.
-   Confirm clipboard contents are not written to logs.
-   Confirm private mode prevents capture.
-   Confirm clear-history actions remove the expected data.
-   Confirm the extension listing accurately describes actual behavior.

### Compatibility tests

-   Test each GNOME Shell version listed in metadata.
-   Test the target Ubuntu release.
-   Test Wayland and X11 where applicable.
-   Verify preferences open and save correctly.
-   Verify keyboard navigation and display scaling.

------------------------------------------------------------------------

## 9. Release and submission checklist

### Before development is considered complete

-   [ ] Initial GNOME Shell target version selected.
-   [ ] Product scope for the first release frozen.
-   [ ] Clipboard capture and restore work reliably.
-   [ ] Popup is compact and keyboard-friendly.
-   [ ] Search is focused when the popup opens.
-   [ ] Pinning and deletion work correctly.
-   [ ] Private mode works and is tested.
-   [ ] History and content-size limits are enforced.
-   [ ] Storage recovery is tested.
-   [ ] No clipboard content is sent to external services.
-   [ ] No clipboard contents appear in logs.

### Before GNOME Extensions submission

-   [ ] `metadata.json` is valid.
-   [ ] UUID is unique and correctly formatted.
-   [ ] Repository URL is real and publicly accessible.
-   [ ] Only tested GNOME Shell versions are listed.
-   [ ] GSettings schema ID and path follow GNOME requirements.
-   [ ] Schema is included in the package.
-   [ ] License file is included and compatible.
-   [ ] Clipboard access is clearly disclosed in the description.
-   [ ] No default clipboard keyboard shortcut is configured.
-   [ ] No bundled binary executables or libraries.
-   [ ] No telemetry or unnecessary external dependencies.
-   [ ] Enable/disable lifecycle cleanup is correct.
-   [ ] Source is readable and not minified or obfuscated.
-   [ ] Screenshots and user documentation are prepared.
-   [ ] Extension package has been tested from a clean install.
-   [ ] Maintainer is prepared to respond to review feedback.

------------------------------------------------------------------------

## 10. Suggested implementation phases

  -----------------------------------------------------------------------
  Phase                   Scope                   Completion criteria
  ----------------------- ----------------------- -----------------------
  1\. Foundation          GJS project, metadata,  Installs, enables,
                          schema, lifecycle       disables, and cleans up
                                                  correctly

  2\. Clipboard core      Capture and restore     Reliable local capture
                          plain text              and restore

  3\. History UI          Panel indicator,        Search-focused popup
                          compact popup, search   and keyboard navigation

  4\. Organization        Pinning, deletion,      Items remain consistent
                          history limits          and bounded

  5\. Privacy             Private mode,           Privacy behavior
                          disclosure, clear       verified by tests
                          controls

  6\. Reliability         Persistence,            Survives restart and
                          validation, recovery    malformed storage

  7\. Preferences         GNOME-native            Settings persist and
                          preferences             are understandable

  8\. Review preparation  Documentation, tests,   Submission package
                          package audit           meets review checklist

  9\. Submission          Upload and review       Address reviewer
                          feedback                findings; approval
                                                  remains subject to
                                                  GNOME review
  -----------------------------------------------------------------------

------------------------------------------------------------------------

## 11. Official references

-   [GNOME Shell Extension Review
    Guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html)
-   [GNOME Shell Extension Best
    Practices](https://gjs.guide/extensions/review-guidelines/best-practices.html)
-   [GNOME Extensions](https://extensions.gnome.org/)
-   [GNOME Extensions upload page](https://extensions.gnome.org/upload/)
-   [GNOME Shell JavaScript documentation](https://gjs.guide/)

**Important:** GNOME's review policies and supported Shell APIs can
change. Re-check the official guidelines and the target GNOME Shell
version before each release. This document is a project requirements
baseline, not a guarantee of review approval.
