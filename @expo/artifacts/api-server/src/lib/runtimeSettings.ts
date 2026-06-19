import { logger } from "./logger";

/**
 * Operator-adjustable runtime settings, backed by the `app_settings` key/value
 * table but read from an in-memory cache so hot paths (e.g. the AdMob alert
 * evaluator, which is synchronous) never touch the DB.
 *
 * Lifecycle:
 *   - `loadRuntimeSettings()` is called once at server startup to warm the cache.
 *   - `setSetting()` writes through to the DB and updates the cache, so a change
 *     made from the admin Integration Hub takes effect immediately on this
 *     replica without a restart, and on other replicas the next time they load
 *     (startup) — and is durable across deploys.
 *
 * The DB module is imported lazily so this file can be imported in unit tests
 * (which mock SMTP and don't provision a database) without tripping the
 * `DATABASE_URL must be set` guard in `@workspace/db`.
 */

// Setting keys. Keep these stable — they are the persisted column values.
export const ADMOB_ALERT_EMAIL_KEY = "admob_alert_email";
export const ADMOB_ALERT_EMAIL_ENABLED_KEY = "admob_alert_email_enabled";
// Cosmetic on-screen display multiplier: how many points equal $1 in the UI.
// Does NOT affect real cash owed. Owner can update via PUT /api/admin/economy/display-rate.
export const DISPLAY_POINTS_PER_DOLLAR_KEY = "display_points_per_dollar";
// LevelPlay rewarded-fill state — persisted so the admin hub shows the last
// known fill status immediately after an API restart, before any user reports.
export const AD_FILL_AVAILABLE_KEY = "ad_fill_available";
export const AD_FILL_REPORTED_AT_KEY = "ad_fill_reported_at";

const cache = new Map<string, string>();
let loaded = false;

/** Synchronous read from the warmed cache. Returns null when unset. */
export function getSetting(key: string): string | null {
  const v = cache.get(key);
  return v == null ? null : v;
}

/** Warm the in-memory cache from the DB. Fail-soft: logs and leaves the cache
 * empty (callers fall back to env defaults) if the DB is unreachable. */
export async function loadRuntimeSettings(): Promise<void> {
  try {
    const { db, appSettings } = await import("@workspace/db");
    const rows = await db.select().from(appSettings);
    cache.clear();
    for (const row of rows) {
      cache.set(row.key, row.value);
    }
    loaded = true;
    logger.info({ count: rows.length }, "Runtime settings loaded");
  } catch (err) {
    logger.error({ err }, "Failed to load runtime settings — using defaults");
  }
}

/** Persist a setting (write-through) and update the cache. Throws on DB error
 * so the calling admin route can report failure. */
export async function setSetting(key: string, value: string): Promise<void> {
  const { db, appSettings } = await import("@workspace/db");
  const { sql } = await import("drizzle-orm");
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: sql`now()` },
    });
  cache.set(key, value);
}

/** Whether the cache has been warmed from the DB at least once. */
export function isRuntimeSettingsLoaded(): boolean {
  return loaded;
}
