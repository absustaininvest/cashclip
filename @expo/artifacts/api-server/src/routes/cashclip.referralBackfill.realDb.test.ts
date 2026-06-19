/**
 * Real-database integration tests for the one-time referral backfill.
 *
 * The existing `cashclip.referralBackfill.test.ts` mocks storage and only proves
 * the ROUTE wiring (auth gate, dry-run branch, tally arithmetic). It cannot prove
 * the part that actually moves money: that `storage.getReferralBackfillCandidates`
 * selects the RIGHT users with real SQL, and that `storage.qualifyReferral` credits
 * each referrer exactly once and is idempotent via `referral_credited_at`.
 *
 * This suite closes that gap by running the REAL route + REAL storage + REAL
 * `db.transaction`/`FOR UPDATE` against a REAL Postgres instance, isolated in a
 * throwaway schema (search_path pinned per pooled connection) so it never touches
 * the live `public` tables. Only the things that would otherwise hit the network,
 * spam logs, or are covered elsewhere are mocked (email, sibling route modules,
 * logger, the passphrase gate — its own enforcement lives in
 * secretsPassphrase.test.ts). Auth runs for real against a seeded admin row.
 *
 * Covered (POST /api/admin/referrals/backfill):
 *   - { dryRun: true } reports the candidate count and credits nobody.
 *   - A real run finds only qualifying candidates (referredBy set,
 *     referralCreditedAt NULL, a withdrawal >= the qualifying amount) and credits
 *     each referrer exactly $0.50 once, with a ledger row + credited_at stamp.
 *   - Re-running credits nobody a second time (idempotency via referralCreditedAt).
 *
 * Requires DATABASE_URL (always set in this environment).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { randomBytes } from "node:crypto";
import { REFERRAL_QUALIFY_USD, REFERRAL_BONUS_USD } from "../withdrawalTiers";

const JWT_SECRET =
  "test-jwt-secret-for-referral-backfill-realdb-padded-to-64-chars-aabbccdd";
const SCHEMA = `refbf_test_${randomBytes(6).toString("hex")}`;
const ADMIN_ID = "admin-backfill-1";

// Keep storage and @workspace/db REAL — the whole point is to exercise the real
// referral SQL. Only silence the noise and stub things the route registers but
// this suite does not use.
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

const BONUS = REFERRAL_BONUS_USD; // $0.50 default
const QUALIFY = REFERRAL_QUALIFY_USD; // $3.00 default (min withdrawal tier)

function tokenFor(userId: string, role: string): string {
  return jwt.sign({ userId, role, tokenVersion: 0 }, JWT_SECRET, { expiresIn: "1h" });
}

async function seedUser(opts: {
  username: string;
  role?: string;
  referredBy?: string | null;
  referralCreditedAt?: Date | null;
}): Promise<string> {
  const id = `u_${randomBytes(8).toString("hex")}`;
  await admin.query(
    `INSERT INTO users (id, username, password, role, referred_by, referral_credited_at)
     VALUES ($1, $2, 'x', $3, $4, $5)`,
    [id, opts.username, opts.role ?? "user", opts.referredBy ?? null, opts.referralCreditedAt ?? null],
  );
  return id;
}

async function seedWithdrawal(userId: string, username: string, amount: number): Promise<void> {
  const amt = amount.toFixed(2);
  await admin.query(
    `INSERT INTO withdrawals (user_id, username, amount, total_payout, paypal_email, status)
     VALUES ($1, $2, $3, $3, 'p@example.com', 'pending')`,
    [userId, username, amt],
  );
}

async function userRow(id: string): Promise<{ balance: string; total_earned: string; referral_credited_at: Date | null }> {
  const r = await admin.query(
    `SELECT balance, total_earned, referral_credited_at FROM users WHERE id = $1`,
    [id],
  );
  return r.rows[0] as any;
}

async function referralLedger(userId: string): Promise<Array<{ amount: string; type: string; ref_id: string | null }>> {
  const r = await admin.query(
    `SELECT amount, type, ref_id FROM earnings_ledger WHERE user_id = $1 ORDER BY created_at`,
    [userId],
  );
  return r.rows as any;
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
  // Pin every pooled connection to our throwaway schema so the real route/storage
  // unqualified queries (users, withdrawals, earnings_ledger) resolve there, never
  // to the live app tables in `public`.
  pool.on("connect", (c) => {
    c.query(`SET search_path TO ${SCHEMA}, pg_catalog`);
  });

  admin = (await pool.connect()) as unknown as SqlClient;
  await admin.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  await admin.query(`SET search_path TO ${SCHEMA}, pg_catalog`);

  // Full users table — storage.getUser does `select()` (all columns), so the
  // shape must match the drizzle schema or auth's lookup would error.
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
    CREATE TABLE withdrawals (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id varchar NOT NULL,
      username text NOT NULL,
      amount numeric(10,2) NOT NULL,
      bonus_percent numeric(5,2) NOT NULL DEFAULT '0',
      bonus_amount numeric(10,2) NOT NULL DEFAULT '0',
      total_payout numeric(10,2) NOT NULL,
      paypal_email text NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      admin_note text,
      paypal_batch_id text,
      created_at timestamp NOT NULL DEFAULT now(),
      processed_at timestamp
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
      created_at timestamp NOT NULL DEFAULT now()
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
  await admin.query(`TRUNCATE users, withdrawals, earnings_ledger`);
  // The admin who triggers the backfill — resolved for real by adminMiddleware.
  await admin.query(
    `INSERT INTO users (id, username, password, role) VALUES ($1, 'opsadmin', 'x', 'admin')`,
    [ADMIN_ID],
  );
});

describe("POST /api/admin/referrals/backfill (real DB)", () => {
  it("dry run reports the candidate count and credits nobody", async () => {
    const carol = await seedUser({ username: "carol" });
    const alice = await seedUser({ username: "alice", referredBy: "carol" });
    await seedWithdrawal(alice, "alice", QUALIFY);
    const dave = await seedUser({ username: "dave" });
    const bob = await seedUser({ username: "bob", referredBy: "dave" });
    await seedWithdrawal(bob, "bob", QUALIFY + 2);

    const res = await asAdmin(
      request(app).post("/api/admin/referrals/backfill").send({ dryRun: true }),
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ dryRun: true, candidates: 2 });

    // Nobody credited, nothing stamped, no ledger rows.
    expect(parseFloat((await userRow(carol)).balance)).toBe(0);
    expect(parseFloat((await userRow(dave)).balance)).toBe(0);
    expect((await userRow(alice)).referral_credited_at).toBeNull();
    expect((await userRow(bob)).referral_credited_at).toBeNull();
    expect(await referralLedger(carol)).toHaveLength(0);
    expect(await referralLedger(dave)).toHaveLength(0);
  });

  it("finds only qualifying candidates and credits each referrer exactly once", async () => {
    const carol = await seedUser({ username: "carol" });
    const dave = await seedUser({ username: "dave" });

    // Two qualifying referred users (referredBy set, not yet credited, withdrawal
    // at or above the qualifying amount).
    const alice = await seedUser({ username: "alice", referredBy: "carol" });
    await seedWithdrawal(alice, "alice", QUALIFY);
    const bob = await seedUser({ username: "bob", referredBy: "dave" });
    await seedWithdrawal(bob, "bob", QUALIFY + 4);

    // Non-candidates that must be excluded:
    //  - referred but withdrawal is BELOW the qualifying amount
    const tooSmall = await seedUser({ username: "tinytim", referredBy: "carol" });
    await seedWithdrawal(tooSmall, "tinytim", QUALIFY - 1);
    //  - referred but never withdrew
    await seedUser({ username: "nodraw", referredBy: "dave" });
    //  - qualifying withdrawal but NO referrer on record
    const organic = await seedUser({ username: "organic", referredBy: null });
    await seedWithdrawal(organic, "organic", QUALIFY + 1);
    //  - already credited (referralCreditedAt set) — must be skipped
    const past = await seedUser({
      username: "alreadydone",
      referredBy: "carol",
      referralCreditedAt: new Date("2026-01-01T00:00:00Z"),
    });
    await seedWithdrawal(past, "alreadydone", QUALIFY);

    const res = await asAdmin(request(app).post("/api/admin/referrals/backfill").send({}));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      dryRun: false,
      candidates: 2,
      credited: 2,
      skipped: 0,
      failed: 0,
    });

    // Each referrer credited exactly the bonus, once, in balance + total_earned.
    const carolRow = await userRow(carol);
    const daveRow = await userRow(dave);
    expect(parseFloat(carolRow.balance)).toBeCloseTo(BONUS, 2);
    expect(parseFloat(carolRow.total_earned)).toBeCloseTo(BONUS, 2);
    expect(parseFloat(daveRow.balance)).toBeCloseTo(BONUS, 2);
    expect(parseFloat(daveRow.total_earned)).toBeCloseTo(BONUS, 2);

    // One referral ledger row per referrer, tagged and pointed at the referred user.
    const carolLedger = await referralLedger(carol);
    expect(carolLedger).toHaveLength(1);
    expect(carolLedger[0].type).toBe("referral");
    expect(parseFloat(carolLedger[0].amount)).toBeCloseTo(BONUS, 2);
    expect(carolLedger[0].ref_id).toBe(alice);
    const daveLedger = await referralLedger(dave);
    expect(daveLedger).toHaveLength(1);
    expect(daveLedger[0].ref_id).toBe(bob);

    // The credited referred users are stamped; excluded ones are untouched.
    expect((await userRow(alice)).referral_credited_at).not.toBeNull();
    expect((await userRow(bob)).referral_credited_at).not.toBeNull();
    expect((await userRow(tooSmall)).referral_credited_at).toBeNull();
    // The non-referred withdrawer never gets a referral payout.
    expect(parseFloat((await userRow(organic)).balance)).toBe(0);
  });

  it("is idempotent — re-running credits nobody a second time", async () => {
    const carol = await seedUser({ username: "carol" });
    const alice = await seedUser({ username: "alice", referredBy: "carol" });
    await seedWithdrawal(alice, "alice", QUALIFY);

    const first = await asAdmin(request(app).post("/api/admin/referrals/backfill").send({}));
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ candidates: 1, credited: 1, skipped: 0, failed: 0 });
    expect(parseFloat((await userRow(carol)).balance)).toBeCloseTo(BONUS, 2);

    // Second run: alice now has referral_credited_at set, so she is no longer a
    // candidate. Nobody is credited again and balances/ledger are unchanged.
    const second = await asAdmin(request(app).post("/api/admin/referrals/backfill").send({}));
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ candidates: 0, credited: 0, skipped: 0, failed: 0 });

    expect(parseFloat((await userRow(carol)).balance)).toBeCloseTo(BONUS, 2);
    expect(await referralLedger(carol)).toHaveLength(1);
  });

  it("rejects an unauthenticated request with 401", async () => {
    const res = await request(app).post("/api/admin/referrals/backfill").send({});
    expect(res.status).toBe(401);
  });
});
