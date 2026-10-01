#!/usr/bin/env bash
# Installs Unity Performance on an Ubuntu or Debian VPS: Node.js, the website + admin panel +
# Telegram bot as an always-on service, Caddy for HTTPS, a firewall and daily backups.
#
#   sudo bash /opt/unity-performance/deploy/vps/install.sh shop.example.com
#
# Safe to run again: settings and data are kept. Run it with a new domain to switch domains.
# Without a domain the site is served over plain HTTP on the server's IP address (for testing only).
set -euo pipefail

APP_NAME=unity-performance
APP_USER=unity
APP_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
DATA_DIR=/var/lib/$APP_NAME
CONFIG_DIR=/etc/$APP_NAME
ENV_FILE=$CONFIG_DIR/env
BACKUP_DIR=/var/backups/$APP_NAME
CADDY_SITE=/etc/caddy/sites/$APP_NAME.caddy
NODE_MAJOR=22

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33mNote:\033[0m %s\n' "$*"; }
fail() {
  printf '\n\033[31mError:\033[0m %s\n' "$*" >&2
  exit 1
}

# The port the app listens on, from the settings file if it already exists.
app_port() {
  local port=""
  [ -f "$ENV_FILE" ] && port=$(sed -n "s/^PORT=['\"]\{0,1\}\([0-9]*\).*/\1/p" "$ENV_FILE" | head -n 1)
  echo "${port:-3000}"
}

wait_healthy() {
  local port
  port=$(app_port)
  for _ in $(seq 1 30); do
    curl -fsS "http://127.0.0.1:$port/healthz" >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

# ---------- Files this script writes (printed, so they can be checked) ----------

# $1 admin password, $2 WhatsApp number, $3 Telegram token, $4 OpenAI key, $5 public address.
env_file() {
  cat <<EOF
# Unity Performance server settings, read by the $APP_NAME service.
# After changing anything here, run: sudo systemctl restart $APP_NAME
# Business details (name, address, hours, currency…) are edited in the admin panel instead.

# Only Caddy on this server talks to the app; visitors reach it through https.
HOST=127.0.0.1
PORT=3000
DATA_DIR=$DATA_DIR
PUBLIC_URL=$5

ADMIN_USERNAME=admin
ADMIN_PASSWORD='$1'
WHATSAPP_NUMBER=$2
TELEGRAM_BOT_TOKEN=$3
OPENAI_API_KEY=$4
# Most AI requests a day across all customers (default 400).
AI_DAILY_LIMIT=
EOF
}

# $1 the node binary.
service_unit() {
  cat <<EOF
[Unit]
Description=Unity Performance website, shop, admin panel and Telegram bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$1 src/server.js
Restart=always
RestartSec=3
# The app can read its code and write only to its data folder.
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
EOF
}

# $1 the site address (a domain, or :80 for plain HTTP), $2 the app port.
caddy_site() {
  cat <<EOF
# Unity Performance. With a domain, Caddy gets and renews the HTTPS certificate automatically.
$1 {
	encode zstd gzip
	reverse_proxy 127.0.0.1:$2
}
EOF
}

backup_script() {
  cat <<EOF
#!/bin/sh
# Daily copy of orders, enquiries, products, settings and uploaded photos. Keeps the last 14 days.
set -eu
mkdir -p "$BACKUP_DIR"
# Exit status 1 only means a file changed while it was copied (the next backup catches it).
tar -czf "$BACKUP_DIR/$APP_NAME-\$(date +%F).tar.gz" --exclude='*.tmp' -C "$DATA_DIR" . || [ \$? -eq 1 ]
find "$BACKUP_DIR" -name '$APP_NAME-*.tar.gz' -mtime +14 -delete
EOF
}

backup_units() {
  cat >"/etc/systemd/system/$APP_NAME-backup.service" <<EOF
[Unit]
Description=Back up Unity Performance data

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/$APP_NAME-backup
EOF
  cat >"/etc/systemd/system/$APP_NAME-backup.timer" <<EOF
[Unit]
Description=Daily Unity Performance backup

[Timer]
OnCalendar=daily
RandomizedDelaySec=30m
Persistent=true

[Install]
WantedBy=timers.target
EOF
}

# ---------- Steps ----------

check_system() {
  [ "$(id -u)" -eq 0 ] || fail "Run this with sudo: sudo bash $0 ${1:-your-domain.com}"
  command -v apt-get >/dev/null || fail "This installer needs Ubuntu or Debian."
  [ -f "$APP_DIR/src/server.js" ] || fail "Run this script from inside the project (deploy/vps/install.sh)."
  # The service can't read home folders (ProtectHome), and the code shouldn't live in one.
  case "$APP_DIR" in
    /home/* | /root/*) fail "Move the project to /opt/$APP_NAME first: sudo mv $APP_DIR /opt/$APP_NAME" ;;
  esac
  if [ -n "${1:-}" ] && ! [[ "$1" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$ ]]; then
    fail "\"$1\" doesn't look like a domain. Use just the name, e.g. shop.example.com (no https://)."
  fi
}

install_packages() {
  say "Installing Node.js $NODE_MAJOR, Caddy and the firewall…"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -q
  apt-get install -y -q ca-certificates curl gnupg ufw
  if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
    curl -fsSL "https://deb.nodesource.com/setup_$NODE_MAJOR.x" | bash -
    apt-get install -y -q nodejs
  fi
  if ! command -v caddy >/dev/null; then
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt >/etc/apt/sources.list.d/caddy-stable.list
    chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -q
    apt-get install -y -q caddy
  fi
}

create_account() {
  id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$APP_USER"
  install -d -o "$APP_USER" -g "$APP_USER" -m 750 "$DATA_DIR"
  install -d -o root -g "$APP_USER" -m 750 "$CONFIG_DIR"
  install -d -o root -g root -m 700 "$BACKUP_DIR"
  runuser -u "$APP_USER" -- test -r "$APP_DIR/src/server.js" || fail "The $APP_USER account can't read $APP_DIR. Run: sudo chmod -R a+rX $APP_DIR"
}

GENERATED_PASSWORD=""

# Asks for the main settings the first time; afterwards the settings file is kept as it is.
write_settings() {
  local domain=$1 public_url=""
  [ -n "$domain" ] && public_url="https://$domain"
  if [ -f "$ENV_FILE" ]; then
    if [ -n "$domain" ]; then
      if grep -q '^PUBLIC_URL=' "$ENV_FILE"; then sed -i "s|^PUBLIC_URL=.*|PUBLIC_URL=$public_url|" "$ENV_FILE"; else echo "PUBLIC_URL=$public_url" >>"$ENV_FILE"; fi
    fi
    say "Keeping your settings in $ENV_FILE"
    return
  fi
  local password=${ADMIN_PASSWORD:-} whatsapp=${WHATSAPP_NUMBER:-} telegram=${TELEGRAM_BOT_TOKEN:-} openai=${OPENAI_API_KEY:-}
  if [ -t 0 ]; then
    say "A few settings (press Enter to skip any you don't have yet; you can add them later in $ENV_FILE)"
    [ -n "$whatsapp" ] || read -rp "WhatsApp number for orders, with country code (e.g. 919876543210): " whatsapp
    [ -n "$telegram" ] || read -rp "Telegram bot token from @BotFather: " telegram
    [ -n "$openai" ] || read -rp "OpenAI API key (for AI search): " openai
    if [ -z "$password" ]; then
      read -rsp "Admin password, at least 10 characters (Enter to create one for you): " password
      echo
    fi
  fi
  if [ -z "$password" ]; then
    password=$(head -c 64 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | cut -c 1-20)
    GENERATED_PASSWORD=$password
  fi
  [ "${#password}" -ge 10 ] || fail "The admin password must be at least 10 characters."
  [[ "$password" != *"'"* && "$password" != *$'\n'* ]] || fail "The admin password can't contain a ' character."
  whatsapp=${whatsapp//[^0-9]/}
  [ -z "$telegram" ] || [[ "$telegram" =~ ^[0-9]+:[A-Za-z0-9_-]+$ ]] || fail "That doesn't look like a Telegram bot token (it looks like 123456789:ABC-def…)."
  [[ "$openai" =~ ^[A-Za-z0-9_-]*$ ]] || fail "That doesn't look like an OpenAI API key."
  (
    umask 077
    env_file "$password" "$whatsapp" "$telegram" "$openai" "$public_url" >"$ENV_FILE"
  )
  chown root:"$APP_USER" "$ENV_FILE"
  chmod 640 "$ENV_FILE"
  say "Saved your settings in $ENV_FILE"
}

run_tests() {
  say "Checking the app on this server's Node.js…"
  local log
  log=$(mktemp)
  if ! (cd "$APP_DIR" && node --test --import ./scripts/isolate-data.js >"$log" 2>&1); then
    grep -E '^not ok|error:' "$log" | head -n 20 >&2
    fail "The app's checks failed on this server (full log: $log)."
  fi
  rm -f "$log"
}

start_app() {
  say "Starting the app…"
  service_unit "$(command -v node)" >"/etc/systemd/system/$APP_NAME.service"
  backup_script >"/usr/local/sbin/$APP_NAME-backup"
  chmod 755 "/usr/local/sbin/$APP_NAME-backup"
  backup_units
  systemctl daemon-reload
  systemctl enable --now "$APP_NAME-backup.timer" >/dev/null
  systemctl enable "$APP_NAME" >/dev/null 2>&1
  systemctl restart "$APP_NAME"
  if ! wait_healthy; then
    journalctl -u "$APP_NAME" -n 30 --no-pager >&2 || true
    fail "The app didn't start. The log above says why."
  fi
}

# Checks the domain points at this server; Caddy can only get a certificate once it does.
check_dns() {
  local domain=$1 here there
  here=$(curl -4 -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)
  there=$(getent ahostsv4 "$domain" 2>/dev/null | awk 'NR == 1 { print $1 }')
  local target=${here:-"your server"}
  if [ -z "$there" ]; then
    warn "$domain doesn't resolve yet. Add a DNS \"A\" record for it pointing to $target. HTTPS starts working a few minutes after it does."
  elif [ -n "$here" ] && [ "$here" != "$there" ]; then
    warn "$domain points to $there, but this server is $here. Update the DNS \"A\" record; HTTPS starts working once it matches."
  fi
}

configure_caddy() {
  local domain=$1 site
  say "Setting up Caddy…"
  install -d -m 755 "$(dirname "$CADDY_SITE")"
  if [ -n "$domain" ]; then
    site=$domain
  elif [ -f "$CADDY_SITE" ]; then
    site=""
  else
    site=":80"
  fi
  [ -z "$site" ] || caddy_site "$site" "$(app_port)" >"$CADDY_SITE"
  # Point Caddy's main config at the sites folder: replace the stock welcome page, or add the
  # import to a config that already serves other sites.
  if [ ! -f /etc/caddy/Caddyfile ] || grep -q '/usr/share/caddy' /etc/caddy/Caddyfile; then
    echo "import $(dirname "$CADDY_SITE")/*.caddy" >/etc/caddy/Caddyfile
  elif ! grep -qF "import $(dirname "$CADDY_SITE")/*.caddy" /etc/caddy/Caddyfile; then
    printf '\nimport %s/*.caddy\n' "$(dirname "$CADDY_SITE")" >>/etc/caddy/Caddyfile
  fi
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || {
    caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile || true
    fail "Caddy's configuration in /etc/caddy is invalid (see above)."
  }
  local busy
  busy=$(ss -ltnpH '( sport = :80 or sport = :443 )' 2>/dev/null | grep -v '"caddy"' || true)
  [ -z "$busy" ] || fail "Another program is using port 80 or 443 (often Apache or Nginx). Stop it first, e.g. sudo systemctl disable --now apache2 nginx. Details: $busy"
  systemctl enable caddy >/dev/null 2>&1
  systemctl reload-or-restart caddy
  [ -z "$domain" ] || check_dns "$domain"
}

configure_firewall() {
  if [ "${SKIP_FIREWALL:-0}" = 1 ]; then
    warn "Skipping the firewall (SKIP_FIREWALL=1)."
    return
  fi
  say "Turning on the firewall (SSH, HTTP and HTTPS stay open)…"
  # Keep SSH open on every port it uses, so this session isn't cut off: ports sshd listens on, the
  # port of open SSH sessions (Ubuntu starts SSH through systemd, so the listener isn't sshd) and
  # sshd's configured port.
  local ports
  ports=$({
    ss -ltnpH 2>/dev/null | awk '/"sshd/ { n = split($4, a, ":"); print a[n] }'
    ss -tnpH state established 2>/dev/null | awk '/"sshd/ { n = split($3, a, ":"); print a[n] }'
    sshd -T 2>/dev/null | awk '$1 == "port" { print $2 }'
  } | sort -un)
  for port in ${ports:-22}; do ufw allow "$port/tcp" >/dev/null; done
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null
}

summary() {
  local domain=$1 address
  if [ -n "$domain" ]; then
    address="https://$domain"
  else
    address="http://$(curl -4 -fsS --max-time 5 https://api.ipify.org 2>/dev/null || echo "YOUR-SERVER-IP")"
  fi
  say "Unity Performance is running."
  echo "  Website:   $address"
  echo "  Admin:     $address/admin  (username: admin)"
  [ -z "$GENERATED_PASSWORD" ] || echo "  Password:  $GENERATED_PASSWORD   ← save this now; it's also in $ENV_FILE"
  echo "  Settings:  $ENV_FILE  (then: sudo systemctl restart $APP_NAME)"
  echo "  Data:      $DATA_DIR   Backups: $BACKUP_DIR (daily, 14 kept)"
  echo "  Logs:      sudo journalctl -u $APP_NAME -f"
  echo "  Update:    sudo bash $APP_DIR/deploy/vps/update.sh"
  if [ -z "$domain" ]; then
    warn "Without a domain the site has no HTTPS, so the admin password travels unencrypted. Point a domain at this server and run: sudo bash $APP_DIR/deploy/vps/install.sh your-domain.com"
  fi
  if grep -q '^TELEGRAM_BOT_TOKEN=.\+' "$ENV_FILE"; then
    warn "Only one copy of the bot can run. Stop any other copy (Render, your computer) that uses the same Telegram token."
  fi
}

main() {
  local domain=${1:-}
  domain=${domain#https://}
  domain=${domain#http://}
  domain=${domain%%/*}
  check_system "$domain"
  install_packages
  create_account
  write_settings "$domain"
  run_tests
  start_app
  configure_caddy "$domain"
  configure_firewall
  summary "$domain"
}

# Only run when executed, so update.sh can reuse the functions above.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
