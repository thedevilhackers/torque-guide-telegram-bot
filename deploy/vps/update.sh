#!/usr/bin/env bash
# Updates Unity Performance to the latest code on its branch. The new version is checked in a
# separate copy first, so the running site never serves untested files; if it then fails to start,
# the previous version is put back.
#
#   sudo bash /opt/unity-performance/deploy/vps/update.sh
set -euo pipefail
# shellcheck source=deploy/vps/install.sh
source "$(dirname "${BASH_SOURCE[0]}")/install.sh"

[ "$(id -u)" -eq 0 ] || fail "Run this with sudo: sudo bash $0"
cd "$APP_DIR"
previous=$(git rev-parse HEAD)

say "Fetching the latest version…"
git fetch -q || fail "Couldn't fetch the update (see above). Nothing was changed."
latest=$(git rev-parse '@{upstream}')
if [ "$latest" = "$previous" ]; then
  say "Already up to date."
  exit 0
fi
git merge-base --is-ancestor HEAD "$latest" || fail "The code in $APP_DIR has changes of its own, so it can't be updated automatically."

say "Checking the new version…"
check=$(mktemp -d)
log=$(mktemp)
git worktree add -q --detach "$check/app" "$latest"
if ! (cd "$check/app" && node --test --import ./scripts/isolate-data.js >"$log" 2>&1); then
  git worktree remove --force "$check/app"
  grep -E '^not ok|error:' "$log" | head -n 20 >&2
  fail "The new version failed its checks (full log: $log). Nothing was changed; the site keeps running."
fi
git worktree remove --force "$check/app"
rm -rf "$check" "$log"

say "Switching to the new version…"
git merge -q --ff-only "$latest"
service_unit "$(command -v node)" >"/etc/systemd/system/$APP_NAME.service"
systemctl daemon-reload
systemctl restart "$APP_NAME"
if ! wait_healthy; then
  git reset -q --hard "$previous"
  systemctl restart "$APP_NAME"
  wait_healthy || fail "The new version didn't start, and neither did the previous one. See: sudo journalctl -u $APP_NAME -n 50"
  fail "The new version didn't start (see: sudo journalctl -u $APP_NAME -n 50). Went back to the previous version, which is running again."
fi
say "Updated to: $(git log -1 --format='%h %s')"
