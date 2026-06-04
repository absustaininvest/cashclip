/**
 * Unit tests for the DB-backed dedupe / idempotency slots
 * (`reserveDedupeSlot`, `releaseDedupeSlot`, `pruneExpiredDedupeSlots`).
 *
 * These helpers back the support-reply duplicate guard: a reserved slot is
 * shared across all autoscaled instances via the `dedupe_slots` table, and a
 * scheduled job prunes expired rows. Their correctness lives entirely in SQL
 * (an INSERT … ON CONFLICT with expiry-aware CASE branches, a GREATEST(0, …)
 * decrement, and an `expires_at < NOW()` delete). Faking the DB would mean
 * re-implementing that SQL and could be subtly wrong, so this suite runs the
 * REAL helpers against a REAL Postgres in a throwaway, isolated schema
 * (search_path pinned per pooled connection) — the same pattern as
 * routes/earnings.moneyFlow.test.ts.
 *
 * Coverage:
 *   - reserve: first call -> { count: 1, duplicate: false }; a second call
 *     within the window -> { count: 2, duplicate: true }.
 *   - release: decrements the count, and floors at 0 (never negative).
 *   - expired-window reset: a held slot whose window has lapsed resets to a
 *     fresh { count: 1, duplicate: false } on the next reserve.
 *   - prune: deletes only rows whose window has expired, leaving live rows.
 *
 * Requires DATABASE_URL (always set in this environment). The schema is created
 * in beforeAll and dropped in afterAll, so it never touches real app tables.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomBytes } from "node:crypto";

vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const SCHEMA = `dedupe_test_${randomBytes(6).toString("hex")}`;

// Minimal shape of the raw pg client we use for DDL/seeding. The derived typing
// of pool.connect() collapses to its callback overload, and `pg` types aren't
// directly resolvable from this package, so we model just what we touch.
interface SqlResult {
  rows: Array<Record<string, any>>;
}
interface SqlClient {
  query(text: string, params?: unknown[]): Promise<SqlResult>;
  release(): void;
}

let pool: typeof import("@workspace/db").pool;
let admin: SqlClient;
let reserveDedupeSlot: typeof import("./dedupe").reserveDedupeSlot;
let releaseDedupeSlot: typeof import("./dedupe").releaseDedupeSlot;
let pruneExpiredDedupeSlots: typeof import("./dedupe").pruneExpiredDedupeSlots;

const MINUTE = 60 * 1000;

function uniqueKey(prefix = "k"): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

async function rowFor(key: string): Promise<{ count: number; expires_at: Date } | null> {
  const r = await admin.query(
    `SELECT count, expires_at FROM dedupe_slots WHERE key = $1`,
    [key],
  );
  if (r.rows.length === 0) return null;
  return { count: Number(r.rows[0].count), expires_at: r.rows[0].expires_at as Date };
}

beforeAll(async () => {
  const dbMod = await import("@workspace/db");
  pool = dbMod.pool;
  // Pin every pooled connection to our throwaway schema so the real helpers'
  // unqualified `dedupe_slots` queries resolve there, never to the live table.
  pool.on("connect", (c) => {
    c.query(`SET search_path TO ${SCHEMA}, pg_catalog`);
  });

  admin = (await pool.connect()) as unknown as SqlClient;
  await admin.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  await admin.query(`SET search_path TO ${SCHEMA}, pg_catalog`);

  // Mirror lib/db/src/schema/dedupeSlots.ts.
  await admin.query(`
    CREATE TABLE dedupe_slots (
      key text PRIMARY KEY,
      count integer NOT NULL DEFAULT 1,
      first_seen timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  const mod = await import("./dedupe");
  reserveDedupeSlot = mod.reserveDedupeSlot;
  releaseDedupeSlot = mod.releaseDedupeSlot;
  pruneExpiredDedupeSlots = mod.pruneExpiredDedupeSlots;
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
  await admin.query(`TRUNCATE dedupe_slots`);
});

describe("reserveDedupeSlot", () => {
  it("returns count 1 / not duplicate on the first reservation in a window", async () => {
    const key = uniqueKey();
    const res = await reserveDedupeSlot(key, MINUTE);

    expect(res).toEqual({ count: 1, duplicate: false });
    const row = await rowFor(key);
    expect(row?.count).toBe(1);
    // Window should be roughly a minute out, never already expired.
    expect(row!.expires_at.getTime()).toBeGreaterThan(Date.now());
  });

  it("increments and flags a duplicate on a second reservation within the window", async () => {
    const key = uniqueKey();
    const first = await reserveDedupeSlot(key, MINUTE);
    const second = await reserveDedupeSlot(key, MINUTE);

    expect(first).toEqual({ count: 1, duplicate: false });
    expect(second).toEqual({ count: 2, duplicate: true });
    expect((await rowFor(key))?.count).toBe(2);
  });

  it("keeps incrementing for further reservations within the window", async () => {
    const key = uniqueKey();
    await reserveDedupeSlot(key, MINUTE);
    await reserveDedupeSlot(key, MINUTE);
    const third = await reserveDedupeSlot(key, MINUTE);

    expect(third).toEqual({ count: 3, duplicate: true });
  });

  it("resets to a fresh reservation once the stored window has expired", async () => {
    const key = uniqueKey();
    // Seed an already-expired slot with a high count and an old first_seen.
    await admin.query(
      `INSERT INTO dedupe_slots (key, count, first_seen, expires_at)
       VALUES ($1, 5, NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '1 second')`,
      [key],
    );

    const res = await reserveDedupeSlot(key, MINUTE);

    // Expired window must reset to a brand-new reservation, not increment to 6.
    expect(res).toEqual({ count: 1, duplicate: false });
    const row = await rowFor(key);
    expect(row?.count).toBe(1);
    expect(row!.expires_at.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("releaseDedupeSlot", () => {
  it("decrements the occupancy count for a live slot", async () => {
    const key = uniqueKey();
    await reserveDedupeSlot(key, MINUTE);
    await reserveDedupeSlot(key, MINUTE); // count = 2

    await releaseDedupeSlot(key);

    expect((await rowFor(key))?.count).toBe(1);
  });

  it("floors the count at 0 and never goes negative", async () => {
    const key = uniqueKey();
    await reserveDedupeSlot(key, MINUTE); // count = 1

    await releaseDedupeSlot(key); // -> 0
    expect((await rowFor(key))?.count).toBe(0);

    await releaseDedupeSlot(key); // stays at 0
    expect((await rowFor(key))?.count).toBe(0);
  });

  it("is a no-op for an expired slot (only live windows are released)", async () => {
    const key = uniqueKey();
    await admin.query(
      `INSERT INTO dedupe_slots (key, count, first_seen, expires_at)
       VALUES ($1, 3, NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '1 second')`,
      [key],
    );

    await releaseDedupeSlot(key);

    // Untouched: the WHERE clause excludes expired rows, so prune (not release)
    // is responsible for cleaning these up.
    expect((await rowFor(key))?.count).toBe(3);
  });

  it("is a no-op when the key does not exist", async () => {
    await expect(releaseDedupeSlot(uniqueKey("missing"))).resolves.toBeUndefined();
  });
});

describe("pruneExpiredDedupeSlots", () => {
  it("deletes only rows whose window has expired, leaving live rows intact", async () => {
    const live = uniqueKey("live");
    const expired = uniqueKey("expired");

    await admin.query(
      `INSERT INTO dedupe_slots (key, count, first_seen, expires_at)
       VALUES ($1, 1, NOW(), NOW() + INTERVAL '5 minutes')`,
      [live],
    );
    await admin.query(
      `INSERT INTO dedupe_slots (key, count, first_seen, expires_at)
       VALUES ($1, 1, NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '1 second')`,
      [expired],
    );

    await pruneExpiredDedupeSlots();

    expect(await rowFor(expired)).toBeNull();
    expect(await rowFor(live)).not.toBeNull();
  });

  it("does nothing when there are no expired rows", async () => {
    const live = uniqueKey("live");
    await reserveDedupeSlot(live, MINUTE);

    await pruneExpiredDedupeSlots();

    expect(await rowFor(live)).not.toBeNull();
    const all = await admin.query(`SELECT count(*)::int AS n FROM dedupe_slots`);
    expect(all.rows[0].n).toBe(1);
  });
});
