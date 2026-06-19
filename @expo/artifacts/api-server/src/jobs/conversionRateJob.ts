import { logger } from "../lib/logger";
import { withAdvisoryLock } from "../lib/advisoryLock";
import {
  DEFAULT_REGION,
  computeAndStoreRate,
  seedRateIfMissing,
} from "../lib/pointsEconomy";

// Recompute the points→cash rate on a cadence so it tracks ad ARPU. Append-only,
// so this is safe to run repeatedly and across restarts. A Postgres advisory
// lock keeps a single replica doing the work at a time on the autoscaled fleet.
const RECOMPUTE_INTERVAL_MS = 60 * 60 * 1000; // hourly
const INITIAL_DELAY_MS = 60 * 1000; // 1 min after boot
const ADVISORY_LOCK_KEY = 260002; // distinct singleton-job key (conversion rate)

async function recompute(): Promise<void> {
  try {
    const ran = await withAdvisoryLock(ADVISORY_LOCK_KEY, async () => {
      await seedRateIfMissing(DEFAULT_REGION);
      await computeAndStoreRate(DEFAULT_REGION);
    });
    if (!ran) {
      logger.debug("conversion-rate job: another replica holds the lock — skipping");
    }
  } catch (err) {
    logger.error({ err }, "conversion-rate job: recompute failed");
  }
}

export function startConversionRateJob(): void {
  // Seed immediately so the first token issue / rate read has a value even
  // before the first scheduled recompute.
  seedRateIfMissing(DEFAULT_REGION).catch((err) =>
    logger.error({ err }, "conversion-rate job: initial seed failed"),
  );

  setTimeout(() => {
    recompute().catch((err) =>
      logger.error({ err }, "conversion-rate job: initial run failed"),
    );
    setInterval(() => {
      recompute().catch((err) =>
        logger.error({ err }, "conversion-rate job: interval run failed"),
      );
    }, RECOMPUTE_INTERVAL_MS);
  }, INITIAL_DELAY_MS);

  logger.info("conversion-rate job: scheduled");
}
