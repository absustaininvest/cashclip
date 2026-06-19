/**
 * Proactive PayPal webhook-missing alert at the money-moving moment.
 *
 * POST /api/admin/withdrawals/:id/payout sends real money. If payout
 * credentials are set (so payouts go out) but PAYPAL_WEBHOOK_ID is missing,
 * PayPal's status callback for the batch is rejected (401) and the withdrawal
 * stays stuck in "paying" forever — no callback can ever clear it.
 *
 * A startup alert and a callback alert already exist, but a long-running
 * replica whose startup alert was throttled/missed would otherwise pay out
 * with no fresh warning. These tests prove the payout route fires the operator
 * alert (email, via alertPayPalWebhookSecretMissing) and surfaces a
 * webhookMissing warning in the response when — and only when — the webhook
 * secret is absent.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

const ADMIN_ID = "admin-payout-webhook-alert-test";
const JWT_SECRET = "test-jwt-secret-for-payout-webhook-alert-padded-to-64xxxxxx";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockIsPayPalWebhookConfigured = vi.fn();
const mockSendPayPalPayout = vi.fn();

vi.mock("../paypal", () => ({
  isPayPalConfigured: vi.fn().mockReturnValue(true),
  isPayPalWebhookConfigured: (...args: unknown[]) => mockIsPayPalWebhookConfigured(...args),
  sendPayPalPayout: (...args: unknown[]) => mockSendPayPalPayout(...args),
  verifyPayPalWebhook: vi.fn(),
  getPayPalApiBase: vi.fn().mockReturnValue("https://api-m.sandbox.paypal.com"),
}));

const mockGetWithdrawalById = vi.fn();
const mockUpdateWithdrawalStatusIfStatus = vi.fn();
const mockGetUser = vi.fn();

vi.mock("../storage", () => ({
  storage: {
    getUser: (...args: unknown[]) => mockGetUser(...args),
    getWithdrawalById: (...args: unknown[]) => mockGetWithdrawalById(...args),
    updateWithdrawalStatusIfStatus: (...args: unknown[]) => mockUpdateWithdrawalStatusIfStatus(...args),
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

vi.mock("../surveys", () => ({ registerSurveyRoutes: vi.fn() }));
vi.mock("../offerwalls", () => ({ registerOfferwallRoutes: vi.fn() }));
vi.mock("./earnings", () => ({ registerEarningsRoutes: vi.fn() }));
vi.mock("./ventures", () => ({ default: express.Router() }));

// Spy on the throttled operator-alert helper. The throttle behaviour itself is
// covered by paypalWebhookAlert.test.ts; here we only assert the payout route
// invokes it with source "payout".
const mockAlert = vi.fn();
vi.mock("../lib/paypalWebhookAlert", () => ({
  alertPayPalWebhookSecretMissing: (...args: unknown[]) => mockAlert(...args),
}));

vi.mock("../lib/email", () => ({
  sendWithdrawalRequestedAdmin: vi.fn(),
  sendWithdrawalRequestedUser: vi.fn(),
  sendWithdrawalVelocityAdmin: vi.fn(),
  sendWithdrawalStatusUpdate: vi.fn(),
  sendSupportTicket: vi.fn(),
  sendPasswordChangedNotice: vi.fn(),
  sendAdminCreditReceipt: vi.fn(),
  sendSupportReply: vi.fn(),
  sendPayPalAmbiguousAlert: vi.fn(),
  sendPayPalWebhookSecretMissingAlert: vi.fn(),
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Setup ────────────────────────────────────────────────────────────────────

let app: Express;
let adminToken: string;

// A $3 withdrawal in a payable state with a valid PayPal email so the route
// reaches sendPayPalPayout.
function payableWithdrawal(): Record<string, unknown> {
  return {
    id: "w-1",
    username: "payee",
    amount: "3.00",
    status: "pending",
    paypalEmail: "payee@paypal.com",
    paypalBatchId: null,
  };
}

beforeAll(async () => {
  process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";
  process.env["JWT_ACCESS_SECRET"] = JWT_SECRET;
  delete process.env["ADMIN_TOKEN"];

  adminToken = jwt.sign(
    { userId: ADMIN_ID, role: "admin", tokenVersion: 0 },
    JWT_SECRET,
    { expiresIn: "1h" },
  );

  vi.resetModules();
  const { registerRoutes } = await import("./cashclip");
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const noop = () => {};
    (req as unknown as { log: Record<string, unknown> }).log = {
      info: noop, warn: noop, error: noop, debug: noop, trace: noop, fatal: noop,
      child: () => (req as unknown as { log: unknown }).log,
    };
    next();
  });
  await registerRoutes(app);
});

beforeEach(() => {
  vi.clearAllMocks();
  // adminMiddleware verifies the Bearer JWT against the DB user's role +
  // tokenVersion, so the admin must resolve to a real admin record.
  mockGetUser.mockResolvedValue({ id: ADMIN_ID, role: "admin", tokenVersion: 0 });
  mockGetWithdrawalById.mockResolvedValue(payableWithdrawal());
  // Claim succeeds → returns the locked "paying" record.
  mockUpdateWithdrawalStatusIfStatus.mockResolvedValue({
    ...payableWithdrawal(),
    status: "paying",
  });
  mockSendPayPalPayout.mockResolvedValue({ success: true, batchId: "batch-1" });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/admin/withdrawals/:id/payout — webhook-missing proactive alert", () => {
  it("fires the operator alert with source 'payout' when the webhook secret is missing", async () => {
    mockIsPayPalWebhookConfigured.mockReturnValue(false);

    const res = await request(app)
      .post("/api/admin/withdrawals/w-1/payout")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(mockAlert).toHaveBeenCalledTimes(1);
    expect(mockAlert).toHaveBeenCalledWith("payout");
  });

  it("still sends the payout (money is not blocked) and flags webhookMissing in the response", async () => {
    mockIsPayPalWebhookConfigured.mockReturnValue(false);

    const res = await request(app)
      .post("/api/admin/withdrawals/w-1/payout")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});

    expect(mockSendPayPalPayout).toHaveBeenCalledTimes(1);
    expect(res.body.webhookMissing).toBe(true);
    expect(typeof res.body.warning).toBe("string");
    expect(res.body.warning).toContain("PAYPAL_WEBHOOK_ID");
  });

  it("does NOT fire the alert or flag a warning when the webhook secret IS configured", async () => {
    mockIsPayPalWebhookConfigured.mockReturnValue(true);

    const res = await request(app)
      .post("/api/admin/withdrawals/w-1/payout")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(mockSendPayPalPayout).toHaveBeenCalledTimes(1);
    expect(mockAlert).not.toHaveBeenCalled();
    expect(res.body.webhookMissing).toBeUndefined();
    expect(res.body.warning).toBeUndefined();
  });

  it("does not fire the alert when the payout request never reaches the send step", async () => {
    // Withdrawal already paid → claim fails, route 409s before sendPayPalPayout.
    mockIsPayPalWebhookConfigured.mockReturnValue(false);
    mockUpdateWithdrawalStatusIfStatus.mockResolvedValue(null);
    mockGetWithdrawalById
      .mockResolvedValueOnce(payableWithdrawal()) // initial lookup
      .mockResolvedValueOnce({ ...payableWithdrawal(), status: "paid" }); // post-claim fresh

    const res = await request(app)
      .post("/api/admin/withdrawals/w-1/payout")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});

    expect(res.status).toBe(409);
    expect(mockSendPayPalPayout).not.toHaveBeenCalled();
    expect(mockAlert).not.toHaveBeenCalled();
  });
});
