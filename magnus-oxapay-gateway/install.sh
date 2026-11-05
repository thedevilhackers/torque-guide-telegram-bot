#!/usr/bin/env bash
#
# Unity Carrier - crypto top-up gateway installer for an existing MagnusBilling 7/8 server
# (Debian 11, 12 or 13 with the standard MagnusBilling Apache + MariaDB setup).
#
#   bash install.sh                 install, or update / reconfigure an existing install
#   bash install.sh --uninstall     remove the web page, bot service and API key (keeps data)
#   bash install.sh --uninstall --purge   ...and delete all files and payment records
#
# Options (all optional, you are asked for anything missing):
#   --company "Unity Carrier"   --ip 212.113.119.248   --domain pay.unitycarrier.com
#   --oxapay-key KEY   --sandbox | --live   --telegram-token TOKEN   --telegram-admins 123,456
#   --telegram-viewers 789 (view-only admins; "none" to remove)   --theme voip|luxury|classic (website look)
#   --currency EUR|USD|GBP (what customers pay in; Telegram admins can also change it under Settings)
#   --email you@example.com (Let's Encrypt)   --path pay   --yes (accept defaults, no questions)
#
# What it changes on the server:
#   - copies the gateway to /var/www/unitycarrier-pay  (only public/ is reachable from the web)
#   - links /var/www/html/pay -> /var/www/unitycarrier-pay/public
#   - adds one row to MagnusBilling's API keys (create + read + update, usable from 127.0.0.1 only)
#   - optional: an Apache site + Let's Encrypt certificate for your domain
#   - optional: a systemd service for the Telegram bot when there is no HTTPS domain
# It does not touch MagnusBilling's files, Asterisk, the firewall or existing Apache sites.

set -Eeuo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="/var/www/unitycarrier-pay"
WEB_ROOT="/var/www/html"
URL_PATH="pay"
SERVICE="unitycarrier-pay-bot"
DEFAULT_PUBLIC_IP="212.113.119.248"   # Unity Carrier's MagnusBilling server, used if detection fails
SITE_CONF="unitycarrier-pay"
WEB_USER="www-data"

COMPANY=""
SERVER_IP=""
DOMAIN=""
OXAPAY_KEY=""
SANDBOX=""
TG_TOKEN=""
TG_ADMINS=""
TG_VIEWERS=""
CRON_FILE="/etc/cron.d/unitycarrier-pay"
THEME=""
CURRENCY=""
LE_EMAIL=""
ASSUME_YES=0
ACTION="install"
PURGE=0

# ---------------------------------------------------------------- helpers

c_blue=$'\033[1;34m'; c_green=$'\033[32m'; c_yellow=$'\033[33m'; c_red=$'\033[31m'; c_off=$'\033[0m'
step() { printf '\n%s==>%s %s\n' "$c_blue" "$c_off" "$*"; }
ok()   { printf '  %s✓%s %s\n' "$c_green" "$c_off" "$*"; }
warn() { printf '  %s!%s %s\n' "$c_yellow" "$c_off" "$*"; }
die()  { printf '\n%sERROR:%s %s\n' "$c_red" "$c_off" "$*" >&2; exit 1; }
trap 'die "install.sh stopped at line $LINENO. Fix the error above and run it again; it is safe to re-run."' ERR

interactive() { [[ $ASSUME_YES -eq 0 && -t 0 ]]; }

# ask VAR "Question" "default" [secret]
ask() {
    local __var=$1 __prompt=$2 __default=${3:-} __secret=${4:-} __reply=""
    if [[ -n "${!__var:-}" ]]; then return 0; fi
    if ! interactive; then printf -v "$__var" '%s' "$__default"; return 0; fi
    if [[ -n "$__secret" ]]; then
        read -r -s -p "  $__prompt${__default:+ [keep current]}: " __reply; echo
    else
        read -r -p "  $__prompt${__default:+ [$__default]}: " __reply
    fi
    printf -v "$__var" '%s' "${__reply:-$__default}"
}

