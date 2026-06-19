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
 *
 * Also covers withdrawal email delivery guarantees:
 *   • sendWithdrawalRequestedUser fires for every payout tier ($3/$5/$7).
 *   • sendWithdrawalRequestedAdmin fires only for the $7 max tier.
 *   • sendPayPalAmbiguousAlert fires when the admin payout result is ambiguous.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

const USER_ID = "user-withdrawal-guard-test";
const ADMIN_ID = "admin-withdrawal-guard-test";
const JWT_SECRET = "test-jwt-secret-for-withdrawal-guard-tests-padded-to-64xxxxxx";
const TEST_ADMIN_TOKEN = "test-admin-console-token-for-withdrawal-email-tests";

const mockGetUser = vi.fn();
const mockGetUserWithdrawals = vi.fn();
const mockCreateWithdrawalAtomic = vi.fn();
const mockGetWithdrawalById = vi.fn();
const mockUpdateWithdrawalStatusIfStatus = vi.fn();
const mockSendPayPalPayout = vi.fn();
const mockIsPayPalConfigured = vi.fn().mockReturnValue(true);
const mockSetPaypalEmail = vi.fn();
const mockInsertUserNotification = vi.fn();

vi.mock("../storage", () => ({
  storage: {
    getUser: (...args: unknown[]) => mockGetUser(...args),
    getUserWithdrawals: (...args: unknown[]) => mockGetUserWithdrawals(...args),
    createWithdrawalAtomic: (...args: unknown[]) => mockCreateWithdrawalAtomic(...args),
    getWithdrawalById: (...args: unknown[]) => mockGetWithdrawalById(...args),
    updateWithdrawalStatusIfStatus: (...args: unknown[]) => mockUpdateWithdrawalStatusIfStatus(...args),
    setPaypalEmail: (...args: unknown[]) => mockSetPaypalEmail(...args),
    insertUserNotification: (...args: unknown[]) => mockInsertUserNotification(...args),
  },
}));

