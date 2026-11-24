#!/usr/bin/env bash
#
# Customer-panel add-on for MagnusBilling 8: adds two menu items (with desktop icons) for customers:
#   💳 Top up               balance, crypto top-up, recent payments
#   🔐 Telegram & security  Connect Telegram, two-step login (Google Authenticator)
#
# The pages are served by the top-up gateway; MagnusBilling's own files are not changed. In the MagnusBilling
# database it only fills its free "Extra" menu slots and lets customer groups open them.
#
# Before changing anything it makes a full backup in /root/unitycarrier-backups/panel-<date>/:
#   magnus-database.sql.gz   the whole MagnusBilling database
#   web-files.tar.gz         /var/www/html (the panel)
#   asterisk-etc.tar.gz      /etc/asterisk
#   gateway.tar.gz           the gateway's config.php and data/
#
# Usage (run the gateway update first: bash install.sh --yes):
#   bash panel-addon.sh --panel-url https://www.unitycarrier.com/panel/ --check    show what would change, change nothing
#   bash panel-addon.sh --panel-url https://www.unitycarrier.com/panel/            back up, then add the menu items
#   bash panel-addon.sh --uninstall                                                remove the menu items again
#
# Options: --yes (no questions), --skip-call-records (leave the call-history tables out of the database backup)

set -Eeuo pipefail

# (The PA_* variables exist only for testing this script.)
APP_DIR=${PA_APP_DIR:-/var/www/unitycarrier-pay}
WEB_ROOT=${PA_WEB_ROOT:-/var/www/html}
BACKUP_ROOT=${PA_BACKUP_ROOT:-/root/unitycarrier-backups}
UNDO=$BACKUP_ROOT/panel-addon-undo.json
STAMP=$(date +%Y%m%d-%H%M%S)
PANEL_URL=""
CHECK_ONLY=0
ASSUME_YES=0
UNINSTALL=0
SKIP_CDR=0

if [[ -t 1 ]]; then
    c_blue=$'\e[34m' c_green=$'\e[32m' c_yellow=$'\e[33m' c_red=$'\e[31m' c_bold=$'\e[1m' c_off=$'\e[0m'
else
    c_blue="" c_green="" c_yellow="" c_red="" c_bold="" c_off=""
fi
step() { printf '\n%s==>%s %s\n' "$c_blue" "$c_off" "$*"; }
ok()   { printf '  %s✓%s %s\n' "$c_green" "$c_off" "$*"; }
warn() { printf '  %s!%s %s\n' "$c_yellow" "$c_off" "$*"; }
info() { printf '    %s\n' "$*"; }
die()  { printf '\n%sERROR:%s %s\n' "$c_red" "$c_off" "$*" >&2; exit 1; }
trap 'die "panel-addon.sh stopped at line $LINENO. The MagnusBilling menu was not changed unless it says so above."' ERR

usage() { sed -n '3,25p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }
while [[ $# -gt 0 ]]; do
    case $1 in
        --panel-url) PANEL_URL=${2:-}; shift 2 ;;
        --panel-url=*) PANEL_URL=${1#*=}; shift ;;
        --check) CHECK_ONLY=1; shift ;;
        --yes|-y) ASSUME_YES=1; shift ;;
        --uninstall) UNINSTALL=1; shift ;;
        --skip-call-records) SKIP_CDR=1; shift ;;
        -h|--help) usage 0 ;;
        *) printf 'Unknown option: %s\n\n' "$1" >&2; usage 1 ;;
    esac
done

confirm() {
    local reply
    [[ $ASSUME_YES -eq 1 ]] && return 0
    [[ -t 0 ]] || return 1
    read -r -p "  $1 [Y/n]: " reply
    [[ -z $reply || $reply =~ ^[Yy] ]]
}

addon() { php "$APP_DIR/bin/panel-addon.php" "$@"; }

[[ $EUID -eq 0 ]] || die "Run as root: sudo bash $0"
command -v php >/dev/null || die "PHP is missing."
[[ -f $APP_DIR/config.php ]] || die "The top-up gateway is not installed in $APP_DIR. Install it first (install.sh)."
[[ -f $APP_DIR/public/panel/index.php && -f $APP_DIR/bin/panel-addon.php ]] \
    || die "The gateway in $APP_DIR is older than this add-on. Update it first: bash $(dirname "$0")/install.sh --yes"
mkdir -p "$BACKUP_ROOT" && chmod 700 "$BACKUP_ROOT"
WEB_USER=$(stat -c %U "$APP_DIR/data" 2>/dev/null || echo www-data)

