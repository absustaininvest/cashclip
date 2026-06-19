/**
 * Admin PayPal status — webhook-missing distinction test.
 *
 * GET /api/admin/integrations/paypal/status must surface THREE distinct states
 * so an operator can tell the dangerous case apart from "not set up at all":
 *
 *   1. Payout creds set, but PAYPAL_WEBHOOK_ID absent → the DANGEROUS state.
 *      Payouts can go out, but PayPal's status callbacks fail closed (401), so
 *      withdrawals sit in "paying"/"pending" forever. The endpoint must report
 *      `webhookMissing: true`, `status: "webhook-missing"`, `configured: true`.
 *   2. No credentials at all → `status: "incomplete"`, `webhookMissing: false`.
 *   3. Everything set → `status: "live"`/`"sandbox"`, `webhookMissing: false`.
 *
 * Without this test a future refactor could silently collapse the
 * webhook-missing state back into "incomplete", re-hiding the case where money
 * leaves but never settles.
 *
 * isPayPalConfigured / isPayPalWebhookConfigured from ../paypal are mocked so
 * the three scenarios can be driven deterministically without real env juggling
 * affecting unrelated process state, while the env vars the handler reads
 * directly (PAYPAL_CLIENT_ID / PAYPAL_SECRET / PAYPAL_MODE) are set to match.
 * The REAL adminMiddleware is used so the admin auth gate is genuinely
 * exercised via a signed admin Bearer JWT.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

const ADMIN_ID = "admin-1";
const JWT_SECRET =
  "test-jwt-secret-for-paypal-status-webhook-missing-padded-to-64x-aabb";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockIsPayPalConfigured = vi.fn();
const mockIsPayPalWebhookConfigured = vi.fn();

vi.mock("../paypal", () => ({
  isPayPalConfigured: (...args: unknown[]) => mockIsPayPalConfigured(...args),
  isPayPalWebhookConfigured: (...args: unknown[]) =>
    mockIsPayPalWebhookConfigured(...args),
  verifyPayPalWebhook: vi.fn(),
  sendPayPalPayout: vi.fn(),
  getPayPalApiBase: vi.fn().mockReturnValue("https://api-m.sandbox.paypal.com"),
}));

const mockGetUser = vi.fn();

vi.mock("../storage", () => ({
  storage: {
    getUser: (...args: unknown[]) => mockGetUser(...args),
  },
}));

// DB-backed per-IP rate limit — always allow so it never short-circuits the
// admin auth path.
vi.mock("../lib/dbRateLimit", () => ({
  recordLoginAttempt: vi.fn().mockResolvedValue({ count: 1, allowed: true }),
  checkLoginAttempts: vi.fn().mockResolvedValue({ count: 0, allowed: true }),
  clearLoginAttempts: vi.fn().mockResolvedValue(undefined),
  pruneExpiredLoginAttempts: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/secretsPassphrase", () => ({
  secretsPassphraseMiddleware: (
    _req: Request,
    _res: Response,
    next: NextFunction,
  ) => next(),
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

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Setup ────────────────────────────────────────────────────────────────────

let app: Express;
let adminToken: string;

const STATUS_URL = "/api/admin/integrations/paypal/status";

beforeAll(async () => {
  process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";
  process.env["JWT_ACCESS_SECRET"] = JWT_SECRET;
  // Keep the console-token fallback out of the picture so the Bearer path is
  // the only way in.
  delete process.env["ADMIN_TOKEN"];

  adminToken = jwt.sign(
    { userId: ADMIN_ID, role: "admin", tokenVersion: 0 },
    JWT_SECRET,
    {
      expiresIn: "1h",
    },
  );

  vi.resetModules();
  const { registerRoutes } = await import("./cashclip");
  app = express();
  app.use(express.json());
  await registerRoutes(app);
});

beforeEach(() => {
  vi.clearAllMocks();
  // adminMiddleware resolves the acting admin via storage.getUser.
  mockGetUser.mockResolvedValue({
    id: ADMIN_ID,
    role: "admin",
    tokenVersion: 0,
  });
});

function asAdmin(req: request.Test): request.Test {
  return req.set("Authorization", `Bearer ${adminToken}`);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/admin/integrations/paypal/status — webhook-missing distinction", () => {
  it("reports the dangerous webhook-missing state when creds are set but PAYPAL_WEBHOOK_ID is absent", async () => {
    // Payout credentials present (payouts CAN go out)...
    process.env["PAYPAL_CLIENT_ID"] = "client-id";
    process.env["PAYPAL_SECRET"] = "secret";
    process.env["PAYPAL_MODE"] = "live";
    mockIsPayPalConfigured.mockReturnValue(true);
    // ...but the webhook secret is missing, so callbacks fail closed.
    mockIsPayPalWebhookConfigured.mockReturnValue(false);

    const res = await asAdmin(request(app).get(STATUS_URL));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      webhookMissing: true,
      status: "webhook-missing",
      configured: true,
      webhookSet: false,
      fullyConfigured: false,
    });
  });

  it("reports incomplete (not webhook-missing) when no credentials are set at all", async () => {
    delete process.env["PAYPAL_CLIENT_ID"];
    delete process.env["PAYPAL_SECRET"];
    delete process.env["PAYPAL_CLIENT_SECRET"];
    mockIsPayPalConfigured.mockReturnValue(false);
    mockIsPayPalWebhookConfigured.mockReturnValue(false);

    const res = await asAdmin(request(app).get(STATUS_URL));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      webhookMissing: false,
      status: "incomplete",
      configured: false,
      fullyConfigured: false,
    });
  });

  it("reports live (webhookMissing:false) when everything is configured in live mode", async () => {
    process.env["PAYPAL_CLIENT_ID"] = "client-id";
    process.env["PAYPAL_SECRET"] = "secret";
    process.env["PAYPAL_WEBHOOK_ID"] = "wh-123";
    process.env["PAYPAL_MODE"] = "live";
    mockIsPayPalConfigured.mockReturnValue(true);
    mockIsPayPalWebhookConfigured.mockReturnValue(true);

    const res = await asAdmin(request(app).get(STATUS_URL));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      webhookMissing: false,
      status: "live",
      configured: true,
      webhookSet: true,
      fullyConfigured: true,
    });
  });

  it("reports sandbox (webhookMissing:false) when everything is configured in sandbox mode", async () => {
    process.env["PAYPAL_CLIENT_ID"] = "client-id";
    process.env["PAYPAL_SECRET"] = "secret";
    process.env["PAYPAL_WEBHOOK_ID"] = "wh-123";
    process.env["PAYPAL_MODE"] = "sandbox";
    mockIsPayPalConfigured.mockReturnValue(true);
    mockIsPayPalWebhookConfigured.mockReturnValue(true);

    const res = await asAdmin(request(app).get(STATUS_URL));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      webhookMissing: false,
      status: "sandbox",
      fullyConfigured: true,
    });
  });

  it("requires admin auth — a tokenless request is rejected", async () => {
    const res = await request(app).get(STATUS_URL);
    expect(res.status).toBe(401);
  });
});