vi.mock("../paypal", () => ({
  sendPayPalPayout: (...args: unknown[]) => mockSendPayPalPayout(...args),
  isPayPalConfigured: () => mockIsPayPalConfigured(),
  isPayPalWebhookConfigured: () => true,
  verifyPayPalWebhook: vi.fn().mockResolvedValue(true),
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

// Override adminMiddleware so tests that use only x-console-token can reach
// the route handler.  The real adminMiddleware requires a Bearer JWT (the
// console-token standalone path was removed); these tests exercise payout and
// email logic, not auth, so we stub the gate and let the tests run.
vi.mock("../auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth")>();
  return {
    ...actual,
    adminMiddleware: async (req: any, _res: any, next: any) => {
      req.userId = "admin-test-user";
      req.userRole = "admin";
      next();
    },
  };
});

vi.mock("../lib/email", () => ({
  sendWithdrawalRequestedAdmin: vi.fn().mockResolvedValue(undefined),
  sendWithdrawalRequestedUser: vi.fn().mockResolvedValue(undefined),
  sendWithdrawalVelocityAdmin: vi.fn().mockResolvedValue(undefined),
  sendWithdrawalStatusUpdate: vi.fn().mockResolvedValue(undefined),
  sendSupportTicket: vi.fn().mockResolvedValue(undefined),
  sendPasswordChangedNotice: vi.fn().mockResolvedValue(undefined),
  sendAdminCreditReceipt: vi.fn().mockResolvedValue(undefined),
  sendSupportReply: vi.fn().mockResolvedValue(undefined),
  sendReferralBonusEarned: vi.fn().mockResolvedValue(undefined),
  sendPayPalAmbiguousAlert: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

let app: Express;
let userToken: string;
let adminToken: string;

// References to the mocked email functions — captured after vi.resetModules() + dynamic import
// so they point to the same instances that cashclip.ts received.
let mockSendWithdrawalRequestedUser: ReturnType<typeof vi.fn>;
let mockSendWithdrawalRequestedAdmin: ReturnType<typeof vi.fn>;
let mockSendPayPalAmbiguousAlert: ReturnType<typeof vi.fn>;

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
  process.env["ADMIN_TOKEN"] = TEST_ADMIN_TOKEN;
  delete process.env["NEW_ACCOUNT_HOLD_HOURS"];
  delete process.env["MAX_WITHDRAWALS_PER_DAY"];

  userToken = jwt.sign({ userId: USER_ID, role: "user", tokenVersion: 0 }, JWT_SECRET, {
    expiresIn: "1h",
  });

  adminToken = jwt.sign({ userId: ADMIN_ID, role: "admin", tokenVersion: 0 }, JWT_SECRET, {
    expiresIn: "1h",
  });

  vi.resetModules();
  const { registerRoutes } = await import("./cashclip");
  app = express();
  app.use(express.json());
  await registerRoutes(app);

  // Capture the mocked email functions that cashclip.ts received after reset.
  // These are the exact vi.fn() instances called by the route handlers.
  const emailMod = await import("../lib/email");
  mockSendWithdrawalRequestedUser = emailMod.sendWithdrawalRequestedUser as ReturnType<typeof vi.fn>;
  mockSendWithdrawalRequestedAdmin = emailMod.sendWithdrawalRequestedAdmin as ReturnType<typeof vi.fn>;
  mockSendPayPalAmbiguousAlert = emailMod.sendPayPalAmbiguousAlert as ReturnType<typeof vi.fn>;

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
  // adminMiddleware calls storage.getUser with the admin's userId from the JWT,
  // so the implementation must return an admin record for ADMIN_ID and the
  // regular eligible user for all other IDs.
  mockGetUser.mockImplementation(async (id: string) => {
    if (id === ADMIN_ID) return { id: ADMIN_ID, role: "admin", tokenVersion: 0 };
    return eligibleUser();
  });
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

// ── Withdrawal email delivery — user confirmation ─────────────────────────────
//
// sendWithdrawalRequestedUser must fire for every accepted tier so the user
// always receives a "we got your request" email regardless of the amount.
// sendWithdrawalRequestedAdmin must fire ONLY on the $7 (max) tier to avoid
// operator inbox noise for routine $3/$5 cashouts.

describe("POST /api/withdrawals — sendWithdrawalRequestedUser called for every tier", () => {
  function successResultFor(amountStr: string) {
    return {
      ok: true,
      withdrawal: { id: "w-email", status: "pending", amount: amountStr, totalPayout: amountStr },
      balance: 0,
      withdrawalsTodayCount: 1,
    };
  }

  it("sends user confirmation email for a $3 withdrawal", async () => {
    mockCreateWithdrawalAtomic.mockResolvedValue(successResultFor("3.00"));

    const res = await withAuth(
      request(app).post("/api/withdrawals").send({ amount: 3, paypalEmail: "user@paypal.com" }),
    );

    expect(res.status).toBe(201);
    // Fire-and-forget — give the microtask queue a tick to flush.
    await new Promise((r) => setTimeout(r, 0));
    expect(mockSendWithdrawalRequestedUser).toHaveBeenCalledTimes(1);
    const args = mockSendWithdrawalRequestedUser.mock.calls[0][0] as Record<string, string>;
    expect(args["paypalEmail"]).toBe("user@paypal.com");
    expect(args["totalPayout"]).toBe("3.00");
  });

  it("sends user confirmation email for a $5 withdrawal", async () => {
    mockCreateWithdrawalAtomic.mockResolvedValue(successResultFor("5.00"));

    const res = await withAuth(
      request(app).post("/api/withdrawals").send({ amount: 5, paypalEmail: "user@paypal.com" }),
    );

    expect(res.status).toBe(201);
    await new Promise((r) => setTimeout(r, 0));
    expect(mockSendWithdrawalRequestedUser).toHaveBeenCalledTimes(1);
    const args = mockSendWithdrawalRequestedUser.mock.calls[0][0] as Record<string, string>;
    expect(args["totalPayout"]).toBe("5.00");
  });

  it("sends user confirmation email for a $7 withdrawal", async () => {
    mockCreateWithdrawalAtomic.mockResolvedValue(successResultFor("7.00"));

    const res = await withAuth(
      request(app).post("/api/withdrawals").send({ amount: 7, paypalEmail: "user@paypal.com" }),
    );

    expect(res.status).toBe(201);
    await new Promise((r) => setTimeout(r, 0));
    expect(mockSendWithdrawalRequestedUser).toHaveBeenCalledTimes(1);
    const args = mockSendWithdrawalRequestedUser.mock.calls[0][0] as Record<string, string>;
    expect(args["totalPayout"]).toBe("7.00");
  });

  it("does NOT send user email when the withdrawal is rejected (insufficient balance)", async () => {
    mockCreateWithdrawalAtomic.mockResolvedValue({
      ok: false,
      reason: "INSUFFICIENT_BALANCE",
      balance: 1,
    });

    const res = await withAuth(
      request(app).post("/api/withdrawals").send({ amount: 3, paypalEmail: "user@paypal.com" }),
    );

    expect(res.status).toBe(400);
    await new Promise((r) => setTimeout(r, 0));
    expect(mockSendWithdrawalRequestedUser).not.toHaveBeenCalled();
  });

  it("uses the PayPal email as toEmail when user.email is null", async () => {
    mockGetUser.mockResolvedValue(eligibleUser({ email: null }));
    mockCreateWithdrawalAtomic.mockResolvedValue(successResultFor("3.00"));

    const res = await withAuth(
      request(app).post("/api/withdrawals").send({ amount: 3, paypalEmail: "paypal-only@paypal.com" }),
    );

    expect(res.status).toBe(201);
    await new Promise((r) => setTimeout(r, 0));
    expect(mockSendWithdrawalRequestedUser).toHaveBeenCalledTimes(1);
    const args = mockSendWithdrawalRequestedUser.mock.calls[0][0] as Record<string, string>;
    expect(args["toEmail"]).toBe("paypal-only@paypal.com");
  });

  it("uses the PayPal email as toEmail when user.email is an empty string", async () => {
    mockGetUser.mockResolvedValue(eligibleUser({ email: "" }));
    mockCreateWithdrawalAtomic.mockResolvedValue(successResultFor("3.00"));

    const res = await withAuth(
      request(app).post("/api/withdrawals").send({ amount: 3, paypalEmail: "paypal-only@paypal.com" }),
    );

    expect(res.status).toBe(201);
    await new Promise((r) => setTimeout(r, 0));
    expect(mockSendWithdrawalRequestedUser).toHaveBeenCalledTimes(1);
    const args = mockSendWithdrawalRequestedUser.mock.calls[0][0] as Record<string, string>;
    expect(args["toEmail"]).toBe("paypal-only@paypal.com");
  });

  it("uses the account email as toEmail when user.email is present (not PayPal email)", async () => {
    mockGetUser.mockResolvedValue(eligibleUser({ email: "account@example.com" }));
    mockCreateWithdrawalAtomic.mockResolvedValue(successResultFor("3.00"));

    const res = await withAuth(
      request(app).post("/api/withdrawals").send({ amount: 3, paypalEmail: "different@paypal.com" }),
    );

    expect(res.status).toBe(201);
    await new Promise((r) => setTimeout(r, 0));
    expect(mockSendWithdrawalRequestedUser).toHaveBeenCalledTimes(1);
    const args = mockSendWithdrawalRequestedUser.mock.calls[0][0] as Record<string, string>;
    expect(args["toEmail"]).toBe("account@example.com");
  });
});

// ── Withdrawal email delivery — admin notification ────────────────────────────
//
// sendWithdrawalRequestedAdmin is intentionally gated to max-tier ($7) only.
// Removing this gate would flood the operator inbox on every $3/$5 cashout.

describe("POST /api/withdrawals — sendWithdrawalRequestedAdmin only for $7 (max tier)", () => {
  function successResultFor(amountStr: string) {
    return {
      ok: true,
      withdrawal: { id: "w-admin", status: "pending", amount: amountStr, totalPayout: amountStr },
      balance: 0,
      withdrawalsTodayCount: 1,
    };
  }

  it("does NOT send admin email for a $3 withdrawal", async () => {
    mockCreateWithdrawalAtomic.mockResolvedValue(successResultFor("3.00"));

    const res = await withAuth(
      request(app).post("/api/withdrawals").send({ amount: 3, paypalEmail: "user@paypal.com" }),
    );

    expect(res.status).toBe(201);
    await new Promise((r) => setTimeout(r, 0));
    expect(mockSendWithdrawalRequestedAdmin).not.toHaveBeenCalled();
  });

  it("does NOT send admin email for a $5 withdrawal", async () => {
    mockCreateWithdrawalAtomic.mockResolvedValue(successResultFor("5.00"));

    const res = await withAuth(
      request(app).post("/api/withdrawals").send({ amount: 5, paypalEmail: "user@paypal.com" }),
    );

    expect(res.status).toBe(201);
    await new Promise((r) => setTimeout(r, 0));
    expect(mockSendWithdrawalRequestedAdmin).not.toHaveBeenCalled();
  });

  it("sends admin email for the $7 max-tier withdrawal", async () => {
    mockCreateWithdrawalAtomic.mockResolvedValue(successResultFor("7.00"));

    const res = await withAuth(
      request(app).post("/api/withdrawals").send({ amount: 7, paypalEmail: "user@paypal.com" }),
    );

    expect(res.status).toBe(201);
    await new Promise((r) => setTimeout(r, 0));
    expect(mockSendWithdrawalRequestedAdmin).toHaveBeenCalledTimes(1);
    const args = mockSendWithdrawalRequestedAdmin.mock.calls[0][0] as Record<string, string>;
    expect(args["amount"]).toBe("7.00");
  });

  it("sends BOTH user and admin emails for the $7 tier in the same request", async () => {
    mockCreateWithdrawalAtomic.mockResolvedValue(successResultFor("7.00"));

    const res = await withAuth(
      request(app).post("/api/withdrawals").send({ amount: 7, paypalEmail: "user@paypal.com" }),
    );

    expect(res.status).toBe(201);
    await new Promise((r) => setTimeout(r, 0));
    expect(mockSendWithdrawalRequestedUser).toHaveBeenCalledTimes(1);
    expect(mockSendWithdrawalRequestedAdmin).toHaveBeenCalledTimes(1);
  });
});

// ── Admin payout — sendPayPalAmbiguousAlert on uncertain outcome ───────────────
//
// When PayPal accepts the request but the response is ambiguous (timeout,
// network drop, duplicate batch), the route must alert the operator so they
// can resolve the withdrawal manually rather than silently leaving it stuck.

describe("POST /api/admin/withdrawals/:id/payout — sendPayPalAmbiguousAlert on ambiguous result", () => {
  const WITHDRAWAL_ID = "w-ambiguous-test";
  const BATCH_ID = "cashclip_w-ambiguous-test";

  function adminRequest() {
    return request(app)
      .post(`/api/admin/withdrawals/${WITHDRAWAL_ID}/payout`)
      .set("Authorization", `Bearer ${adminToken}`);
  }

  function pendingWithdrawal(overrides: Record<string, unknown> = {}) {
    return {
      id: WITHDRAWAL_ID,
      status: "pending",
      amount: "3.00",
      totalPayout: "3.00",
      paypalEmail: "user@paypal.com",
      username: "testuser",
      paypalBatchId: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    mockGetWithdrawalById.mockResolvedValue(pendingWithdrawal());
    mockUpdateWithdrawalStatusIfStatus.mockResolvedValue(pendingWithdrawal({ status: "paying" }));
    mockSendPayPalPayout.mockResolvedValue({ success: true, batchId: BATCH_ID });
  });

  it("fires sendPayPalAmbiguousAlert and returns 503 when result.ambiguous is true", async () => {
    mockSendPayPalPayout.mockResolvedValue({
      success: false,
      ambiguous: true,
      error: "Network timeout after dispatch",
    });

    const res = await adminRequest().send();

    expect(res.status).toBe(503);
    await new Promise((r) => setTimeout(r, 0));
    expect(mockSendPayPalAmbiguousAlert).toHaveBeenCalledTimes(1);
    const args = mockSendPayPalAmbiguousAlert.mock.calls[0][0] as Record<string, string>;
    expect(args["withdrawalId"]).toBe(WITHDRAWAL_ID);
  });

  it("includes the withdrawal ID and batch ID in the ambiguous alert payload", async () => {
    mockSendPayPalPayout.mockResolvedValue({
      success: false,
      ambiguous: true,
      error: "Connection dropped",
    });
    // Simulate a pre-assigned batchId on the withdrawal so the stable ID path is exercised.
    mockGetWithdrawalById.mockResolvedValue(pendingWithdrawal({ paypalBatchId: BATCH_ID }));
    mockUpdateWithdrawalStatusIfStatus.mockResolvedValue(
      pendingWithdrawal({ status: "paying", paypalBatchId: BATCH_ID }),
    );

    await adminRequest().send();
    await new Promise((r) => setTimeout(r, 0));

    expect(mockSendPayPalAmbiguousAlert).toHaveBeenCalledTimes(1);
    const args = mockSendPayPalAmbiguousAlert.mock.calls[0][0] as Record<string, string>;
    expect(args["withdrawalId"]).toBe(WITHDRAWAL_ID);
    expect(args["paypalBatchId"]).toBe(BATCH_ID);
  });

  it("does NOT fire sendPayPalAmbiguousAlert on a clean success", async () => {
    mockSendPayPalPayout.mockResolvedValue({ success: true, batchId: BATCH_ID });
    // After success, getWithdrawalById is called again to return the fresh record.
    mockGetWithdrawalById
      .mockResolvedValueOnce(pendingWithdrawal())
      .mockResolvedValueOnce(pendingWithdrawal({ status: "paying" }));

    const res = await adminRequest().send();

    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 0));
    expect(mockSendPayPalAmbiguousAlert).not.toHaveBeenCalled();
  });

  it("does NOT fire sendPayPalAmbiguousAlert on a clean failure (non-ambiguous)", async () => {
    mockSendPayPalPayout.mockResolvedValue({
      success: false,
      ambiguous: false,
      error: "Recipient not found",
    });

    const res = await adminRequest().send();

    expect(res.status).toBe(500);
    await new Promise((r) => setTimeout(r, 0));
    expect(mockSendPayPalAmbiguousAlert).not.toHaveBeenCalled();
  });

  it("returns 400 and does not call sendPayPalPayout when PayPal is not configured", async () => {
    mockIsPayPalConfigured.mockReturnValue(false);

    const res = await adminRequest().send();

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringContaining("PayPal") });
    expect(mockSendPayPalPayout).not.toHaveBeenCalled();

    mockIsPayPalConfigured.mockReturnValue(true);
  });
});

