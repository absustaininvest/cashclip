import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

/**
 * DB-backed, distributed dedupe / idempotency slots.
 *
 * Deliberately separate from the login throttle (`login_attempts`): outbound
 * dedupe (e.g. "don't send the same support reply twice") and login brute-force
 * throttling are unrelated concerns. Keeping them in their own table means
 * tuning, pruning, or schema changes to one can never silently affect the other.
 *
 * Backed by the `dedupe_slots` table so a reserved slot is shared across all
 * autoscaled instances and survives restarts.
 */

/**
 * Atomically reserve the slot for `key` for `windowMs`, returning the current
 * occupancy count and whether this reservation is a duplicate (i.e. the slot
 * was already held within the window). If the stored window has expired the
 * counter resets to 1 (a fresh reservation). The very first caller in a window
 * gets `{ count: 1, duplicate: false }`; any subsequent caller within the same
 * window gets `count > 1` and `duplicate: true`.
 */
export async function reserveDedupeSlot(
  key: string,
  windowMs: number,
): Promise<{ count: number; duplicate: boolean }> {
  const windowSecs = Math.ceil(windowMs / 1000);
  const result = await db.execute(sql`
    INSERT INTO dedupe_slots (key, count, first_seen, expires_at)
    VALUES (
      ${key},
      1,
      NOW(),
      NOW() + (${windowSecs} * INTERVAL '1 second')
    )
    ON CONFLICT (key) DO UPDATE SET
      count = CASE
        WHEN dedupe_slots.expires_at < NOW() THEN 1
        ELSE dedupe_slots.count + 1
      END,
      first_seen = CASE
        WHEN dedupe_slots.expires_at < NOW() THEN NOW()
        ELSE dedupe_slots.first_seen
      END,
      expires_at = CASE
        WHEN dedupe_slots.expires_at < NOW()
          THEN NOW() + (${windowSecs} * INTERVAL '1 second')
        ELSE dedupe_slots.expires_at
      END
    RETURNING count
  `);
  const count = Number((result.rows[0] as { count: unknown }).count);
  return { count, duplicate: count > 1 };
}

/**
 * Release a previously reserved slot by decrementing its occupancy (minimum 0).
 * Used when the guarded operation did not ultimately complete (e.g. the email
 * send failed) so a genuine retry within the window is not blocked.
 */
export async function releaseDedupeSlot(key: string): Promise<void> {
  await db.execute(sql`
    UPDATE dedupe_slots
    SET count = GREATEST(0, count - 1)
    WHERE key = ${key} AND expires_at >= NOW()
  `);
}

/**
 * Purge rows whose window has expired. Safe to call on a schedule.
 */
export async function pruneExpiredDedupeSlots(): Promise<void> {
  try {
    await db.execute(sql`DELETE FROM dedupe_slots WHERE expires_at < NOW()`);
  } catch (err) {
    logger.warn({ err }, "dedupe_slots prune failed");
  }
}
