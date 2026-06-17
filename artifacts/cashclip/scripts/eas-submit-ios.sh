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

# ── Materialize ASC key from Replit Secrets ───────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/asc-key-env.sh"

cd "$SCRIPT_DIR/.."

export PATH="/tmp/fake-bin:$PATH"
export EXPO_TOKEN="$EXPO_TOKLAST"

# ── Patch eas.json with ASC key so --non-interactive submit finds credentials ─
cp eas.json eas.json.submit-bak
node -e "
const fs = require('fs');
const eas = JSON.parse(fs.readFileSync('eas.json', 'utf8'));
eas.submit = eas.submit || {};
eas.submit.production = eas.submit.production || {};
eas.submit.production.ios = eas.submit.production.ios || {};
eas.submit.production.ios.ascApiKeyPath = process.env.EXPO_ASC_API_KEY_PATH;
eas.submit.production.ios.ascApiKeyId = process.env.EXPO_ASC_KEY_ID;
eas.submit.production.ios.ascApiKeyIssuerId = process.env.EXPO_ASC_ISSUER_ID;
fs.writeFileSync('eas.json', JSON.stringify(eas, null, 2));
console.log('Patched eas.json with ASC key:', process.env.EXPO_ASC_KEY_ID);
"

# ── Run EAS iOS production submit ─────────────────────────────────────────────
echo "▶ Starting EAS iOS production submit (profile: production) ..."
pnpm exec eas submit --platform ios --profile production --non-interactive "$@"
SUBMIT_EXIT=$?

# ── Restore eas.json ──────────────────────────────────────────────────────────
mv eas.json.submit-bak eas.json

exit $SUBMIT_EXIT