// ── PayPal credential guard — user-facing withdrawal route ────────────────────
//
// POST /api/withdrawals must return 503 with code PAYPAL_NOT_CONFIGURED when
// isPayPalConfigured() is false. The guard must fire BEFORE any DB write so
// createWithdrawalAtomic is never called when credentials are missing.

describe("POST /api/withdrawals — isPayPalConfigured() guard", () => {
  it("returns 503 with PAYPAL_NOT_CONFIGURED and does not call createWithdrawalAtomic when PayPal is not configured", async () => {
    mockIsPayPalConfigured.mockReturnValue(false);

    const res = await withAuth(
      request(app).post("/api/withdrawals").send(VALID_BODY),
    );

    expect(res.status).toBe(503);
    expect(res.body.code).toBe("PAYPAL_NOT_CONFIGURED");
    // The guard must fire before any DB write — no atomic transaction attempted.
    expect(mockCreateWithdrawalAtomic).not.toHaveBeenCalled();

    mockIsPayPalConfigured.mockReturnValue(true);
  });
});

// ── PayPal email validation ───────────────────────────────────────────────────
//
// POST /api/withdrawals must reject clearly malformed paypalEmail values with
// a 4xx before any DB write. A broken destination address must never reach
// createWithdrawalAtomic — the rejection must be pre-emptive, server-side,
// and not rely on PayPal's own API to surface the error later.

