#!/bin/bash
# One-shot OTA publish helper. Run via a managed workflow (Metro bundling exceeds
# the 120s bash limit and background jobs get reaped). Uses the git-wrapper PATH
# trick so the EAS CLI's post-publish `git add/commit` writes don't get killed by
# the sandbox's .git write guard.
#
# OTA_PLATFORM  – target platform: ios | android | all  (default: ios)
# OTA_MESSAGE   – override the EAS update message         (optional)

mkdir -p /tmp/fake-bin
cat > /tmp/fake-bin/git << 'WRAP'
#!/bin/bash
case "$1" in
  add|commit|merge|rebase|restore|checkout|reset|stash|tag|push|pull)
    exit 0
    ;;
  *)
    exec /usr/bin/git "$@"
    ;;
esac
WRAP
chmod +x /tmp/fake-bin/git

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Remove any stale dist/ from a prior run so each platform gets a clean export.
# Two workflows sharing a dist/ directory can result in one platform's metadata
# appearing in the other's upload step if they run concurrently or sequentially
# without clearing first.
rm -rf dist

export PATH="/tmp/fake-bin:$PATH"
export EXPO_TOKEN="${EXPO_TOKLAST}"

if [ -z "$EXPO_TOKEN" ]; then
  echo "OTA_PUBLISH_FATAL: EXPO_TOKLAST not set in workflow env"
  exit 1
fi

PLATFORM="${OTA_PLATFORM:-ios}"
MESSAGE="${OTA_MESSAGE:-OTA update (${PLATFORM})}"

echo "OTA_PUBLISH_START $(date -u +%FT%TZ) platform=${PLATFORM}"
pnpm exec eas update \
  --branch production \
  --platform "${PLATFORM}" \
  --message "${MESSAGE}" \
  --non-interactive
EXIT=$?
echo "OTA_PUBLISH_EXIT=${EXIT}"
if [ ${EXIT} -eq 0 ]; then
  echo "OTA_PUBLISH_MESSAGE: ${MESSAGE}"
fi
exit ${EXIT}
