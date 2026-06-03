import { storage } from "../storage";
import { logger } from "../lib/logger";

const DEFAULT_INTERVAL_HOURS = 1;

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

export async function runSpinChallengeCleanup(): Promise<number> {
  const now = new Date();
  try {
    const deleted = await storage.pruneSpinChallenges(now);
    if (deleted > 0) {
      logger.info({ deleted }, "Pruned expired spin_challenges rows");
    } else {
      logger.debug("No expired spin_challenges rows to prune");
    }
    return deleted;
  } catch (err) {
    logger.error({ err }, "Failed to prune expired spin_challenges rows");
    return 0;
  }
}

export function startSpinChallengeCleanupJob(): NodeJS.Timeout | null {
  const intervalHours = parsePositiveNumber(
    process.env["SPIN_CHALLENGE_CLEANUP_INTERVAL_HOURS"],
    DEFAULT_INTERVAL_HOURS,
  );
  const intervalMs = intervalHours * 60 * 60 * 1000;

  logger.info({ intervalHours }, "Scheduling spin_challenges cleanup job");

  void runSpinChallengeCleanup();

  const timer = setInterval(() => {
    void runSpinChallengeCleanup();
  }, intervalMs);

  if (typeof timer.unref === "function") timer.unref();
  return timer;
}
