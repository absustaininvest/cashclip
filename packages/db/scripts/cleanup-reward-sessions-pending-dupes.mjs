/**
 * One-time (idempotent) cleanup: delete all but the newest pending
 * reward_sessions row per (user_id, source, external_id) group.
 *
 * Run this BEFORE drizzle-kit push so the reward_sessions_pending_unique
 * partial index can be created without hitting duplicate-key violations.
 *
 * Safe to run repeatedly — when there are no duplicates it is a no-op.
 */
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("cleanup-reward-sessions-pending-dupes: DATABASE_URL not set — skipping");
  process.exit(0);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  const res = await client.query(`
    WITH survivors AS (
      SELECT DISTINCT ON (user_id, source, external_id) id
      FROM reward_sessions
      WHERE status = 'pending'
      ORDER BY user_id, source, external_id, created_at DESC
    )
    DELETE FROM reward_sessions
    WHERE status = 'pending'
      AND id NOT IN (SELECT id FROM survivors)
    RETURNING id
  `);
  const deleted = res.rowCount ?? 0;
  if (deleted > 0) {
    console.log(`cleanup-reward-sessions-pending-dupes: removed ${deleted} duplicate pending row(s)`);
  } else {
    console.log("cleanup-reward-sessions-pending-dupes: no duplicates found — nothing to do");
  }
} finally {
  await client.end();
}
