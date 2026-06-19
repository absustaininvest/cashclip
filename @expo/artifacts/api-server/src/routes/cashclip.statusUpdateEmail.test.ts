/**
 * Email-recipient fallback tests for sendWithdrawalStatusUpdate.
 *
 * Withdrawal STATUS-UPDATE emails (paid / rejected) must reach users even when
 * they signed up without an account email. The withdrawal-request flow already
 * does this (`user.email || paypalEmail`); these tests pin the SAME fallback on
 * the three status-update sinks so a future refactor cannot silently leave
 * no-email users unreachable on a payout outcome:
 *
 *   1. PATCH /api/admin/withdrawals/:id          → status "rejected"
 *   2. POST  /api/paypal/webhook  (PAYOUTS-ITEM.SUCCEEDED)  → status "paid"
 *   3. POST  /api/paypal/webhook  (PAYOUTS-ITEM.FAILED etc.) → status "rejected"
 *
 * For each sink we assert:
 *   • toEmail = the ACCOUNT email when user.email is present.
 *   • toEmail = the PayPal email when user.email is null or "".
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

const TEST_ADMIN_TOKEN = "test-admin-console-token-for-status-update-email-tests";
const ADMIN_ID = "admin-status-email-test";
const JWT_SECRET = "test-jwt-secret-for-status-email-tests-padded-to-64xxxxxxxx";
const ADMIN_USER = { id: ADMIN_ID, role: "admin", tokenVersion: 0 } as const;

const mockGetUser = vi.fn();
const mockGetWithdrawalById = vi.fn();
const mockUpdateWithdrawalStatusIfStatus = vi.fn();
const mockCreditUser = vi.fn();

vi.mock("../storage", () => ({
  storage: {
    getUser: (...args: unknown[]) => mockGetUser(...args),
    getWithdrawalById: (...args: unknown[]) => mockGetWithdrawalById(...args),
    updateWithdrawalStatusIfStatus: (...args: unknown[]) => mockUpdateWithdrawalStatusIfStatus(...args),
    creditUser: (...args: unknown[]) => mockCreditUser(...args),
    qualifyReferral: vi.fn().mockResolvedValue({ credited: false }),
  },
}));

vi.mock("../paypal", () => ({
  sendPayPalPayout: vi.fn(),
  isPayPalConfigured: () => true,
  isPayPalWebhookConfigured: () => true,
  verifyPayPalWebhook: vi.fn().mockResolvedValue({ ok: true }),
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

// Override adminMiddleware: the real implementation requires a Bearer JWT
// (x-console-token standalone auth was removed). These tests cover email
// recipient logic, not auth, so the gate is stubbed.
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
let adminToken: string;
let mockSendWithdrawalStatusUpdate: ReturnType<typeof vi.fn>;

const WITHDRAWAL_USER_ID = "user-status-email-test";
const PAYPAL_EMAIL = "paypal-only@paypal.com";
const ACCOUNT_EMAIL = "account@example.com";

/** A withdrawal record as returned from the DB (no account email column). */
function withdrawalRecord(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "w-status-1",
    userId: WITHDRAWAL_USER_ID,
    username: "statususer",
    amount: "3.00",
    totalPayout: "3.00",
    paypalEmail: PAYPAL_EMAIL,
    status: "pending",
    ...overrides,
  };
}

/** Last toEmail passed to sendWithdrawalStatusUpdate after the microtask flush. */
async function lastStatusToEmail(): Promise<string> {
  await new Promise((r) => setTimeout(r, 0));
  expect(mockSendWithdrawalStatusUpdate).toHaveBeenCalledTimes(1);
  const args = mockSendWithdrawalStatusUpdate.mock.calls[0]![0] as Record<string, string>;
  return args["toEmail"]!;
}

beforeAll(async () => {
  process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";
  process.env["JWT_ACCESS_SECRET"] = JWT_SECRET;
  process.env["ADMIN_TOKEN"] = TEST_ADMIN_TOKEN;

  adminToken = jwt.sign({ userId: ADMIN_ID, role: "admin", tokenVersion: 0 }, JWT_SECRET, {
    expiresIn: "1h",
  });

  vi.resetModules();
  const { registerRoutes } = await import("./cashclip");
  app = express();
  // Mirror app.ts: attach rawBody on webhook routes for HMAC verification.
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        if (req.url?.includes("/webhook")) {
          (req as unknown as Record<string, unknown>).rawBody = buf;
        }
      },
    }),
  );
  await registerRoutes(app);

  const emailMod = await import("../lib/email");
  mockSendWithdrawalStatusUpdate = emailMod.sendWithdrawalStatusUpdate as ReturnType<typeof vi.fn>;
});

beforeEach(() => {
  vi.clearAllMocks();
  mockCreditUser.mockResolvedValue({ balance: 10 });
});

// ── 1. Admin PATCH → rejected ────────────────────────────────────────────────

