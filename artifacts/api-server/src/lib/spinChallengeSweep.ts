import { logger } from "./logger";

// A single server-issued spin-challenge token kept in the in-memory store.
export interface SpinChallenge {
  userId: string;
  issuedAt: number;
}

// Sweeps expired spin-challenge tokens out of the in-memory store.
// Mirrors the search-challenge sweep treatment: removes expired entries,
// logs how many were removed, and never throws (errors -> WARN, no crash).
export function runSpinChallengeSweep(
  store: Map<string, SpinChallenge>,
  ttlMs: number,
  now: number = Date.now(),
): number {
  try {
    const cutoff = now - ttlMs;
    let removed = 0;
    for (const [token, challenge] of store) {
      if (challenge.issuedAt < cutoff) {
        store.delete(token);
        removed++;
      }
    }
    if (removed > 0) {
      logger.info({ removed }, "spin challenge startup sweep complete");
    }
    return removed;
  } catch (err) {
    logger.warn({ err }, "spin challenge startup sweep failed");
    return 0;
  }
}
