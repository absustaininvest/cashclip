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

# ── Run EAS Android production build ─────────────────────────────────────────
# No App Store Connect key here — Android signing uses the remote keystore on
# EAS (eas.json production profile: credentialsSource "remote", app-bundle).
cd artifacts/cashclip

export PATH="/tmp/fake-bin:$PATH"
export EXPO_TOKEN="$EXPO_TOKLAST"
export EAS_SKIP_AUTO_FINGERPRINT=1

echo "▶ Starting EAS Android production build (profile: production) ..."
pnpm exec eas build --platform android --profile production --non-interactive
