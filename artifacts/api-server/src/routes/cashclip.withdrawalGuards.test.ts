/**
 * Server-side enforcement tests for POST /api/withdrawals.
 *
 * The new-account hold (NEW_ACCOUNT_HOLD_HOURS, default 48 h) and the
 * per-user daily withdrawal-count cap (MAX_WITHDRAWALS_PER_DAY, default 2)
 * are enforced on the SERVER, at the trusted API boundary, using:
 *   • Hold: user.createdAt from the database (not client-provided).
 *   • Cap:  createWithdrawalAtomic() counts today's withdrawals from the
 *           withdrawals table inside a serialized, locked transaction.
 *
 * These tests pin both gates so a future refactor cannot silently remove
 * server-side enforcement and regress to client-only AsyncStorage checks
 * (which are bypassable by reinstalling the app or calling the API directly).
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

const USER_ID = "user-withdrawal-guard-test";
const JWT_SECRET = "test-jwt-secret-for-withdrawal-guard-tests-padded-to-64xxxxxx";

const mockGetUser = vi.fn();
const mockGetUserWithdrawals = vi.fn();
const mockCreateWithdrawalAtomic = vi.fn();

vi.mock("../storage", () => ({
  storage: {
    getUser: (...args: unknown[]) => mockGetUser(...args),
    getUserWithdrawals: (...args: unknown[]) => mockGetUserWithdrawals(...args),
    createWithdrawalAtomic: (...args: unknown[]) => mockCreateWithdrawalAtomic(...args),
  },
}));

vi.mock("../lib/dbRateLimit", () => ({
  recordLoginAttempt: vi.fn().mockResolvedValue({ count: 1, allowed: true }),
  checkLoginAttempts: vi.fn().mockResolvedValue({ count: 0, allowed: true }),
  clearLoginAttempts: vi.fn().mockResolvedValue(undefined),
  pruneExpiredLoginAttempts: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/secretsPassphrase", () => ({
  secretsPassphraseMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    db: { transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn({}) },
  };
});

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

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

let app: Express;
let userToken: string;

// ── Helpers ─────────────────────────────────────────────────────────────────

/** ISO timestamp for an account created `hours` hours ago. */
function createdAtHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

/** A fully-eligible user: old account, profile complete, standard email. */
function eligibleUser(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: USER_ID,
    role: "user",
    tokenVersion: 0,
    email: "user@example.com",
    username: "testuser",
    profileComplete: true,
    referredBy: null,
    createdAt: createdAtHoursAgo(72), // 72 h > 48 h hold
    ...overrides,
  };
}

function withAuth(req: request.Test): request.Test {
  return req.set("Authorization", `Bearer ${userToken}`);
}

const VALID_BODY = { amount: 3, paypalEmail: "user@paypal.com" };

// ── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";
  process.env["JWT_ACCESS_SECRET"] = JWT_SECRET;
  delete process.env["ADMIN_TOKEN"];
  delete process.env["NEW_ACCOUNT_HOLD_HOURS"];
  delete process.env["MAX_WITHDRAWALS_PER_DAY"];

  userToken = jwt.sign({ userId: USER_ID, role: "user", tokenVersion: 0 }, JWT_SECRET, {
    expiresIn: "1h",
  });

  vi.resetModules();
  const { registerRoutes } = await import("./cashclip");
  app = express();
  app.use(express.json());
  await registerRoutes(app);

  // Warm-up: send one request so any lazy module initialization (rate limiters,
  // module-level singletons, etc.) completes before the first timed test runs.
  // Use an account clearly past the hold (72 h) so it hits createWithdrawalAtomic.
  mockGetUser.mockResolvedValue(eligibleUser());
  mockGetUserWithdrawals.mockResolvedValue([]);
  mockCreateWithdrawalAtomic.mockResolvedValue({
    ok: true,
    withdrawal: { id: "warmup", status: "pending", amount: "3.00", totalPayout: "3.00" },
    balance: 10,
    withdrawalsTodayCount: 1,
  });
  await request(app)
    .post("/api/withdrawals")
    .set("Authorization", `Bearer ${userToken}`)
    .send(VALID_BODY);
});

