/**
 * Real-database integration tests for the AdMob reporting persistence layer
 * (Task #391). These exercise the REAL storage methods + REAL SQL against a
 * REAL Postgres instance, isolated in a throwaway schema (search_path pinned
 * per pooled connection) so they never touch the live `public` tables.
 *
 * Covered:
 *   - upsertAdmobSnapshots is idempotent per (date, ad_format): re-running the
 *     same day/format UPDATES the row (and refreshes synced_at) instead of
 *     duplicating or inflating it.
 *   - getAdmobSnapshotSummary aggregates today/7d/30d correctly, excludes the
 *     "TOTAL" pseudo-format from the per-format breakdown, computes eCPM from
 *     aggregates, and reports lastSyncedAt.
 *   - getAdmobReconciliation compares official (snapshots) vs app-reported
 *     (summed ad_events.revenue_micros) and guards divide-by-zero (pct null
 *     when official earnings are 0).
 *
 * Only the logger is mocked. Requires DATABASE_URL (always set here).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { randomBytes } from "node:crypto";

vi.mock("./lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const SCHEMA = `admob_test_${randomBytes(6).toString("hex")}`;

interface SqlResult {
  rows: Array<Record<string, any>>;
}
interface SqlClient {
  query(text: string, params?: unknown[]): Promise<SqlResult>;
  release(): void;
}

let pool: typeof import("@workspace/db").pool;
let admin: SqlClient;
let storage: typeof import("./storage").storage;

/** UTC YYYY-MM-DD `daysAgo` days before today. */
function ymdDaysAgo(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

beforeAll(async () => {
  const dbMod = await import("@workspace/db");
  pool = dbMod.pool;
  pool.on("connect", (c) => {
    c.query(`SET search_path TO ${SCHEMA}, pg_catalog`);
  });

  admin = (await pool.connect()) as unknown as SqlClient;
  await admin.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  await admin.query(`SET search_path TO ${SCHEMA}, pg_catalog`);

  await admin.query(`
    CREATE TABLE admob_report_snapshots (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      date text NOT NULL,
      ad_format text NOT NULL,
      earnings numeric(18,6) NOT NULL DEFAULT '0',
      impressions numeric(18,0) NOT NULL DEFAULT '0',
      clicks numeric(18,0) NOT NULL DEFAULT '0',
      ecpm numeric(14,6) NOT NULL DEFAULT '0',
      currency text NOT NULL DEFAULT 'USD',
      synced_at timestamp NOT NULL DEFAULT now(),
      CONSTRAINT admob_snapshots_day_format_unique UNIQUE (date, ad_format)
    );
    CREATE TABLE ad_events (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id varchar,
      event text NOT NULL,
      ad_unit_type text NOT NULL,
      reward_amount numeric(8,2),
      reward_type text,
      revenue_micros numeric(18,0),
      error_code text,
      error_message text,
      duration_ms numeric(10,0),
      platform text,
      created_at timestamp NOT NULL DEFAULT now()
    );
  `);

  storage = (await import("./storage")).storage;
});

afterAll(async () => {
  if (admin) {
    await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    admin.release();
  }
});

beforeEach(async () => {
  await admin.query(`TRUNCATE admob_report_snapshots, ad_events`);
});

describe("upsertAdmobSnapshots", () => {
  it("inserts new rows and is idempotent per (date, format)", async () => {
    const date = ymdDaysAgo(1);
    await storage.upsertAdmobSnapshots([
      { date, adFormat: "REWARDED", earnings: 10, impressions: 1000, clicks: 5, ecpm: 10 },
      { date, adFormat: "BANNER", earnings: 1, impressions: 2000, clicks: 1, ecpm: 0.5 },
    ]);
    let count = await admin.query(`SELECT count(*)::int AS n FROM admob_report_snapshots`);
    expect(count.rows[0].n).toBe(2);

    // Re-run with an updated value for the SAME (date, REWARDED) — must update,
    // not duplicate.
    await storage.upsertAdmobSnapshots([
      { date, adFormat: "REWARDED", earnings: 12.5, impressions: 1100, clicks: 6, ecpm: 11.36 },
    ]);
    count = await admin.query(`SELECT count(*)::int AS n FROM admob_report_snapshots`);
    expect(count.rows[0].n).toBe(2);

    const row = await admin.query(
      `SELECT earnings, impressions FROM admob_report_snapshots WHERE date = $1 AND ad_format = 'REWARDED'`,
      [date],
    );
    expect(Number(row.rows[0].earnings)).toBeCloseTo(12.5, 2);
    expect(Number(row.rows[0].impressions)).toBe(1100);
  });

  it("writes nothing for an empty batch", async () => {
    const written = await storage.upsertAdmobSnapshots([]);
    expect(written).toBe(0);
  });
});

describe("getAdmobSnapshotSummary", () => {
  it("aggregates totals, excludes TOTAL, and builds the per-format breakdown", async () => {
    const d1 = ymdDaysAgo(1);
    const d2 = ymdDaysAgo(2);
    await storage.upsertAdmobSnapshots([
      { date: d1, adFormat: "REWARDED", earnings: 10, impressions: 1000, clicks: 5, ecpm: 10 },
      { date: d1, adFormat: "BANNER", earnings: 2, impressions: 4000, clicks: 2, ecpm: 0.5 },
      { date: d2, adFormat: "REWARDED", earnings: 8, impressions: 800, clicks: 4, ecpm: 10 },
      // A "TOTAL" roll-up row that must NOT be counted (would double the totals).
      { date: d1, adFormat: "TOTAL", earnings: 12, impressions: 5000, clicks: 7, ecpm: 2.4 },
    ]);

    const s = await storage.getAdmobSnapshotSummary(30);
    expect(s.totals.earnings).toBeCloseTo(20, 2); // 10 + 2 + 8, TOTAL excluded
    expect(s.totals.impressions).toBe(5800);
    expect(s.totals.clicks).toBe(11);
    // eCPM recomputed from aggregates: 20 / 5800 * 1000
    expect(s.totals.ecpm).toBeCloseTo((20 / 5800) * 1000, 1);

    const rewarded = s.byFormat.find((f) => f.adFormat === "REWARDED");
    expect(rewarded?.earnings).toBeCloseTo(18, 2);
    expect(s.byFormat.some((f) => f.adFormat === "TOTAL")).toBe(false);
    // Sorted by earnings desc → REWARDED first.
    expect(s.byFormat[0].adFormat).toBe("REWARDED");
    expect(s.lastSyncedAt).toBeTruthy();
  });

  it("respects the date window (7d excludes a 10-day-old row)", async () => {
    await storage.upsertAdmobSnapshots([
      { date: ymdDaysAgo(1), adFormat: "REWARDED", earnings: 5, impressions: 500, clicks: 2, ecpm: 10 },
      { date: ymdDaysAgo(10), adFormat: "REWARDED", earnings: 99, impressions: 9999, clicks: 9, ecpm: 9.9 },
    ]);
    const s7 = await storage.getAdmobSnapshotSummary(7);
    expect(s7.totals.earnings).toBeCloseTo(5, 2);
    const s30 = await storage.getAdmobSnapshotSummary(30);
    expect(s30.totals.earnings).toBeCloseTo(104, 2);
  });

  it("returns honest zeros (not fabricated) when there is no data", async () => {
    const s = await storage.getAdmobSnapshotSummary(30);
    expect(s.rowCount).toBe(0);
    expect(s.totals.earnings).toBe(0);
    expect(s.totals.ecpm).toBe(0);
    expect(s.byFormat).toHaveLength(0);
    expect(s.lastSyncedAt).toBeNull();
  });
});

describe("getAdmobReconciliation", () => {
  it("compares official vs app-reported and computes the difference", async () => {
    const date = ymdDaysAgo(1);
    await storage.upsertAdmobSnapshots([
      { date, adFormat: "REWARDED", earnings: 20, impressions: 2000, clicks: 10, ecpm: 10 },
    ]);
    // App-reported: two impressions worth $8 + $4 = $12 (micros).
    await admin.query(
      `INSERT INTO ad_events (event, ad_unit_type, revenue_micros, created_at)
       VALUES ('impression','rewarded',$1, now()), ('impression','rewarded',$2, now())`,
      [String(8_000_000), String(4_000_000)],
    );

    const r = await storage.getAdmobReconciliation(30);
    expect(r.officialEarnings).toBeCloseTo(20, 2);
    expect(r.appReportedEarnings).toBeCloseTo(12, 2);
    expect(r.differenceAbs).toBeCloseTo(8, 2);
    expect(r.differencePct).toBeCloseTo(40, 1); // 8 / 20 * 100
  });

  it("guards divide-by-zero: pct is null when official earnings are 0", async () => {
    await admin.query(
      `INSERT INTO ad_events (event, ad_unit_type, revenue_micros, created_at)
       VALUES ('impression','rewarded',$1, now())`,
      [String(3_000_000)],
    );
    const r = await storage.getAdmobReconciliation(30);
    expect(r.officialEarnings).toBe(0);
    expect(r.appReportedEarnings).toBeCloseTo(3, 2);
    expect(r.differencePct).toBeNull();
  });
});

describe("syncAdMobSnapshots last-known fallback", () => {
  const ADMOB_ENV = [
    "ADMOB_OAUTH_CLIENT_ID",
    "ADMOB_OAUTH_CLIENT_SECRET",
    "ADMOB_OAUTH_REFRESH_TOKEN",
    "ADMOB_PUBLISHER_ID",
  ] as const;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ADMOB_ENV) savedEnv[k] = process.env[k];
  });

  afterEach(() => {
    for (const k of ADMOB_ENV) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    vi.unstubAllGlobals();
  });

  it("returns configured:false and never touches the store when unconfigured", async () => {
    for (const k of ADMOB_ENV) delete process.env[k];
    const date = ymdDaysAgo(1);
    await storage.upsertAdmobSnapshots([
      { date, adFormat: "REWARDED", earnings: 7, impressions: 700, clicks: 3, ecpm: 10 },
    ]);

    const { syncAdMobSnapshots } = await import("./lib/admobReporting");
    const result = await syncAdMobSnapshots(30);
    expect(result.ok).toBe(false);
    expect(result.configured).toBe(false);

    // Prior persisted data is untouched.
    const summary = await storage.getAdmobSnapshotSummary(30);
    expect(summary.totals.earnings).toBeCloseTo(7, 2);
  });

  it("leaves last-known snapshots intact when the AdMob API is unreachable", async () => {
    for (const k of ADMOB_ENV) process.env[k] = "test-value";
    process.env.ADMOB_PUBLISHER_ID = "pub-0000000000000000";

    // Pre-seed a known-good snapshot (the "last known" data).
    const date = ymdDaysAgo(1);
    await storage.upsertAdmobSnapshots([
      { date, adFormat: "REWARDED", earnings: 15, impressions: 1500, clicks: 7, ecpm: 10 },
    ]);

    // Simulate the AdMob API being unreachable: the OAuth token refresh throws.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const { syncAdMobSnapshots } = await import("./lib/admobReporting");
    const result = await syncAdMobSnapshots(30);
    expect(result.ok).toBe(false);
    expect(result.configured).toBe(true);
    expect(result.error).toBeTruthy();

    // The pre-existing snapshot is still there and unchanged — we served the
    // last-known value rather than wiping it or fabricating zeros.
    const summary = await storage.getAdmobSnapshotSummary(30);
    expect(summary.totals.earnings).toBeCloseTo(15, 2);
    expect(summary.rowCount).toBe(1);
  });
});
