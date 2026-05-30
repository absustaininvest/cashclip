---
name: Post-merge schema drift (dev DB)
description: Why the dev DB falls out of sync with merged code, the symptom, and where the auto-fix lives.
---

When a background task merges a Drizzle schema change (e.g. a new column), the
main dev database is NOT updated by the merge itself. The task applied the
change only to its own isolated DB copy.

**Symptom:** backend startup logs `column "<name>" does not exist` (often during
admin seed in api-server `index.ts` → `storage.getUserByUsername`), and any user
query selecting the new column fails — login/admin break in dev only.

**Fix:** run `pnpm --filter @workspace/db run push` to apply the schema to the
dev DB, then restart the `Start Backend` workflow.

**Prevention:** `scripts/post-merge.sh` runs that same push automatically after
every merge (guarded on `DATABASE_URL` being set). Production schema is applied
separately by the Publish flow, not by this script.

**Why:** drizzle-kit push is intentionally left without `--force` — on a
destructive change it fails fast (closed stdin → EOF) and alerts the agent
rather than silently dropping data. Keep it that way; never add `--force` to the
automated post-merge path.