beforeEach(() => {
  vi.clearAllMocks();

  // Default: eligible user; happy-path atomic result (overridden per test).
  mockGetUser.mockResolvedValue(eligibleUser());
  mockGetUserWithdrawals.mockResolvedValue([]);
  mockCreateWithdrawalAtomic.mockResolvedValue({
    ok: true,
    withdrawal: { id: "w-1", status: "pending", amount: "3.00", totalPayout: "3.00" },
    balance: 7,
    withdrawalsTodayCount: 1,
  });
});

// ── New-account hold ─────────────────────────────────────────────────────────

describe("POST /api/withdrawals — new-account hold (server-side enforcement)", () => {
  it("rejects a brand-new account (age < 1 h) with 403 and NEW_ACCOUNT_HOLD code", async () => {
    // Use a small but non-zero age (5 minutes) so the math is unambiguous.
    mockGetUser.mockResolvedValue(eligibleUser({ createdAt: createdAtHoursAgo(5 / 60) }));

    const res = await withAuth(
      request(app).post("/api/withdrawals").send(VALID_BODY),
    );

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NEW_ACCOUNT_HOLD");
    expect(typeof res.body.hoursLeft).toBe("number");
    expect(res.body.hoursLeft).toBeGreaterThan(0);
    // Atomic function must NOT be called — rejection is pre-emptive.
    expect(mockCreateWithdrawalAtomic).not.toHaveBeenCalled();
  });

  it("rejects an account 47 h old (one hour before the 48 h boundary)", async () => {
    mockGetUser.mockResolvedValue(eligibleUser({ createdAt: createdAtHoursAgo(47) }));

    const res = await withAuth(
      request(app).post("/api/withdrawals").send(VALID_BODY),
    );

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NEW_ACCOUNT_HOLD");
    // hoursLeft should be 1 (ceiling of the remaining fraction).
    expect(res.body.hoursLeft).toBe(1);
    expect(mockCreateWithdrawalAtomic).not.toHaveBeenCalled();
  });

  it("does NOT use client-supplied timestamps — uses server-stored user.createdAt", async () => {
    // Simulate a user attempting to spoof their account age by controlling any
    // client-side variable. The server reads user.createdAt from the DB mock
    // regardless of anything in the request body.
    mockGetUser.mockResolvedValue(eligibleUser({ createdAt: createdAtHoursAgo(1) }));

    const res = await withAuth(
      // Even if the body included spoofed age info (which the route ignores),
      // the server must still reject based on createdAt.
      request(app).post("/api/withdrawals").send({ ...VALID_BODY, accountAge: 999 }),
    );

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NEW_ACCOUNT_HOLD");
    expect(mockCreateWithdrawalAtomic).not.toHaveBeenCalled();
  });

  it("allows a withdrawal once the account is past the 48 h hold", async () => {
    // 49 h old — just past the default hold.
    mockGetUser.mockResolvedValue(eligibleUser({ createdAt: createdAtHoursAgo(49) }));

    const res = await withAuth(
      request(app).post("/api/withdrawals").send(VALID_BODY),
    );

    expect(res.status).toBe(201);
    expect(mockCreateWithdrawalAtomic).toHaveBeenCalledTimes(1);
  });

  it("hold check uses the server's DB timestamp — account exactly at boundary (48 h) is allowed", async () => {
    // An account that is exactly 48 h old should pass the hold check.
    // The hold boundary is open on the right: age >= holdMs is allowed.
    // This confirms the server reads the hold constant correctly.
    mockGetUser.mockResolvedValue(eligibleUser({ createdAt: createdAtHoursAgo(48) }));

    const res = await withAuth(
      request(app).post("/api/withdrawals").send(VALID_BODY),
    );

    // The account cleared the hold; failure here means server enforce broke.
    expect(res.status).toBe(201);
    expect(mockCreateWithdrawalAtomic).toHaveBeenCalledTimes(1);
  });
});

// ── Daily count cap ──────────────────────────────────────────────────────────

