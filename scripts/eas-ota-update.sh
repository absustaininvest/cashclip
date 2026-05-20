#!/usr/bin/env bash
set -euo pipefail

# ── Safety guard ─────────────────────────────────────────────────────────────
# Require EAS_OTA_CONFIRMED=1 to prevent accidental fires when Replit
# auto-restarts this workflow. Set it in the workflow command to run.
if [ "${EAS_OTA_CONFIRMED:-0}" != "1" ]; then
  echo "================================================"
  echo "  EAS OTA Update — WAITING FOR CONFIRMATION"
  echo "================================================"
  echo ""
  echo "  This workflow requires EAS_OTA_CONFIRMED=1 to run."
  echo "  Set it in the workflow command to proceed:"
  echo "    EAS_OTA_CONFIRMED=1 EAS_OTA_MESSAGE='your message' bash scripts/eas-ota-update.sh"
  echo ""
  echo "  Sleeping indefinitely to prevent accidental publishes..."
  sleep infinity
fi

if [ -z "${EXPO_TOKEN:-}" ]; then
  echo "ERROR: EXPO_TOKEN is not set."
  exit 1
fi

MESSAGE="${EAS_OTA_MESSAGE:-OTA update}"
CHANNEL="${EAS_OTA_CHANNEL:-production}"

echo "================================================"
echo "  CashClip EAS OTA Update — $(date)"
echo "  Channel: $CHANNEL"
echo "  Message: $MESSAGE"
echo "================================================"

cd artifacts/cashclip
EXPO_TOKEN="$EXPO_TOKEN" eas update \
  --channel "$CHANNEL" \
  --message "$MESSAGE" \
  --non-interactive

echo ""
echo "================================================"
echo "  OTA update published successfully!"
echo "================================================"
