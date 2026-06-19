#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────────────
# verify-spki-hash.sh — Pre-build SSL-pin freshness check
#
# Fetches the live SPKI hash from cash-clip.app and compares it against the
# PRIMARY pin baked into plugins/withSslPinning.js.  Exits non-zero when they
# differ so EAS builds fail fast instead of shipping a pinned app that will
# refuse all API connections the moment the cert rotates.
#
# Usage
# ─────
#   bash scripts/verify-spki-hash.sh [--allow-network-failure] [path/to/withSslPinning.js]
#
#   --allow-network-failure
#       When set, a network error (host unreachable, TLS handshake timeout,
#       empty certificate response) exits 0 with a clear WARNING instead of
#       blocking the build.  Use ONLY in CI environments where the production
#       domain is intentionally unreachable (e.g. sandboxed build workers).
#       A CONFIRMED HASH MISMATCH always exits 1 regardless of this flag —
#       the flag cannot be used to bypass a detected pin rotation.
#
#   With no path argument the script looks for the plugin in the standard
#   locations relative to the workspace root (auto-detects which cashclip
#   copy to use).
#
# Exit codes
# ──────────
#   0  — Pin matches the live server (or network failure with --allow-network-failure)
#   1  — Hash mismatch: live SPKI ≠ PRIMARY pin  (hard fail — never skippable)
#   2  — Network failure: could not reach cash-clip.app (without --allow-network-failure)
#   3  — Configuration error: missing plugin file, unparseable pin, etc.
#
# Run this BEFORE every EAS build (iOS and Android).  Add it to your pre-build
# checklist or wire it as the first command in the EAS build scripts.
#
# What "SPKI hash" means
# ──────────────────────
# SSL pinning compares the SHA-256 hash of the server certificate's
# SubjectPublicKeyInfo (SPKI) DER block — i.e., just the public key portion,
# not the entire cert.  Using the public-key hash instead of the full cert hash
# means routine cert renewals (new cert, same key pair) do NOT break the pin;
# only an actual key rotation does.  That is why you must run this check before
# shipping a new build when the cert *or* key may have changed.
#
# How to update the pins when the key rotates
# ────────────────────────────────────────────
#   1. Generate a new private key on the server.
#   2. Run this script — it will print both the live hash and the pinned hash
#      so you can copy the new live value.
#   3. In plugins/withSslPinning.js set:
#        PRIMARY = current BACKUP hash
#        BACKUP  = the new hash this script just printed
#   4. Ship a native app build (OTA cannot update pinned keys).
#   5. Wait for users to update, THEN swap the cert on the server.
#   6. Generate another fresh backup key for the next rotation.
# ────────────────────────────────────────────────────────────────────────────
set -euo pipefail

DOMAIN="cash-clip.app"
ALLOW_NETWORK_FAILURE=0

# ── Parse flags ───────────────────────────────────────────────────────────────
POSITIONAL_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --allow-network-failure)
      ALLOW_NETWORK_FAILURE=1
      ;;
    *)
      POSITIONAL_ARGS+=("$arg")
      ;;
  esac
done

# ── Locate the plugin file ────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ "${#POSITIONAL_ARGS[@]}" -ge 1 ]; then
  PLUGIN_FILE="${POSITIONAL_ARGS[0]}"
else
  # Auto-detect: prefer the primary cashclip artifact, fall back to cashclip-next
  CANDIDATES=(
    "$WORKSPACE/apps/cashclip/plugins/withSslPinning.js"
    "$WORKSPACE/artifacts/cashclip/plugins/withSslPinning.js"
    "$WORKSPACE/artifacts/cashclip-next/plugins/withSslPinning.js"
  )
  PLUGIN_FILE=""
  for candidate in "${CANDIDATES[@]}"; do
    if [ -f "$candidate" ]; then
      PLUGIN_FILE="$candidate"
      break
    fi
  done
  if [ -z "$PLUGIN_FILE" ]; then
    echo "ERROR: Could not find withSslPinning.js in any known location."
    echo "       Pass the path as an argument: $0 path/to/withSslPinning.js"
    exit 3
  fi
fi

