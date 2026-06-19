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
