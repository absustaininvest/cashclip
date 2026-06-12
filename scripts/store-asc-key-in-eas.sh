#!/usr/bin/env bash
set -euo pipefail
#
# store-asc-key-in-eas.sh
#
# Stores a new App Store Connect Admin Team Key in EAS so that
# "eas build --platform ios --profile production" can manage
# certificates and provisioning profiles.
#
# Run AFTER validate-asc-key.js confirms the key returns 200 on
# /v1/certificates and /v1/profiles.
#
# USAGE:
#   bash scripts/store-asc-key-in-eas.sh <path-to-AuthKey_KEYID.p8>
#
# The Key ID is derived from the filename (AuthKey_<KEY_ID>.p8).
# The Issuer ID is account-wide; hardcoded below (constant across key rotations).
#
# REQUIRES:
#   - EXPO_TOKLAST (or EXPO_TOKEN) set in the environment
#   - eas CLI installed globally (npm i -g eas-cli)
#   - run from the workspace root or any directory (cd is handled internally)
#

ISSUER_ID="45944549-8278-4477-a1c6-3348ec45c3f0"
WORKSPACE="$(cd "$(dirname "$0")/.." && pwd)"
CASHCLIP_DIR="$WORKSPACE/artifacts/cashclip"

if [ -z "${1:-}" ]; then
  echo "Usage: bash scripts/store-asc-key-in-eas.sh <AuthKey_KEYID.p8>"
  echo ""
  echo "  The Key ID is read from the filename: AuthKey_<KEY_ID>.p8"
  exit 1
fi

P8_PATH="$(realpath "$1")"
if [ ! -f "$P8_PATH" ]; then
  echo "ERROR: File not found: $P8_PATH"
  exit 1
fi

# Extract Key ID from the filename (Apple names it AuthKey_<KEYID>.p8)
FILENAME="$(basename "$P8_PATH")"
KEY_ID="${FILENAME#AuthKey_}"
KEY_ID="${KEY_ID%.p8}"

if [ "$KEY_ID" = "$FILENAME" ] || [ -z "$KEY_ID" ]; then
  echo "ERROR: Could not extract Key ID from filename '$FILENAME'."
  echo "  Expected format: AuthKey_<KEY_ID>.p8 (as downloaded from App Store Connect)"
  exit 1
fi

EXPO_TOKEN="${EXPO_TOKEN:-${EXPO_TOKLAST:-}}"
if [ -z "$EXPO_TOKEN" ]; then
  echo "WARNING: EXPO_TOKEN / EXPO_TOKLAST not set — EAS CLI will try its own auth."
fi

echo ""
echo "══════════════════════════════════════════════"
echo "  Store ASC Admin Key in EAS"
echo "══════════════════════════════════════════════"
echo "  Key ID:    $KEY_ID"
echo "  Issuer ID: $ISSUER_ID"
echo "  .p8 file:  $P8_PATH"
echo "  App dir:   $CASHCLIP_DIR"
echo ""

EAS_BIN="$(which eas 2>/dev/null || echo "$HOME/.config/npm/node_global/bin/eas")"
echo "  EAS CLI: $EAS_BIN ($("$EAS_BIN" --version 2>/dev/null | head -1))"
echo ""

cd "$CASHCLIP_DIR"

# Run eas credentials interactively.
# EAS will prompt to select/create the ASC key entry — choose "Add new key"
# and supply the Key ID, Issuer ID, and .p8 path when asked.
#
# The env vars below pre-fill the non-interactive fields where eas-cli supports it.
EXPO_TOKEN="$EXPO_TOKEN" \
EXPO_ASC_KEY_ID="$KEY_ID" \
EXPO_ASC_ISSUER_ID="$ISSUER_ID" \
EXPO_ASC_API_KEY_PATH="$P8_PATH" \
  "$EAS_BIN" credentials --platform ios

echo ""
echo "══════════════════════════════════════════════"
echo "  Done. Key $KEY_ID is now stored in EAS."
echo ""
echo "  Verify with a dry-run:"
echo "    cd artifacts/cashclip && eas build --platform ios --profile production --non-interactive --dry-run"
echo ""
echo "  Then revoke the OLD key (36377NCG8Z) in:"
echo "    App Store Connect → Integrations → App Store Connect API → Team Keys"
echo "══════════════════════════════════════════════"
echo ""