if [ ! -f "$PLUGIN_FILE" ]; then
  echo "ERROR: Plugin file not found: $PLUGIN_FILE"
  exit 3
fi

echo "Plugin: $PLUGIN_FILE"

# ── Extract the PRIMARY pin from the plugin ───────────────────────────────────
PINNED_HASH="$(grep -E "PRIMARY\s*:" "$PLUGIN_FILE" | grep -oP "(?<=')[^']+" | head -1)"

if [ -z "$PINNED_HASH" ]; then
  echo "ERROR: Could not extract PRIMARY pin from $PLUGIN_FILE"
  echo "       Expected a line like:  PRIMARY: 'abc123...=',"
  exit 3
fi

echo "Pinned PRIMARY: $PINNED_HASH"

# ── Fetch the live SPKI hash from the server ──────────────────────────────────
echo "Fetching live certificate from $DOMAIN ..."

LIVE_HASH="$(
  openssl s_client \
    -connect "${DOMAIN}:443" \
    -servername "$DOMAIN" \
    2>/dev/null \
  | openssl x509 -noout -pubkey \
  | openssl pkey -pubin -outform der \
  | openssl dgst -sha256 -binary \
  | base64
)" || true

if [ -z "$LIVE_HASH" ]; then
  echo ""
  echo "⚠  NETWORK FAILURE: Could not retrieve the TLS certificate from $DOMAIN."
  echo "   Possible causes: host unreachable, DNS resolution failure,"
  echo "   TLS handshake timeout, or empty certificate response."
  echo ""
  if [ "$ALLOW_NETWORK_FAILURE" = "1" ]; then
    echo "   --allow-network-failure is set — skipping the pin check."
    echo "   WARNING: The pin has NOT been verified against the live server."
    echo "   Do not use this flag outside of isolated CI environments where"
    echo "   $DOMAIN is intentionally unreachable."
    echo ""
    exit 0
  else
    echo "   Build blocked.  To bypass in a sandboxed CI environment where the"
    echo "   domain is intentionally unreachable, pass --allow-network-failure:"
    echo ""
    echo "     bash scripts/verify-spki-hash.sh --allow-network-failure"
    echo ""
    echo "   Or set SSL_ALLOW_NETWORK_FAILURE=1 in the EAS build environment"
    echo "   and re-run the build script — it will forward the flag automatically."
    echo ""
    echo "   IMPORTANT: --allow-network-failure does NOT bypass a hash mismatch."
    echo "   A confirmed mismatch always blocks the build."
    exit 2
  fi
fi

echo "Live SPKI hash: $LIVE_HASH"
echo ""

# ── Compare ───────────────────────────────────────────────────────────────────
if [ "$LIVE_HASH" = "$PINNED_HASH" ]; then
  echo "✓  PRIMARY pin matches the live server — safe to build."
  exit 0
else
  echo "✗  MISMATCH — the live SPKI hash does NOT match the PRIMARY pin."
  echo ""
  echo "   Pinned : $PINNED_HASH"
  echo "   Live   : $LIVE_HASH"
  echo ""
  echo "   Also check the BACKUP pin in $PLUGIN_FILE:"
  BACKUP_HASH="$(grep -E "BACKUP\s*:" "$PLUGIN_FILE" | grep -oP "(?<=')[^']+" | head -1)"
  if [ "$LIVE_HASH" = "$BACKUP_HASH" ]; then
    echo "   ⚠  The live hash MATCHES the BACKUP pin."
    echo "   The cert was already rotated.  Follow the rotation procedure in"
    echo "   $PLUGIN_FILE to promote BACKUP→PRIMARY and add a new BACKUP,"
    echo "   then ship a new native build before users start seeing connection errors."
  else
    echo "   The live hash does not match BACKUP either."
    echo "   The server key may have changed without a prior pin update."
    echo "   Follow the rotation procedure in $PLUGIN_FILE immediately."
  fi
  echo ""
  echo "   DO NOT proceed with the EAS build until the pins are updated."
  echo "   NOTE: --allow-network-failure does NOT bypass a hash mismatch."
  echo "         This failure cannot be skipped."
  exit 1
fi
