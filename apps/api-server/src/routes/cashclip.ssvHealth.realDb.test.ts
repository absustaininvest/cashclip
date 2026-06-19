/**
 * Real-database integration tests for GET /api/admin/admob/ssv-health.
 *
 * The endpoint counts `earn_tokens` with actionType="rewarded_ad" issued since
 * UTC midnight, splits them by "SSV verified" in the description, and derives a
 * `staleAlert` flag.  These tests guard the boundary conditions that a future
 * refactor could silently break:
 *
 *   1. Tokens issued BEFORE UTC midnight are NOT included in today's counts.
 *   2. Tokens with "SSV verified" in the description are counted as SSV;
 *      all others (same action_type) are counted as fallback.
 *   3. staleAlert is true when totalToday > 0 but no SSV token has been
 *      credited in the past 6 hours (including when there has never been an SSV
 *      token — lastSsvAt = null → gap from epoch → always > 6 h).
 *   4. staleAlert is false when there are no tokens today (zero DAU is not a
 *      false-positive alert).
 *   5. staleAlert is false when a recent SSV token exists (< 6 h ago).
 *
 * Mocking the database would only exercise the route wiring, not the actual
 * Drizzle query that operators rely on to detect regressions. This suite runs
 * the REAL route against a REAL Postgres instance, isolated in a throwaway
 * schema (search_path pinned per pooled connection) so it never touches the
 * live `public` tables.
 *
 * Only the things that would otherwise hit the network, spam logs, or are
 * covered elsewhere are mocked (email, sibling route modules, logger, the
 * passphrase gate, the DB rate limiter). Auth runs for real against a seeded
 * admin row.
 *
 * Requires DATABASE_URL (always set in this environment).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { randomBytes } from "node:crypto";

const JWT_SECRET =
  "test-jwt-secret-for-ssv-health-realdb-padded-to-64-chars-aabbccddeeff";
const SCHEMA = `ssv_test_${randomBytes(6).toString("hex")}`;
const ADMIN_ID = "admin-ssv-health-1";

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../lib/secretsPassphrase", () => ({
  secretsPassphraseMiddleware: (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => next(),
}));

vi.mock("../lib/dbRateLimit", () => ({
  recordLoginAttempt: vi.fn().mockResolvedValue({ count: 1, allowed: true }),
  checkLoginAttempts: vi.fn().mockResolvedValue({ count: 0, allowed: true }),
  clearLoginAttempts: vi.fn().mockResolvedValue(undefined),
  pruneExpiredLoginAttempts: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../surveys", () => ({ registerSurveyRoutes: vi.fn() }));
vi.mock("../offerwalls", () => ({ registerOfferwallRoutes: vi.fn() }));
vi.mock("./earnings", () => ({ registerEarningsRoutes: vi.fn() }));
vi.mock("./ventures", () => ({ default: express.Router() }));

vi.mock("../lib/email", () => ({
  sendWithdrawalRequestedAdmin: vi.fn(),
  sendWithdrawalRequestedUser: vi.fn(),
  sendWithdrawalVelocityAdmin: vi.fn(),
  sendWithdrawalStatusUpdate: vi.fn(),
  sendSupportTicket: vi.fn(),
  sendPasswordChangedNotice: vi.fn(),
  sendAdminCreditReceipt: vi.fn(),
  sendSupportReply: vi.fn(),
  sendReferralBonusEarned: vi.fn(),
  sendPayPalAmbiguousAlert: vi.fn(),
  sendBroadcastEmail: vi.fn(),
}));

interface SqlResult {
  rows: Array<Record<string, unknown>>;
}
interface SqlClient {
  query(text: string, params?: unknown[]): Promise<SqlResult>;
  release(): void;
}

let app: Express;
let pool: typeof import("@workspace/db").pool;
let admin: SqlClient;
let adminToken: string;

function tokenFor(userId: string, role: string): string {
  return jwt.sign({ userId, role, tokenVersion: 0 }, JWT_SECRET, { expiresIn: "1h" });
}

/** Insert an earn_token row. earnedAt defaults to NOW() if omitted. */
async function seedToken(opts: {
  actionType: string;
  description: string;
  earnedAt?: Date;
}): Promise<void> {
  const earnedAt = opts.earnedAt ?? new Date();
  await admin.query(
    `INSERT INTO earn_tokens
       (user_id, points, action_type, description, earned_at, claimable_at, status)
     VALUES ($1, 10, $2, $3, $4, $4, 'pending')`,
    [ADMIN_ID, opts.actionType, opts.description, earnedAt],
  );
}