describe("POST /api/withdrawals — paypalEmail input validation", () => {
  const INVALID_EMAILS: Array<{ label: string; value: unknown }> = [
    { label: "empty string",          value: "" },
    { label: "absent field (null)",   value: null },
    { label: "no @ sign",             value: "notanemail" },
    { label: "starts with @",         value: "@nodomain" },
    { label: "missing domain part",   value: "user@" },
    { label: "whitespace only",       value: "   " },
    { label: "@ with space in local", value: "user name@example.com" },
    { label: "double-@ address",      value: "user@@example.com" },
  ];

  for (const { label, value } of INVALID_EMAILS) {
    it(`rejects paypalEmail "${label}" with 400 and does not call createWithdrawalAtomic`, async () => {
      const res = await withAuth(
        request(app)
          .post("/api/withdrawals")
          .send({ amount: 3, paypalEmail: value }),
      );

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      // Must never reach the DB write path.
      expect(mockCreateWithdrawalAtomic).not.toHaveBeenCalled();
    });
  }

  it("accepts a well-formed paypalEmail and proceeds to createWithdrawalAtomic", async () => {
    const res = await withAuth(
      request(app)
        .post("/api/withdrawals")
        .send({ amount: 3, paypalEmail: "valid.user+tag@paypal.com" }),
    );

    expect(res.status).toBe(201);
    expect(mockCreateWithdrawalAtomic).toHaveBeenCalledTimes(1);
  });
});

