#!/usr/bin/env bash
# Usage: ./scripts/extract-spki-hash.sh cash-clip.app
# Prints the SHA-256 SPKI hash for the live TLS public key on a domain.
# Use this to get the value for the PRIMARY pin in plugins/withSslPinning.js.
set -euo pipefail

DOMAIN="${1:?Usage: $0 <domain>}"

echo ""
echo "Extracting SPKI hash for: $DOMAIN"
echo "---"

HASH=$(echo | openssl s_client -connect "${DOMAIN}:443" -servername "${DOMAIN}" 2>/dev/null \
  | openssl x509 -pubkey -noout \
  | openssl pkey -pubin -outform DER \
  | openssl dgst -sha256 -binary \
  | openssl enc -base64)

echo "SPKI SHA-256 (base64): $HASH"
echo ""
echo "Paste this as PRIMARY in artifacts/cashclip/plugins/withSslPinning.js"
echo ""
echo "ROTATION CHECKLIST:"
echo "  1. Run this script to get the NEW server public key hash"
echo "  2. Set PRIMARY = current BACKUP value"
echo "  3. Set BACKUP  = new hash from this script"
echo "  4. Ship an app update — wait for users to update"
echo "  5. Swap the TLS cert on cash-clip.app"
echo "  6. Run this script again and generate a fresh BACKUP for next time"
