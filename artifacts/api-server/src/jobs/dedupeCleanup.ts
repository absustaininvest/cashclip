import { pruneExpiredDedupeSlots } from "../lib/dedupe";
import { logger } from "../lib/logger";

// Prune the shared `dedupe_slots` table on a cadence so short-lived dedupe
// reservations (e.g. the support-reply double-send guard) don't accumulate
// indefinitely. The pruner is idempotent and only deletes rows whose window
// has already expired, so it is safe to run repeatedly across the autoscaled
// fleet and across restarts.
const DEFAULT_INTERVAL_MINUTES = 5;

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

export function startDedupeCleanupJob(): NodeJS.Timeout {
  const intervalMinutes = parsePositiveNumber(
    process.env["DEDUPE_CLEANUP_INTERVAL_MINUTES"],
    DEFAULT_INTERVAL_MINUTES,
  );
  const intervalMs = intervalMinutes * 60 * 1000;

  logger.info({ intervalMinutes }, "Scheduling dedupe_slots cleanup job");

  const timer = setInterval(() => {
    // `pruneExpiredDedupeSlots` already try/catches internally, but we attach a
    // defensive .catch() so an unexpected rejection can never bubble into an
    // unhandled rejection that takes the server down.
    pruneExpiredDedupeSlots().catch((err) =>
      logger.warn({ err }, "dedupe_slots cleanup job: run failed"),
    );
  }, intervalMs);

  if (typeof timer.unref === "function") timer.unref();
  return timer;
}
