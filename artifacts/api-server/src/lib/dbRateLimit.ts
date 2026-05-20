import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

/**
 * DB-backed distributed rate limiter for login/register endpoints.
 * Uses the login_attempts table so counters are shared across all
 * autoscaled instances and survive restarts.
 */

/**
 * Atomically record one attempt for the given key and return whether
 * it is still within the allowed limit.  If the stored window has
 * already expired the counter is reset to 1 before comparing.
 */
export async function recordLoginAttempt(
  key: string,
  max: number,
  windowMs: number,
): Promise<{ count: number; allowed: boolean }> {
  const windowSecs = Math.ceil(windowMs / 1000);
  const result = await db.execute(sql`
    INSERT INTO login_attempts (key, count, first_attempt, expires_at)
    VALUES (
      ${key},
      1,
      NOW(),
      NOW() + (${windowSecs} * INTERVAL '1 second')
    )
    ON CONFLICT (key) DO UPDATE SET
      count = CASE
        WHEN login_attempts.expires_at < NOW() THEN 1
        ELSE login_attempts.count + 1
      END,
      first_attempt = CASE
        WHEN login_attempts.expires_at < NOW() THEN NOW()
        ELSE login_attempts.first_attempt
      END,
      expires_at = CASE
        WHEN login_attempts.expires_at < NOW()
          THEN NOW() + (${windowSecs} * INTERVAL '1 second')
        ELSE login_attempts.expires_at
      END
    RETURNING count
  `);
  const count = Number((result.rows[0] as { count: unknown }).count);
  return { count, allowed: count <= max };
}

/**
 * Read the current attempt count for a key without incrementing it.
 * Returns whether the key is still within the allowed limit.
 * Used to gate access before a potentially expensive operation (e.g. bcrypt)
 * without consuming an attempt against the caller.
 */
export async function checkLoginAttempts(
  key: string,
  max: number,
): Promise<{ count: number; allowed: boolean }> {
  const result = await db.execute(sql`
    SELECT count FROM login_attempts
    WHERE key = ${key} AND expires_at >= NOW()
  `);
  const count = result.rows.length > 0 ? Number((result.rows[0] as { count: unknown }).count) : 0;
  return { count, allowed: count < max };
}

/**
 * Remove the attempt record for a key (called on successful login so
 * the next failure starts a fresh window).
 */
export async function clearLoginAttempts(key: string): Promise<void> {
  await db.execute(sql`DELETE FROM login_attempts WHERE key = ${key}`);
}

/**
 * Purge rows whose window has expired.  Safe to call on a schedule.
 */
export async function pruneExpiredLoginAttempts(): Promise<void> {
  try {
    await db.execute(sql`DELETE FROM login_attempts WHERE expires_at < NOW()`);
  } catch (err) {
    logger.warn({ err }, "login_attempts prune failed");
  }
}
