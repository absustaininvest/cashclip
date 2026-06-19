/**
 * DB-backed concurrent integration test for the spin-wheel 2-hour cooldown.
 *
 * The unit tests in lib/earnSpinComplete.test.ts and the DB-resilience suite in
 * routes/earnings.spinDbResilience.test.ts cover the individual branches of
 * POST /api/earn/spin/complete in isolation (mocked DB / mocked store). Neither
 * proves that TWO simultaneous /complete requests — each holding a freshly
 * validated challenge token — cannot both observe the pre-insert cooldown state
 * and race past the 2-hour gate.
 *
 * The guard is a `SELECT … FOR UPDATE` on the users row inside a transaction,
 * which serialises concurrent /complete requests for the same user at the
 * Postgres level. This test drives the REAL transaction and the REAL earnTokens
 * insert SQL against a throwaway schema so that any regression in the lock scope
 * or the cooldown-query logic shows up as "two 201s" instead of silently passing.
 *
 * Pattern mirrors routes/earnings.moneyFlow.test.ts (real DB, throwaway schema)
 * and routes/cashclip.inboxReply.dedupeDb.test.ts (concurrent Promise.all
 * assertion). Only the spin-challenge store (already exercised in its own suite),
 * the spin-sweep interval, auth storage, and the rate-snapshot helper are
 * mocked; the transaction + FOR UPDATE + cooldown check + insert stay real.
 *
 * Requires DATABASE_URL (always set in this environment). The schema is created
 * in beforeAll and dropped in afterAll, so it never touches real app tables.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { randomBytes } from "node:crypto";

const JWT_SECRET =
  "test-jwt-secret-for-spin-cooldown-concurrent-tests-padded-to-64-aabbcc";
const SCHEMA = `spin_cooldown_test_${randomBytes(6).toString("hex")}`;

// ── Mock: spin challenge store ────────────────────────────────────────────────
// The store (spin_challenges table) is exercised in its own suite. Here we
// inject a known-good consume result for every request so the test can focus
// exclusively on the cooldown guard inside the earnTokens transaction.
const mockConsume = vi.fn();
const mockIssue = vi.fn().mockResolvedValue(undefined);
vi.mock("../lib/spinChallengeStore", () => ({
  SpinChallengeStoreError: class SpinChallengeStoreError extends Error {
    constructor(op: string, cause: unknown) {
      super(`spin challenge store ${op} failed`, { cause });
      this.name = "SpinChallengeStoreError";
    }
  },
  issueSpinChallenge: (...args: unknown[]) => mockIssue(...args),
  consumeSpinChallenge: (...args: unknown[]) => mockConsume(...args),
}));

// ── Mock: spin-challenge expiry sweep ─────────────────────────────────────────
// Fires on a 30-second interval at module load; prevent it from touching the
// DB after the pool is torn down in afterAll.
vi.mock("../lib/spinChallengeSweep", () => ({
  runSpinChallengeSweep: vi.fn(async () => 0),
}));

// ── Mock: auth storage ────────────────────────────────────────────────────────
// authMiddleware resolves the acting user via storage.getUser and fires a
// fire-and-forget storage.touchUserLastSeen call. Both must be present in the
// mock or the synchronous `storage.touchUserLastSeen is not a function` throw
// propagates out of authMiddleware and Express converts it to a 500.
const mockGetUser = vi.fn(async (id: string) => ({
  id,
  role: "user",
  tokenVersion: 0,
}));
vi.mock("../storage", () => ({
  storage: {
    getUser: (...a: unknown[]) => mockGetUser(a[0] as string),
    touchUserLastSeen: vi.fn().mockResolvedValue(undefined),
  },
}));

// ── Mock: logger ──────────────────────────────────────────────────────────────
vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Minimal pg-client interface (pool.connect() typing collapses) ─────────────
interface SqlResult { rows: Array<Record<string, unknown>> }
interface SqlClient {
  query(text: string, params?: unknown[]): Promise<SqlResult>;
  release(): void;
}

let app: Express;
let pool: typeof import("@workspace/db").pool;
let admin: SqlClient;
let invalidateRateCache: (region?: string) => void;

function tokenFor(userId: string): string {
  return jwt.sign({ userId, role: "user", tokenVersion: 0 }, JWT_SECRET, {
    expiresIn: "1h",
  });
}

async function createUser(): Promise<{ id: string; token: string }> {
  const id = `u_${randomBytes(8).toString("hex")}`;
  await admin.query(`INSERT INTO users (id) VALUES ($1)`, [id]);
  return { id, token: tokenFor(id) };
}

async function spinTokenCount(userId: string): Promise<number> {
  const r = await admin.query(
    `SELECT count(*)::int AS n FROM earn_tokens WHERE user_id = $1 AND action_type = 'spin'`,
    [userId],
  );
  return r.rows[0].n as number;
}

beforeAll(async () => {
  process.env["JWT_ACCESS_SECRET"] = JWT_SECRET;
  delete process.env["JWT_EDDSA_KEY"];
  delete process.env["JWT_ACCESS_SECRET_PREV"];
  delete process.env["ADMIN_TOKEN"];

  const dbMod = await import("@workspace/db");
  pool = dbMod.pool;

  // Pin every pooled connection to the throwaway schema so the real handler's
  // unqualified queries (users, earn_tokens) resolve there, never to live tables.
  pool.on("connect", (c) => {
    c.query(`SET search_path TO ${SCHEMA}, pg_catalog`);
  });

  admin = (await pool.connect()) as unknown as SqlClient;
  await admin.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  await admin.query(`SET search_path TO ${SCHEMA}, pg_catalog`);

  // Minimal tables the spin/complete handler touches.
  // Users: needs `id` for the FOR UPDATE lock.
  // earn_tokens: all columns the INSERT uses.
  // conversion_rates: queried by snapshotRateString (used inside the transaction).
  await admin.query(`
    CREATE TABLE users (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      balance numeric(12,2) NOT NULL DEFAULT '0',
      total_earned numeric(12,2) NOT NULL DEFAULT '0',
      checkin_streak integer NOT NULL DEFAULT 0,
      last_checkin_at timestamptz
    );
    CREATE TABLE earn_tokens (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id varchar NOT NULL,
      points integer NOT NULL,
      action_type text NOT NULL,
      description text NOT NULL DEFAULT '',
      earned_at timestamptz NOT NULL DEFAULT now(),
      claimable_at timestamptz NOT NULL,
      claimed_at timestamptz,
      status text NOT NULL DEFAULT 'pending',
      transaction_id varchar UNIQUE,
      usd_per_point_snapshot numeric(12,8)
    );
    CREATE TABLE conversion_rates (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      region text NOT NULL DEFAULT 'GLOBAL',
      usd_per_point numeric(12,8) NOT NULL,
      floor_usd_per_point numeric(12,8) NOT NULL,
      method text NOT NULL DEFAULT 'seed',
      window_days integer,
      revenue_usd numeric(14,4),
      points_issued numeric(18,0),
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  // Seed a conversion rate so snapshotRateString doesn't fall through to the floor.
  await admin.query(
    `INSERT INTO conversion_rates (region, usd_per_point, floor_usd_per_point, method)
     VALUES ('GLOBAL', '0.00100000', '0.00020000', 'seed')`,
  );

  // Invalidate the in-memory rate cache so the seeded rate is used in tests.
  const econ = await import("../lib/pointsEconomy");
  invalidateRateCache = econ.invalidateRateCache;
  invalidateRateCache();

  const { registerEarningsRoutes } = await import("./earnings");
  app = express();
  app.use(express.json());
  registerEarningsRoutes(app);
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

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockImplementation(async (id: string) => ({
    id,
    role: "user",
    tokenVersion: 0,
  }));
  // Each consume call returns a fresh "ok" result so both concurrent requests
  // pass the challenge-store gate and proceed to the DB transaction.
  mockConsume.mockResolvedValue({ status: "ok", points: 180 });
});

describe("POST /api/earn/spin/complete — concurrent 2-hour cooldown guard", () => {
  it("exactly one 201 and one 429 when two valid challenges arrive concurrently for the same user", async () => {
    const { id: userId, token: userToken } = await createUser();

    // Each request carries a distinct challenge token (the store mock accepts
    // both). They hit the handler at the same instant; only one can hold the
    // FOR UPDATE lock at a time.
    const [a, b] = await Promise.all([
      request(app)
        .post("/api/earn/spin/complete")
        .set("Authorization", `Bearer ${userToken}`)
        .send({ challengeToken: randomBytes(32).toString("hex") }),
      request(app)
        .post("/api/earn/spin/complete")
        .set("Authorization", `Bearer ${userToken}`)
        .send({ challengeToken: randomBytes(32).toString("hex") }),
    ]);

    const statuses = [a.status, b.status].sort((x, y) => x - y);
    expect(statuses).toEqual([201, 429]);

    const winner = a.status === 201 ? a : b;
    const loser  = a.status === 429 ? a : b;

    // Winner: earn token issued.
    expect(winner.body.tokenId).toBeDefined();
    expect(winner.body.points).toBe(180);

    // Loser: cooldown error.
    expect(loser.body.error).toMatch(/cooldown/i);
    expect(typeof loser.body.nextAvailableAt).toBe("string");

    // Exactly one earn_tokens row — the duplicate was fully suppressed.
    expect(await spinTokenCount(userId)).toBe(1);
  });

  it("a sequential second spin within 2 hours is also blocked (baseline)", async () => {
    const { id: userId, token: userToken } = await createUser();

    const first = await request(app)
      .post("/api/earn/spin/complete")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ challengeToken: randomBytes(32).toString("hex") });

    expect(first.status).toBe(201);
    expect(await spinTokenCount(userId)).toBe(1);

    const second = await request(app)
      .post("/api/earn/spin/complete")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ challengeToken: randomBytes(32).toString("hex") });

    expect(second.status).toBe(429);
    expect(second.body.error).toMatch(/cooldown/i);
    expect(typeof second.body.nextAvailableAt).toBe("string");

    // Still only one spin token — sequential guard works too.
    expect(await spinTokenCount(userId)).toBe(1);
  });

  it("a second spin after the cooldown window has expired succeeds", async () => {
    const { id: userId, token: userToken } = await createUser();

    const first = await request(app)
      .post("/api/earn/spin/complete")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ challengeToken: randomBytes(32).toString("hex") });

    expect(first.status).toBe(201);

    // Backdate the existing earn_token so the 2h cooldown window has passed.
    await admin.query(
      `UPDATE earn_tokens
          SET earned_at = NOW() - INTERVAL '3 hours'
        WHERE user_id = $1 AND action_type = 'spin'`,
      [userId],
    );

    const second = await request(app)
      .post("/api/earn/spin/complete")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ challengeToken: randomBytes(32).toString("hex") });

    expect(second.status).toBe(201);
    expect(second.body.tokenId).toBeDefined();

    // Two tokens now — both spins went through.
    expect(await spinTokenCount(userId)).toBe(2);
  });

  it("concurrent spins for DIFFERENT users both succeed (locks are per-user)", async () => {
    const userA = await createUser();
    const userB = await createUser();

    // Mock must return the right user for each userId token.
    mockGetUser.mockImplementation(async (id: string) => ({
      id,
      role: "user",
      tokenVersion: 0,
    }));

    const [a, b] = await Promise.all([
      request(app)
        .post("/api/earn/spin/complete")
        .set("Authorization", `Bearer ${userA.token}`)
        .send({ challengeToken: randomBytes(32).toString("hex") }),
      request(app)
        .post("/api/earn/spin/complete")
        .set("Authorization", `Bearer ${userB.token}`)
        .send({ challengeToken: randomBytes(32).toString("hex") }),
    ]);

    // Both should succeed — the row-level lock is keyed per user.
    const statuses = [a.status, b.status].sort((x, y) => x - y);
    expect(statuses).toEqual([201, 201]);

    expect(await spinTokenCount(userA.id)).toBe(1);
    expect(await spinTokenCount(userB.id)).toBe(1);
  });
});
