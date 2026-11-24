#!/usr/bin/env bash
#
# MagnusBilling 8 Webphone (WebRTC) check and fix.
#
# The Webphone in MagnusBilling connects to wss://<the domain in your browser>:8089/ws. This script makes that work:
#   - finds (or gets) a trusted certificate for that domain and gives Asterisk a copy it can read,
#     plus a Let's Encrypt renewal hook that keeps the copy up to date;
#   - turns on Asterisk HTTPS on port 8089 (http.conf) and adds a PJSIP WSS transport (pjsip.conf);
#   - loads the WebSocket and SRTP modules;
#   - opens TCP port 8089 in firewalld or ufw;
#   - reloads Asterisk (no restart unless you allow it) and tests the result.
#
# Usage:
#   bash setup.sh --domain voip.example.com           check, then fix (asks before changing anything)
#   bash setup.sh --domain voip.example.com --check   only check, change nothing
#   bash setup.sh --domain voip.example.com --yes     fix without questions
#
# Options:
#   --domain NAME        the domain you open MagnusBilling with (what is after https:// in the address bar)
#   --email ADDRESS      email for Let's Encrypt, if a new certificate is needed
#   --check              report only
#   --yes                do not ask
#   --restart-asterisk   allow an Asterisk restart if a reload is not enough (ends calls in progress)
#
# Every file it changes is backed up next to the original as <file>.bak-<date>. Safe to run again.

set -Eeuo pipefail

DOMAIN=""
EMAIL=""
CHECK_ONLY=0
ASSUME_YES=0
ALLOW_RESTART=0
# Paths (the MW_* variables exist only for testing this script).
ETC=${MW_ASTERISK_ETC:-/etc/asterisk}
LE_DIR=${MW_LETSENCRYPT:-/etc/letsencrypt}
APACHE_SITES=${MW_APACHE_SITES:-/etc/apache2/sites-enabled}
KEY_DIR=$ETC/keys
CERT_DEST=$KEY_DIR/webphone.crt
KEY_DEST=$KEY_DIR/webphone.key
HOOK=$LE_DIR/renewal-hooks/deploy/magnus-webphone
PORT=8089
STAMP=$(date +%Y%m%d-%H%M%S)

if [[ -t 1 ]]; then
    c_blue=$'\e[34m' c_green=$'\e[32m' c_yellow=$'\e[33m' c_red=$'\e[31m' c_bold=$'\e[1m' c_off=$'\e[0m'
else
    c_blue="" c_green="" c_yellow="" c_red="" c_bold="" c_off=""
fi
step() { printf '\n%s==>%s %s\n' "$c_blue" "$c_off" "$*"; }
ok()   { printf '  %s✓%s %s\n' "$c_green" "$c_off" "$*"; }
warn() { printf '  %s!%s %s\n' "$c_yellow" "$c_off" "$*"; }
bad()  { printf '  %s✗%s %s\n' "$c_red" "$c_off" "$*"; PROBLEMS=$((PROBLEMS + 1)); }
info() { printf '    %s\n' "$*"; }
die()  { printf '\n%sERROR:%s %s\n' "$c_red" "$c_off" "$*" >&2; exit 1; }
trap 'die "setup.sh stopped at line $LINENO. Nothing after that point was changed; it is safe to run again."' ERR

usage() { sed -n '3,25p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

while [[ $# -gt 0 ]]; do
    case $1 in
        --domain) DOMAIN=${2:-}; shift 2 ;;
        --domain=*) DOMAIN=${1#*=}; shift ;;
        --email) EMAIL=${2:-}; shift 2 ;;
        --email=*) EMAIL=${1#*=}; shift ;;
        --check) CHECK_ONLY=1; shift ;;
        --yes|-y) ASSUME_YES=1; shift ;;
        --restart-asterisk) ALLOW_RESTART=1; shift ;;
        -h|--help) usage 0 ;;
        *) printf 'Unknown option: %s\n\n' "$1" >&2; usage 1 ;;
    esac
