/**
 * Legacy admin PayPal status endpoint test.
 *
 * GET /api/admin/paypal-status is the OLDER status endpoint (predating the
 * Integration Hub's /api/admin/integrations/paypal/status, which Task #685
 * covers). It reports a smaller shape — `configured`, `mode`, and
 * `webhookConfigured` — and is read by any operator UI still pointed at the
 * legacy route.
 *
 * The dangerous case it must keep surfacing is "payouts on, callbacks off":
 * payout credentials are present so money CAN leave, but PAYPAL_WEBHOOK_ID is
 * absent so PayPal's status callbacks fail closed and withdrawals never settle.
 * If a refactor dropped or inverted `webhookConfigured` here, that state would
 * silently disappear from this UI. These tests pin it down:
 *
 *   - `webhookConfigured` is true ONLY when PAYPAL_WEBHOOK_ID is set.
 *   - `configured` reflects isPayPalConfigured().
 *   - `mode` reflects PAYPAL_MODE (defaulting to "sandbox").
 *   - admin auth is enforced (tokenless -> 401).
 *
 * Unlike the Hub endpoint, the legacy handler reads PAYPAL_WEBHOOK_ID from the
 * environment directly (not via isPayPalWebhookConfigured), so these tests
 * drive that env var directly while mocking isPayPalConfigured to decouple
 * `configured` from the other env vars.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

const ADMIN_ID = "admin-1";
const JWT_SECRET = "test-jwt-secret-for-paypal-status-legacy-padded-to-64x-aabbccddeeff";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockIsPayPalConfigured = vi.fn();
const mockIsPayPalWebhookConfigured = vi.fn();

vi.mock("../paypal", () => ({
  isPayPalConfigured: (...args: unknown[]) => mockIsPayPalConfigured(...args),
  isPayPalWebhookConfigured: (...args: unknown[]) => mockIsPayPalWebhookConfigured(...args),
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
  secretsPassphraseMiddleware: (_req: Request, _res: Response, next: NextFunction) => next(),
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

const STATUS_URL = "/api/admin/paypal-status";

beforeAll(async () => {
  process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";
  process.env["JWT_ACCESS_SECRET"] = JWT_SECRET;
  // Keep the console-token fallback out of the picture so the Bearer path is
  // the only way in.
  delete process.env["ADMIN_TOKEN"];

  adminToken = jwt.sign({ userId: ADMIN_ID, role: "admin", tokenVersion: 0 }, JWT_SECRET, {
    expiresIn: "1h",
  });

  vi.resetModules();
  const { registerRoutes } = await import("./cashclip");
  app = express();
  app.use(express.json());
  await registerRoutes(app);
});

beforeEach(() => {
  vi.clearAllMocks();
  // adminMiddleware resolves the acting admin via storage.getUser.
  mockGetUser.mockResolvedValue({ id: ADMIN_ID, role: "admin", tokenVersion: 0 });
});

function asAdmin(req: request.Test): request.Test {
  return req.set("Authorization", `Bearer ${adminToken}`);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/admin/paypal-status — legacy status endpoint", () => {
  it("reports webhookConfigured:false when PAYPAL_WEBHOOK_ID is absent (the dangerous payouts-on/callbacks-off state)", async () => {
    // Payout credentials present (payouts CAN go out)...
    process.env["PAYPAL_CLIENT_ID"] = "client-id";
    process.env["PAYPAL_SECRET"] = "secret";
    process.env["PAYPAL_MODE"] = "live";
    // ...but the webhook ID is missing, so callbacks fail closed.
    delete process.env["PAYPAL_WEBHOOK_ID"];
    mockIsPayPalConfigured.mockReturnValue(true);

    const res = await asAdmin(request(app).get(STATUS_URL));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      configured: true,
      mode: "live",
      webhookConfigured: false,
    });
  });

  it("reports webhookConfigured:true only when PAYPAL_WEBHOOK_ID is set", async () => {
    process.env["PAYPAL_CLIENT_ID"] = "client-id";
    process.env["PAYPAL_SECRET"] = "secret";
    process.env["PAYPAL_WEBHOOK_ID"] = "wh-123";
    process.env["PAYPAL_MODE"] = "live";
    mockIsPayPalConfigured.mockReturnValue(true);

    const res = await asAdmin(request(app).get(STATUS_URL));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      configured: true,
      mode: "live",
      webhookConfigured: true,
    });
  });

  it("reports configured:false reflecting isPayPalConfigured() when creds are absent", async () => {
    delete process.env["PAYPAL_CLIENT_ID"];
    delete process.env["PAYPAL_SECRET"];
    delete process.env["PAYPAL_CLIENT_SECRET"];
    delete process.env["PAYPAL_WEBHOOK_ID"];
    delete process.env["PAYPAL_MODE"];
    mockIsPayPalConfigured.mockReturnValue(false);

    const res = await asAdmin(request(app).get(STATUS_URL));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      configured: false,
      // PAYPAL_MODE unset → defaults to "sandbox".
      mode: "sandbox",
      webhookConfigured: false,
    });
  });

  it("requires admin auth — a tokenless request is rejected", async () => {
    const res = await request(app).get(STATUS_URL);
    expect(res.status).toBe(401);
  });
});