# confirm "Question" y|n  -> exit status
confirm() {
    local prompt=$1 default=$2 reply
    if ! interactive; then [[ $default == y ]]; return; fi
    read -r -p "  $prompt [$( [[ $default == y ]] && echo Y/n || echo y/N )]: " reply
    reply=${reply:-$default}
    [[ $reply =~ ^[Yy] ]]
}

as_web() { runuser -u "$WEB_USER" -- "$@"; }

php_conf() { # read a value from the installed config.php, e.g. php_conf site.base_url
    [[ -f "$APP_DIR/config.php" ]] || return 0
    php -r '$v = require $argv[1]; foreach (explode(".", $argv[2]) as $k) { $v = is_array($v) && array_key_exists($k, $v) ? $v[$k] : ""; }
        echo is_bool($v) ? ($v ? "1" : "0") : (is_array($v) ? implode(",", $v) : $v);' "$APP_DIR/config.php" "$1" 2>/dev/null || true
}

reload_apache() { systemctl reload apache2 2>/dev/null || apache2ctl graceful 2>/dev/null; }

json_field() { php -r '$d = json_decode(stream_get_contents(STDIN), true); $v = $d[$argv[1]] ?? ""; echo is_bool($v) ? ($v ? "1" : "0") : $v;' "$1"; }

usage() { sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; exit 0; }

# ---------------------------------------------------------------- arguments

while [[ $# -gt 0 ]]; do
    case "$1" in
        --company) COMPANY=$2; shift 2 ;;
        --ip) SERVER_IP=$2; shift 2 ;;
        --domain) DOMAIN=$2; shift 2 ;;
        --oxapay-key) OXAPAY_KEY=$2; shift 2 ;;
        --sandbox) SANDBOX=1; shift ;;
        --live) SANDBOX=0; shift ;;
        --telegram-token) TG_TOKEN=$2; shift 2 ;;
        --telegram-admins) TG_ADMINS=$2; shift 2 ;;
        --telegram-viewers) TG_VIEWERS=$2; shift 2 ;;
        --theme) THEME=$2; shift 2 ;;
        --currency) CURRENCY=$(echo "$2" | tr '[:lower:]' '[:upper:]'); shift 2 ;;
        --email) LE_EMAIL=$2; shift 2 ;;
        --path) URL_PATH=${2#/}; URL_PATH=${URL_PATH%/}; shift 2 ;;
        --yes|-y) ASSUME_YES=1; shift ;;
        --uninstall) ACTION="uninstall"; shift ;;
        --purge) PURGE=1; shift ;;
        --help|-h) usage ;;
        *) die "Unknown option: $1 (see --help)" ;;
    esac
done

[[ $URL_PATH =~ ^[A-Za-z0-9_-]+$ ]] || die "--path may only contain letters, numbers, - and _"

# ---------------------------------------------------------------- uninstall

if [[ $ACTION == uninstall ]]; then
    [[ $EUID -eq 0 ]] || die "Run as root."
    step "Uninstalling the top-up gateway"
    if [[ -f "$APP_DIR/config.php" && "$(php_conf "telegram.enabled")" == 1 ]]; then
        as_web php "$APP_DIR/bin/cli.php" telegram:unhook >/dev/null 2>&1 || true
    fi
    if [[ -f /etc/systemd/system/$SERVICE.service ]]; then
        systemctl disable --now "$SERVICE" >/dev/null 2>&1 || true
        rm -f "/etc/systemd/system/$SERVICE.service"
        systemctl daemon-reload || true
        ok "Telegram bot service removed"
    fi
    if [[ -f $CRON_FILE ]]; then
        rm -f "$CRON_FILE"
        ok "Scheduled jobs removed"
    fi
    link="$WEB_ROOT/$URL_PATH"
    if [[ -L $link && "$(readlink -f "$link")" == "$APP_DIR/public" ]]; then
        rm -f "$link"; ok "Removed $link"
    fi
    if [[ -f /etc/apache2/sites-available/$SITE_CONF.conf ]]; then
        warn "Kept the Apache site $SITE_CONF (it also serves your domain for MagnusBilling). Remove it with: a2dissite $SITE_CONF $SITE_CONF-le-ssl"
    fi
    if [[ -f "$APP_DIR/config.php" ]]; then
        php "$APP_DIR/bin/setup.php" remove-key | sed 's/^/  /' || warn "Could not remove the MagnusBilling API key; delete it in Settings > API."
    fi
    if [[ $PURGE -eq 1 ]]; then
        rm -rf "$APP_DIR"; ok "Deleted $APP_DIR (including payment records)"
    else
        ok "Kept $APP_DIR (config and payment records). Use --purge to delete it."
    fi
    exit 0
