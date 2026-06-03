import { db, searchChallenges } from "@workspace/db";
import { lt } from "drizzle-orm";
import { logger } from "./logger";

/**
 * Deletes all already-expired search_challenges rows immediately.
 *
 * Called once on server boot so stale challenges never accumulate across
 * restarts or autoscale idle periods (the periodic 60-second in-process
 * cleanup won't run during those gaps).
 */
export function runSearchChallengeSweep(): Promise<void> {
  return db
    .delete(searchChallenges)
    .where(lt(searchChallenges.expiresAt, new Date()))
    .then((result) => {
      logger.info({ deleted: result.rowCount ?? 0 }, "search challenge startup sweep complete");
    })
    .catch((err) => {
      logger.warn({ err }, "search challenge startup sweep failed");
    });
}
