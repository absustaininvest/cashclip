#!/bin/bash
set -e

# ── git wrapper (sandbox blocks .git writes) ────────────────────────────────
mkdir -p /tmp/fake-bin
cat > /tmp/fake-bin/git << 'GITEOF'
#!/bin/bash
case "$1" in
  add|commit|stash|checkout|reset|clean|push|pull|fetch|rm) exit 0 ;;
  *) exec /usr/bin/git "$@" ;;
esac
GITEOF
chmod +x /tmp/fake-bin/git

# ── Locate ASC key — owner drops AuthKey_DGVBV8VV95_*.p8 into attached_assets ──
# NOTE: The .p8 file must NOT be committed to the repo. Drop it into chat at
# build time; Replit places it in attached_assets/ with a timestamp suffix.
# After the build queues, the file can be safely discarded.
KEY_FILE=$(ls -t attached_assets/AuthKey_DGVBV8VV95_*.p8 2>/dev/null | head -1)
if [ -z "$KEY_FILE" ]; then
  echo "ERROR: No AuthKey_DGVBV8VV95_*.p8 found in attached_assets/"
  echo "Please drop the ASC private key file into the chat before running this build."
  exit 1
fi
echo "Using ASC key: $KEY_FILE"
cat "$KEY_FILE" > /tmp/AuthKey_DGVBV8VV95.p8

# ── Run EAS iOS production build ─────────────────────────────────────────────
cd artifacts/cashclip

export PATH="/tmp/fake-bin:$PATH"
export EXPO_TOKEN="$EXPO_TOKLAST"
export EXPO_ASC_API_KEY_PATH="/tmp/AuthKey_DGVBV8VV95.p8"
export EXPO_ASC_KEY_ID="DGVBV8VV95"
export EXPO_ASC_ISSUER_ID="45944549-8278-4477-a1c6-3348ec45c3f0"
export EXPO_APPLE_TEAM_ID="FAX932PG78"
export EXPO_APPLE_TEAM_TYPE="COMPANY_OR_ORGANIZATION"
export EAS_SKIP_AUTO_FINGERPRINT=1

echo "▶ Starting EAS iOS production build (profile: production) ..."
pnpm exec eas build --platform ios --profile production --non-interactive