// ── Fake / implausible PayPal email domain — user-facing withdrawal ───────────
//
// POST /api/withdrawals must also reject syntactically valid but clearly fake
// domains: single-character labels, single-character TLDs, and known disposable
// providers. These pass the bare format regex but would produce PayPal failures
// or fund fake accounts. Rejection must be pre-emptive — createWithdrawalAtomic
// must NOT be called for any of these inputs.

describe("POST /api/withdrawals — fake/implausible PayPal domain rejection", () => {
  const FAKE_DOMAIN_EMAILS: Array<{ label: string; value: string }> = [
    { label: "single-char SLD (a.co)",                value: "user@a.co" },
    { label: "single-char TLD (domain.x)",            value: "user@domain.x" },
    { label: "both labels single-char (x.y)",         value: "user@x.y" },
    { label: "three-part, one label 1-char",          value: "user@ab.c.com" },
    { label: "short SLD + non-trusted TLD (aaa.co)",  value: "user@aaa.co" },
    { label: "short SLD + non-trusted TLD (ab.cc)",   value: "user@ab.cc" },
    { label: "short SLD + non-trusted TLD (xyz.biz)", value: "user@xyz.biz" },
    { label: "known disposable: mailinator.com",      value: "user@mailinator.com" },
    { label: "known disposable: yopmail.com",         value: "user@yopmail.com" },
    { label: "known disposable: trashmail.net",       value: "user@trashmail.net" },
    { label: "known disposable: guerrillamail.com",   value: "user@guerrillamail.com" },
  ];

  for (const { label, value } of FAKE_DOMAIN_EMAILS) {
    it(`rejects "${label}" with 400 and does not call createWithdrawalAtomic`, async () => {
      const res = await withAuth(
        request(app)
          .post("/api/withdrawals")
          .send({ amount: 3, paypalEmail: value }),
      );

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
      expect(res.body.code).toBe("INVALID_PAYPAL_EMAIL");
      expect(mockCreateWithdrawalAtomic).not.toHaveBeenCalled();
    });
  }

  it("accepts a plausible domain with short but valid multi-label structure (ox.ac.uk)", async () => {
    const res = await withAuth(
      request(app)
        .post("/api/withdrawals")
        .send({ amount: 3, paypalEmail: "user@ox.ac.uk" }),
    );

    expect(res.status).toBe(201);
    expect(mockCreateWithdrawalAtomic).toHaveBeenCalledTimes(1);
  });

  it("accepts a short SLD on a trusted TLD (aol.com) — real email provider", async () => {
    const res = await withAuth(
      request(app)
        .post("/api/withdrawals")
        .send({ amount: 3, paypalEmail: "user@aol.com" }),
    );

    expect(res.status).toBe(201);
    expect(mockCreateWithdrawalAtomic).toHaveBeenCalledTimes(1);
  });

  it("accepts a short SLD on a trusted TLD (qq.com) — real email provider", async () => {
    const res = await withAuth(
      request(app)
        .post("/api/withdrawals")
        .send({ amount: 3, paypalEmail: "user@qq.com" }),
    );

    expect(res.status).toBe(201);
    expect(mockCreateWithdrawalAtomic).toHaveBeenCalledTimes(1);
  });
});

