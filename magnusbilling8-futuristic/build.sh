#!/usr/bin/env bash
# Rebuild the self-contained install.sh from src/ and tools/.
#   ./build.sh            build
#   ./build.sh --check    fail if install.sh is out of date (for CI / pre-commit)
set -euo pipefail
cd "$(dirname "$0")"

RAW_URL="${MBF_RAW_URL:-https://raw.githubusercontent.com/thedevilhackers/torque-guide-telegram-bot/claude/happy-ramanujan-61c1eu/magnusbilling8-futuristic/install.sh}"

VERSION="$(grep -m1 '^MBF_VERSION=' tools/mbf-theme | cut -d'"' -f2)"
JS_VERSION="$(grep -m1 "var VERSION = '" src/mbf.js | cut -d"'" -f2)"
if [ "$VERSION" != "$JS_VERSION" ]; then
    echo "Version mismatch: tools/mbf-theme=$VERSION src/mbf.js=$JS_VERSION" >&2
    exit 1
fi

bash -n tools/mbf-theme
bash -n tools/installer.head.sh

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/payload"
cp src/mbf.css src/mbf.js tools/mbf-theme "$tmp/payload/"
chmod 0644 "$tmp/payload/mbf.css" "$tmp/payload/mbf.js"
chmod 0755 "$tmp/payload/mbf-theme"
# Reproducible archive: fixed owner, mtime and order, no gzip timestamp.
tar -C "$tmp/payload" --owner=0 --group=0 --numeric-owner --mtime='2026-01-01 00:00:00Z' \
    --sort=name -cf - mbf.css mbf.js mbf-theme | gzip -n -9 > "$tmp/payload.tgz"
SHA="$(sha256sum "$tmp/payload.tgz" | cut -c1-64)"

{
    sed -e "s|@VERSION@|$VERSION|g" -e "s|@PAYLOAD_SHA256@|$SHA|g" -e "s|@RAW_URL@|$RAW_URL|g" tools/installer.head.sh
    echo "mbf_payload() {"
    echo "    base64 -d <<'__MBF_PAYLOAD__'"
    base64 -w 76 "$tmp/payload.tgz"
    echo "__MBF_PAYLOAD__"
    echo "}"
    echo
    echo 'main "$@"'
} > "$tmp/install.sh"
bash -n "$tmp/install.sh"

if [ "${1:-}" = "--check" ]; then
    if cmp -s "$tmp/install.sh" install.sh; then
        echo "install.sh is up to date (v$VERSION)"
        exit 0
    fi
    echo "install.sh is stale — run ./build.sh" >&2
    exit 1
fi

install -m 0755 "$tmp/install.sh" install.sh
echo "Built install.sh v$VERSION ($(wc -c < install.sh) bytes, payload sha256 ${SHA:0:12}…)"
