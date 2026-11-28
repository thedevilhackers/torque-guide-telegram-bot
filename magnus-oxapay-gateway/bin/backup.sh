#!/usr/bin/env bash
#
# Nightly encrypted backup of the MagnusBilling server (run by cron as root; install.sh sets it up).
#
# Each backup holds:
#   magnus-database.sql   the MagnusBilling database (call history only if backup.include_calls is on)
#   etc-asterisk/         /etc/asterisk
#   gateway/              the top-up gateway's config.php and database
# It is encrypted (AES-256) with the key in /root/unitycarrier-backups/backup.key, kept for backup.keep nights in
# /root/unitycarrier-backups/nightly/, and sent to the Telegram admin chats (split into parts over 45 MB).
#
# Usage:
#   bash bin/backup.sh --now               make a backup now
#   bash bin/backup.sh --show-key          print the encryption key (store it somewhere safe, off this server)
#   bash bin/backup.sh --restore FILE      decrypt a backup (or its first part) into a folder and show how to restore
#
# Without the key a backup cannot be opened, by you or by anyone else.

set -Eeuo pipefail

APP_DIR=${UC_APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}
BACKUP_ROOT=${UC_BACKUP_ROOT:-/root/unitycarrier-backups}
NIGHTLY=$BACKUP_ROOT/nightly
KEY=$BACKUP_ROOT/backup.key
CIPHER=(-aes-256-cbc -pbkdf2 -iter 200000 -md sha256)
PART_SIZE=${UC_PART_SIZE:-$((45 * 1024 * 1024))}   # UC_PART_SIZE: testing only
STAMP=$(date +%Y%m%d-%H%M)
HOST=$(hostname -s 2>/dev/null || echo server)
MODE=${1:-}

cli() { php "$APP_DIR/bin/cli.php" "$@"; }
log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }
fail() {
    trap - ERR   # a failing alert must not raise a second one
    log "FAILED: $1"
    if [[ ${TELEGRAM:-0} == 1 ]]; then
        cli backup:notify "❌ Nightly backup on $HOST failed: $1" > /dev/null 2>&1 || log "The failure alert could not be sent to Telegram either."
    fi
    exit 1
}
trap 'fail "stopped at line $LINENO"' ERR
# send FILE CAPTION: fails only if no admin chat got the file. Chats that did not get it are noted for one warning.
send() {
    local out
    if ! out=$(cli backup:send "$1" "$2" 2>&1); then
        log "$out"
        return 1
    fi
    grep '^not sent to chat ' <<< "$out" >> "$TMP/not-sent" || true
}

[[ $EUID -eq 0 ]] || { echo "Run as root." >&2; exit 1; }
umask 077
mkdir -p "$NIGHTLY"
chmod 700 "$BACKUP_ROOT" "$NIGHTLY"
if [[ ! -s $KEY ]]; then
    openssl rand -base64 48 > "$KEY"
    chmod 600 "$KEY"
    log "Created a new encryption key: $KEY"
fi

# ------------------------------------------------------------------ show key / restore

if [[ $MODE == --show-key ]]; then
    cat "$KEY"
    exit 0
fi

if [[ $MODE == --restore ]]; then
    trap - ERR
    file=${2:-}
    [[ -f $file ]] || { echo "Usage: bash $0 --restore /root/unitycarrier-backups/nightly/backup-....enc" >&2; exit 1; }
    out=${3:-/root/unitycarrier-restore-$STAMP}
    mkdir -p "$out"
    if [[ $file == *.part-aa ]]; then
        input=$(mktemp); cat "${file%.part-aa}".part-* > "$input"
    else
        input=$file
    fi
    if ! openssl enc -d "${CIPHER[@]}" -pass "file:$KEY" -in "$input" | tar -xz -C "$out"; then
        echo "Could not decrypt $file. Is $KEY the key this backup was made with?" >&2
        exit 1
    fi
    [[ $input != "$file" ]] && rm -f "$input"
    echo "Decrypted into $out:"
    ls -la "$out"
    cat "$out/RESTORE.txt"
    exit 0
fi

# ------------------------------------------------------------------ settings

while IFS='=' read -r name value; do
    case $name in
        enabled) ENABLED=$value ;;
        keep) KEEP=$value ;;
        telegram) TELEGRAM=$value ;;
        include_calls) INCLUDE_CALLS=$value ;;
    esac
done < <(cli backup:settings)
if [[ ${ENABLED:-1} != 1 && $MODE != --now ]]; then
    log "Backups are turned off (backup.enabled in config.php)."
    exit 0
