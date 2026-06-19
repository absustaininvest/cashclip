/**
 * DB-backed tests for computeRevenueUsd().
 *
 * Task #266 switched the revenue measure that drives the points→cash conversion
 * rate from a per-reward proxy (COUNT(reward_earned) × constant) to a SUM of
 * REAL per-impression ad revenue recorded on ad_events.revenue_micros (AdMob
 * valueMicros; 1,000,000 micros = $1, already inclusive of Unity via mediation).
 * A graceful fallback keeps the old proxy when no real revenue is recorded in
 * the window so the rate never collapses to the floor during rollout.
 *
 * These cases run against a REAL database in a throwaway, isolated schema
 * (search_path pinned per pooled connection) so the actual COALESCE/SUM/FILTER
 * SQL is exercised, not a re-implementation. Requires DATABASE_URL.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomBytes } from "node:crypto";

const SCHEMA = `rev_test_${randomBytes(6).toString("hex")}`;

interface SqlResult {
  rows: Array<Record<string, any>>;
}
interface SqlClient {
  query(text: string, params?: unknown[]): Promise<SqlResult>;
  release(): void;
}

let pool: typeof import("@workspace/db").pool;
let admin: SqlClient;
let computeRevenueUsd: (since: Date) => Promise<number>;
let AD_REVENUE_PER_REWARD_USD: number;

async function insertAdEvent(opts: {
  event: string;
  adUnitType?: string;
  revenueMicros?: number | null;
  createdAt?: Date;
}): Promise<void> {
  await admin.query(
    `INSERT INTO ad_events (event, ad_unit_type, revenue_micros, created_at)
     VALUES ($1, $2, $3, $4)`,
    [
      opts.event,
      opts.adUnitType ?? "rewarded",
      opts.revenueMicros ?? null,
      opts.createdAt ?? new Date(),
    ],
  );
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
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  const econ = await import("./pointsEconomy");
  computeRevenueUsd = econ.computeRevenueUsd;
  AD_REVENUE_PER_REWARD_USD = econ.AD_REVENUE_PER_REWARD_USD;
}, 30_000);

afterAll(async () => {
  try {
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
      admin.release();
    }
  } finally {
    if (pool) await pool.end();
  }
});

beforeEach(async () => {
  await admin.query(`TRUNCATE ad_events`);
});

const since = () => new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

describe("computeRevenueUsd", () => {
  it("sums real revenue_micros across all events in the window (micros → USD)", async () => {
    // $1.50 + $0.50 across two impressions of any unit type.
    await insertAdEvent({ event: "impression", revenueMicros: 1_500_000 });
    await insertAdEvent({ event: "completion", revenueMicros: 500_000 });
    const usd = await computeRevenueUsd(since());
    expect(usd).toBeCloseTo(2.0, 8);
  });

  it("ignores null revenue_micros and sums only the real money present", async () => {
    await insertAdEvent({ event: "reward_earned", revenueMicros: 250_000 });
    await insertAdEvent({ event: "reward_earned", revenueMicros: null });
    await insertAdEvent({ event: "impression", revenueMicros: null });
    const usd = await computeRevenueUsd(since());
    expect(usd).toBeCloseTo(0.25, 8);
  });

  it("falls back to the per-reward proxy when no real revenue is recorded", async () => {
    // Three verified rewarded ads, none carrying revenue → proxy estimate.
    await insertAdEvent({ event: "reward_earned", revenueMicros: null });
    await insertAdEvent({ event: "reward_earned", revenueMicros: null });
    await insertAdEvent({ event: "reward_earned", revenueMicros: null });
    // A non-reward event should NOT inflate the proxy count.
    await insertAdEvent({ event: "impression", revenueMicros: null });
    const usd = await computeRevenueUsd(since());
    expect(usd).toBeCloseTo(3 * AD_REVENUE_PER_REWARD_USD, 8);
  });

  it("returns 0 when the window is empty (no events, no fallback to charge)", async () => {
    const usd = await computeRevenueUsd(since());
    expect(usd).toBe(0);
  });

  it("honors a real-but-zero revenue window instead of reverting to the proxy", async () => {
    // Real revenue HAS started flowing (rows carry revenue_micros), but these
    // impressions happened to be worth $0. We must NOT switch back to the proxy
    // and overestimate — once real rows exist, the SUM is authoritative.
    await insertAdEvent({ event: "reward_earned", revenueMicros: 0 });
    await insertAdEvent({ event: "reward_earned", revenueMicros: 0 });
    const usd = await computeRevenueUsd(since());
    expect(usd).toBe(0);
  });

  it("excludes events older than the window from the real-revenue sum", async () => {
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await insertAdEvent({ event: "impression", revenueMicros: 9_000_000, createdAt: old });
    await insertAdEvent({ event: "impression", revenueMicros: 1_000_000 });
    const usd = await computeRevenueUsd(since());
    expect(usd).toBeCloseTo(1.0, 8);
  });
});
