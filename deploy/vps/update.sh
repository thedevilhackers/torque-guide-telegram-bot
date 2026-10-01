#!/usr/bin/env bash
# Updates Unity Performance. The new version is checked in a separate copy first, so the running
# site never serves untested files; if it then fails to start, the previous version is put back.
#
#   From git:          sudo bash /opt/unity-performance/deploy/vps/update.sh
#   From a new zip:    sudo bash /opt/unity-performance/deploy/vps/update.sh ~/unity-performance-vps.zip
set -euo pipefail
# shellcheck source=deploy/vps/install.sh
source "$(dirname "${BASH_SOURCE[0]}")/install.sh"

[ "$(id -u)" -eq 0 ] || fail "Run this with sudo: sudo bash $0"

check_version() {
  local log
  log=$(mktemp)
  if ! (cd "$1" && node --test --import ./scripts/isolate-data.js >"$log" 2>&1); then
    grep -E '^not ok|error:' "$log" | head -n 20 >&2
    return 1
  fi
  rm -f "$log"
}

restart_app() {
  service_unit "$(command -v node)" >"/etc/systemd/system/$APP_NAME.service"
  systemctl daemon-reload
  systemctl restart "$APP_NAME"
  wait_healthy
}

# The unpacked zip, removed when the script ends however it ends.
ZIP_WORK=""
trap 'if [ -n "$ZIP_WORK" ]; then rm -rf "$ZIP_WORK"; fi' EXIT

update_from_zip() {
  local zip=$1 new previous=$APP_DIR.previous
  [ -f "$zip" ] || fail "Can't find $zip. Upload the zip to the server first."
  command -v unzip >/dev/null || apt-get install -y -q unzip >/dev/null
  # Unpacked next to the live copy, so switching over is a quick rename.
  ZIP_WORK=$(mktemp -d "$(dirname "$APP_DIR")/.$APP_NAME-update.XXXXXX")
  unzip -q "$zip" -d "$ZIP_WORK" || fail "That zip couldn't be opened. Nothing was changed."
  new=$ZIP_WORK/$APP_NAME
  [ -f "$new/src/server.js" ] || fail "That zip doesn't contain the Unity Performance app. Nothing was changed."
  chmod -R a+rX "$new"

  say "Checking the new version…"
  check_version "$new" || fail "The new version failed its checks. Nothing was changed; the site keeps running."

  say "Switching to the new version…"
  rm -rf "$previous"
  mv "$APP_DIR" "$previous"
  mv "$new" "$APP_DIR"
  if ! restart_app; then
    rm -rf "$APP_DIR"
    mv "$previous" "$APP_DIR"
    restart_app || fail "The new version didn't start, and neither did the previous one. See: sudo journalctl -u $APP_NAME -n 50"
    fail "The new version didn't start (see: sudo journalctl -u $APP_NAME -n 50). Went back to the previous version, which is running again."
  fi
  say "Updated. The previous version is kept in $previous until the next update."
}

update_from_git() {
  cd "$APP_DIR"
  local previous latest check
  previous=$(git rev-parse HEAD)
  say "Fetching the latest version…"
  git fetch -q || fail "Couldn't fetch the update (see above). Nothing was changed."
  latest=$(git rev-parse '@{upstream}')
  if [ "$latest" = "$previous" ]; then
    say "Already up to date."
    return
  fi
  git merge-base --is-ancestor HEAD "$latest" || fail "The code in $APP_DIR has changes of its own, so it can't be updated automatically."

  say "Checking the new version…"
  check=$(mktemp -d)
  git worktree add -q --detach "$check/app" "$latest"
  if ! check_version "$check/app"; then
    git worktree remove --force "$check/app"
    fail "The new version failed its checks. Nothing was changed; the site keeps running."
  fi
  git worktree remove --force "$check/app"
  rm -rf "$check"

  say "Switching to the new version…"
  git merge -q --ff-only "$latest"
  if ! restart_app; then
    git reset -q --hard "$previous"
    restart_app || fail "The new version didn't start, and neither did the previous one. See: sudo journalctl -u $APP_NAME -n 50"
    fail "The new version didn't start (see: sudo journalctl -u $APP_NAME -n 50). Went back to the previous version, which is running again."
  fi
  say "Updated to: $(git log -1 --format='%h %s')"
}

if [ -n "${1:-}" ]; then
  update_from_zip "$1"
elif [ -d "$APP_DIR/.git" ]; then
  update_from_git
else
  fail "This copy was installed from a zip. Upload the new zip to the server, then run: sudo bash $0 /path/to/unity-performance-vps.zip"
fi
