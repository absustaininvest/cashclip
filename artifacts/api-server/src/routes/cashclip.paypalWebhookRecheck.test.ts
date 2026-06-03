/**
 * Tests that the real POST /api/admin/integrations/:id/key handler fires
 * verifyWebhookRegistration() in the background when the PAYPAL_WEBHOOK_ID
 * integration is updated, and that the result lands in the cache returned by
 * getCachedWebhookRegistrationResult().
 *
 * The handler (cashclip.ts lines 582–600) sends the HTTP response first and
 * then kicks off the PayPal verification as a fire-and-forget promise.  These
 * tests verify both sides of that contract using the REAL registerRoutes() so
 * that a future refactor of the production handler is always caught:
 *   1. The background call fires and updates the cache with the new webhook ID.
 *   2. The HTTP 200 response arrives before the background re-check finishes.
 *   3. A different integration key does NOT trigger the re-check.
 *
 * Heavy dependencies (auth, storage, db, surveys, offerwalls…) are stubbed so
 * the test is self-contained and needs no database.  PayPal API credentials
 * are intentionally absent so verifyWebhookRegistration() takes the
 * "credentials not configured" early-exit branch — no real HTTP calls needed.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ── Synthetic integration injected via mock ───────────────────────────────────
// The real integrations list has no entry with envKey "PAYPAL_WEBHOOK_ID", so
// we inject one here so the route's integration lookup succeeds and the
// production branch `if (integration.envKey === "PAYPAL_WEBHOOK_ID")` fires.

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

// ── Module mocks (hoisted before any imports by Vitest) ───────────────────────

vi.mock("../auth", () => ({
  registerAuthRoutes: vi.fn(),
  authMiddleware: (_req: Request, _res: Response, next: NextFunction) => next(),
  adminMiddleware: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock("../lib/secretsPassphrase", () => ({
  secretsPassphraseMiddleware: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// Inject the synthetic PAYPAL_WEBHOOK_ID integration alongside an empty list of
// regular integrations — the test only exercises the key-update route.
vi.mock("../integrations", () => ({
  integrations: [PAYPAL_WEBHOOK_INTEGRATION],
  getIntegrationStatuses: () => [PAYPAL_WEBHOOK_STATUS],
  getIntegrationSummary: () => ({
    total: 1,
    connected: 0,
    pending: 1,
    readyToEarn: false,
    startHereComplete: "0/0",
    byCategory: {
      ads: { total: 0, connected: 0 },
      surveys: { total: 0, connected: 0 },
      affiliates: { total: 0, connected: 0 },
      payments: { total: 1, connected: 0 },
    },
  }),
}));

// verifyIntegrationKey: return "unsupported" so the handler skips the
// auth-rejection rollback and writes verification state, then falls through to
// send the response and trigger the PayPal re-check.
vi.mock("../lib/integrationVerify", () => ({
  verifyIntegrationKey: vi.fn().mockResolvedValue({
    supported: false,
    ok: false,
    authRejected: false,
    reason: "No automatic verification available for PAYPAL_WEBHOOK_ID",
  }),
}));

// Key-store: no-op stubs (avoids filesystem and encryption setup).
vi.mock("../lib/integrationKeyStore", () => ({
  persistIntegrationKey: vi.fn().mockReturnValue(false),
  deletePersistedIntegrationKey: vi.fn().mockReturnValue(false),
  isIntegrationKeyPersisted: vi.fn().mockReturnValue(false),
  rotateEncryptionSecret: vi.fn(),
  getIntegrationKeyHealth: vi.fn().mockReturnValue({ decryptionFailures: [] }),
  loadPersistedIntegrationKeys: vi.fn(),
}));

// Verification-state: no-op (in-memory module, safe to stub).
vi.mock("../lib/integrationVerificationState", () => ({
  setVerificationState: vi.fn(),
  clearVerificationState: vi.fn(),
  getVerificationState: vi.fn().mockReturnValue(null),
}));

// Storage: minimal stubs for methods reachable during route registration.
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

// DB: pass db.transaction through to the callback with a noop tx object.
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

// Sibling route registrations — stub so we don't pull in their dependencies.
vi.mock("../surveys", () => ({ registerSurveyRoutes: vi.fn() }));
vi.mock("../offerwalls", () => ({ registerOfferwallRoutes: vi.fn() }));
vi.mock("./earnings", () => ({ registerEarningsRoutes: vi.fn() }));
vi.mock("./ventures", () => ({ default: express.Router() }));

// Email helpers used by withdrawal/support routes.
vi.mock("../lib/email", () => ({
  sendWithdrawalRequestedAdmin: vi.fn(),
  sendWithdrawalStatusUpdate: vi.fn(),
  sendSupportTicket: vi.fn(),
  sendPasswordChangedNotice: vi.fn(),
}));

// Push notifications — stub to avoid db dependency.
vi.mock("../lib/push", () => ({
  maybeSendThresholdPush: vi.fn().mockResolvedValue(undefined),
}));

// Inbox — stub.
vi.mock("../lib/inbox", () => ({
  fetchInbox: vi.fn().mockResolvedValue([]),
}));

// Webhook alerts — stub.
vi.mock("../lib/webhookAlerts", () => ({
  getRecentRejections: vi.fn().mockReturnValue([]),
  getRecentAlerts: vi.fn().mockReturnValue([]),
  getRejectionSummary: vi.fn().mockReturnValue({}),
  logWebhookVerificationFailure: vi.fn(),
}));

// Rate-limiter — always allow.
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
    "test-jwt-secret-for-webhook-recheck-tests-padded-to-64-chars-aabbccdd";

  vi.resetModules();

  const { registerRoutes } = await import("./cashclip");
  app = express();
  app.use(express.json());

  // Add a silent req.log so the real handler's req.log.info/warn/error calls
  // don't throw — pino-http is not wired in the test Express instance.
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
});

beforeEach(() => {
  // Clear PayPal credentials so verifyWebhookRegistration exits via the
  // "credentials not configured" branch — no real HTTP calls are required
  // and the module-level _cachedWebhookCheck is still written.
  delete process.env.PAYPAL_WEBHOOK_ID;
  delete process.env.PAYPAL_CLIENT_ID;
  delete process.env.PAYPAL_SECRET;
  delete process.env.PAYPAL_CLIENT_SECRET;

  // Guard: fail immediately if fetch is accidentally invoked.
  globalThis.fetch = vi.fn(async () => {
    throw new Error("fetch must not be called during this test");
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.PAYPAL_WEBHOOK_ID;
  vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/admin/integrations/paypal-webhook-id/key — auto re-check", () => {
  it("returns HTTP 200 after saving a valid webhook ID", async () => {
    const res = await request(app)
      .post("/api/admin/integrations/paypal-webhook-id/key")
      .send({ value: "WH-PROBE-ID-200" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("updates getCachedWebhookRegistrationResult() with the newly saved webhook ID", async () => {
    // Import the real paypal module to spy on verifyWebhookRegistration and
    // read the module-level cache.  vi.resetModules() was already called in
    // beforeAll, so this import shares the same module instance as cashclip.ts.
    const paypalModule = await import("../paypal");
    const spy = vi.spyOn(paypalModule, "verifyWebhookRegistration");

    await request(app)
      .post("/api/admin/integrations/paypal-webhook-id/key")
      .send({ value: "WH-CACHED-ID-XYZ" })
      .expect(200);

    // Poll until the fire-and-forget promise has written the cache.
    await vi.waitUntil(
      () => paypalModule.getCachedWebhookRegistrationResult() !== null,
      { timeout: 1000 },
    );

    // The background call must have been made exactly once.
    expect(spy).toHaveBeenCalledTimes(1);

    const cached = paypalModule.getCachedWebhookRegistrationResult();
    expect(cached).not.toBeNull();
    // The cached result must reflect the webhook ID that was just saved.
    expect(cached!.webhookId).toBe("WH-CACHED-ID-XYZ");
    // Without PayPal API credentials the check cannot reach the "ok" state.
    expect(cached!.ok).toBe(false);
  });

  it("returns HTTP 200 BEFORE the background re-check completes (fire-and-forget)", async () => {
    const paypalModule = await import("../paypal");

    // Replace verifyWebhookRegistration with a promise we control manually so
    // we can confirm the response arrives while verification is still pending.
    let resolveVerify!: (result: typeof paypalModule.WebhookRegistrationResult) => void;
    vi.spyOn(paypalModule, "verifyWebhookRegistration").mockImplementation(
      () =>
        new Promise<Awaited<ReturnType<typeof paypalModule.verifyWebhookRegistration>>>(
          (resolve) => { resolveVerify = resolve as unknown as typeof resolveVerify; },
        ),
    );

    // The response must arrive even though verifyWebhookRegistration never
    // resolves during the HTTP round-trip.
    const res = await request(app)
      .post("/api/admin/integrations/paypal-webhook-id/key")
      .send({ value: "WH-SLOW-ID" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Clean up: resolve the lingering promise to avoid unhandled-rejection noise.
    (resolveVerify as unknown as (v: unknown) => void)({
      ok: false,
      checkedAt: new Date().toISOString(),
      webhookId: "WH-SLOW-ID",
      urlMatch: null,
      registeredUrl: null,
      missingEvents: [],
      warnings: [],
      error: "test-controlled resolve",
    });
    await new Promise((r) => setTimeout(r, 10));
  });

  it("does NOT call verifyWebhookRegistration() when a non-existent integration ID is supplied", async () => {
    const paypalModule = await import("../paypal");
    const spy = vi.spyOn(paypalModule, "verifyWebhookRegistration");

    // "unknown-id" is not in the mocked integrations list → 404.
    const res = await request(app)
      .post("/api/admin/integrations/unknown-id/key")
      .send({ value: "some-value" });

    expect(res.status).toBe(404);
    await new Promise((r) => setTimeout(r, 50));
    expect(spy).not.toHaveBeenCalled();
  });
});