describe("POST /api/withdrawals — daily count cap (server-side enforcement)", () => {
  it("rejects when createWithdrawalAtomic returns DAILY_COUNT_EXCEEDED", async () => {
    mockCreateWithdrawalAtomic.mockResolvedValue({
      ok: false,
      reason: "DAILY_COUNT_EXCEEDED",
      withdrawalsTodayCount: 2,
      maxPerDay: 2,
    });

    const res = await withAuth(
      request(app).post("/api/withdrawals").send(VALID_BODY),
    );

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("DAILY_COUNT_EXCEEDED");
    expect(res.body.maxPerDay).toBe(2);
  });

  it("includes today's withdrawal count in the 429 rejection body", async () => {
    mockCreateWithdrawalAtomic.mockResolvedValue({
      ok: false,
      reason: "DAILY_COUNT_EXCEEDED",
      withdrawalsTodayCount: 3,
      maxPerDay: 2,
    });

    const res = await withAuth(
      request(app).post("/api/withdrawals").send(VALID_BODY),
    );

    expect(res.status).toBe(400);
    expect(res.body.withdrawalsTodayCount).toBe(3);
  });

  it("always calls createWithdrawalAtomic — cap is checked inside the DB transaction", async () => {
    // The count gate lives inside createWithdrawalAtomic (inside a DB
    // transaction with FOR UPDATE lock), not in ad-hoc code in the route.
    // Verify the route delegates to that function and passes maxPerDay.
    mockCreateWithdrawalAtomic.mockResolvedValue({
      ok: true,
      withdrawal: { id: "w-2", status: "pending", amount: "3.00", totalPayout: "3.00" },
      balance: 4,
      withdrawalsTodayCount: 1,
    });

    await withAuth(request(app).post("/api/withdrawals").send(VALID_BODY));

    expect(mockCreateWithdrawalAtomic).toHaveBeenCalledTimes(1);
    const callArgs = mockCreateWithdrawalAtomic.mock.calls[0][0] as Record<string, unknown>;
    // maxPerDay carries the server constant (MAX_WITHDRAWALS_PER_DAY, default 2).
    expect(typeof callArgs["maxPerDay"]).toBe("number");
    expect((callArgs["maxPerDay"] as number)).toBeGreaterThanOrEqual(1);
    // dayStart must be a Date set to today's UTC midnight.
    const dayStart = callArgs["dayStart"] as Date;
    expect(dayStart instanceof Date).toBe(true);
    expect(dayStart.getUTCHours()).toBe(0);
    expect(dayStart.getUTCMinutes()).toBe(0);
    expect(dayStart.getUTCSeconds()).toBe(0);
  });

  it("rejects on DAILY_CAP_EXCEEDED (per-user dollar cap) with 400", async () => {
    mockCreateWithdrawalAtomic.mockResolvedValue({
      ok: false,
      reason: "DAILY_CAP_EXCEEDED",
      withdrawnToday: 7,
      remaining: 0,
    });

    const res = await withAuth(
      request(app).post("/api/withdrawals").send(VALID_BODY),
    );

    expect(res.status).toBe(400);
    expect(res.body.dailyLimit).toBeDefined();
    expect(res.body.remaining).toBe(0);
  });

  it("rejects on FLOAT_EXCEEDED (system-wide payout cap) with 429", async () => {
    mockCreateWithdrawalAtomic.mockResolvedValue({
      ok: false,
      reason: "FLOAT_EXCEEDED",
      floatMax: 60,
      paidOutToday: 60,
      remaining: 0,
    });

    const res = await withAuth(
      request(app).post("/api/withdrawals").send(VALID_BODY),
    );

    expect(res.status).toBe(429);
    expect(res.body.code).toBe("PAYOUT_FLOAT_REACHED");
  });

  it("allows the first withdrawal when under the cap and past the hold", async () => {
    const res = await withAuth(
      request(app).post("/api/withdrawals").send(VALID_BODY),
    );

    expect(res.status).toBe(201);
    expect(res.body.withdrawal).toBeDefined();
  });
});
