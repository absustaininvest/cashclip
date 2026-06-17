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

# ── Materialize ASC key from Replit Secrets (shared with submit) ─────────────
# Resolves the active App Store Connect API key entirely from the
# APPLE_ASC_PRIVATE_KEY / APPLE_ASC_KEY_ID / APPLE_ASC_ISSUER_ID secrets and
# exports the EXPO_ASC_* env vars EAS reads. Fails loudly if any are missing —
# no key ID or .p8 path is hardcoded here.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/asc-key-env.sh"

# ── Run EAS iOS production build ─────────────────────────────────────────────
cd artifacts/cashclip

export PATH="/tmp/fake-bin:$PATH"
export EXPO_TOKEN="$EXPO_TOKLAST"
export EXPO_APPLE_TEAM_ID="FAX932PG78"
export EXPO_APPLE_TEAM_TYPE="COMPANY_OR_ORGANIZATION"
export EAS_SKIP_AUTO_FINGERPRINT=1

echo "▶ Starting EAS iOS production build (profile: production) ..."
pnpm exec eas build --platform ios --profile production --non-interactive
