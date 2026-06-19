/**
 * PayPal-not-configured withdrawal rejection test.
 *
 * The guard at the top of POST /api/withdrawals (after auth and account-hold
 * checks) calls `isPayPalConfigured()` and returns 503 + code
 * "PAYPAL_NOT_CONFIGURED" when PayPal credentials are absent.  This must
 * happen BEFORE `storage.createWithdrawalAtomic()` is called so no orphaned
 * pending-withdrawal records are created.
 *
 * A regression that removes or re-orders the guard would allow users to create
 * dangling DB rows, see confusing 500 errors, or bypass the check entirely.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

const USER_ID = "user-paypal-guard-test";
const JWT_SECRET = "test-jwt-secret-for-paypal-guard-tests-padded-to-64xxxxxxxx";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockGetUser = vi.fn();
const mockGetUserWithdrawals = vi.fn();
const mockCreateWithdrawalAtomic = vi.fn();
const mockIsPayPalConfigured = vi.fn();

vi.mock("../paypal", () => ({
  isPayPalConfigured: (...args: unknown[]) => mockIsPayPalConfigured(...args),
  isPayPalWebhookConfigured: vi.fn().mockReturnValue(false),
  sendPayPalPayout: vi.fn(),
  verifyPayPalWebhook: vi.fn(),
  getPayPalApiBase: vi.fn().mockReturnValue("https://api-m.sandbox.paypal.com"),
}));

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

// ── Setup ────────────────────────────────────────────────────────────────────

let app: Express;
let userToken: string;

/** A fully-eligible user: old account, profile complete. */
function eligibleUser(): Record<string, unknown> {
  return {
    id: USER_ID,
    role: "user",
    tokenVersion: 0,
    email: "user@example.com",
    username: "testuser",
    profileComplete: true,
    referredBy: null,
    // 72 h > 48 h hold → new-account gate passes
    createdAt: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(),
  };
}

const VALID_BODY = { amount: 3, paypalEmail: "user@paypal.com" };

beforeAll(async () => {
  process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";
  process.env["JWT_ACCESS_SECRET"] = JWT_SECRET;
  delete process.env["ADMIN_TOKEN"];

  userToken = jwt.sign(
    { userId: USER_ID, role: "user", tokenVersion: 0 },
    JWT_SECRET,
    { expiresIn: "1h" },
  );

  vi.resetModules();
  const { registerRoutes } = await import("./cashclip");
  app = express();
  app.use(express.json());
  await registerRoutes(app);

  // Warm-up: let any lazy module singletons initialize before the first timed
  // test.  Use PayPal=configured + ok:true so it reaches createWithdrawalAtomic
  // and all initialization paths fire.
  mockIsPayPalConfigured.mockReturnValue(true);
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
  // Default: PayPal NOT configured (the scenario under test).
  mockIsPayPalConfigured.mockReturnValue(false);
  // Default user: fully eligible so only the PayPal guard can block.
  mockGetUser.mockResolvedValue(eligibleUser());
  mockGetUserWithdrawals.mockResolvedValue([]);
  // createWithdrawalAtomic should never be reached; set a guard return anyway.
  mockCreateWithdrawalAtomic.mockResolvedValue({ ok: false, reason: "SHOULD_NOT_BE_CALLED" });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/withdrawals — PayPal-not-configured guard", () => {
  it("returns 503 with code PAYPAL_NOT_CONFIGURED when PayPal is unconfigured", async () => {
    const res = await request(app)
      .post("/api/withdrawals")
      .set("Authorization", `Bearer ${userToken}`)
      .send(VALID_BODY);

    expect(res.status).toBe(503);
    expect(res.body.code).toBe("PAYPAL_NOT_CONFIGURED");
  });

  it("does NOT call createWithdrawalAtomic — no DB record is created", async () => {
    await request(app)
      .post("/api/withdrawals")
      .set("Authorization", `Bearer ${userToken}`)
      .send(VALID_BODY);

    expect(mockCreateWithdrawalAtomic).not.toHaveBeenCalled();
  });

  it("includes a user-friendly error message in the 503 body", async () => {
    const res = await request(app)
      .post("/api/withdrawals")
      .set("Authorization", `Bearer ${userToken}`)
      .send(VALID_BODY);

    expect(res.status).toBe(503);
    expect(typeof res.body.error).toBe("string");
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  it("rejects regardless of the requested withdrawal amount (all valid tiers)", async () => {
    // Valid tiers are $3, $5, $7 — amounts outside these are rejected by the
    // tier-validation guard before the PayPal check, so only test valid ones.
    for (const amount of [3, 5, 7]) {
      const res = await request(app)
        .post("/api/withdrawals")
        .set("Authorization", `Bearer ${userToken}`)
        .send({ amount, paypalEmail: "user@paypal.com" });

      expect(res.status).toBe(503);
      expect(res.body.code).toBe("PAYPAL_NOT_CONFIGURED");
    }
    expect(mockCreateWithdrawalAtomic).not.toHaveBeenCalled();
  });

  it("allows withdrawal to proceed past the guard when PayPal IS configured", async () => {
    // Flip the mock: now PayPal is configured.
    mockIsPayPalConfigured.mockReturnValue(true);
    mockCreateWithdrawalAtomic.mockResolvedValue({
      ok: true,
      withdrawal: { id: "w-ok", status: "pending", amount: "3.00", totalPayout: "3.00" },
      balance: 7,
      withdrawalsTodayCount: 1,
    });

    const res = await request(app)
      .post("/api/withdrawals")
      .set("Authorization", `Bearer ${userToken}`)
      .send(VALID_BODY);

    // The guard is cleared; the route proceeds normally.
    expect(res.status).toBe(201);
    expect(mockCreateWithdrawalAtomic).toHaveBeenCalledTimes(1);
  });
});