// ── Admin payout — stored email re-validation ─────────────────────────────────
//
// POST /api/admin/withdrawals/:id/payout must re-validate the stored paypalEmail
// before dispatching to PayPal. Records inserted via migration or direct DB
// writes may contain bad addresses; a 400 must be returned before any state
// mutation or PayPal API call so the issue surfaces clearly instead of producing
// an ambiguous PayPal error or a failed payout.

describe("POST /api/admin/withdrawals/:id/payout — stored email re-validation", () => {
  const VALID_WITHDRAWAL = {
    id: "wd-email-guard",
    userId: USER_ID,
    username: "testuser",
    status: "pending",
    amount: "3.00",
    totalPayout: "3.00",
    paypalEmail: "user@paypal.com",
    paypalBatchId: null,
  };

  const INVALID_STORED_EMAILS: Array<{ label: string; paypalEmail: unknown }> = [
    { label: "empty string",        paypalEmail: "" },
    { label: "null",                paypalEmail: null },
    { label: "no @ sign",           paypalEmail: "notanemail" },
    { label: "missing domain part", paypalEmail: "user@" },
    { label: "whitespace only",     paypalEmail: "   " },
    { label: "double-@ address",    paypalEmail: "user@@example.com" },
  ];

  for (const { label, paypalEmail } of INVALID_STORED_EMAILS) {
    it(`returns 400 and does NOT call sendPayPalPayout when stored email is "${label}"`, async () => {
      mockGetWithdrawalById.mockResolvedValue({ ...VALID_WITHDRAWAL, paypalEmail });

      const res = await request(app)
        .post("/api/admin/withdrawals/wd-email-guard/payout")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid/i);
      expect(mockSendPayPalPayout).not.toHaveBeenCalled();
      expect(mockUpdateWithdrawalStatusIfStatus).not.toHaveBeenCalled();
    });
  }

  const FAKE_STORED_EMAILS: Array<{ label: string; paypalEmail: string }> = [
    { label: "single-char SLD (user@a.co)",              paypalEmail: "user@a.co" },
    { label: "single-char TLD (user@domain.x)",          paypalEmail: "user@domain.x" },
    { label: "both labels 1-char (user@x.y)",            paypalEmail: "user@x.y" },
    { label: "short SLD + non-trusted TLD (aaa.co)",     paypalEmail: "user@aaa.co" },
    { label: "short SLD + non-trusted TLD (ab.cc)",      paypalEmail: "user@ab.cc" },
    { label: "known disposable: mailinator.com",         paypalEmail: "user@mailinator.com" },
    { label: "known disposable: guerrillamail.com",      paypalEmail: "user@guerrillamail.com" },
  ];

  for (const { label, paypalEmail } of FAKE_STORED_EMAILS) {
    it(`returns 400 and does NOT call sendPayPalPayout when stored email has fake domain "${label}"`, async () => {
      mockGetWithdrawalById.mockResolvedValue({ ...VALID_WITHDRAWAL, paypalEmail });

      const res = await request(app)
        .post("/api/admin/withdrawals/wd-email-guard/payout")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
      expect(mockSendPayPalPayout).not.toHaveBeenCalled();
      expect(mockUpdateWithdrawalStatusIfStatus).not.toHaveBeenCalled();
    });
  }

  it("proceeds past email validation for a well-formed stored email", async () => {
    mockGetWithdrawalById.mockResolvedValue(VALID_WITHDRAWAL);
    mockUpdateWithdrawalStatusIfStatus.mockResolvedValue({ ...VALID_WITHDRAWAL, status: "paying" });
    mockSendPayPalPayout.mockResolvedValue({ success: true, batchId: "batch-123" });
    mockGetWithdrawalById
      .mockResolvedValueOnce(VALID_WITHDRAWAL)
      .mockResolvedValueOnce({ ...VALID_WITHDRAWAL, status: "paying" });

    const res = await request(app)
      .post("/api/admin/withdrawals/wd-email-guard/payout")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(mockSendPayPalPayout).toHaveBeenCalledTimes(1);
    expect(mockSendPayPalPayout).toHaveBeenCalledWith(
      VALID_WITHDRAWAL.id,
      VALID_WITHDRAWAL.paypalEmail,
      expect.any(String),
      expect.any(String),
      expect.any(String),
    );
    expect(res.status).toBe(200);
  });
});

