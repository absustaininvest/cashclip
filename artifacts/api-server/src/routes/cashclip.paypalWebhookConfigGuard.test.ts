/**
 * PayPal webhook-secret-not-configured rejection test.
 *
 * `isPayPalWebhookConfigured()` (checks `PAYPAL_WEBHOOK_ID`) is a separate
 * guard from `isPayPalConfigured()`. The POST /api/paypal/webhook handler runs
 * `verifyPayPalWebhook()`, which fails closed when `PAYPAL_WEBHOOK_ID` is
 * absent — there is no signing secret to verify the callback against, so the
 * payload cannot be trusted.
 *
 * If that guard ever regressed to fail-open, an unsigned/forged callback could
 * flip a withdrawal to "paid" (or refund a user) with no real PayPal proof.
 * These tests assert the route rejects (4xx) and performs NO withdrawal DB
 * mutations when the webhook secret is missing.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockIsPayPalWebhookConfigured = vi.fn();

// verifyPayPalWebhook mirrors the real fail-closed behaviour: when the webhook
// secret is not configured there is no way to verify the signature, so it
// returns ok:false. This lets the test exercise the production rejection path
// driven purely by the missing-secret guard.
const mockVerifyPayPalWebhook = vi.fn(async () => {
  if (!mockIsPayPalWebhookConfigured()) {
    return { ok: false, reason: "PAYPAL_WEBHOOK_ID not configured — webhook verification disabled" };
  }
  return { ok: true };
});

vi.mock("../paypal", () => ({
  isPayPalConfigured: vi.fn().mockReturnValue(true),
  isPayPalWebhookConfigured: (...args: unknown[]) => mockIsPayPalWebhookConfigured(...args),
  verifyPayPalWebhook: (...args: unknown[]) => mockVerifyPayPalWebhook(...(args as [])),
  sendPayPalPayout: vi.fn(),
  getPayPalApiBase: vi.fn().mockReturnValue("https://api-m.sandbox.paypal.com"),
}));

const mockGetWithdrawalById = vi.fn();
const mockUpdateWithdrawalStatusIfStatus = vi.fn();
const mockCreditUser = vi.fn();

vi.mock("../storage", () => ({
  storage: {
    getWithdrawalById: (...args: unknown[]) => mockGetWithdrawalById(...args),
    updateWithdrawalStatusIfStatus: (...args: unknown[]) => mockUpdateWithdrawalStatusIfStatus(...args),
    creditUser: (...args: unknown[]) => mockCreditUser(...args),
  },
}));

// DB-backed per-IP rate limit — always allow so it never short-circuits the
// request before the webhook verification guard runs.
vi.mock("../lib/dbRateLimit", () => ({
  recordLoginAttempt: vi.fn().mockResolvedValue({ count: 1, allowed: true }),
  checkLoginAttempts: vi.fn().mockResolvedValue({ count: 0, allowed: true }),
  clearLoginAttempts: vi.fn().mockResolvedValue(undefined),
  pruneExpiredLoginAttempts: vi.fn().mockResolvedValue(undefined),
}));

// Avoid any DB write from the audit logger fired on verification failure.
vi.mock("../lib/webhookAuth", () => ({
  logWebhookVerificationFailure: vi.fn(),
}));

vi.mock("../lib/secretsPassphrase", () => ({
  secretsPassphraseMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
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
  sendPayPalWebhookSecretMissingAlert: vi.fn(),
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Setup ────────────────────────────────────────────────────────────────────

let app: Express;

// A well-formed PayPal payout-success callback. If the guard ever failed open,
// this body would flip withdrawal "w-1" to "paid".
const VALID_EVENT = {
  event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
  resource: { payout_item: { sender_item_id: "w-1" } },
};

beforeAll(async () => {
  process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";
  process.env["JWT_ACCESS_SECRET"] = "test-jwt-secret-for-paypal-webhook-config-guard-padded-64x";

  vi.resetModules();
  const { registerRoutes } = await import("./cashclip");
  app = express();
  // Mirror app.ts: attach rawBody to /webhook requests so the handler's
  // "Missing raw body" 400 guard is not what trips first.
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        if (req.url?.includes("/webhook")) {
          (req as unknown as Record<string, unknown>).rawBody = buf;
        }
      },
    }),
  );
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
  // Scenario under test: webhook secret absent.
  mockIsPayPalWebhookConfigured.mockReturnValue(false);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/paypal/webhook — missing webhook secret guard", () => {
  it("rejects with 401 when PAYPAL_WEBHOOK_ID is not configured", async () => {
    const res = await request(app)
      .post("/api/paypal/webhook")
      .send(VALID_EVENT);

    expect(res.status).toBe(401);
  });

  it("does NOT mutate any withdrawal record when the secret is missing", async () => {
    await request(app)
      .post("/api/paypal/webhook")
      .send(VALID_EVENT);

    expect(mockGetWithdrawalById).not.toHaveBeenCalled();
    expect(mockUpdateWithdrawalStatusIfStatus).not.toHaveBeenCalled();
    expect(mockCreditUser).not.toHaveBeenCalled();
  });

  it("rejects failure-event callbacks too, with no refund credit", async () => {
    await request(app)
      .post("/api/paypal/webhook")
      .send({
        event_type: "PAYMENT.PAYOUTS-ITEM.FAILED",
        resource: { payout_item: { sender_item_id: "w-1" } },
      });

    expect(mockUpdateWithdrawalStatusIfStatus).not.toHaveBeenCalled();
    expect(mockCreditUser).not.toHaveBeenCalled();
  });

  it("proceeds past the verification gate once the webhook secret IS configured", async () => {
    // Flip the guard: secret present → verifyPayPalWebhook returns ok:true, so
    // the handler reaches the withdrawal lookup. This proves the 401 above is
    // caused specifically by the missing-secret guard, not an unrelated reject.
    mockIsPayPalWebhookConfigured.mockReturnValue(true);
    mockGetWithdrawalById.mockResolvedValue(undefined);

    const res = await request(app)
      .post("/api/paypal/webhook")
      .send(VALID_EVENT);

    expect(res.status).not.toBe(401);
    expect(mockGetWithdrawalById).toHaveBeenCalledWith("w-1");
  });
});