done

interactive() { [[ $ASSUME_YES -eq 0 && -t 0 ]]; }
confirm() {
    local reply
    if [[ $ASSUME_YES -eq 1 ]]; then return 0; fi
    if [[ ! -t 0 ]]; then return 1; fi
    read -r -p "  $1 [Y/n]: " reply
    [[ -z $reply || $reply =~ ^[Yy] ]]
}

ast() { timeout 15 asterisk -rx "$1" 2>/dev/null || true; }

backup() {
    [[ -f $1 ]] && cp -p "$1" "$1.bak-$STAMP" && info "backup: $1.bak-$STAMP"
    return 0
}

# set_conf FILE SECTION KEY VALUE: sets "KEY=VALUE" in [SECTION], replacing an active line or adding one after the header.
set_conf() {
    local file=$1 section=$2 key=$3 value=$4 tmp
    tmp=$(mktemp)
    awk -v section="$section" -v key="$key" -v value="$value" '
        function flush() { if (insec && !done) { print key "=" value; done = 1 } }
        /^[[:space:]]*\[[^]]+\]/ {
            name = $0; sub(/^[[:space:]]*\[/, "", name); sub(/\].*$/, "", name)
            if (insec && !done) { print key "=" value; done = 1 }
            insec = (name == section); seen = seen || insec
            print; next
        }
        insec && $0 ~ "^[[:space:]]*" key "[[:space:]]*=" {
            if (!done) { print key "=" value; done = 1 }
            next
        }
        { print }
        END {
            if (!seen) { print ""; print "[" section "]"; print key "=" value }
            else if (insec && !done) { print key "=" value }
        }
    ' "$file" > "$tmp"
    cat "$tmp" > "$file"
    rm -f "$tmp"
}

# get_conf FILE SECTION KEY: prints the active value of KEY in [SECTION].
get_conf() {
    [[ -f $1 ]] || return 0
    awk -v section="$2" -v key="$3" '
        /^[[:space:]]*\[[^]]+\]/ { name = $0; sub(/^[[:space:]]*\[/, "", name); sub(/\].*$/, "", name); insec = (name == section); next }
        insec && $0 ~ "^[[:space:]]*" key "[[:space:]]*=" {
            v = $0; sub(/^[^=]*=[[:space:]]*/, "", v); sub(/[[:space:]]*;.*$/, "", v); sub(/[[:space:]]+$/, "", v); print v; exit
        }
    ' "$1"
}

# cert_covers FILE: the certificate is valid now, for $DOMAIN, for at least one more day.
cert_covers() {
    [[ -r $1 ]] || return 1
    openssl x509 -in "$1" -noout -checkend 86400 >/dev/null 2>&1 || return 1
    openssl x509 -in "$1" -noout -checkhost "$DOMAIN" 2>/dev/null | grep -q 'does match'
}

key_matches() {
    local a b
    a=$(openssl x509 -in "$1" -noout -pubkey 2>/dev/null | sha256sum)
    b=$(openssl pkey -in "$2" -pubout 2>/dev/null | sha256sum)
    [[ -n $a && $a == "$b" ]]
}

# ------------------------------------------------------------------ start

[[ $EUID -eq 0 ]] || die "Run as root: sudo bash $0 ${*:-}"
command -v asterisk >/dev/null || die "Asterisk is not installed on this server."
command -v openssl >/dev/null || die "openssl is missing: apt-get install -y openssl"
[[ -n $(ast 'core show version') ]] || die "Asterisk is not running, or 'asterisk -rx' does not work. Start it with: systemctl start asterisk"

if [[ -z $DOMAIN ]] && interactive; then
    printf '\nWhich domain do you open MagnusBilling with? This is the part after https:// in the address bar,\n'
    printf 'for example voip.unitycarrier.com (not an IP address).\n'
    read -r -p "  Domain: " DOMAIN