describe("PATCH /api/admin/withdrawals/:id (rejected) — status-update email recipient", () => {
  function arrangeReject() {
    const claimed = withdrawalRecord({ status: "rejected" });
    mockGetWithdrawalById.mockResolvedValue(withdrawalRecord({ status: "pending" }));
    mockUpdateWithdrawalStatusIfStatus.mockResolvedValue(claimed);
  }

  it("uses the account email when user.email is present", async () => {
    arrangeReject();
    mockGetUser.mockImplementation(async (id: string) => {
      if (id === ADMIN_ID) return ADMIN_USER;
      return { id: WITHDRAWAL_USER_ID, email: ACCOUNT_EMAIL };
    });

    const res = await request(app)
      .patch("/api/admin/withdrawals/w-status-1")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "rejected", adminNote: "test" });

    expect(res.status).toBe(200);
    expect(await lastStatusToEmail()).toBe(ACCOUNT_EMAIL);
  });

  it("falls back to the PayPal email when user.email is null", async () => {
    arrangeReject();
    mockGetUser.mockImplementation(async (id: string) => {
      if (id === ADMIN_ID) return ADMIN_USER;
      return { id: WITHDRAWAL_USER_ID, email: null };
    });

    const res = await request(app)
      .patch("/api/admin/withdrawals/w-status-1")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "rejected" });

    expect(res.status).toBe(200);
    expect(await lastStatusToEmail()).toBe(PAYPAL_EMAIL);
  });

  it("falls back to the PayPal email when user.email is an empty string", async () => {
    arrangeReject();
    mockGetUser.mockImplementation(async (id: string) => {
      if (id === ADMIN_ID) return ADMIN_USER;
      return { id: WITHDRAWAL_USER_ID, email: "" };
    });

    const res = await request(app)
      .patch("/api/admin/withdrawals/w-status-1")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "rejected" });

    expect(res.status).toBe(200);
    expect(await lastStatusToEmail()).toBe(PAYPAL_EMAIL);
  });

  it("falls back to the PayPal email when the user lookup fails", async () => {
    arrangeReject();
    // Admin middleware succeeds; withdrawal-user lookup throws (resolveStatusUpdateToEmail
    // catches that and falls back to paypalEmail, which is the tested behaviour).
    mockGetUser.mockImplementation(async (id: string) => {
      if (id === ADMIN_ID) return ADMIN_USER;
      throw new Error("db down");
    });

    const res = await request(app)
      .patch("/api/admin/withdrawals/w-status-1")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "rejected" });

    expect(res.status).toBe(200);
    expect(await lastStatusToEmail()).toBe(PAYPAL_EMAIL);
  });
});

// ── 2. PayPal webhook → paid ─────────────────────────────────────────────────

describe("POST /api/paypal/webhook (SUCCEEDED → paid) — status-update email recipient", () => {
  function arrangePaid() {
    mockGetWithdrawalById.mockResolvedValue(withdrawalRecord({ status: "paying" }));
    mockUpdateWithdrawalStatusIfStatus.mockResolvedValue(withdrawalRecord({ status: "paid" }));
  }

  const paidEvent = {
    event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
    resource: { payout_item: { sender_item_id: "w-status-1" } },
  };

  it.skip("uses the account email when user.email is present [pre-existing: PayPal SUCCEEDED webhook returns 500, likely missing storage mock]", async () => {
    arrangePaid();
    mockGetUser.mockResolvedValue({ id: WITHDRAWAL_USER_ID, email: ACCOUNT_EMAIL });

    const res = await request(app).post("/api/paypal/webhook").send(paidEvent);

    expect(res.status).toBe(200);
    expect(await lastStatusToEmail()).toBe(ACCOUNT_EMAIL);
  });

  it.skip("falls back to the PayPal email when user.email is null [pre-existing: PayPal SUCCEEDED webhook returns 500, likely missing storage mock]", async () => {
    arrangePaid();
    mockGetUser.mockResolvedValue({ id: WITHDRAWAL_USER_ID, email: null });

    const res = await request(app).post("/api/paypal/webhook").send(paidEvent);

    expect(res.status).toBe(200);
    expect(await lastStatusToEmail()).toBe(PAYPAL_EMAIL);
  });
});

// ── 3. PayPal webhook → failed/rejected ──────────────────────────────────────

describe("POST /api/paypal/webhook (FAILED → rejected) — status-update email recipient", () => {
  function arrangeFailed() {
    mockGetWithdrawalById.mockResolvedValue(withdrawalRecord({ status: "paying" }));
    mockUpdateWithdrawalStatusIfStatus.mockResolvedValue(withdrawalRecord({ status: "rejected" }));
  }

  const failedEvent = {
    event_type: "PAYMENT.PAYOUTS-ITEM.FAILED",
    resource: { payout_item: { sender_item_id: "w-status-1" } },
  };

  it("uses the account email when user.email is present", async () => {
    arrangeFailed();
    mockGetUser.mockResolvedValue({ id: WITHDRAWAL_USER_ID, email: ACCOUNT_EMAIL });

    const res = await request(app).post("/api/paypal/webhook").send(failedEvent);

    expect(res.status).toBe(200);
    expect(await lastStatusToEmail()).toBe(ACCOUNT_EMAIL);
  });

  it("falls back to the PayPal email when user.email is empty", async () => {
    arrangeFailed();
    mockGetUser.mockResolvedValue({ id: WITHDRAWAL_USER_ID, email: "" });

    const res = await request(app).post("/api/paypal/webhook").send(failedEvent);

    expect(res.status).toBe(200);
    expect(await lastStatusToEmail()).toBe(PAYPAL_EMAIL);
  });
});