# ------------------------------------------------------------------ uninstall

if [[ $UNINSTALL -eq 1 ]]; then
    printf '%sRemove the customer-panel add-on%s\n' "$c_bold" "$c_off"
    [[ -f $UNDO ]] || die "No undo record at $UNDO, so the add-on is not installed (or was removed already)."
    confirm "Put the MagnusBilling menu back the way it was before the add-on?" || { echo "Nothing changed."; exit 0; }
    addon remove --undo="$UNDO"
    mv "$UNDO" "$BACKUP_ROOT/panel-addon-undo.removed-$STAMP.json"
    ok "Menu items removed. MagnusBilling's menu settings are back to what they were before."
    info "Customers see the change the next time they log in. Your backups in $BACKUP_ROOT were kept."
    exit 0
fi

# ------------------------------------------------------------------ checks

if [[ -z $PANEL_URL && -t 0 && $ASSUME_YES -eq 0 ]]; then
    printf 'Address of your customer panel (as in the browser), e.g. https://www.unitycarrier.com/panel/\n'
    read -r -p "  Panel address: " PANEL_URL
fi
[[ $PANEL_URL =~ ^(https?)://([A-Za-z0-9.-]+)(:([0-9]+))?(/.*)?$ ]] \
    || die "Give the panel address, e.g.: bash $0 --panel-url https://www.unitycarrier.com/panel/"
SCHEME=${BASH_REMATCH[1]}
HOST=$(printf '%s' "${BASH_REMATCH[2]}" | tr 'A-Z' 'a-z')
PORT=${BASH_REMATCH[4]:-$([[ $SCHEME == https ]] && echo 443 || echo 80)}
[[ $HOST =~ ^[0-9.]+$ ]] && warn "The panel is opened by IP address. Customers must use the same address for these pages."

if [[ -e $WEB_ROOT/pay ]]; then
    ADDON_PATH=/pay/panel/
else
    base_path=$(cd "$APP_DIR" && php -r 'require "app/bootstrap.php"; echo (string) parse_url(Gateway\App::load()->baseUrl(), PHP_URL_PATH);' 2>/dev/null || true)
    ADDON_PATH="${base_path%/}/panel/"
fi

printf '%sCustomer-panel add-on%s for %s\n' "$c_bold" "$c_off" "$PANEL_URL"

step "Add-on page on the panel's domain"
ping=$(curl -sk --noproxy '*' --max-time 15 --resolve "$HOST:$PORT:127.0.0.1" "$SCHEME://$HOST:$PORT${ADDON_PATH}?ping=1" 2>/dev/null || true)
if [[ $ping == *'"addon":"unity-panel"'* ]]; then
    ok "$SCHEME://$HOST$ADDON_PATH answers"
else
    die "$SCHEME://$HOST$ADDON_PATH does not answer on this server.
       The pages must be on the same domain as the panel ($HOST), so the browser sends the panel login to them.
       This server's $HOST site must serve $WEB_ROOT (where the 'pay' link to the gateway is).
       Nothing was changed."
fi

step "MagnusBilling menu"
plan=$(addon plan --addon-path="$ADDON_PATH") || die "Could not read the MagnusBilling menu settings. Nothing was changed."
printf '%s' "$plan" | php -r '
    $p = json_decode(stream_get_contents(STDIN), true);
    if (empty($p["ok"])) { fwrite(STDERR, "  " . ($p["error"] ?? "Unexpected answer") . "\n"); exit(1); }
    foreach ($p["items"] as $i) {
        printf("  + %s (in %s; uses MagnusBilling menu slot \"%s\")\n", $i["label"], $i["parent"], $i["module"]);
    }
    foreach ($p["busy"] as $slot => $url) { printf("  - slot \"%s\" is already used for %s, left alone\n", $slot, $url); }
    foreach ($p["groups"] as $g) {
        printf("  ✓ group \"%s\": %s\n", $g["name"], (int) $g["id_user_type"] === 3 ? "customers see the items, with desktop icons" : "admins can open the items to preview them");
    }
' || die "Nothing was changed."
if [[ -f $UNDO ]]; then
    info "Already installed before; running again keeps the original undo record."
fi

DB_BYTES=$(addon dbsize 2>/dev/null || echo 0)
FREE_BYTES=$(df -Pk "$BACKUP_ROOT" | awk 'NR == 2 { print $4 * 1024 }')
step "Backup plan"
info "Database: $((DB_BYTES / 1048576)) MB before compression · free space: $((FREE_BYTES / 1048576)) MB in $BACKUP_ROOT"
if [[ $SKIP_CDR -eq 0 && $FREE_BYTES -lt $((DB_BYTES + 1073741824)) ]]; then
    warn "Not enough free space for a full database backup plus 1 GB to spare. Call-history tables will be left out."
    SKIP_CDR=1
fi

if [[ $CHECK_ONLY -eq 1 ]]; then
    printf '\nCheck finished. Nothing was changed. Run again without --check to back up and install.\n'
    exit 0
fi
confirm "Back up MagnusBilling and add the menu items now?" || { echo "Nothing changed."; exit 0; }

# ------------------------------------------------------------------ backup

DIR=$BACKUP_ROOT/panel-$STAMP
mkdir -m 700 "$DIR"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
step "Backup to $DIR"

command -v mysqldump >/dev/null || command -v mariadb-dump >/dev/null || die "mysqldump is missing, so the database cannot be backed up. Nothing was changed."
DUMP=$(command -v mariadb-dump || command -v mysqldump)
DBNAME=$(addon mycnf "$TMP/my.cnf")
ignore=()
if [[ $SKIP_CDR -eq 1 ]]; then
    for table in pkg_cdr pkg_cdr_failed pkg_cdr_archive pkg_cdr_summary_day pkg_cdr_summary_month; do
        ignore+=("--ignore-table=$DBNAME.$table")
    done
fi
info "Database $DBNAME (this can take a few minutes on a big server)…"
if ! "$DUMP" --defaults-extra-file="$TMP/my.cnf" --single-transaction --quick --no-tablespaces --triggers "${ignore[@]}" "$DBNAME" \
    | gzip -6 > "$DIR/magnus-database.sql.gz"; then
    die "The database backup failed, so nothing was changed. The partial file is in $DIR."
fi
gzip -t "$DIR/magnus-database.sql.gz"
ok "magnus-database.sql.gz ($(du -h "$DIR/magnus-database.sql.gz" | cut -f1))$([[ $SKIP_CDR -eq 1 ]] && echo ', without call history')"

# tar exits with 1 when a file (a log, say) changes while it is read; the archive is still good.
archive() { tar --warning=no-file-changed -czf "$@" || [[ $? -eq 1 ]]; }
archive "$DIR/web-files.tar.gz" -C / --exclude="${WEB_ROOT#/}/mbilling/tmp/*" "${WEB_ROOT#/}"
ok "web-files.tar.gz ($(du -h "$DIR/web-files.tar.gz" | cut -f1)): $WEB_ROOT"
archive "$DIR/asterisk-etc.tar.gz" -C / etc/asterisk
ok "asterisk-etc.tar.gz: /etc/asterisk"
archive "$DIR/gateway.tar.gz" -C / "${APP_DIR#/}/config.php" "${APP_DIR#/}/data"
ok "gateway.tar.gz: the gateway's config.php and data/"

cat > "$DIR/RESTORE.txt" <<EOF
Backup made by panel-addon.sh on $(date) before adding the customer-panel add-on.

Undo only the add-on (recommended; keeps everything that happened since):
  bash $(cd "$(dirname "$0")" && pwd)/panel-addon.sh --uninstall

Full restore (also loses customers, payments and settings changed after this backup!):
  Database:  gunzip < $DIR/magnus-database.sql.gz | mysql $DBNAME
  Panel:     tar -xzf $DIR/web-files.tar.gz -C /
  Asterisk:  tar -xzf $DIR/asterisk-etc.tar.gz -C /   then: systemctl restart asterisk
  Gateway:   tar -xzf $DIR/gateway.tar.gz -C /
EOF
chmod -R go-rwx "$DIR"

# ------------------------------------------------------------------ install

step "Adding the menu items"
items=$(addon apply --addon-path="$ADDON_PATH" --undo="$UNDO")
cp -p "$UNDO" "$DIR/panel-addon-undo.json"
while IFS='|' read -r label parent url; do
    [[ -n $label ]] && ok "$label (in $parent) → $SCHEME://$HOST$url"
done <<< "$items"
runuser -u "$WEB_USER" -- php "$APP_DIR/bin/panel-addon.php" set-login-url "$PANEL_URL" 2>/dev/null \
    || warn "Could not save the panel address for the add-on's log-in link (not important)."

cat <<EOF

${c_green}Done.${c_off} Customers see the new items the next time they log in to the panel
(MagnusBilling builds the menu at login, so ask them to log out and in again).

  Backup:  $DIR
  Undo:    bash $(cd "$(dirname "$0")" && pwd)/panel-addon.sh --uninstall
EOF
