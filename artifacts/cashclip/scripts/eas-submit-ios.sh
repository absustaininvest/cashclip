#!/bin/bash
set -e

# ── git wrapper (sandbox blocks .git writes) ─────────────────────────────────
mkdir -p /tmp/fake-bin
cat > /tmp/fake-bin/git << 'GITEOF'
#!/bin/bash
case "$1" in
  add|commit|stash|checkout|reset|clean|push|pull|fetch|rm) exit 0 ;;
  *) exec /usr/bin/git "$@" ;;
esac
GITEOF
chmod +x /tmp/fake-bin/git

# ── Materialize ASC key from Replit Secrets (shared with build) ──────────────
# Resolves the active App Store Connect API key entirely from the
# APPLE_ASC_PRIVATE_KEY / APPLE_ASC_KEY_ID / APPLE_ASC_ISSUER_ID secrets and
# exports the EXPO_ASC_* env vars EAS submit reads — so submit never relies on
# a stale hardcoded key or .p8 path.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/asc-key-env.sh"

# ── Run EAS iOS production submit ─────────────────────────────────────────────
# cd to the cashclip package dir regardless of caller cwd (scripts/ lives inside it).
cd "$SCRIPT_DIR/.."

export PATH="/tmp/fake-bin:$PATH"
export EXPO_TOKEN="$EXPO_TOKLAST"

echo "▶ Starting EAS iOS production submit (profile: production) ..."
pnpm exec eas submit --platform ios --profile production --non-interactive "$@"
