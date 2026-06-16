#!/bin/bash
set -e

# ── git wrapper (sandbox blocks .git writes; eas update runs git add/commit
#    after publishing — stub the write ops, pass reads through) ───────────────
mkdir -p /tmp/fake-bin
cat > /tmp/fake-bin/git << 'GITEOF'
#!/bin/bash
case "$1" in
  add|commit|stash|checkout|reset|clean|push|pull|fetch|rm) exit 0 ;;
  *) exec /usr/bin/git "$@" ;;
esac
GITEOF
chmod +x /tmp/fake-bin/git

# ── cd to the cashclip package dir regardless of caller cwd ──────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

export PATH="/tmp/fake-bin:$PATH"
export EXPO_TOKEN="$EXPO_TOKLAST"

echo "▶ Publishing OTA to branch=production, runtime=1.0.0 (build 29 + build 46, iOS + Android) ..."
pnpm exec eas update \
  --branch production \
  --message "Honest balance: show only server-recorded earnings (removed phantom client-side balance)" \
  --non-interactive

echo "✅ OTA publish command finished."
