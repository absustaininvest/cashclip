import { logger } from "../lib/logger";
import { withAdvisoryLock } from "../lib/advisoryLock";
import { getAdMobConfigState, syncAdMobSnapshots } from "../lib/admobReporting";

// Pull AdMob earnings into the persisted snapshot store on a cadence so the
// reporting data stays fresh even when no admin opens the hub. The admin
// revenue route (GET /api/admin/admob/revenue) also kicks a background sync,
// but only on a page load — so if nobody visits, a freshly-restarted server
// would show "never synced" and trip the stale-sync operator alert email.
//
// The first run is scheduled to land BEFORE the admob-alerts job's first
// evaluation (which runs ~90s after boot), so a just-restarted replica records
// a sync before staleness is ever checked — that's what stops the false
// "AdMob reporting has never synced" alert after a routine restart.
//
// A Postgres advisory lock keeps a single replica doing the live AdMob API
// call at a time on the autoscaled fleet, so we don't hammer the reporting API
// (or its OAuth token) from every replica.
const SYNC_INTERVAL_MS = 60 * 60 * 1000; // every 60 min
const INITIAL_DELAY_MS = 20 * 1000; // 20s after boot (before the 90s alert eval)
const ADVISORY_LOCK_KEY = 260004; // distinct singleton-job key (admob sync)
const SYNC_DAYS = 30;

async function sync(): Promise<void> {
  try {
    // Nothing to do until the AdMob reporting credentials are configured —
    // skip quietly rather than firing failing OAuth/API calls on a timer.
    if (!getAdMobConfigState().configured) {
      logger.debug("admob-sync job: not configured — skipping");
      return;
    }

    const ran = await withAdvisoryLock(ADVISORY_LOCK_KEY, async () => {
      const result = await syncAdMobSnapshots(SYNC_DAYS);
      if (result.ok) {
        logger.info({ written: result.written }, "admob-sync job: snapshots refreshed");
      } else {
        logger.warn({ error: result.error }, "admob-sync job: sync returned not-ok");
      }
    });
    if (!ran) {
      logger.debug("admob-sync job: another replica holds the lock — skipping");
    }
  } catch (err) {
    logger.error({ err }, "admob-sync job: sync failed");
  }
}

export function startAdmobSyncJob(): void {
  setTimeout(() => {
    sync().catch((err) =>
      logger.error({ err }, "admob-sync job: initial run failed"),
    );
    setInterval(() => {
      sync().catch((err) =>
        logger.error({ err }, "admob-sync job: interval run failed"),
      );
    }, SYNC_INTERVAL_MS);
  }, INITIAL_DELAY_MS);

  logger.info("admob-sync job: scheduled");
}
