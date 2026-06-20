# Verification: `reward_sessions_pending_unique` Index — Production State

**Date:** 2026-06-20  
**Environment queries:** Production (read-only replica) and Development

---

## Summary

The partial unique index `reward_sessions_pending_unique` and its prerequisite
duplicate-row cleanup script are **fully wired and applied in development**.
Production is **pending the next Publish** — the index does not yet exist there
and duplicate rows remain.

---

## Pre-Publish: Production DB (2026-06-20)

**Query:** `SELECT indexname FROM pg_indexes WHERE tablename = 'reward_sessions'`

| indexname |
|-----------|
| reward_sessions_pkey |
| reward_sessions_session_token_unique |
| reward_sessions_completed_unique |
| reward_sessions_txn_unique |
| reward_sessions_user_idx |

**Result:** `reward_sessions_pending_unique` is **ABSENT** — Publish has not yet run.

---

**Query:** `SELECT user_id, source, external_id, COUNT(*) FROM reward_sessions WHERE status = 'pending' GROUP BY user_id, source, external_id HAVING COUNT(*) > 1`

**Result:** **27 groups** of duplicate pending rows remain in production (cpx_wall
entries and individual CPX survey IDs such as cpx_66573649, cpx_69224153,
cpx_68704900, cpx_67659894, cpx_67913667, cpx_69065810, cpx_69079185,
cpx_68916890, cpx_68611243).

---

## Dev DB (2026-06-20)

**Indexes present:** pkey, session_token_unique, completed_unique, txn_unique,
user_idx, **reward_sessions_pending_unique ✅**

**Duplicate pending groups:** **0** — cleanup applied, index created without conflicts.

---

## Code wiring (verified correct)

| File | State |
|------|-------|
| `packages/db/src/schema/schema.ts` lines 125-127 | `pendingUnique: uniqueIndex("reward_sessions_pending_unique").on(userId, source, externalId).where(sql\`status = 'pending'\`)` ✅ |
| `packages/db/scripts/cleanup-reward-sessions-pending-dupes.mjs` | Idempotent CTE DELETE — removes all but newest pending row per `(user_id, source, external_id)` ✅ |
| `packages/db/package.json` push script | `cleanup-pending-dupes.mjs && drizzle-kit push` — cleanup runs **before** index creation ✅ |

---

## What happens on next Publish

1. Replit's Publish flow runs `drizzle-kit push` against the production database.
2. The push script first runs the cleanup script — deletes all duplicate pending rows, keeping the newest per group.
3. drizzle-kit then creates the `reward_sessions_pending_unique` partial unique index.
4. From that point forward, duplicate `(user_id, source, external_id)` inserts with `status = 'pending'` are rejected at the DB level.

---

## Post-Publish verification queries (run after owner publishes API)

```sql
-- 1. Confirm index exists
SELECT indexname FROM pg_indexes WHERE tablename = 'reward_sessions';
-- Expected: reward_sessions_pending_unique in the result set

-- 2. Confirm zero duplicates remain
SELECT user_id, source, external_id, COUNT(*) as cnt
FROM reward_sessions
WHERE status = 'pending'
GROUP BY user_id, source, external_id
HAVING COUNT(*) > 1;
-- Expected: 0 rows
```

See follow-up task #885 for the post-Publish confirmation step.
