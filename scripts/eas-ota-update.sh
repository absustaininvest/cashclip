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
SOURCE="${EAS_OTA_SOURCE:-cashclip-next}"
SOURCE_DIR="artifacts/${SOURCE}"

# Validate that the resolved source tree exists before proceeding.
if [ ! -d "${SOURCE_DIR}" ]; then
  echo "ERROR: Source directory '${SOURCE_DIR}' does not exist."
  echo "  Set EAS_OTA_SOURCE to a valid subdirectory of artifacts/ (e.g. cashclip-next or cashclip)."
  exit 1
fi

echo "================================================"
echo "  CashClip EAS OTA Update — $(date)"
echo "  Source tree: ${SOURCE_DIR}"
echo "  Channel: $CHANNEL"
echo "  Message: $MESSAGE"
echo "================================================"

cd "${SOURCE_DIR}"
EXPO_TOKEN="$EXPO_TOKEN" eas update \
  --channel "$CHANNEL" \
  --message "$MESSAGE" \
  --non-interactive

echo ""
echo "================================================"
echo "  OTA update published successfully!"
echo "================================================"
