/**
 * End-to-end money-flow tests for the earn → convert pipeline.
 *
 * Phase 2 added a pure unit test for the rate math (pointsEconomy.test.ts) but
 * nothing covered the full flow against a real database. This suite closes that
 * gap for the money-moving paths:
 *
 *   1. Issuing a token stamps usd_per_point_snapshot at the CURRENT rate — on
 *      the client /record path, the server-gated spin /complete path, and the
 *      AdMob SSV server-to-server callback.
 *   2. GET /api/earnings/pending reports the correct USD fields, each token
 *      valued at its own snapshot (legacy/NULL tokens at the 0.001 floor).
 *   3. POST /api/earnings/claim AND the auto-convert sweep credit exactly
 *      sum(points × COALESCE(snapshot, 0.001)), bounded by the $5/day USD cap,
 *      and never double-credit.
 *
 * Rather than fake Postgres, the suite runs the REAL routes against a REAL
 * database in a throwaway, isolated schema (search_path is pinned per pooled
 * connection). This exercises the actual transactions, FOR UPDATE locks, and
 * the COALESCE/SUM rate SQL — the things a fake would have to re-implement and
 * could get subtly wrong. Only auth's storage.getUser, the logger, and the spin
 * sweep interval are mocked; the database is genuine.
 *
 * Requires DATABASE_URL (always set in this environment). The schema is created
 * in beforeAll and dropped in afterAll, so it never touches real app tables.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { randomBytes, generateKeyPairSync, createSign } from "node:crypto";

const JWT_SECRET =
  "test-jwt-secret-for-earnings-money-flow-tests-padded-to-64-chars-aabbccdd";
const SCHEMA = `earn_test_${randomBytes(6).toString("hex")}`;

// authMiddleware resolves the acting user via storage.getUser. Echo back a
// matching user for whatever id the JWT carries so every minted token is valid.
const mockGetUser = vi.fn(async (id: string) => ({ id, role: "user", tokenVersion: 0 }));
vi.mock("../storage", () => ({
  storage: {
    getUser: (...a: unknown[]) => mockGetUser(a[0] as string),
    touchUserLastSeen: () => Promise.resolve(),
  },
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// The spin-challenge expiry sweep fires on a 30s interval at module load; make
// it a no-op so it can't touch the DB after the pool is torn down.
vi.mock("../lib/spinChallengeSweep", () => ({
  runSpinChallengeSweep: vi.fn(async () => 0),
}));

// Minimal shape of the raw pg client we use for DDL/seeding. Derived typing of
// pool.connect() collapses to its callback overload, and `pg` types aren't
// directly resolvable from this package, so we model just what we touch.
interface SqlResult {
  rows: Array<Record<string, any>>;
}
interface SqlClient {
  query(text: string, params?: unknown[]): Promise<SqlResult>;
  release(): void;
}

let app: Express;
let pool: typeof import("@workspace/db").pool;
let admin: SqlClient;
let runAutoConvert: () => Promise<void>;
let FLOOR_USD_PER_POINT: number;
let LEGACY_USD_PER_POINT: number;
let invalidateRateCache: (region?: string) => void;

const RATE = "0.00050000"; // current rate stamped on newly issued tokens
const RATE_NUM = 0.0005;
const HOUR = 60 * 60 * 1000;

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

interface SeedToken {
  userId: string;
  points: number;
  snapshot: string | null;
  status?: string;
  actionType?: string;
  claimableAt?: Date;
  earnedAt?: Date;
  claimedAt?: Date | null;
}

async function seedToken(t: SeedToken): Promise<string> {
  const now = new Date();
  const r = await admin.query(
    `INSERT INTO earn_tokens
       (user_id, points, action_type, description, earned_at, claimable_at, claimed_at, status, transaction_id, usd_per_point_snapshot)
     VALUES ($1,$2,$3,'seed',$4,$5,$6,$7,NULL,$8)
     RETURNING id`,
    [
      t.userId,
      t.points,
      t.actionType ?? "checkin",
      t.earnedAt ?? now,
      t.claimableAt ?? new Date(now.getTime() - 1000),
      t.claimedAt ?? null,
      t.status ?? "pending",
      t.snapshot,
    ],
  );
  return r.rows[0].id as string;
}

async function getUserRow(id: string): Promise<{ balance: string; total_earned: string }> {
  const r = await admin.query(`SELECT balance, total_earned FROM users WHERE id = $1`, [id]);
  return r.rows[0] as { balance: string; total_earned: string };
}

async function tokensByStatus(userId: string): Promise<Record<string, number>> {
  const r = await admin.query(
    `SELECT status, count(*)::int AS n FROM earn_tokens WHERE user_id = $1 GROUP BY status`,
    [userId],
  );
  const out: Record<string, number> = {};
  for (const row of r.rows) out[row.status] = row.n;
  return out;
}

async function ledgerFor(userId: string): Promise<Array<{ amount: string; type: string }>> {
  const r = await admin.query(
    `SELECT amount, type FROM earnings_ledger WHERE user_id = $1 ORDER BY created_at`,
    [userId],
  );
  return r.rows as Array<{ amount: string; type: string }>;
}

beforeAll(async () => {
  process.env["JWT_ACCESS_SECRET"] = JWT_SECRET;
  // Keep the HS256 path the only one in play.
  delete process.env["JWT_EDDSA_KEY"];
  delete process.env["JWT_ACCESS_SECRET_PREV"];
  delete process.env["ADMIN_TOKEN"];

  // Pin every pooled connection to our throwaway schema so the real routes'
  // unqualified queries (users, earn_tokens, …) resolve there, never to the
  // live app tables in `public`.
  // We inject the search_path into DATABASE_URL as a server option so
  // PostgreSQL applies it at protocol level on every new connection — no
  // extra query needed and no deprecated pool.on("connect") fire-and-forget.
  const baseUrl = process.env["DATABASE_URL"] ?? "";
  const sep = baseUrl.includes("?") ? "&" : "?";
  process.env["DATABASE_URL"] =
    `${baseUrl}${sep}options=-c%20search_path%3D${SCHEMA}%2Cpg_catalog`;

  const dbMod = await import("@workspace/db");
  pool = dbMod.pool;

  admin = (await pool.connect()) as unknown as SqlClient;
  await admin.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  await admin.query(`SET search_path TO ${SCHEMA}, pg_catalog`);

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
    CREATE TABLE earnings_ledger (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id varchar NOT NULL,
      amount numeric(12,2) NOT NULL,
      type text NOT NULL,
      description text NOT NULL,
      ref_id text,
      provider text,
      actor_user_id varchar,
      created_at timestamptz NOT NULL DEFAULT now()
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
    CREATE TABLE spin_challenges (
      token text PRIMARY KEY,
      user_id varchar NOT NULL,
      issued_at timestamptz NOT NULL,
      expires_at timestamptz NOT NULL,
      points integer
    );
  `);

  // Seed the current conversion rate the issuance paths will snapshot.
  await admin.query(
    `INSERT INTO conversion_rates (region, usd_per_point, floor_usd_per_point, method)
     VALUES ('GLOBAL', $1, '0.00020000', 'arpu')`,
    [RATE],
  );

  const econ = await import("../lib/pointsEconomy");
  FLOOR_USD_PER_POINT = econ.FLOOR_USD_PER_POINT;
  LEGACY_USD_PER_POINT = econ.LEGACY_USD_PER_POINT;
  invalidateRateCache = econ.invalidateRateCache;
  invalidateRateCache();

  const earnings = await import("./earnings");
  app = express();
  app.use(express.json());
  earnings.registerEarningsRoutes(app);
  // registerEarningsRoutes wires the sweep to this test seam.
  runAutoConvert = earnings.runAutoConvertForTests!;
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
  mockGetUser.mockClear();
});

describe("token issuance stamps usd_per_point_snapshot at the current rate", () => {
  it("stamps the snapshot on a /api/earnings/record check-in", async () => {
    const { id, token } = await createUser();
    const res = await request(app)
      .post("/api/earnings/record")
      .set("Authorization", `Bearer ${token}`)
      .send({ actionType: "checkin" });

    expect(res.status).toBe(201);
    const r = await admin.query(
      `SELECT action_type, usd_per_point_snapshot FROM earn_tokens WHERE user_id = $1`,
      [id],
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].action_type).toBe("checkin");
    expect(r.rows[0].usd_per_point_snapshot).toBe(RATE);
  });

  it("stamps the snapshot on a server-gated spin /complete", async () => {
    const { id, token } = await createUser();
    // Insert a challenge issued in the past so the 3s min-wait passes instantly.
    const challenge = randomBytes(16).toString("hex");
    await admin.query(
      `INSERT INTO spin_challenges (token, user_id, issued_at, expires_at)
       VALUES ($1, $2, NOW() - INTERVAL '10 seconds', NOW() + INTERVAL '50 seconds')`,
      [challenge, id],
    );

    const res = await request(app)
      .post("/api/earn/spin/complete")
      .set("Authorization", `Bearer ${token}`)
      .send({ challengeToken: challenge });

    expect(res.status).toBe(201);
    const r = await admin.query(
      `SELECT action_type, usd_per_point_snapshot FROM earn_tokens WHERE user_id = $1`,
      [id],
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].action_type).toBe("spin");
    expect(r.rows[0].usd_per_point_snapshot).toBe(RATE);
  });

  it("stamps the snapshot on an AdMob SSV callback", async () => {
    const { id } = await createUser();

    // Forge a Google-style ECDSA-SHA256 callback: generate our own EC key,
    // make fetchGooglePublicKey return our public key, and sign the query.
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const pubPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ keys: [{ keyId: 123, pem: pubPem, base64: "" }] }),
      })),
    );

    const ts = Date.now().toString();
    const txn = `txn_${randomBytes(6).toString("hex")}`;
    const params =
      `user_id=${id}&reward_item=coins&reward_amount=10&timestamp=${ts}&transaction_id=${txn}&key_id=123`;
    const signer = createSign("SHA256");
    signer.update(params);
    signer.end();
    const sig = signer.sign(privateKey, "base64");

    const res = await request(app).get(
      `/api/admob/ssv?${params}&signature=${encodeURIComponent(sig)}`,
    );
    expect(res.status).toBe(200);

    vi.unstubAllGlobals();

    const r = await admin.query(
      `SELECT action_type, points, usd_per_point_snapshot FROM earn_tokens WHERE user_id = $1`,
      [id],
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].action_type).toBe("rewarded_ad");
    expect(r.rows[0].points).toBe(50);
    expect(r.rows[0].usd_per_point_snapshot).toBe(RATE);
  });
});

describe("GET /api/earnings/pending reports per-snapshot USD", () => {
  it("values pending at its snapshot and claimable legacy/NULL at 0.001", async () => {
    const { id, token } = await createUser();
    // Pending (not yet claimable) at the current snapshot: 1000 × 0.0005 = $0.50
    await seedToken({
      userId: id,
      points: 1000,
      snapshot: RATE,
      claimableAt: new Date(Date.now() + 3 * HOUR),
    });
    // Claimable legacy token (NULL snapshot): 2000 × 0.001 = $2.00
    await seedToken({ userId: id, points: 2000, snapshot: null });

    const res = await request(app)
      .get("/api/earnings/pending")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.pendingPoints).toBe(1000);
    expect(res.body.claimablePoints).toBe(2000);
    expect(res.body.pendingUsd).toBeCloseTo(0.5, 4);
    expect(res.body.claimableUsd).toBeCloseTo(2000 * LEGACY_USD_PER_POINT, 4);
    expect(res.body.usdPerPoint).toBeCloseTo(RATE_NUM, 8);
    expect(res.body.floorUsdPerPoint).toBeCloseTo(FLOOR_USD_PER_POINT, 8);
    expect(res.body.pointsPerDollar).toBe(Math.round(1 / RATE_NUM));
  });
});

describe("POST /api/earnings/claim credits at snapshot, never double-credits", () => {
  it("credits sum(points × snapshot) incl. legacy NULL at 0.001, then is idempotent", async () => {
    const { id, token } = await createUser();
    await seedToken({ userId: id, points: 1000, snapshot: RATE }); // $0.50
    await seedToken({ userId: id, points: 1000, snapshot: null }); // $1.00 legacy

    const res = await request(app)
      .post("/api/earnings/claim")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.claimed).toBe(2);
    const expectedUsd = 1000 * RATE_NUM + 1000 * LEGACY_USD_PER_POINT; // 1.5
    expect(res.body.creditedUsd).toBeCloseTo(expectedUsd, 4);
    expect(res.body.newBalance).toBeCloseTo(expectedUsd, 2);

    const u = await getUserRow(id);
    expect(parseFloat(u.balance)).toBeCloseTo(expectedUsd, 2);
    expect(parseFloat(u.total_earned)).toBeCloseTo(expectedUsd, 2);
    expect((await tokensByStatus(id)).claimed).toBe(2);
    const ledger = await ledgerFor(id);
    expect(ledger).toHaveLength(1);
    expect(parseFloat(ledger[0].amount)).toBeCloseTo(expectedUsd, 2);

    // Second claim must credit nothing (no double-credit).
    const again = await request(app)
      .post("/api/earnings/claim")
      .set("Authorization", `Bearer ${token}`);
    expect(again.status).toBe(200);
    expect(again.body.claimed).toBe(0);
    expect(again.body.creditedUsd).toBe(0);

    const u2 = await getUserRow(id);
    expect(parseFloat(u2.balance)).toBeCloseTo(expectedUsd, 2);
    expect(await ledgerFor(id)).toHaveLength(1);
  });

  it("stops at the $5/day USD cap and leaves the rest pending", async () => {
    const { id, token } = await createUser();
    // Three tokens worth $2.50 each (5000 × 0.0005). Cap is $5 → only 2 convert.
    await seedToken({ userId: id, points: 5000, snapshot: RATE });
    await seedToken({ userId: id, points: 5000, snapshot: RATE });
    await seedToken({ userId: id, points: 5000, snapshot: RATE });

    const res = await request(app)
      .post("/api/earnings/claim")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.claimed).toBe(2);
    expect(res.body.creditedUsd).toBeCloseTo(5, 4);
    expect(res.body.skippedCap).toBe(true);

    const u = await getUserRow(id);
    expect(parseFloat(u.balance)).toBeCloseTo(5, 2);
    const status = await tokensByStatus(id);
    expect(status.claimed).toBe(2);
    expect(status.pending).toBe(1); // remaining token still claimable later
  });
});

describe("auto-convert sweep credits at snapshot, never double-credits", () => {
  it("sweeps claimable tokens (incl. legacy NULL) once at the snapshot rate", async () => {
    const { id } = await createUser();
    await seedToken({ userId: id, points: 1000, snapshot: RATE }); // $0.50
    await seedToken({ userId: id, points: 3000, snapshot: null }); // $3.00 legacy
    // A still-pending token (claimable in the future) must be left untouched.
    await seedToken({
      userId: id,
      points: 9999,
      snapshot: RATE,
      claimableAt: new Date(Date.now() + 3 * HOUR),
    });

    await runAutoConvert();

    const expectedUsd = 1000 * RATE_NUM + 3000 * LEGACY_USD_PER_POINT; // 3.5
    const u = await getUserRow(id);
    expect(parseFloat(u.balance)).toBeCloseTo(expectedUsd, 2);
    expect(parseFloat(u.total_earned)).toBeCloseTo(expectedUsd, 2);

    const status = await tokensByStatus(id);
    expect(status.claimed).toBe(2);
    expect(status.pending).toBe(1); // the future-dated token

    const ledger = await ledgerFor(id);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].type).toBe("bonus");
    expect(parseFloat(ledger[0].amount)).toBeCloseTo(expectedUsd, 2);

    // Running the sweep again must not credit the same tokens twice.
    await runAutoConvert();
    const u2 = await getUserRow(id);
    expect(parseFloat(u2.balance)).toBeCloseTo(expectedUsd, 2);
    expect(await ledgerFor(id)).toHaveLength(1);
  });
});

