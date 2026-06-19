import { logger } from "../lib/logger";
import { withAdvisoryLock } from "../lib/advisoryLock";
import { storage } from "../storage";
import { getAdMobConfigState } from "../lib/admobReporting";
import { evaluateAdmobAlerts, evaluateSsvAlerts } from "../lib/admobAlerts";

// Evaluate the AdMob staleness / revenue-divergence operator alerts on a cadence
// so they fire even when no admin is watching the hub. The admin revenue route
// (GET /api/admin/admob/revenue) also evaluates them, but only on a page load —
// if nobody opens the hub, a stale sync or a divergence could sit unnoticed.
//
// Also evaluates the SSV credit-health alert (ssv_credit_stale) so an overnight
// drop in rewarded-ad SSV credits is caught before any operator opens the hub.
// The HTTP route GET /api/admin/admob/ssv-health still evaluates on admin page
// loads; this job ensures it also fires on a schedule.
//
// Read-only: it reads the already-persisted snapshot summary + reconciliation
// and feeds them to evaluateAdmobAlerts (which is itself in-memory de-duped and
// cooldown'd, so this never floods). A Postgres advisory lock keeps a single
// replica doing the work at a time on the autoscaled fleet — though the alert
// state machine lives per-replica in memory, so the lock just avoids wasteful
// duplicate evaluation rather than being required for correctness.
const EVALUATE_INTERVAL_MS = 30 * 60 * 1000; // every 30 min
const INITIAL_DELAY_MS = 90 * 1000; // 90s after boot
const ADVISORY_LOCK_KEY = 260003; // distinct singleton-job key (admob alerts)
const SUMMARY_DAYS = 30;

async function evaluate(): Promise<void> {
  try {
    const ran = await withAdvisoryLock(ADVISORY_LOCK_KEY, async () => {
      const cfg = getAdMobConfigState();
      const summary = await storage.getAdmobSnapshotSummary(SUMMARY_DAYS);
      const reconciliation = await storage.getAdmobReconciliation(SUMMARY_DAYS);
      const lastSyncedAt = await storage.getAdmobLastSyncedAt();
      const hasData = summary.rowCount > 0;

      evaluateAdmobAlerts({
        configured: cfg.configured,
        lastSyncedAt,
        reconciliation: hasData ? reconciliation : null,
      });

      // SSV credit-health: fire when videos were watched today but SSV hasn't
      // credited in the past 6h. evaluateSsvAlerts is gated on AD_ADMOB_NATIVE
      // so it's a no-op on staging / dev environments.
      const ssvStats = await storage.getSsvHealthStats();
      evaluateSsvAlerts({
        staleAlert: ssvStats.staleAlert,
        totalToday: ssvStats.totalToday,
        lastSsvAt: ssvStats.lastSsvAt,
      });
    });
    if (!ran) {
      logger.debug("admob-alerts job: another replica holds the lock — skipping");
    }
  } catch (err) {
    logger.error({ err }, "admob-alerts job: evaluation failed");
  }
}

export function startAdmobAlertsJob(): void {
  setTimeout(() => {
    evaluate().catch((err) =>
      logger.error({ err }, "admob-alerts job: initial run failed"),
    );
    setInterval(() => {
      evaluate().catch((err) =>
        logger.error({ err }, "admob-alerts job: interval run failed"),
      );
    }, EVALUATE_INTERVAL_MS);
  }, INITIAL_DELAY_MS);

  logger.info("admob-alerts job: scheduled");
}
