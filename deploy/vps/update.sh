#!/usr/bin/env bash
# Updates Unity Performance to the latest code on its branch, checks it, restarts the app, and goes
# back to the previous version if the new one fails its checks or doesn't start.
#
#   sudo bash /opt/unity-performance/deploy/vps/update.sh
set -euo pipefail
# shellcheck source=deploy/vps/install.sh
source "$(dirname "${BASH_SOURCE[0]}")/install.sh"

[ "$(id -u)" -eq 0 ] || fail "Run this with sudo: sudo bash $0"
cd "$APP_DIR"
previous=$(git rev-parse HEAD)

say "Fetching the latest version…"
git pull --ff-only || fail "Couldn't fetch the update (see above). Nothing was changed."
if [ "$(git rev-parse HEAD)" = "$previous" ]; then
  say "Already up to date."
  exit 0
fi

roll_back() {
  git reset -q --hard "$previous"
  systemctl restart "$APP_NAME" || true
  fail "$1 Went back to the previous version, which is running again."
}

say "Checking the new version…"
log=$(mktemp)
if ! node --test --import ./scripts/isolate-data.js >"$log" 2>&1; then
  grep -E '^not ok|error:' "$log" | head -n 20 >&2
  roll_back "The new version failed its checks (full log: $log)."
fi
rm -f "$log"

say "Restarting…"
service_unit "$(command -v node)" >"/etc/systemd/system/$APP_NAME.service"
systemctl daemon-reload
systemctl restart "$APP_NAME"
wait_healthy || roll_back "The new version didn't start (see: sudo journalctl -u $APP_NAME -n 50)."
say "Updated to: $(git log -1 --format='%h %s')"
