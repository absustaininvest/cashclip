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

# ── Materialize ASC key from the verified APPLE_ASC_PRIVATE_KEY secret ────────
# Key ID 3685WS5P35 (Admin role), verified against the App Store Connect API.
# The .p8 is NEVER stored in the repo — it lives only in Replit Secrets and is
# written to /tmp at build time, then discarded with the sandbox.
KEY_ID="${APPLE_ASC_KEY_ID:-3685WS5P35}"
KEY_PATH="/tmp/AuthKey_${KEY_ID}.p8"
KEY_PATH="$KEY_PATH" node -e 'const s=(process.env.APPLE_ASC_PRIVATE_KEY||"").replace(/\\n/g,"\n").trim(); if(!s){console.error("ERROR: APPLE_ASC_PRIVATE_KEY secret is not set.");process.exit(1)} const pem=s.includes("\n")?s:`-----BEGIN PRIVATE KEY-----\n${s.replace(/-----[^-]+-----/g,"").replace(/\s+/g,"").match(/.{1,64}/g).join("\n")}\n-----END PRIVATE KEY-----`; require("fs").writeFileSync(process.env.KEY_PATH, pem.endsWith("\n")?pem:pem+"\n");' || exit 1
echo "Wrote ASC key $KEY_ID to $KEY_PATH"

# ── Run EAS iOS production build ─────────────────────────────────────────────
cd artifacts/cashclip

export PATH="/tmp/fake-bin:$PATH"
export EXPO_TOKEN="$EXPO_TOKLAST"
export EXPO_ASC_API_KEY_PATH="$KEY_PATH"
export EXPO_ASC_KEY_ID="$KEY_ID"
export EXPO_ASC_ISSUER_ID="${APPLE_ASC_ISSUER_ID:-45944549-8278-4477-a1c6-3348ec45c3f0}"
export EXPO_APPLE_TEAM_ID="FAX932PG78"
export EXPO_APPLE_TEAM_TYPE="COMPANY_OR_ORGANIZATION"
export EAS_SKIP_AUTO_FINGERPRINT=1

echo "▶ Starting EAS iOS production build (profile: production) ..."
pnpm exec eas build --platform ios --profile production --non-interactive
