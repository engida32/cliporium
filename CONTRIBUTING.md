# Contributing

Cliporium uses Git Flow, Conventional Commits, and the Developer Certificate of Origin.

## Branches

- `main` holds released code.
- `develop` holds integration work.
- `feature/<name>` branches start from `develop`.
- `release/<version>` branches prepare a release.
- `hotfix/<name>` branches start from `main`.

Open pull requests against `develop` unless you are fixing a release.

## Commits

Use a Conventional Commit subject:

```text
feat(store): add trigram fallback for short queries
fix(daemon): release the store lock before replying
docs: record the Phase 0 environment
```

Keep the subject under 72 characters. Explain the why in the body when the change is not obvious.

## Sign-off

Every commit needs a DCO sign-off:

```sh
git commit -s -m "feat: describe the change"
```

The sign-off certifies that you wrote the change or have the right to submit it. See `DCO` for the full text.

## Checks

Run these before opening a pull request:

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
dbus-run-session -- cargo test --workspace
gnome-extensions pack --force --out-dir dist extension
```

Keep clipboard data, databases, blobs, and secrets out of commits.