/** UTC midnight for the current day — mirrors the handler's todayStart logic. */
function utcMidnightToday(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function asAdmin(req: request.Test): request.Test {
  return req.set("Authorization", `Bearer ${adminToken}`);
}

beforeAll(async () => {
  process.env["JWT_ACCESS_SECRET"] = JWT_SECRET;
  delete process.env["JWT_EDDSA_KEY"];
  delete process.env["JWT_ACCESS_SECRET_PREV"];
  delete process.env["ADMIN_TOKEN"];

  const dbMod = await import("@workspace/db");
  pool = dbMod.pool;
  pool.on("connect", (c) => {
    c.query(`SET search_path TO ${SCHEMA}, pg_catalog`);
  });

  admin = (await pool.connect()) as unknown as SqlClient;
  await admin.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  await admin.query(`SET search_path TO ${SCHEMA}, pg_catalog`);

  // Full users table — storage.getUser (used by adminMiddleware) does select()
  // over all columns, so the shape must match the drizzle schema.
  await admin.query(`
    CREATE TABLE users (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      username text NOT NULL UNIQUE,
      email text,
      password text NOT NULL,
      role text NOT NULL DEFAULT 'user',
      balance numeric(12,2) NOT NULL DEFAULT '0',
      total_earned numeric(12,2) NOT NULL DEFAULT '0',
      referred_by text,
      referral_credited_at timestamp,
      email_verified boolean NOT NULL DEFAULT false,
      email_verification_token text,
      email_verification_expires_at timestamp,
      created_at timestamp NOT NULL DEFAULT now(),
      date_of_birth text,
      gender text,
      zip_code text,
      country text DEFAULT 'US',
      employment_status text,
      household_income text,
      education_level text,
      ethnicity text,
      profile_complete boolean NOT NULL DEFAULT false,
      checkin_streak integer NOT NULL DEFAULT 0,
      last_checkin_at timestamptz,
      token_version integer NOT NULL DEFAULT 0,
      last_seen_at timestamptz,
      is_publisher boolean NOT NULL DEFAULT false,
      publisher_granted_at timestamp,
      ad_credits numeric(12,2) NOT NULL DEFAULT '0',
      totp_secret text,
      totp_enabled boolean NOT NULL DEFAULT false,
      totp_backup_codes text[],
      paypal_email text UNIQUE,
      paypal_email_set_at timestamp
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
  `);

  const { registerRoutes } = await import("./cashclip");
  app = express();
  app.use(express.json());
  await registerRoutes(app);

  adminToken = tokenFor(ADMIN_ID, "admin");
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
  vi.clearAllMocks();
  await admin.query(`TRUNCATE users, earn_tokens`);
  await admin.query(
    `INSERT INTO users (id, username, password, role) VALUES ($1, 'opsadmin', 'x', 'admin')`,
    [ADMIN_ID],
  );
});

describe("GET /api/admin/admob/ssv-health (real DB)", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const res = await request(app).get("/api/admin/admob/ssv-health");
    expect(res.status).toBe(401);
  });

  it("returns all-zero counts and no alert when the table is empty", async () => {
    const res = await asAdmin(request(app).get("/api/admin/admob/ssv-health"));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ssvToday: 0,
      fallbackToday: 0,
      totalToday: 0,
      lastSsvAt: null,
      staleAlert: false,
    });
  });

  it("does NOT count tokens issued before UTC midnight", async () => {
    const midnight = utcMidnightToday();
    // One second before midnight — strictly yesterday.
    const yesterday = new Date(midnight.getTime() - 1000);

    await seedToken({ actionType: "rewarded_ad", description: "SSV verified", earnedAt: yesterday });
    await seedToken({ actionType: "rewarded_ad", description: "fallback", earnedAt: yesterday });

    const res = await asAdmin(request(app).get("/api/admin/admob/ssv-health"));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ssvToday: 0,
      fallbackToday: 0,
      totalToday: 0,
    });
  });

  it("counts SSV-verified and fallback tokens issued today correctly", async () => {
    // Two SSV tokens and one fallback token, all issued today.
    await seedToken({ actionType: "rewarded_ad", description: "AdMob SSV verified user_id=u1" });
    await seedToken({ actionType: "rewarded_ad", description: "AdMob SSV verified user_id=u2" });
    await seedToken({ actionType: "rewarded_ad", description: "begin/complete fallback" });
    // A different actionType must NOT be counted even if its description matches.
    await seedToken({ actionType: "checkin", description: "SSV verified should not count" });

    const res = await asAdmin(request(app).get("/api/admin/admob/ssv-health"));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ssvToday: 2,
      fallbackToday: 1,
      totalToday: 3,
    });
  });

  it("tokens from yesterday do not inflate today's split (mixed-day scenario)", async () => {
    const midnight = utcMidnightToday();
    const yesterday = new Date(midnight.getTime() - 1000);

    // Yesterday: 5 SSV tokens.
    for (let i = 0; i < 5; i++) {
      await seedToken({ actionType: "rewarded_ad", description: "SSV verified", earnedAt: yesterday });
    }
    // Today: 1 SSV + 1 fallback.
    await seedToken({ actionType: "rewarded_ad", description: "SSV verified today" });
    await seedToken({ actionType: "rewarded_ad", description: "fallback today" });

    const res = await asAdmin(request(app).get("/api/admin/admob/ssv-health"));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ssvToday: 1,
      fallbackToday: 1,
      totalToday: 2,
    });
  });

  it("staleAlert is false when there are no tokens today (zero DAU is not a false positive)", async () => {
    // SSV token exists but it was yesterday — totalToday = 0.
    const midnight = utcMidnightToday();
    const yesterday = new Date(midnight.getTime() - 1000);
    await seedToken({ actionType: "rewarded_ad", description: "SSV verified", earnedAt: yesterday });

    const res = await asAdmin(request(app).get("/api/admin/admob/ssv-health"));
    expect(res.status).toBe(200);
    expect(res.body.totalToday).toBe(0);
    expect(res.body.staleAlert).toBe(false);
  });

  it("staleAlert is true when videos were watched today but SSV has never credited (null lastSsvAt)", async () => {
    // Only fallback (non-SSV) tokens today — SSV table is empty so lastSsvAt = null.
    // null → lastSsvMs = 0, so now - 0 >> 6 h → staleAlert = true.
    await seedToken({ actionType: "rewarded_ad", description: "begin/complete fallback" });

    const res = await asAdmin(request(app).get("/api/admin/admob/ssv-health"));
    expect(res.status).toBe(200);
    expect(res.body.totalToday).toBeGreaterThan(0);
    expect(res.body.lastSsvAt).toBeNull();
    expect(res.body.staleAlert).toBe(true);
  });

  it("staleAlert is false when there is a recent SSV token (less than 6 hours ago)", async () => {
    // SSV token issued 1 minute ago — well within the 6-hour window.
    const recentAt = new Date(Date.now() - 60 * 1000);
    await seedToken({ actionType: "rewarded_ad", description: "SSV verified recent", earnedAt: recentAt });

    const res = await asAdmin(request(app).get("/api/admin/admob/ssv-health"));
    expect(res.status).toBe(200);
    expect(res.body.ssvToday).toBe(1);
    expect(res.body.totalToday).toBe(1);
    expect(res.body.lastSsvAt).not.toBeNull();
    expect(res.body.staleAlert).toBe(false);
  });

  it("lastSsvAt reflects the most recent SSV token across all time, not just today", async () => {
    const midnight = utcMidnightToday();
    const yesterday = new Date(midnight.getTime() - 60 * 60 * 1000); // 1 h before midnight
    const earlier = new Date(midnight.getTime() - 2 * 60 * 60 * 1000); // 2 h before midnight

    await seedToken({ actionType: "rewarded_ad", description: "SSV verified older", earnedAt: earlier });
    await seedToken({ actionType: "rewarded_ad", description: "SSV verified newer", earnedAt: yesterday });

    const res = await asAdmin(request(app).get("/api/admin/admob/ssv-health"));
    expect(res.status).toBe(200);
    // Both are yesterday → not in today's count.
    expect(res.body.ssvToday).toBe(0);
    expect(res.body.totalToday).toBe(0);
    // lastSsvAt should be the more recent one (yesterday, not earlier).
    const lastSsvAt = new Date(res.body.lastSsvAt as string).getTime();
    expect(Math.abs(lastSsvAt - yesterday.getTime())).toBeLessThan(1000);
  });

  it("includes a fetchedAt ISO timestamp in the response", async () => {
    const before = Date.now();
    const res = await asAdmin(request(app).get("/api/admin/admob/ssv-health"));
    const after = Date.now();

    expect(res.status).toBe(200);
    expect(typeof res.body.fetchedAt).toBe("string");
    const ts = new Date(res.body.fetchedAt as string).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});