fi
DOMAIN=$(printf '%s' "$DOMAIN" | tr 'A-Z' 'a-z' | sed -E 's#^[a-z]+://##; s#[/?].*$##; s#:[0-9]+$##; s#\.$##')
[[ -n $DOMAIN ]] || die "Give the domain: bash $0 --domain voip.example.com"
if [[ $DOMAIN =~ ^[0-9.]+$ ]] || [[ ! $DOMAIN =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$ ]]; then
    die "\"$DOMAIN\" is not a domain name. The Webphone only works when MagnusBilling is opened with a domain, not an IP address."
fi

AST_USER=$(get_conf $ETC/asterisk.conf options runuser); AST_USER=${AST_USER:-root}
AST_GROUP=$(get_conf $ETC/asterisk.conf options rungroup); AST_GROUP=${AST_GROUP:-$AST_USER}
MODDIR=$(awk -F'=>' '/^[[:space:]]*astmoddir/ { gsub(/[[:space:]]/, "", $2); print $2; exit }' $ETC/asterisk.conf 2>/dev/null)
MODDIR=${MODDIR:-/usr/lib/asterisk/modules}
PROBLEMS=0

printf '%sMagnusBilling Webphone check%s for %s (wss://%s:%s/ws)\n' "$c_bold" "$c_off" "$DOMAIN" "$DOMAIN" "$PORT"

# ------------------------------------------------------------------ checks

module_running() { ast "module show like $1" | grep -Eq "^$1[[:space:]].*Running"; }

# Active firewalld zones (newer firewalld prints "public (default)"), or the default zone.
firewalld_zones() {
    local zones
    zones=$(firewall-cmd --get-active-zones 2>/dev/null | awk '!/^[[:space:]]/ && NF { print $1 }' || true)
    [[ -n $zones ]] || zones=$(firewall-cmd --get-default-zone 2>/dev/null || echo public)
    printf '%s\n' $zones
}

