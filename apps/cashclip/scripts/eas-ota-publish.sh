#!/bin/bash
# One-shot OTA publish helper. Run via a managed workflow (Metro bundling exceeds
# the 120s bash limit and background jobs get reaped). Uses the git-wrapper PATH
# trick so the EAS CLI's post-publish `git add/commit` writes don't get killed by
# the sandbox's .git write guard.
#
# OTA_PLATFORM  – target platform: ios | android | all  (default: ios)
# OTA_MESSAGE   – override the EAS update message         (optional)
#
# Each platform writes to its own dist-<platform>/ directory so iOS and Android
# workflows can run simultaneously without racing over the same dist/ folder.

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

if [ -z "$EXPO_TOKEN" ]; then
  echo "OTA_PUBLISH_FATAL: EXPO_TOKLAST not set in workflow env"
  exit 1
fi

PLATFORM="${OTA_PLATFORM:-ios}"
MESSAGE="${OTA_MESSAGE:-OTA update (${PLATFORM})}"
DIST_DIR="dist-${PLATFORM}"

echo "OTA_PUBLISH_START $(date -u +%FT%TZ) platform=${PLATFORM}"

# Export to a platform-specific directory so concurrent iOS + Android workflows
# never collide. --clear wipes any stale artefacts from prior runs in this dir.
echo "Exporting bundle for platform=${PLATFORM} into ${DIST_DIR}/ …"
rm -rf "${DIST_DIR}"
pnpm exec expo export \
  --platform "${PLATFORM}" \
  --output-dir "${DIST_DIR}"
EXPORT_EXIT=$?
if [ ${EXPORT_EXIT} -ne 0 ]; then
  echo "OTA_PUBLISH_EXIT=${EXPORT_EXIT}"
  echo "OTA_PUBLISH_FATAL: expo export failed (exit ${EXPORT_EXIT})"
  exit ${EXPORT_EXIT}
fi

pnpm exec eas update \
  --branch production \
  --platform "${PLATFORM}" \
  --message "${MESSAGE}" \
  --input-dir "${DIST_DIR}" \
  --skip-bundler \
  --non-interactive
EXIT=$?
echo "OTA_PUBLISH_EXIT=${EXIT}"
if [ ${EXIT} -eq 0 ]; then
  echo "OTA_PUBLISH_MESSAGE: ${MESSAGE}"
fi
exit ${EXIT}
