#!/usr/bin/env bash
# =============================================================================
#  MagnusBilling 8 — Futuristic Theme installer v@VERSION@ (self-contained)
#
#  On your MagnusBilling server, as root:
#    curl -fsSL @RAW_URL@ -o mbf-install.sh && bash mbf-install.sh
#
#  Options (all optional) are passed to `mbf-theme install`, for example:
#    bash mbf-install.sh --accent magenta --tagline "Acme Voice Cloud"
#    bash mbf-install.sh --help
#  Other commands:  bash mbf-install.sh uninstall | status
#
#  GENERATED FILE — edit src/ and tools/, then run ./build.sh
# =============================================================================
set -euo pipefail

MBF_INSTALLER_VERSION="@VERSION@"
MBF_PAYLOAD_SHA256="@PAYLOAD_SHA256@"

main() {
    if [ "$(id -u)" != "0" ]; then
        echo "Please run as root, e.g.: sudo bash $0 $*" >&2
        exit 1
    fi
    local bin
    for bin in tar gzip base64 sha256sum awk install mktemp stat cmp; do
        command -v "$bin" >/dev/null 2>&1 || { echo "Missing required command: $bin" >&2; exit 1; }
    done

    local tmp rc=0
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' EXIT

    mbf_payload > "$tmp/payload.tgz"
    if ! echo "$MBF_PAYLOAD_SHA256  $tmp/payload.tgz" | sha256sum -c --status -; then
        echo "Installer payload checksum mismatch — the download is incomplete or modified. Download it again." >&2
        exit 1
    fi
    mkdir -p "$tmp/x"
    tar -xzf "$tmp/payload.tgz" -C "$tmp/x"

    local P="${MBF_ROOT:-}"
    install -d -m 0755 "$P/usr/local/share/mbf-theme" "$P/usr/local/sbin"
    install -m 0644 "$tmp/x/mbf.css" "$P/usr/local/share/mbf-theme/mbf.css"
    install -m 0644 "$tmp/x/mbf.js"  "$P/usr/local/share/mbf-theme/mbf.js"
    install -m 0755 "$tmp/x/mbf-theme" "$P/usr/local/sbin/mbf-theme"

    [ "${1:-}" = "install" ] && shift
    case "${1:-}" in
        uninstall|remove|status|apply|reapply|set|enable|disable|version|help|-h|--help)
            "$P/usr/local/sbin/mbf-theme" "$@" || rc=$?
            ;;
        *)
            "$P/usr/local/sbin/mbf-theme" install "$@" || rc=$?
            ;;
    esac
    exit "$rc"
}