check_all() {
    PROBLEMS=0

    step "DNS"
    local ips local_ips ip cf=0 here=0
    ips=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk '{print $1}' | sort -u | paste -sd ' ' -)
    local_ips=" $(ip -4 -o addr show 2>/dev/null | awk '{split($4, a, "/"); printf "%s ", a[1]}')"
    if [[ -z ${ips// /} ]]; then
        bad "$DOMAIN does not resolve. Add an A record pointing to this server."
    else
        for ip in $ips; do
            [[ $local_ips == *" $ip "* ]] && here=1
            if [[ $ip =~ ^(104\.(1[6-9]|2[0-9]|3[01])|172\.(6[4-9]|7[01])|188\.114|162\.15[89]|141\.101|108\.162|173\.245|190\.93|198\.41|103\.2[12]|103\.31|131\.0)\. ]]; then cf=1; fi
        done
        if [[ $here -eq 1 ]]; then
            ok "$DOMAIN points to this server ($ips)"
        elif [[ $cf -eq 1 ]]; then
            bad "$DOMAIN goes through the Cloudflare proxy ($ips). Cloudflare does not pass port $PORT."
            info "In Cloudflare DNS, set this record to \"DNS only\" (grey cloud), or open MagnusBilling with a domain that is not proxied."
        else
            warn "$DOMAIN points to $ips, which is not an address of this server."
            info "That is fine behind NAT, but otherwise the browser is connecting to another machine."
        fi
    fi

    step "Asterisk HTTPS on port $PORT"
    local status bound
    status=$(ast 'http show status')
    bound=$(printf '%s\n' "$status" | sed -n 's/^HTTPS Server Enabled and Bound to //p' | head -1)
    if [[ -z $bound ]]; then
        bad "Asterisk HTTPS is off (http.conf), or its certificate failed to load."
    elif [[ $bound != *":$PORT" ]]; then
        bad "Asterisk HTTPS listens on $bound, not port $PORT."
    elif [[ $bound == 127.* ]]; then
        bad "Asterisk HTTPS listens on $bound only, so browsers cannot reach it."
    else
        ok "HTTPS enabled on $bound"
    fi
    if printf '%s\n' "$status" | grep -Eq '^/ws[[:space:]]+=>'; then ok "/ws endpoint registered"; else bad "/ws endpoint missing (res_http_websocket not loaded)"; fi

    local cert
    cert=$(get_conf $ETC/http.conf general tlscertfile)
    if [[ -n $cert ]]; then
        if [[ ! -r $cert ]]; then
            bad "Certificate file in http.conf not found: $cert"
        elif ! openssl x509 -in "$cert" -noout -checkend 0 >/dev/null 2>&1; then
            bad "The certificate in http.conf has expired: $cert"
        elif ! openssl x509 -in "$cert" -noout -checkhost "$DOMAIN" 2>/dev/null | grep -q 'does match'; then
            bad "The certificate in http.conf is not for $DOMAIN: $cert"
            info "It is for: $(openssl x509 -in "$cert" -noout -ext subjectAltName 2>/dev/null | tail -n +2 | tr -d ' ' || true)"
        elif [[ "$(openssl x509 -in "$cert" -noout -issuer 2>/dev/null | sed 's/^issuer=//')" == "$(openssl x509 -in "$cert" -noout -subject 2>/dev/null | sed 's/^subject=//')" ]]; then
            bad "The certificate in http.conf is self-signed, so browsers reject it: $cert"
        elif [[ $(grep -c 'BEGIN CERTIFICATE' "$cert") -lt 2 ]]; then
            warn "The certificate in http.conf has no intermediate certificate (use fullchain.pem, not cert.pem): $cert"
        else
            ok "Certificate in http.conf is valid for $DOMAIN until $(openssl x509 -in "$cert" -noout -enddate | cut -d= -f2)"
        fi
    fi

    local tls
    tls=$(timeout 10 openssl s_client -connect "127.0.0.1:$PORT" -servername "$DOMAIN" -verify_hostname "$DOMAIN" </dev/null 2>&1 || true)
    if printf '%s' "$tls" | grep -q 'Verify return code: 0 (ok)'; then
        ok "TLS on port $PORT is trusted for $DOMAIN"
    elif printf '%s' "$tls" | grep -q 'Verify return code'; then
        bad "TLS on port $PORT is not trusted: $(printf '%s' "$tls" | grep -m1 'Verify return code' | sed 's/^[[:space:]]*//')"
    else
        bad "Nothing answers TLS on port $PORT on this server."
    fi

    local code
    code=$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' --max-time 5 --http1.1 --resolve "$DOMAIN:$PORT:127.0.0.1" \
        -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
        -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' -H 'Sec-WebSocket-Protocol: sip' \
        "https://$DOMAIN:$PORT/ws" 2>/dev/null || true)
    if [[ $code == 101 ]]; then
        ok "WebSocket handshake answered (101 Switching Protocols)"
    elif [[ -z $code || $code == 000 ]]; then
        bad "WebSocket handshake failed: no answer, or the certificate was refused"
    else
        bad "WebSocket handshake failed: HTTP $code"
    fi

    step "Modules and PJSIP"
    local m
    for m in res_http_websocket.so res_pjsip_transport_websocket.so; do
        if module_running "$m"; then ok "$m running"; else bad "$m not running"; fi
    done
    if module_running res_srtp.so; then
        ok "res_srtp.so running (encrypted WebRTC audio)"
    elif [[ -f $MODDIR/res_srtp.so ]]; then
        bad "res_srtp.so is installed but not loaded. WebRTC calls need it."
    else
        bad "res_srtp.so is not installed: Asterisk was built without SRTP, so WebRTC calls will fail (registration still works)."
        info "Fix: apt-get install -y libsrtp2-dev, then rebuild Asterisk in /usr/src/asterisk-* (./configure --with-jansson-bundled --with-pjproject-bundled && make && make install)."
    fi
    if module_running codec_opus.so; then ok "codec_opus.so running"; else warn "codec_opus.so not running: give WebRTC accounts the alaw or ulaw codec."; fi
    if ast 'pjsip show transports' | grep -Eq '[[:space:]]wss[[:space:]]'; then ok "PJSIP WSS transport active"; else bad "No PJSIP WSS transport, so the Webphone cannot register."; fi

    step "Firewall"
    if command -v firewall-cmd >/dev/null && firewall-cmd --state >/dev/null 2>&1; then
        local zone
        for zone in $(firewalld_zones); do
            if firewall-cmd --zone="$zone" --query-port=$PORT/tcp >/dev/null 2>&1; then ok "firewalld zone $zone allows $PORT/tcp"; else bad "firewalld zone $zone blocks $PORT/tcp"; fi
        done
    elif command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q '^Status: active'; then
        if ufw status | grep -Eq "^$PORT(/tcp)?[[:space:]]+ALLOW"; then ok "ufw allows $PORT/tcp"; else bad "ufw blocks $PORT/tcp"; fi
    else
        warn "No firewalld or ufw running. If you use another firewall, allow TCP $PORT in it."
    fi
    info "Also allow TCP $PORT in your hosting provider's firewall or security group, if it has one."
}

check_all
if [[ $PROBLEMS -eq 0 ]]; then
    printf '\n%sEverything checks out on the server.%s\n' "$c_green" "$c_off"
fi

if [[ $CHECK_ONLY -eq 1 ]]; then
    [[ $PROBLEMS -eq 0 ]] || printf '\n%d problem(s). Run without --check to fix them.\n' "$PROBLEMS"
    exit 0
fi
if [[ $PROBLEMS -eq 0 ]]; then
    printf 'Test from your browser: open https://%s:%s/ws - it should say "Upgrade Required".\n' "$DOMAIN" "$PORT"
    exit 0
fi

printf '\nThis will change: %s/http.conf, %s/pjsip.conf, %s/modules.conf (backups kept), copy the certificate to %s,\nopen TCP %s in the firewall and reload Asterisk (calls in progress are not dropped).\n' "$ETC" "$ETC" "$ETC" "$KEY_DIR" "$PORT"
confirm "Fix it now?" || { printf 'Nothing changed.\n'; exit 0; }

# ------------------------------------------------------------------ certificate

step "Certificate for $DOMAIN"
SRC_CERT="" SRC_KEY="" LINEAGE=""
for dir in "$LE_DIR"/live/*/; do
    [[ -f ${dir}fullchain.pem && -f ${dir}privkey.pem ]] || continue
    if cert_covers "${dir}fullchain.pem"; then
        SRC_CERT=${dir}fullchain.pem SRC_KEY=${dir}privkey.pem LINEAGE=${dir%/}
        ok "Using Let's Encrypt certificate $LINEAGE"
        break
    fi
done

if [[ -z $SRC_CERT && -d $APACHE_SITES ]]; then
    # Certificates used by Apache sites (pairs of SSLCertificateFile / SSLCertificateKeyFile in one VirtualHost).
    while IFS='|' read -r c k; do
        [[ -n $c && -n $k ]] || continue
        if cert_covers "$c" && [[ -r $k ]] && key_matches "$c" "$k"; then
            SRC_CERT=$c SRC_KEY=$k
            ok "Using the certificate of the Apache site for $DOMAIN: $c"
            [[ $(grep -c 'BEGIN CERTIFICATE' "$c") -ge 2 ]] || warn "That file has no intermediate certificate; some browsers may still reject it."
            break
        fi
    done < <(cat "$APACHE_SITES"/*.conf 2>/dev/null | awk '
        /<VirtualHost/ { c = ""; k = "" }
        tolower($1) == "sslcertificatefile" { c = $2 }
        tolower($1) == "sslcertificatekeyfile" { k = $2 }
        /<\/VirtualHost>/ { if (c != "") print c "|" (k != "" ? k : c) }
    ' | tr -d '"' | sort -u)
fi

if [[ -z $SRC_CERT ]]; then
    warn "No certificate for $DOMAIN on this server yet. Getting one from Let's Encrypt."
    command -v certbot >/dev/null || DEBIAN_FRONTEND=noninteractive apt-get install -y -q certbot python3-certbot-apache >/dev/null </dev/null
    email_args=(--register-unsafely-without-email)
    [[ -n $EMAIL ]] && email_args=(-m "$EMAIL")
    if command -v apache2 >/dev/null && certbot plugins </dev/null 2>/dev/null | grep -q '^\* apache'; then
        auth=(--apache)
    else
        auth=(--webroot -w /var/www/html)
    fi
    if timeout 300 certbot certonly "${auth[@]}" -d "$DOMAIN" --non-interactive --agree-tos "${email_args[@]}" </dev/null; then
        LINEAGE=$LE_DIR/live/$DOMAIN
        SRC_CERT=$LINEAGE/fullchain.pem SRC_KEY=$LINEAGE/privkey.pem
        ok "Certificate issued"
    else
        die "Let's Encrypt could not issue a certificate for $DOMAIN. Check that its DNS A record points to this server and that port 80 is open, then run this again."
    fi
fi

install -d -m 0750 -o "$AST_USER" -g "$AST_GROUP" "$KEY_DIR"
install -m 0640 -o "$AST_USER" -g "$AST_GROUP" "$SRC_CERT" "$CERT_DEST"
install -m 0600 -o "$AST_USER" -g "$AST_GROUP" "$SRC_KEY" "$KEY_DEST"
ok "Copied to $CERT_DEST and $KEY_DEST (readable by $AST_USER)"

if [[ -n $LINEAGE ]]; then
    mkdir -p "$(dirname "$HOOK")"
    cat > "$HOOK" <<EOF
#!/bin/sh
# Written by magnus-webphone/setup.sh: copies the renewed certificate for the MagnusBilling Webphone to Asterisk.
[ "\$RENEWED_LINEAGE" = "$LINEAGE" ] || exit 0
install -m 0640 -o $AST_USER -g $AST_GROUP "\$RENEWED_LINEAGE/fullchain.pem" $CERT_DEST
install -m 0600 -o $AST_USER -g $AST_GROUP "\$RENEWED_LINEAGE/privkey.pem" $KEY_DEST
asterisk -rx "module reload http" >/dev/null 2>&1 || true
EOF
    chmod 0755 "$HOOK"
    ok "Renewal hook: $HOOK (Asterisk gets the new certificate automatically)"
else
    warn "This certificate is not from Let's Encrypt on this server. When it is renewed, run this script again."
fi

# ------------------------------------------------------------------ asterisk config

step "Asterisk configuration"
[[ -f $ETC/http.conf ]] || printf '[general]\n' > "$ETC/http.conf"
backup "$ETC/http.conf"
set_conf "$ETC/http.conf" general enabled yes
[[ -n $(get_conf "$ETC/http.conf" general bindaddr) ]] || set_conf "$ETC/http.conf" general bindaddr 127.0.0.1
set_conf "$ETC/http.conf" general tlsenable yes
set_conf "$ETC/http.conf" general tlsbindaddr "0.0.0.0:$PORT"
set_conf "$ETC/http.conf" general tlscertfile "$CERT_DEST"
set_conf "$ETC/http.conf" general tlsprivatekey "$KEY_DEST"
ok "http.conf: HTTPS on 0.0.0.0:$PORT with the certificate above"

if grep -hEiq '^[[:space:]]*protocol[[:space:]]*=[[:space:]]*wss' "$ETC"/pjsip*.conf 2>/dev/null; then
    ok "pjsip.conf already has a WSS transport"
else
    name=transport-wss
    grep -hq "^\[$name\]" "$ETC"/pjsip*.conf 2>/dev/null && name=transport-webphone-wss
    backup "$ETC/pjsip.conf"
    printf '\n; Added by magnus-webphone/setup.sh for the MagnusBilling Webphone (TLS settings are in http.conf)\n[%s]\ntype = transport\nprotocol = wss\nbind = 0.0.0.0\n' "$name" >> "$ETC/pjsip.conf"
    ok "pjsip.conf: added [$name]"
fi

if [[ -f $ETC/modules.conf ]] && grep -Eq '^[[:space:]]*noload[[:space:]]*=>[[:space:]]*(res_http_websocket|res_pjsip_transport_websocket|res_srtp)\.so' "$ETC/modules.conf"; then
    backup "$ETC/modules.conf"
    sed -i -E 's/^([[:space:]]*noload[[:space:]]*=>[[:space:]]*(res_http_websocket|res_pjsip_transport_websocket|res_srtp)\.so)/;\1 ; enabled by magnus-webphone\/setup.sh/' "$ETC/modules.conf"
    ok "modules.conf: stopped blocking the WebSocket/SRTP modules"
fi

# ------------------------------------------------------------------ firewall

step "Firewall"
if command -v firewall-cmd >/dev/null && firewall-cmd --state >/dev/null 2>&1; then
    zones=$(firewalld_zones)
    for zone in $zones; do
        firewall-cmd --permanent --zone="$zone" --add-port=$PORT/tcp >/dev/null
    done
    firewall-cmd --reload >/dev/null
    ok "firewalld: TCP $PORT open in zone(s) $(echo $zones)"
elif command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q '^Status: active'; then
    ufw allow $PORT/tcp >/dev/null
    ok "ufw: TCP $PORT open"
else
    warn "No firewalld or ufw running; nothing to open here."
fi

# ------------------------------------------------------------------ reload

step "Reloading Asterisk"
for m in res_http_websocket.so res_pjsip_transport_websocket.so res_srtp.so; do
    if ! module_running "$m" && [[ -f $MODDIR/$m ]]; then
        ast "module load $m" >/dev/null
    fi
done
ast 'module reload http' >/dev/null
ast 'pjsip reload' >/dev/null
sleep 2
ok "Reloaded http and pjsip"

if ! ast 'pjsip show transports' | grep -Eq '[[:space:]]wss[[:space:]]'; then
    if [[ $ALLOW_RESTART -eq 1 ]]; then
        warn "The WSS transport needs an Asterisk restart. Restarting now (calls in progress end)."
        systemctl restart asterisk
        for _ in $(seq 30); do
            sleep 1
            [[ -n $(ast 'core show version') ]] && break
        done
        sleep 3
    else
        warn "The WSS transport starts after an Asterisk restart. At a quiet time, run: systemctl restart asterisk"
        info "(or run this script again with --restart-asterisk)"
    fi
fi

# ------------------------------------------------------------------ result

printf '\n%sChecking again%s\n' "$c_bold" "$c_off"
check_all
if [[ $PROBLEMS -eq 0 ]]; then
    printf '\n%sDone. The server side of the Webphone is ready.%s\n' "$c_green" "$c_off"
else
    printf '\n%s%d problem(s) left; see the ✗ lines above.%s\n' "$c_yellow" "$PROBLEMS" "$c_off"
fi
cat <<EOF

Now test from your computer:
  1. Open https://$DOMAIN:$PORT/ws in the browser. It should say "Upgrade Required".
     - Page does not load / times out: TCP $PORT is blocked by your hosting provider's firewall.
     - Certificate warning: the certificate is not valid for $DOMAIN.
  2. Open MagnusBilling at https://$DOMAIN/mbilling (exactly this domain), press Ctrl+F5,
     select a SIP user with WebRTC = yes and click Webphone.
EOF
