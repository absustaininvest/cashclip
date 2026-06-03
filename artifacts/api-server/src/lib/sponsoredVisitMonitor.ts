import { logger } from "./logger";
import { sendSponsoredVisitSettlementAlert } from "./email";

const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const WINDOW_HOURS = 2;
const DEBOUNCE_HOURS = 4;
const KV_KEY = "sponsored_visit_alert_last_sent";

async function ensureSystemKvTable(): Promise<void> {
  const { db } = await import("@workspace/db");
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS system_kv (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function readLastAlerted(): Promise<Date | null> {
  const { db } = await import("@workspace/db");
  const { sql } = await import("drizzle-orm");
  const result = await db.execute(sql`
    SELECT value FROM system_kv WHERE key = ${KV_KEY}
  `);
  const row = result.rows[0] as { value?: string } | undefined;
  if (!row?.value) return null;
  const d = new Date(row.value);
  return isNaN(d.getTime()) ? null : d;
}

async function writeLastAlerted(ts: Date): Promise<void> {
  const { db } = await import("@workspace/db");
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`
    INSERT INTO system_kv (key, value, updated_at)
    VALUES (${KV_KEY}, ${ts.toISOString()}, now())
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value,
          updated_at = now()
  `);
}

async function runCheck(): Promise<void> {
  const { db } = await import("@workspace/db");
  const { sql } = await import("drizzle-orm");
  const now = new Date();

  const [settlementResult, campaignResult] = await Promise.all([
    db.execute(sql`
      SELECT COUNT(*)::int AS success_count
      FROM campaign_clicks
      WHERE created_at >= NOW() - INTERVAL '2 hours'
    `),
    db.execute(sql`
      SELECT COUNT(*)::int AS active_count
      FROM campaigns
      WHERE status = 'active'
    `),
  ]);

  const successCount = (settlementResult.rows[0] as { success_count: number }).success_count;
  const activeCount = (campaignResult.rows[0] as { active_count: number }).active_count;

  if (successCount > 0 || activeCount === 0) {
    return;
  }

  const lastAlerted = await readLastAlerted();
  if (lastAlerted) {
    const hoursSinceLastAlert = (now.getTime() - lastAlerted.getTime()) / (60 * 60 * 1000);
    if (hoursSinceLastAlert < DEBOUNCE_HOURS) {
      logger.debug(
        { hoursSinceLastAlert: hoursSinceLastAlert.toFixed(1), debounceHours: DEBOUNCE_HOURS },
        "Sponsored-visit alert debounced — skipping",
      );
      return;
    }
  }

  logger.warn(
    { successCount, activeCount, windowHours: WINDOW_HOURS },
    "No sponsored-visit settlements in window — sending alert",
  );
  sendSponsoredVisitSettlementAlert({
    activeCampaigns: activeCount,
    windowHours: WINDOW_HOURS,
    checkedAt: now,
  });

  await writeLastAlerted(now).catch((err) => {
    logger.error({ err }, "Failed to persist sponsored-visit alert debounce timestamp");
  });
}

let monitorHandle: ReturnType<typeof setInterval> | null = null;

export { runCheck as _runCheckForTests };

export function isSponsoredVisitAlertMonitorRunning(): boolean {
  return monitorHandle !== null;
}

export function stopSponsoredVisitAlertMonitor(): void {
  if (monitorHandle !== null) {
    clearInterval(monitorHandle);
    monitorHandle = null;
  }
}

export async function startSponsoredVisitAlertMonitor(): Promise<void> {
  if (monitorHandle !== null) {
    clearInterval(monitorHandle);
    monitorHandle = null;
  }

  try {
    await ensureSystemKvTable();
  } catch (err) {
    logger.error({ err }, "Failed to create system_kv table — sponsored-visit monitor will not start");
    return;
  }

  logger.info(
    { checkIntervalMinutes: CHECK_INTERVAL_MS / 60000, windowHours: WINDOW_HOURS, debounceHours: DEBOUNCE_HOURS },
    "Sponsored-visit settlement monitor started",
  );

  monitorHandle = setInterval(() => {
    runCheck().catch((err) => {
      logger.error({ err }, "Sponsored-visit settlement check failed");
    });
  }, CHECK_INTERVAL_MS);
}