fi

# ------------------------------------------------------------------ backup

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/b/gateway"
log "Backup started"

DUMP=$(command -v mariadb-dump || command -v mysqldump || true)
[[ -n $DUMP ]] || fail "mysqldump is not installed"
DBNAME=$(php "$APP_DIR/bin/panel-addon.php" mycnf "$TMP/my.cnf")
ignore=()
if [[ ${INCLUDE_CALLS:-0} != 1 ]]; then
    for table in pkg_cdr pkg_cdr_failed pkg_cdr_archive pkg_cdr_summary_day pkg_cdr_summary_month pkg_call_chart; do
        ignore+=("--ignore-table=$DBNAME.$table")
    done
fi
"$DUMP" --defaults-extra-file="$TMP/my.cnf" --single-transaction --quick --no-tablespaces --triggers "${ignore[@]}" "$DBNAME" \
    > "$TMP/b/magnus-database.sql" || fail "the database dump failed"

[[ -d /etc/asterisk ]] && cp -a /etc/asterisk "$TMP/b/etc-asterisk"
cp -a "$APP_DIR/config.php" "$TMP/b/gateway/" 2>/dev/null || true
for db in "$APP_DIR"/data/*.sqlite; do
    [[ -f $db ]] || continue
    if command -v sqlite3 >/dev/null; then
        sqlite3 "$db" ".backup '$TMP/b/gateway/$(basename "$db")'"   # consistent copy while the gateway runs
    else
        cp -a "$db" "$TMP/b/gateway/"
    fi
done

cat > "$TMP/b/RESTORE.txt" <<EOF
Backup of $HOST made on $(date). Call history included: $([[ ${INCLUDE_CALLS:-0} == 1 ]] && echo yes || echo no).

Restore only what you need. Restoring the database replaces everything changed since this backup.
  Database:  mysql $DBNAME < magnus-database.sql
  Asterisk:  cp -a etc-asterisk/. /etc/asterisk/   then: systemctl restart asterisk
  Gateway:   cp gateway/config.php $APP_DIR/  and  cp gateway/*.sqlite $APP_DIR/data/  (then: chown -R www-data: $APP_DIR/data)
EOF

FILE=$NIGHTLY/backup-$HOST-$STAMP.tar.gz.enc
tar -czf - -C "$TMP/b" . | openssl enc -e "${CIPHER[@]}" -salt -pass "file:$KEY" -out "$FILE"
# Check the file opens before trusting it.
openssl enc -d "${CIPHER[@]}" -pass "file:$KEY" -in "$FILE" | tar -tz > /dev/null || fail "the new backup did not open again"
SIZE=$(stat -c %s "$FILE")
log "Saved $FILE ($(du -h "$FILE" | cut -f1))"

# Keep the newest $KEEP backups.
mapfile -t old < <(ls -1t "$NIGHTLY"/backup-*.tar.gz.enc 2>/dev/null | tail -n +$((${KEEP:-7} + 1)))
for f in "${old[@]}"; do
    rm -f "$f"
done

# ------------------------------------------------------------------ telegram

if [[ ${TELEGRAM:-0} == 1 ]]; then
    caption="💾 <b>Nightly backup</b> $HOST · $(date '+%d %b %Y %H:%M') · $(du -h "$FILE" | cut -f1), encrypted.
Restore: bash $APP_DIR/bin/backup.sh --restore FILE (needs the key from backup.sh --show-key)."
    : > "$TMP/not-sent"
    if [[ $SIZE -le $PART_SIZE ]]; then
        send "$FILE" "$caption" || fail "no admin chat could receive it on Telegram (the backup is saved on the server: $FILE)"
    else
        split -b "$PART_SIZE" -a 2 "$FILE" "$TMP/$(basename "$FILE").part-"
        parts=("$TMP/$(basename "$FILE")".part-*)
        n=1
        for part in "${parts[@]}"; do
            send "$part" "$caption
Part $n of ${#parts[@]}. Join the parts in order before restoring." \
                || fail "part $n could not be sent to any admin chat on Telegram (the backup is saved on the server: $FILE)"
            n=$((n + 1))
        done
    fi
    if [[ -s $TMP/not-sent ]]; then
        missed=$(sort -u "$TMP/not-sent")
        log "Sent, but some admin chats did not get it:"
        log "$missed"
        cli backup:notify "⚠️ Backup on $HOST is saved and sent, but these admin chats did not get it:
$missed" > /dev/null 2>&1 || true
    else
        log "Sent to the Telegram admin chats"
    fi
fi
log "Backup finished"
