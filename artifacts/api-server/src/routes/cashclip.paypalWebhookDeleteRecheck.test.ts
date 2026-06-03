/**
 * Tests that the DELETE /api/admin/integrations/:id/key handler fires
 * verifyWebhookRegistration() in the background when the PAYPAL_WEBHOOK_ID
 * integration is removed, and that the result lands in the cache returned by
 * getCachedWebhookRegistrationResult() and surfaces through the
 * GET /api/admin/paypal/webhook-health endpoint as "not configured".
 *
 * The handler (cashclip.ts — DELETE around line 603) sends the HTTP response
 * first and then kicks off the PayPal verification as a fire-and-forget
 * promise.  These tests verify:
 *   1. verifyWebhookRegistration() is called after PAYPAL_WEBHOOK_ID is deleted.
 *   2. The cache is updated to a "not configured" result (webhookId: null).
 *   3. GET /api/admin/paypal/webhook-health reflects the updated cache.
 *   4. The HTTP 200 response arrives before the background re-check completes.
 *   5. A different integration key does NOT trigger the re-check.
 *
 * Heavy dependencies (auth, storage, db, surveys, offerwalls…) are stubbed so
 * the test is self-contained and needs no database.  PayPal API credentials are
 * intentionally absent so verifyWebhookRegistration() takes the "webhook ID not
 * set" early-exit branch — no real HTTP calls are made.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ── Synthetic integration injected via mock ───────────────────────────────────

const PAYPAL_WEBHOOK_INTEGRATION = {
  id: "paypal-webhook-id",
  name: "PayPal Webhook ID",
  category: "payments" as const,
  envKey: "PAYPAL_WEBHOOK_ID",
  signupUrl: "https://developer.paypal.com",
  description: "Webhook registration ID for PayPal payout callbacks",
  priority: "optional" as const,
  revenueShare: "",
  setupSteps: [],
};

const OTHER_INTEGRATION = {
  id: "some-other-key",
  name: "Some Other Key",
  category: "surveys" as const,
  envKey: "SOME_OTHER_KEY",
  signupUrl: "https://example.com",
  description: "A non-PayPal integration",
  priority: "optional" as const,
  revenueShare: "",
  setupSteps: [],
};

const PAYPAL_WEBHOOK_STATUS = {
  id: "paypal-webhook-id",
  name: "PayPal Webhook ID",
  category: "payments",
  priority: "optional",
  connected: false,
  connectionState: "pending" as const,
  envKey: "PAYPAL_WEBHOOK_ID",
  signupUrl: "https://developer.paypal.com",
  description: "Webhook registration ID for PayPal payout callbacks",
  revenueShare: "",
  setupSteps: [],
};

const OTHER_STATUS = {
  id: "some-other-key",
  name: "Some Other Key",
  category: "surveys",
  priority: "optional",
  connected: false,
  connectionState: "pending" as const,
  envKey: "SOME_OTHER_KEY",
  signupUrl: "https://example.com",
  description: "A non-PayPal integration",
  revenueShare: "",
  setupSteps: [],
};

// ── Module mocks (hoisted before any imports by Vitest) ───────────────────────

vi.mock("../auth", () => ({
  registerAuthRoutes: vi.fn(),
  authMiddleware: (_req: Request, _res: Response, next: NextFunction) => next(),
  adminMiddleware: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock("../lib/secretsPassphrase", () => ({
  secretsPassphraseMiddleware: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock("../integrations", () => ({
  integrations: [PAYPAL_WEBHOOK_INTEGRATION, OTHER_INTEGRATION],
  getIntegrationStatuses: () => [PAYPAL_WEBHOOK_STATUS, OTHER_STATUS],
  getIntegrationSummary: () => ({
    total: 2,
    connected: 0,
    pending: 2,
    readyToEarn: false,
    startHereComplete: "0/0",
    byCategory: {
      ads: { total: 0, connected: 0 },
      surveys: { total: 1, connected: 0 },
      affiliates: { total: 0, connected: 0 },
      payments: { total: 1, connected: 0 },
    },
  }),
}));

vi.mock("../lib/integrationVerify", () => ({
  verifyIntegrationKey: vi.fn().mockResolvedValue({
    supported: false,
    ok: false,
    authRejected: false,
    reason: "No automatic verification available",
  }),
}));

vi.mock("../lib/integrationKeyStore", () => ({
  persistIntegrationKey: vi.fn().mockReturnValue(false),
  deletePersistedIntegrationKey: vi.fn().mockReturnValue(false),
  isIntegrationKeyPersisted: vi.fn().mockReturnValue(false),
  rotateEncryptionSecret: vi.fn(),
  getIntegrationKeyHealth: vi.fn().mockReturnValue({ decryptionFailures: [] }),
  loadPersistedIntegrationKeys: vi.fn(),
}));

vi.mock("../lib/integrationVerificationState", () => ({
  setVerificationState: vi.fn(),
  clearVerificationState: vi.fn(),
  getVerificationState: vi.fn().mockReturnValue(null),
}));

vi.mock("../storage", () => ({
  storage: {
    getUser: vi.fn(),
    updateUserPassword: vi.fn(),
    factoryResetUser: vi.fn(),
    recordSecurityAudit: vi.fn().mockResolvedValue(undefined),
    creditUser: vi.fn(),
    debitUser: vi.fn(),
    getWithdrawal: vi.fn(),
    updateWithdrawalStatus: vi.fn(),
  },
  SECURITY_AUDIT_EVENTS: {},
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    db: {
      transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn({}),
      select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }) }),
    },
  };
});

vi.mock("../surveys", () => ({ registerSurveyRoutes: vi.fn() }));
vi.mock("../offerwalls", () => ({ registerOfferwallRoutes: vi.fn() }));
vi.mock("./earnings", () => ({ registerEarningsRoutes: vi.fn() }));
vi.mock("./ventures", () => ({ default: express.Router() }));

vi.mock("../lib/email", () => ({
  sendWithdrawalRequestedAdmin: vi.fn(),
  sendWithdrawalStatusUpdate: vi.fn(),
  sendSupportTicket: vi.fn(),
  sendPasswordChangedNotice: vi.fn(),
}));

vi.mock("../lib/push", () => ({
  maybeSendThresholdPush: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/inbox", () => ({
  fetchInbox: vi.fn().mockResolvedValue([]),
}));

vi.mock("../lib/webhookAlerts", () => ({
  getRecentRejections: vi.fn().mockReturnValue([]),
  getRecentAlerts: vi.fn().mockReturnValue([]),
  getRejectionSummary: vi.fn().mockReturnValue({}),
  logWebhookVerificationFailure: vi.fn(),
}));

vi.mock("../lib/dbRateLimit", () => ({
  recordLoginAttempt: vi.fn().mockResolvedValue({ allowed: true }),
  checkDbRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

// ── Test setup ────────────────────────────────────────────────────────────────

const realFetch = globalThis.fetch;

let app: Express;

beforeAll(async () => {
  process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";
  process.env["JWT_ACCESS_SECRET"] =
    "test-jwt-secret-for-webhook-delete-recheck-tests-padded-aabbccdd";

  vi.resetModules();

  const { registerRoutes } = await import("./cashclip");
  app = express();
  app.use(express.json());

  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as Record<string, unknown>)["log"] = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    };
    next();
  });

  await registerRoutes(app);
});

afterAll(() => {
  delete process.env["PAYPAL_WEBHOOK_ID"];
  delete process.env["SOME_OTHER_KEY"];
});

beforeEach(() => {
  // Give the env var a value so the DELETE handler has something to clear.
  process.env["PAYPAL_WEBHOOK_ID"] = "WH-EXISTING-ID-TO-DELETE";

  // Guard: fail immediately if fetch is accidentally invoked.
  globalThis.fetch = vi.fn(async () => {
    throw new Error("fetch must not be called during this test");
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env["PAYPAL_WEBHOOK_ID"];
  delete process.env["SOME_OTHER_KEY"];
  vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DELETE /api/admin/integrations/paypal-webhook-id/key — auto re-check", () => {
  it("returns HTTP 200 after deleting the webhook ID", async () => {
    const res = await request(app)
      .delete("/api/admin/integrations/paypal-webhook-id/key");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("calls verifyWebhookRegistration() after the webhook ID is deleted", async () => {
    const paypalModule = await import("../paypal");
    const spy = vi.spyOn(paypalModule, "verifyWebhookRegistration");

    await request(app)
      .delete("/api/admin/integrations/paypal-webhook-id/key")
      .expect(200);

    // Poll until the fire-and-forget promise has written the cache.
    await vi.waitUntil(
      () => paypalModule.getCachedWebhookRegistrationResult() !== null,
      { timeout: 1000 },
    );

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("updates the cache to 'not configured' after deleting the webhook ID", async () => {
    const paypalModule = await import("../paypal");

    await request(app)
      .delete("/api/admin/integrations/paypal-webhook-id/key")
      .expect(200);

    // Wait for the background re-check to populate the cache.
    await vi.waitUntil(
      () => paypalModule.getCachedWebhookRegistrationResult() !== null,
      { timeout: 1000 },
    );

    const cached = paypalModule.getCachedWebhookRegistrationResult();
    expect(cached).not.toBeNull();
    // The handler deletes PAYPAL_WEBHOOK_ID before firing the re-check, so
    // verifyWebhookRegistration() must return the "not set" branch.
    expect(cached!.ok).toBe(false);
    expect(cached!.webhookId).toBeNull();
    expect(cached!.error).toBe("PAYPAL_WEBHOOK_ID not configured");
  });

  it("GET /api/admin/paypal/webhook-health reflects the 'not configured' cache after deletion", async () => {
    const paypalModule = await import("../paypal");

    await request(app)
      .delete("/api/admin/integrations/paypal-webhook-id/key")
      .expect(200);

    // Wait for the background re-check to complete.
    await vi.waitUntil(
      () => paypalModule.getCachedWebhookRegistrationResult() !== null,
      { timeout: 1000 },
    );

    const healthRes = await request(app)
      .get("/api/admin/paypal/webhook-health");

    expect(healthRes.status).toBe(200);
    expect(healthRes.body.checked).toBe(true);
    expect(healthRes.body.ok).toBe(false);
    expect(healthRes.body.webhookId).toBeNull();
    expect(healthRes.body.error).toBe("PAYPAL_WEBHOOK_ID not configured");
  });

  it("returns HTTP 200 BEFORE the background re-check completes (fire-and-forget)", async () => {
    const paypalModule = await import("../paypal");

    let resolveVerify!: (result: Awaited<ReturnType<typeof paypalModule.verifyWebhookRegistration>>) => void;
    vi.spyOn(paypalModule, "verifyWebhookRegistration").mockImplementation(
      () =>
        new Promise<Awaited<ReturnType<typeof paypalModule.verifyWebhookRegistration>>>(
          (resolve) => { resolveVerify = resolve as unknown as typeof resolveVerify; },
        ),
    );

    // Response must arrive even while verifyWebhookRegistration is still pending.
    const res = await request(app)
      .delete("/api/admin/integrations/paypal-webhook-id/key");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Clean up: resolve the lingering promise to avoid unhandled-rejection noise.
    (resolveVerify as unknown as (v: unknown) => void)({
      ok: false,
      checkedAt: new Date().toISOString(),
      webhookId: null,
      urlMatch: null,
      registeredUrl: null,
      missingEvents: [],
      warnings: ["PAYPAL_WEBHOOK_ID is not set"],
      error: "PAYPAL_WEBHOOK_ID not configured",
    });
    await new Promise((r) => setTimeout(r, 10));
  });

  it("does NOT call verifyWebhookRegistration() when a non-PayPal integration key is deleted", async () => {
    const paypalModule = await import("../paypal");
    const spy = vi.spyOn(paypalModule, "verifyWebhookRegistration");

    process.env["SOME_OTHER_KEY"] = "a-value";

    const res = await request(app)
      .delete("/api/admin/integrations/some-other-key/key");

    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns 404 when a non-existent integration ID is supplied", async () => {
    const paypalModule = await import("../paypal");
    const spy = vi.spyOn(paypalModule, "verifyWebhookRegistration");

    const res = await request(app)
      .delete("/api/admin/integrations/does-not-exist/key");

    expect(res.status).toBe(404);
    await new Promise((r) => setTimeout(r, 50));
    expect(spy).not.toHaveBeenCalled();
  });
});