// ── PayPal email save — consistent error code at point of entry ────────────────
//
// POST /api/profile/paypal-email runs the same format-regex and
// isPlausiblePayPalDomain checks as the withdrawal route, so it must return the
// same machine-readable code ("INVALID_PAYPAL_EMAIL") on rejection. This lets
// the client show one consistent message and reject a bad address when the user
// first saves it — not only later at withdrawal time. A legitimate multi-label
// address must proceed to storage.setPaypalEmail.

describe("POST /api/profile/paypal-email — INVALID_PAYPAL_EMAIL code parity", () => {
  beforeEach(() => {
    // Fresh user with no PayPal email yet so the save path is reachable.
    mockGetUser.mockResolvedValue(eligibleUser({ paypalEmail: null }));
    mockSetPaypalEmail.mockResolvedValue({ ok: true });
    mockInsertUserNotification.mockResolvedValue(undefined);
  });

  it("returns 400 INVALID_PAYPAL_EMAIL for a known disposable domain and does not call setPaypalEmail", async () => {
    const res = await withAuth(
      request(app).post("/api/profile/paypal-email").send({ email: "user@mailinator.com" }),
    );

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_PAYPAL_EMAIL");
    expect(mockSetPaypalEmail).not.toHaveBeenCalled();
  });

  it("returns 400 INVALID_PAYPAL_EMAIL for a short SLD on an untrusted TLD and does not call setPaypalEmail", async () => {
    const res = await withAuth(
      request(app).post("/api/profile/paypal-email").send({ email: "user@aaa.co" }),
    );

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_PAYPAL_EMAIL");
    expect(mockSetPaypalEmail).not.toHaveBeenCalled();
  });

  it("proceeds to storage.setPaypalEmail for a legitimate multi-label address", async () => {
    const res = await withAuth(
      request(app).post("/api/profile/paypal-email").send({ email: "user@ox.ac.uk" }),
    );

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockSetPaypalEmail).toHaveBeenCalledTimes(1);
    expect(mockSetPaypalEmail).toHaveBeenCalledWith(USER_ID, "user@ox.ac.uk");
  });
});
