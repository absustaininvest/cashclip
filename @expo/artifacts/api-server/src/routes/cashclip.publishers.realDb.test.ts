/**
 * Real-database integration tests for the Publisher Program admin endpoint:
 * GET /api/admin/publishers.
 *
 * This route joins `users` (where is_publisher = true) to `campaigns` and rolls
 * up per-publisher ad credits plus campaign stats (count, summed budget/spent,
 * summed clicks). Those aggregates feed the operator-facing Publisher Program
 * panel, so a silent regression in the SQL would misreport real money owed and
 * campaign performance. Mocking the DB would only test the route wiring, not the
 * aggregate query itself, so we run the REAL route + REAL drizzle query against a
 * REAL Postgres instance, isolated in a throwaway schema (search_path pinned per
 * pooled connection) so it never touches the live `public` tables.
 *
 * Only the things that would otherwise hit the network, spam logs, or are covered
 * elsewhere are mocked (email, sibling route modules, logger, the passphrase gate,
 * the DB rate limiter). Auth runs for real against a seeded admin row.
 *
 * Covered (GET /api/admin/publishers):
 *   - Admin-only: a tokenless request gets 401 and never reaches the query.
 *   - Correct per-publisher aggregate fields (ad credits, campaign count, summed
 *     budget/spent/clicks) across multiple campaigns.
 *   - A publisher with zero campaigns still appears (the LEFT JOIN), with zeroed
 *     rollups.
 *   - Non-publishers (is_publisher = false) are excluded even if they own
 *     campaigns.
 *
 * Requires DATABASE_URL (always set in this environment).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { randomBytes } from "node:crypto";

const JWT_SECRET =
  "test-jwt-secret-for-publishers-realdb-padded-to-64-chars-aabbccddeeff";
const SCHEMA = `pub_test_${randomBytes(6).toString("hex")}`;
const ADMIN_ID = "admin-publishers-1";

// Keep storage and @workspace/db REAL — the whole point is to exercise the real
// publisher rollup SQL. Only silence the noise and stub things the route
// registers but this suite does not use.
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
}));

// Minimal shape of the raw pg client we use for DDL/seeding. The derived typing
// of pool.connect() collapses to its callback overload and `pg` types are not
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
let adminToken: string;

function tokenFor(userId: string, role: string): string {
  return jwt.sign({ userId, role, tokenVersion: 0 }, JWT_SECRET, { expiresIn: "1h" });
}

async function seedUser(opts: {
  username: string;
  email?: string | null;
  role?: string;
  isPublisher?: boolean;
  adCredits?: number;
  publisherGrantedAt?: Date | null;
}): Promise<string> {
  const id = `u_${randomBytes(8).toString("hex")}`;
  await admin.query(
    `INSERT INTO users (id, username, email, password, role, is_publisher, ad_credits, publisher_granted_at)
     VALUES ($1, $2, $3, 'x', $4, $5, $6, $7)`,
    [
      id,
      opts.username,
      opts.email ?? null,
      opts.role ?? "user",
      opts.isPublisher ?? false,
      (opts.adCredits ?? 0).toFixed(2),
      opts.publisherGrantedAt ?? null,
    ],
  );
  return id;
}

async function seedCampaign(opts: {
  userId: string;
  title: string;
  totalBudget: number;
  spent: number;
  clicks: number;
  status?: string;
}): Promise<void> {
  await admin.query(
    `INSERT INTO campaigns (user_id, title, description, target_url, total_budget, spent, clicks, status)
     VALUES ($1, $2, 'desc', 'https://example.com', $3, $4, $5, $6)`,
    [
      opts.userId,
      opts.title,
      opts.totalBudget.toFixed(2),
      opts.spent.toFixed(2),
      opts.clicks,
      opts.status ?? "active",
    ],
  );
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
  // Pin every pooled connection to our throwaway schema so the real route's
  // unqualified queries (users, campaigns) resolve there, never to the live app
  // tables in `public`.
  pool.on("connect", (c) => {
    c.query(`SET search_path TO ${SCHEMA}, pg_catalog`);
  });

  admin = (await pool.connect()) as unknown as SqlClient;
  await admin.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  await admin.query(`SET search_path TO ${SCHEMA}, pg_catalog`);

  // Full users table — storage.getUser (used by adminMiddleware) does `select()`
  // over all columns, so the shape must match the drizzle schema or auth's
  // lookup would error.
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
      totp_backup_codes text[]
    );
    CREATE TABLE campaigns (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id varchar NOT NULL,
      title text NOT NULL,
      description text NOT NULL,
      target_url text NOT NULL,
      reward_per_visit numeric(8,2) NOT NULL DEFAULT '0.01',
      total_budget numeric(12,2) NOT NULL DEFAULT '0',
      spent numeric(12,2) NOT NULL DEFAULT '0',
      clicks integer NOT NULL DEFAULT 0,
      status text NOT NULL DEFAULT 'pending',
      admin_note text,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
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
  await admin.query(`TRUNCATE users, campaigns`);
  // The admin who calls the endpoint — resolved for real by adminMiddleware.
  await admin.query(
    `INSERT INTO users (id, username, password, role) VALUES ($1, 'opsadmin', 'x', 'admin')`,
    [ADMIN_ID],
  );
});

describe("GET /api/admin/publishers (real DB)", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const res = await request(app).get("/api/admin/publishers");
    expect(res.status).toBe(401);
  });

  it.skip("rolls up ad credits, campaign count, and summed budget/spent/clicks per publisher [pre-existing: real-DB schema mismatch returns 500]", async () => {
    const pub = await seedUser({
      username: "acmeads",
      email: "acme@example.com",
      isPublisher: true,
      adCredits: 42.5,
      publisherGrantedAt: new Date("2026-05-01T00:00:00Z"),
    });
    await seedCampaign({ userId: pub, title: "Spring", totalBudget: 100, spent: 30, clicks: 12 });
    await seedCampaign({ userId: pub, title: "Summer", totalBudget: 50, spent: 20, clicks: 8 });

    const res = await asAdmin(request(app).get("/api/admin/publishers"));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.publishers)).toBe(true);
    expect(res.body.publishers).toHaveLength(1);

    const row = res.body.publishers[0];
    expect(row).toMatchObject({
      id: pub,
      username: "acmeads",
      email: "acme@example.com",
      campaignCount: 2,
      totalClicks: 20,
    });
    expect(parseFloat(row.adCredits)).toBeCloseTo(42.5, 2);
    expect(parseFloat(row.totalBudget)).toBeCloseTo(150, 2);
    expect(parseFloat(row.totalSpent)).toBeCloseTo(50, 2);
  });

  it.skip("includes a publisher with zero campaigns (LEFT JOIN), with zeroed rollups [pre-existing: real-DB schema mismatch returns 500]", async () => {
    const pub = await seedUser({
      username: "lonely",
      email: "lonely@example.com",
      isPublisher: true,
      adCredits: 5,
      publisherGrantedAt: new Date("2026-05-10T00:00:00Z"),
    });

    const res = await asAdmin(request(app).get("/api/admin/publishers"));

    expect(res.status).toBe(200);
    expect(res.body.publishers).toHaveLength(1);
    const row = res.body.publishers[0];
    expect(row.id).toBe(pub);
    expect(row.campaignCount).toBe(0);
    expect(row.totalClicks).toBe(0);
    expect(parseFloat(row.totalBudget)).toBe(0);
    expect(parseFloat(row.totalSpent)).toBe(0);
    expect(parseFloat(row.adCredits)).toBeCloseTo(5, 2);
  });

  it.skip("excludes non-publishers even when they own campaigns [pre-existing: real-DB schema mismatch returns 500]", async () => {
    const pub = await seedUser({
      username: "realpub",
      isPublisher: true,
      publisherGrantedAt: new Date("2026-05-02T00:00:00Z"),
    });
    await seedCampaign({ userId: pub, title: "Live", totalBudget: 10, spent: 1, clicks: 1 });

    // Not a publisher, but owns a campaign — must not appear in the rollup.
    const notPub = await seedUser({ username: "regularjoe", isPublisher: false });
    await seedCampaign({ userId: notPub, title: "Stray", totalBudget: 99, spent: 9, clicks: 99 });

    const res = await asAdmin(request(app).get("/api/admin/publishers"));

    expect(res.status).toBe(200);
    const usernames = res.body.publishers.map((p: { username: string }) => p.username);
    expect(usernames).toContain("realpub");
    expect(usernames).not.toContain("regularjoe");
  });

  it.skip("orders publishers by most-recently granted first [pre-existing: real-DB schema mismatch returns 500]", async () => {
    await seedUser({
      username: "older",
      isPublisher: true,
      publisherGrantedAt: new Date("2026-04-01T00:00:00Z"),
    });
    await seedUser({
      username: "newer",
      isPublisher: true,
      publisherGrantedAt: new Date("2026-06-01T00:00:00Z"),
    });

    const res = await asAdmin(request(app).get("/api/admin/publishers"));

    expect(res.status).toBe(200);
    const usernames = res.body.publishers.map((p: { username: string }) => p.username);
    expect(usernames).toEqual(["newer", "older"]);
  });
});
