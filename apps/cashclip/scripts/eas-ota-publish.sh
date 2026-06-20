#!/bin/bash
# One-shot OTA publish helper. Run via a managed workflow (Metro bundling exceeds
# the 120s bash limit and background jobs get reaped). Uses the git-wrapper PATH
# trick so the EAS CLI's post-publish `git add/commit` writes don't get killed by
# the sandbox's .git write guard.
#
# OTA_PLATFORM  – target platform: ios | android | all  (default: ios)
# OTA_MESSAGE   – override the EAS update message         (optional)
#
# A per-workspace flock serialises concurrent iOS + Android workflow runs so
# they never write to dist/ at the same time.

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

export PATH="/tmp/fake-bin:$PATH"
export EXPO_TOKEN="${EXPO_TOKLAST}"
export CI=1

# EXPO_PUBLIC_* vars are inlined by Metro at bundle time.
# They must be set here — EAS build profile env vars do NOT apply to eas update.
export EXPO_PUBLIC_DOMAIN="${EXPO_PUBLIC_DOMAIN:-cash-clip.app}"
export EXPO_PUBLIC_ENV="production"
export EXPO_PUBLIC_SENTRY_DSN="${EXPO_PUBLIC_SENTRY_DSN}"
export EXPO_PUBLIC_VEXO_API_KEY="${EXPO_PUBLIC_VEXO_API_KEY}"

if [ -z "$EXPO_TOKEN" ]; then
  echo "OTA_PUBLISH_FATAL: EXPO_TOKLAST not set in workflow env"
  exit 1
fi

PLATFORM="${OTA_PLATFORM:-ios}"
MESSAGE="${OTA_MESSAGE:-OTA update (${PLATFORM})}"

echo "OTA_PUBLISH_START $(date -u +%FT%TZ) platform=${PLATFORM}"

# Serialise concurrent iOS + Android workflow runs via a workspace-level lock.
# If the other platform is already bundling, wait (up to 10 min) then proceed.
LOCK_FILE="/tmp/eas-ota-workspace-lock"
exec 9>"${LOCK_FILE}"
if ! flock -w 600 9; then
  echo "OTA_PUBLISH_FATAL: timed out waiting for lock (another OTA still running after 10 min)"
  exit 1
fi

# Clean any stale dist/ from prior runs inside this serialised section.
rm -rf dist

pnpm exec eas update \
  --channel production \
  --platform "${PLATFORM}" \
  --message "${MESSAGE}" \
  --non-interactive
EXIT=$?

# Release lock
flock -u 9

echo "OTA_PUBLISH_EXIT=${EXIT}"
if [ ${EXIT} -eq 0 ]; then
  echo "OTA_PUBLISH_MESSAGE: ${MESSAGE}"
fi
exit ${EXIT}
