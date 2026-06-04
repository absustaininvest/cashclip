import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

// DB-backed expiry sweep for the shared `spin_challenges` table.
// Deletes rows whose expires_at is in the past so the shared store doesn't
// accumulate stale challenge tokens across the autoscaled fleet. Mirrors the
// login_attempts prune treatment: logs how many were removed (INFO) and never
// throws (errors -> WARN, returns 0).
export async function runSpinChallengeSweep(): Promise<number> {
  try {
    const result = await db.execute(sql`
      DELETE FROM spin_challenges WHERE expires_at < NOW() RETURNING token
    `);
    const removed = result.rows.length;
    if (removed > 0) {
      logger.info({ removed }, "spin challenge startup sweep complete");
    }
    return removed;
  } catch (err) {
    logger.warn({ err }, "spin challenge startup sweep failed");
    return 0;
  }
}
