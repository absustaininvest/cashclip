#!/bin/bash
set -e

pnpm install

# Apply any merged Drizzle schema changes to the dev database so the running
# app matches the merged code (e.g. newly added columns). Dev only; production
# schema changes are applied by the Publish flow.
# Skip gracefully when DATABASE_URL is not configured so the merge still succeeds.
if [ -n "$DATABASE_URL" ]; then
  pnpm --filter @workspace/db run push
else
  echo "post-merge: DATABASE_URL not set — skipping dev schema push"
fi

# Repair symlinks in @expo/artifacts/absustain/cashclip/node_modules
#
# pnpm generates node_modules symlinks with relative paths computed from the
# package directory depth. Because @expo/artifacts/absustain/cashclip is 4
# levels deep from the workspace root (vs 2 for artifacts/cashclip-next),
# pnpm's generated symlinks consistently resolve 2 levels short — they land
# at @expo/artifacts/node_modules/.pnpm/... which doesn't exist. This causes
# `expo config` to exit 1 and blocks OTA publishing from this directory.
# The script below re-links every broken symlink to the correct absolute target
# so the directory can be used as the OTA publish source directly.
node scripts/fix-cashclip-symlinks.cjs