fi

# ---------------------------------------------------------------- preflight

step "Checking the server"
[[ $EUID -eq 0 ]] || die "Run as root (for example: sudo bash install.sh)."
[[ -f "$SRC_DIR/app/App.php" && -f "$SRC_DIR/public/index.php" ]] || die "Run install.sh from inside the magnus-oxapay-gateway folder."
# Read os-release in a subshell so its variables (NAME, SUPPORT_URL, ...) don't leak into ours.
os_info=$(. /etc/os-release && echo "${ID:-}|${ID_LIKE:-}|${PRETTY_NAME:-}")
IFS='|' read -r os_id os_like os_name <<<"$os_info"
[[ $os_id == debian || $os_like == *debian* ]] || die "This installer supports Debian/Ubuntu MagnusBilling servers."
ok "${os_name:-$os_id}"
[[ -f /var/www/html/mbilling/index.php ]] || die "MagnusBilling was not found in /var/www/html/mbilling."
[[ -r /etc/asterisk/res_config_mysql.conf ]] || die "/etc/asterisk/res_config_mysql.conf is missing (MagnusBilling database settings)."
command -v apache2ctl >/dev/null || die "Apache is not installed."
command -v php >/dev/null || die "PHP is not installed."
php -r 'exit(PHP_VERSION_ID >= 70400 ? 0 : 1);' || die "PHP 7.4 or newer is required."
id "$WEB_USER" >/dev/null 2>&1 || die "Web server user $WEB_USER does not exist."
ok "MagnusBilling, Apache and PHP $(php -r 'echo PHP_MAJOR_VERSION, ".", PHP_MINOR_VERSION;') found"

missing=()
for ext in curl pdo_sqlite pdo_mysql mbstring; do
    php -m | grep -qix "$ext" || missing+=("$ext")
done
if [[ ${#missing[@]} -gt 0 ]]; then
    step "Installing PHP extensions: ${missing[*]}"
    pkgs=()
    for ext in "${missing[@]}"; do
        case $ext in
            curl) pkgs+=(php-curl) ;; pdo_sqlite) pkgs+=(php-sqlite3) ;; pdo_mysql) pkgs+=(php-mysql) ;; mbstring) pkgs+=(php-mbstring) ;;
        esac
    done
    DEBIAN_FRONTEND=noninteractive apt-get install -y -q "${pkgs[@]}" >/dev/null </dev/null
    RELOAD_APACHE=1
    ok "Installed ${pkgs[*]}"
fi

# ---------------------------------------------------------------- questions

UPGRADE=0
[[ -f "$APP_DIR/config.php" ]] && UPGRADE=1

step "Settings"
if [[ $UPGRADE -eq 1 ]]; then
    ok "Existing install found in $APP_DIR, updating it (your config.php and payment records are kept)"
fi
detected_ip=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit }}' || true)
case $detected_ip in
    ""|10.*|127.*|192.168.*|172.1[6-9].*|172.2[0-9].*|172.3[01].*) detected_ip=$DEFAULT_PUBLIC_IP ;;
