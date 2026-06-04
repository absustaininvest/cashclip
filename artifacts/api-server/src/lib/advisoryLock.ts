import { pool } from "@workspace/db";
import { logger } from "./logger";

// Singleton-job coordination across an autoscaled fleet.
//
// Production runs multiple replicas, each of which registers the same interval
// jobs (auto-convert sweep, conversion-rate recompute). Without coordination
// every replica would run the same batch at the same time. The per-user
// FOR UPDATE + token status transition already makes crediting idempotent, so
// concurrent sweeps can't double-credit — this lock just avoids the wasteful
// duplicate work and keeps the rate history from getting duplicate rows.
//
// Session-level advisory locks (pg_try_advisory_lock / pg_advisory_unlock) are
// tied to a single Postgres session. The Drizzle `db` helper runs each query on
// an arbitrary connection borrowed from the pool, so acquiring the lock with one
// `db.execute` and releasing it with another can land on DIFFERENT sessions —
// the unlock becomes a no-op and the lock stays held forever on the original
// pooled connection, wedging the job. To keep the lock lifecycle session-safe we
// check out ONE dedicated client and run both the lock and the unlock on it.
// The job body (`fn`) may use the shared pool freely; it does not need to run on
// the locked session, the lock only gates whether the body runs at all. If a
// replica dies mid-job the client's session ends and Postgres drops the lock, so
// the job is never permanently wedged.
export async function withAdvisoryLock(
  key: number,
  fn: () => Promise<void>,
): Promise<boolean> {
  const client = await pool.connect();
  let locked = false;
  try {
    const acquired = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [key],
    );
    locked = Boolean(acquired.rows[0]?.locked);
    if (!locked) return false;

    await fn();
    return true;
  } finally {
    if (locked) {
      try {
        await client.query("SELECT pg_advisory_unlock($1)", [key]);
      } catch (err) {
        logger.error({ err, key }, "advisory lock: failed to release");
      }
    }
    client.release();
  }
}
