#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="$(bash "$ROOT/tests/headless-toolbar-probe.sh" 2>&1)"

printf '%s\n' "$OUTPUT" | grep -E '^(PASS|FAIL|PROBE_)'

grep -q '^PASS toolbar.children: 2$' <<<"$OUTPUT"
grep -q '^PASS pinned.view: true$' <<<"$OUTPUT"
grep -q '^PASS pinned.title: Pinned items$' <<<"$OUTPUT"
grep -q '^PASS pinned.subtitle: 20 saved items$' <<<"$OUTPUT"
grep -q '^PASS pinned.rows: 20$' <<<"$OUTPUT"
grep -q '^PASS pinned.back: true$' <<<"$OUTPUT"
grep -q '^PASS pinned.manage.hidden: false$' <<<"$OUTPUT"
grep -q '^PASS pinned.search: true/Search pinned items…$' <<<"$OUTPUT"
grep -q '^PASS pinned.search.scope: 20/20$' <<<"$OUTPUT"
grep -q '^PASS pinned.footer: Select an item to copy' <<<"$OUTPUT"
grep -q '^PASS recent.restored: Recent$' <<<"$OUTPUT"
grep -q '^PASS recent.manage: true$' <<<"$OUTPUT"

if grep -Eq '_shelf|cliporium-shelf|cliporium-chip' \
    "$ROOT/extension/extension.js" "$ROOT/extension/stylesheet.css"; then
    echo "PINNED_PROBE_FAIL: shelf or chip code remains" >&2
    exit 1
fi

echo "PINNED_PROBE_OK"