esac
current_base=$(php_conf "site.base_url")
current_domain=""; current_ip=""
[[ $current_base =~ ^https?://([^/:]+) ]] && current_domain=${BASH_REMATCH[1]}
if [[ $current_domain =~ ^[0-9.]+$ ]]; then current_ip=$current_domain; current_domain=""; fi

current_company=$(php_conf site.name)
ask COMPANY "Company name" "${current_company:-Unity Carrier}"
ask SERVER_IP "Public IP of this server" "${current_ip:-$detected_ip}"
if [[ -z $DOMAIN ]] && interactive; then
    echo "  A domain (for example pay.unitycarrier.com) gives you HTTPS. Point its DNS A record to $SERVER_IP first."
fi
ask DOMAIN "Domain for the payment page (leave empty to use the IP)" "$current_domain"
DOMAIN=${DOMAIN#http://}; DOMAIN=${DOMAIN#https://}; DOMAIN=${DOMAIN%%/*}

if [[ -z $OXAPAY_KEY && -z "$(php_conf "oxapay.merchant_api_key")" ]] && interactive; then
    echo "  OxaPay merchant API key: OxaPay dashboard > Merchant Service > Generate API key."
fi
if [[ -n "$(php_conf "oxapay.merchant_api_key")" ]]; then
    ask OXAPAY_KEY "OxaPay merchant API key" "keep" secret; [[ $OXAPAY_KEY == keep ]] && OXAPAY_KEY=""
else
    ask OXAPAY_KEY "OxaPay merchant API key (can be added later)" ""
fi

if [[ -z $SANDBOX ]]; then
    if [[ $UPGRADE -eq 0 ]]; then
        if confirm "Start in OxaPay test mode (sandbox, no real money)?" n; then SANDBOX=1; else SANDBOX=0; fi
    fi
fi

if [[ -n "$(php_conf "telegram.bot_token")" ]]; then
    ask TG_TOKEN "Telegram bot token" "keep" secret; [[ $TG_TOKEN == keep ]] && TG_TOKEN=""
else
    interactive && echo "  Telegram bot (optional): create one with @BotFather and paste its token, or leave empty."
    ask TG_TOKEN "Telegram bot token" ""
fi
if [[ -n $TG_TOKEN || -n "$(php_conf "telegram.bot_token")" ]]; then
    ask TG_ADMINS "Telegram admin chat IDs, comma separated (send /id to the bot to see yours; can be added later)" "$(php_conf "telegram.admin_chat_ids")"
fi

# ---------------------------------------------------------------- files

step "Installing files to $APP_DIR"
mkdir -p "$APP_DIR"
if [[ "$(readlink -f "$SRC_DIR")" != "$(readlink -f "$APP_DIR")" ]]; then
    tar -C "$SRC_DIR" --exclude=./config.php --exclude='./data/*' --exclude=./tests --exclude=./.git -cf - . | tar -C "$APP_DIR" -xf -
fi
mkdir -p "$APP_DIR/data"
find "$APP_DIR" -path "$APP_DIR/data" -prune -o -path "$APP_DIR/config.php" -prune -o -exec chown root:root {} + -exec chmod u=rwX,go=rX {} +
chown -R "$WEB_USER:$WEB_USER" "$APP_DIR/data"
chmod 750 "$APP_DIR/data"
ok "Files copied"

# ---------------------------------------------------------------- web

link="$WEB_ROOT/$URL_PATH"
if [[ -e $link || -L $link ]]; then
    if [[ "$(readlink -f "$link")" != "$APP_DIR/public" ]]; then
        die "$link already exists and is not this gateway. Choose another path with --path, for example --path topup."
    fi
else
    ln -s "$APP_DIR/public" "$link"
fi
ok "Web page linked at /$URL_PATH"

BASE_URL="http://$SERVER_IP/$URL_PATH"
if [[ -n $DOMAIN ]]; then
    step "Setting up $DOMAIN"
    resolved=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk '{print $1}' | sort -u | xargs || true)
    local_ips=" $SERVER_IP $(hostname -I 2>/dev/null || true) "
    points_here=0
    for addr in $resolved; do [[ $local_ips == *" $addr "* ]] && points_here=1; done
    if [[ $points_here -eq 0 && -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem ]]; then
        warn "$DOMAIN does not resolve to this server right now ('${resolved:-nothing}'), keeping the existing https://$DOMAIN/$URL_PATH."
        BASE_URL="https://$DOMAIN/$URL_PATH"
    elif [[ $points_here -eq 0 ]]; then
        warn "$DOMAIN points to '${resolved:-nothing}', not $SERVER_IP. Using http://$SERVER_IP/$URL_PATH for now."
        warn "Add a DNS A record $DOMAIN -> $SERVER_IP, wait a few minutes, then run install.sh again."
    else
        ok "$DOMAIN points to this server"
        if [[ ! -f /etc/apache2/sites-available/$SITE_CONF.conf ]]; then
            cat > "/etc/apache2/sites-available/$SITE_CONF.conf" <<EOF
# Added by the Unity Carrier top-up gateway installer. Serves the same files as the default site.
<VirtualHost *:80>
    ServerName $DOMAIN
    DocumentRoot $WEB_ROOT
    ErrorLog \${APACHE_LOG_DIR}/error.log
    CustomLog \${APACHE_LOG_DIR}/access.log combined
</VirtualHost>
EOF
            a2ensite -q "$SITE_CONF" >/dev/null
            apache2ctl configtest >/dev/null 2>&1 || { a2dissite -q "$SITE_CONF" >/dev/null; rm -f "/etc/apache2/sites-available/$SITE_CONF.conf"; die "Apache rejected the new site; nothing was changed."; }
            reload_apache
            ok "Apache site for $DOMAIN added"
        fi
        if [[ -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem ]]; then
            ok "HTTPS certificate already present"
            BASE_URL="https://$DOMAIN/$URL_PATH"
        elif confirm "Get a free HTTPS certificate for $DOMAIN from Let's Encrypt now?" y; then
            ask LE_EMAIL "Email for certificate expiry notices (optional)" ""
            command -v certbot >/dev/null || DEBIAN_FRONTEND=noninteractive apt-get install -y -q certbot python3-certbot-apache >/dev/null </dev/null
            email_args=(--register-unsafely-without-email)
            [[ -n $LE_EMAIL ]] && email_args=(-m "$LE_EMAIL")
            if timeout 300 certbot --apache -d "$DOMAIN" --non-interactive --agree-tos --no-redirect "${email_args[@]}" </dev/null; then
                ok "HTTPS enabled for $DOMAIN (renews automatically)"
                BASE_URL="https://$DOMAIN/$URL_PATH"
            else
                warn "Let's Encrypt failed (is port 80 reachable from the internet?). Using http for now."
                BASE_URL="http://$DOMAIN/$URL_PATH"
            fi
        else
            BASE_URL="http://$DOMAIN/$URL_PATH"
        fi
    fi
fi

if [[ ${RELOAD_APACHE:-0} -eq 1 ]]; then reload_apache || true; fi

# ---------------------------------------------------------------- config

step "Configuring (MagnusBilling API key, OxaPay, Telegram)"
summary=$(UC_COMPANY="$COMPANY" UC_CURRENCY="$CURRENCY" UC_THEME="$THEME" UC_BASE_URL="$BASE_URL" UC_OXAPAY_KEY="$OXAPAY_KEY" UC_SANDBOX="$SANDBOX" \
    UC_TG_TOKEN="$TG_TOKEN" UC_TG_ADMINS="$TG_ADMINS" UC_TG_VIEWERS="$TG_VIEWERS" \
    php "$APP_DIR/bin/setup.php" configure) || die "Configuration failed (see the message above)."
chown "root:$WEB_USER" "$APP_DIR/config.php"
chmod 640 "$APP_DIR/config.php"

if [[ "$(json_field magnus_key_created <<<"$summary")" == 1 ]]; then
    ok "Created a MagnusBilling API key for admin '$(json_field magnus_admin <<<"$summary")' (create + read + update, 127.0.0.1 only)"
fi
if [[ "$(json_field magnus_key_upgraded <<<"$summary")" == 1 ]]; then
    ok "MagnusBilling API key can now also update records (needed for Telegram caller-ID changes)"
fi
note=$(json_field magnus_note <<<"$summary"); [[ -n $note ]] && warn "$note"
if [[ "$(json_field magnus_ok <<<"$summary")" == 1 ]]; then
    ok "MagnusBilling API works at $(json_field magnus_url <<<"$summary")"
else
    warn "MagnusBilling API check failed: $(json_field magnus_error <<<"$summary")"
fi
[[ -n $CURRENCY ]] && ok "Currency set to $CURRENCY in config.php"
[[ "$(json_field oxapay_key_set <<<"$summary")" == 1 ]] && ok "OxaPay key saved$( [[ "$(json_field sandbox <<<"$summary")" == 1 ]] && echo ' (TEST MODE)')" \
    || warn "No OxaPay key yet: payments cannot start until you run install.sh again with it."

# ---------------------------------------------------------------- telegram

if [[ "$(json_field telegram_ok <<<"$summary")" == 1 ]]; then
    step "Telegram bot @$(json_field telegram_bot <<<"$summary")"
    if [[ $BASE_URL == https://* ]]; then
        if [[ -f /etc/systemd/system/$SERVICE.service ]]; then
            systemctl disable --now "$SERVICE" >/dev/null 2>&1 || true
            rm -f "/etc/systemd/system/$SERVICE.service"; systemctl daemon-reload || true
        fi
        as_web php "$APP_DIR/bin/cli.php" telegram:webhook | sed 's/^/  /'
    else
        cat > "/etc/systemd/system/$SERVICE.service" <<EOF
[Unit]
Description=$COMPANY top-up Telegram bot
After=network-online.target
Wants=network-online.target

[Service]
User=$WEB_USER
Group=$WEB_USER
WorkingDirectory=$APP_DIR
ExecStart=$(command -v php) $APP_DIR/bin/cli.php telegram:poll
Restart=always
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF
        if systemctl daemon-reload 2>/dev/null && systemctl enable "$SERVICE" >/dev/null 2>&1 && systemctl restart "$SERVICE"; then
            ok "Bot running as service $SERVICE (long polling, no HTTPS needed)"
        else
            warn "Could not start the $SERVICE service; check: journalctl -u $SERVICE"
        fi
    fi
elif [[ -n "$(json_field telegram_error <<<"$summary")" ]]; then
    warn "Telegram: $(json_field telegram_error <<<"$summary") - check the bot token."
fi

# ---------------------------------------------------------------- scheduled jobs

step "Scheduled jobs"
printf '%s\n' "# Unity Carrier top-up gateway: order checks, low-balance alerts, daily report, health alerts." \
    "*/5 * * * * $WEB_USER $(command -v php) $APP_DIR/bin/cli.php cron >/dev/null 2>&1" > "$CRON_FILE"
chmod 644 "$CRON_FILE"
ok "Runs every 5 minutes ($CRON_FILE)"
as_web php "$APP_DIR/bin/cli.php" cron | sed 's/^/  /' || true

# ---------------------------------------------------------------- check

step "Final check"
as_web php "$APP_DIR/bin/cli.php" check | sed 's/^/  /' || true

new_api_key=$(json_field new_api_key <<<"$summary")
printf '\n%s%s top-up gateway is installed.%s\n\n' "$c_green" "$COMPANY" "$c_off"
echo "  Payment page:     $BASE_URL/"
echo "  OxaPay webhook:   $BASE_URL/webhook.php   (sent automatically with every invoice)"
echo "  JSON API:         $BASE_URL/api.php"
[[ -n $new_api_key ]] && echo "  API key for your other systems (save it): $new_api_key"
echo "  Config file:      $APP_DIR/config.php   (amounts, bonus, colours...; then run install.sh again or just save)"
echo "  Orders / retry:   php $APP_DIR/bin/cli.php orders   (also: order <id>, retry <id>, check)"
if [[ $BASE_URL == http://* ]]; then
    if [[ -n $DOMAIN ]]; then
        echo "  Tip: once $DOMAIN points here and port 80 is open, run install.sh again to get HTTPS."
    else
        echo "  Tip: for HTTPS, point a domain here and run: bash install.sh --domain pay.unitycarrier.com"
    fi
fi
echo
