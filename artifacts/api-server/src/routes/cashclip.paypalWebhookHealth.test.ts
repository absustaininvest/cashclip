/**
 * Integration tests: PayPal webhook health endpoints.
 *
 * GET  /api/admin/paypal/webhook-health
 *   1. Returns cached result when getCachedWebhookRegistrationResult has data.
 *   2. Returns { checked: false } when cache is empty (startup check hasn't run).
 *   3. Rejects unauthenticated requests with 401.
 *
 * POST /api/admin/paypal/webhook-health/refresh
 *   4. Calls verifyWebhookRegistration exactly once and returns checked: true.
 *   5. Stores the refreshed result so a subsequent GET returns the updated state.
 *   6. Still returns the result when verifyWebhookRegistration reports ok: false.
 *   7. Returns 500 when verifyWebhookRegistration throws.
 *   8. Rejects unauthenticated requests with 401.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import type { Express } from "express";

const TEST_JWT_SECRET = "test-jwt-secret-for-paypal-webhook-health-padded-64c";

// ── Mutable control variables ─────────────────────────────────────────────────

let adminAllowed = true;

// ── Mock return values for paypal functions ───────────────────────────────────

let mockCachedResult: Record<string, unknown> | null = null;
let mockVerifyResult: Record<string, unknown> = {
  ok: true,
  checkedAt: "2026-06-03T00:00:00.000Z",
  webhookId: "WH-TEST-ID",
  urlMatch: true,
  registeredUrl: "https://api.cash-clip.app/api/paypal/webhook",
  missingEvents: [],
  warnings: [],
};
let mockVerifyThrows = false;

// ── @workspace/db mock ────────────────────────────────────────────────────────

vi.mock("@workspace/db", async () => {
  const actual = await vi.importActual<typeof import("@workspace/db")>("@workspace/db");
  const db = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([]),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    }),
    execute: vi.fn().mockResolvedValue({ rows: [] }),
    transaction: vi.fn().mockImplementation(async (cb: (tx: any) => unknown) => cb({})),
  };
  return { ...actual, db };
});

// ── storage mock ──────────────────────────────────────────────────────────────

vi.mock("../storage", () => ({
  storage: {
    getUser: vi.fn().mockResolvedValue(null),
    getUserByUsername: vi.fn().mockResolvedValue(null),
    getWebhookAudits: vi.fn().mockResolvedValue([]),
    getWebhookAuditOffenders: vi.fn().mockResolvedValue([]),
    getWebhookAuditProviders: vi.fn().mockResolvedValue([]),
  },
}));

// ── paypal mock ───────────────────────────────────────────────────────────────
//
// verifyWebhookRegistration also writes the result to mockCachedResult,
// mirroring the real module's _cachedWebhookCheck assignment.  This lets
// a POST /refresh → GET /webhook-health round-trip test verify persistence.

vi.mock("../paypal", () => ({
  sendPayPalPayout: vi.fn(),
  isPayPalConfigured: () => false,
  initPayPal: vi.fn(),
  pingPayPal: vi.fn().mockResolvedValue({ ok: false }),
  getCachedWebhookRegistrationResult: vi.fn().mockImplementation(() => mockCachedResult),
  verifyWebhookRegistration: vi.fn().mockImplementation(async () => {
    if (mockVerifyThrows) {
      throw new Error("PayPal API unreachable");
    }
    mockCachedResult = mockVerifyResult;
    return mockVerifyResult;
  }),
}));

// ── auth mock ─────────────────────────────────────────────────────────────────

vi.mock("../auth", () => ({
  RESERVED_ADMIN_USERNAMES: new Set<string>(),
  registerAuthRoutes: () => {},
  authMiddleware: (req: any, _res: any, next: any) => {
    req.userId = "admin-user-id";
    next();
  },
  adminMiddleware: async (_req: any, res: any, next: any) => {
    if (!adminAllowed) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  },
}));

// ── dbRateLimit mock ──────────────────────────────────────────────────────────

vi.mock("../lib/dbRateLimit", () => ({
  recordLoginAttempt:        vi.fn().mockResolvedValue({ allowed: true, current: 1 }),
  checkLoginAttempts:        vi.fn().mockResolvedValue({ allowed: true, current: 1 }),
  clearLoginAttempts:        vi.fn().mockResolvedValue(undefined),
  pruneExpiredLoginAttempts: vi.fn().mockResolvedValue(undefined),
  decrementLoginAttempt:     vi.fn().mockResolvedValue(undefined),
}));

// ── App setup ─────────────────────────────────────────────────────────────────

let app: Express;

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = TEST_JWT_SECRET;
  process.env.JWT_SECRET        = TEST_JWT_SECRET;
  process.env.DATABASE_URL    ??= "postgres://test:test@127.0.0.1:5432/test";

  const { registerRoutes } = await import("../routes/cashclip");
  app = express();
  app.use(express.json());

  app.use((req: any, _res: any, next: any) => {
    req.log = {
      info:  () => {},
      warn:  () => {},
      error: () => {},
      debug: () => {},
      trace: () => {},
      fatal: () => {},
      child: () => req.log,
    };
    next();
  });

  registerRoutes(app);
});

beforeEach(() => {
  vi.clearAllMocks();
  adminAllowed       = true;
  mockCachedResult   = null;
  mockVerifyThrows   = false;
  mockVerifyResult   = {
    ok: true,
    checkedAt: "2026-06-03T00:00:00.000Z",
    webhookId: "WH-TEST-ID",
    urlMatch: true,
    registeredUrl: "https://api.cash-clip.app/api/paypal/webhook",
    missingEvents: [],
    warnings: [],
  };
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/admin/paypal/webhook-health", () => {

  it("returns checked: true with the cached result when a prior check result exists", async () => {
    mockCachedResult = {
      ok: true,
      checkedAt: "2026-06-03T00:00:00.000Z",
      webhookId: "WH-CACHED-001",
      urlMatch: true,
      registeredUrl: "https://api.cash-clip.app/api/paypal/webhook",
      missingEvents: [],
      warnings: [],
    };

    const res = await request(app).get("/api/admin/paypal/webhook-health");

    expect(res.status).toBe(200);
    expect(res.body.checked).toBe(true);
    expect(res.body.webhookId).toBe("WH-CACHED-001");
    expect(res.body.ok).toBe(true);
  });

  it("includes all fields from the cached result in the response", async () => {
    mockCachedResult = {
      ok: false,
      checkedAt: "2026-06-01T12:00:00.000Z",
      webhookId: "WH-BAD",
      urlMatch: false,
      registeredUrl: "https://wrong-url.example.com/paypal/webhook",
      missingEvents: ["PAYMENT.PAYOUTSBATCH.SUCCESS"],
      warnings: ["Webhook URL mismatch"],
      error: "URL does not match expected endpoint",
    };

    const res = await request(app).get("/api/admin/paypal/webhook-health");

    expect(res.status).toBe(200);
    expect(res.body.checked).toBe(true);
    expect(res.body.ok).toBe(false);
    expect(res.body.urlMatch).toBe(false);
    expect(res.body.missingEvents).toEqual(["PAYMENT.PAYOUTSBATCH.SUCCESS"]);
    expect(res.body.warnings).toEqual(["Webhook URL mismatch"]);
    expect(res.body.error).toBe("URL does not match expected endpoint");
  });

  it("returns checked: false with a message when no startup check result is cached", async () => {
    mockCachedResult = null;

    const res = await request(app).get("/api/admin/paypal/webhook-health");

    expect(res.status).toBe(200);
    expect(res.body.checked).toBe(false);
    expect(typeof res.body.message).toBe("string");
    expect(res.body.message.length).toBeGreaterThan(0);
  });

  it("returns 401 for unauthenticated requests", async () => {
    adminAllowed = false;

    const res = await request(app).get("/api/admin/paypal/webhook-health");

    expect(res.status).toBe(401);
  });
});

describe("POST /api/admin/paypal/webhook-health/refresh", () => {

  it("calls verifyWebhookRegistration exactly once and returns checked: true", async () => {
    const paypal = await import("../paypal");
    const verifySpy = vi.mocked(paypal.verifyWebhookRegistration);

    const res = await request(app)
      .post("/api/admin/paypal/webhook-health/refresh")
      .set("Content-Type", "application/json")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.checked).toBe(true);
    expect(res.body.ok).toBe(true);
    expect(res.body.webhookId).toBe("WH-TEST-ID");
    expect(verifySpy).toHaveBeenCalledTimes(1);
  });

  it("stores the refreshed result — a subsequent GET returns the updated state", async () => {
    mockVerifyResult = {
      ok: true,
      checkedAt: "2026-06-03T10:00:00.000Z",
      webhookId: "WH-REFRESHED",
      urlMatch: true,
      registeredUrl: "https://api.cash-clip.app/api/paypal/webhook",
      missingEvents: [],
      warnings: [],
    };

    await request(app)
      .post("/api/admin/paypal/webhook-health/refresh")
      .set("Content-Type", "application/json")
      .send({});

    const getRes = await request(app).get("/api/admin/paypal/webhook-health");

    expect(getRes.status).toBe(200);
    expect(getRes.body.checked).toBe(true);
    expect(getRes.body.webhookId).toBe("WH-REFRESHED");
    expect(getRes.body.checkedAt).toBe("2026-06-03T10:00:00.000Z");
  });

  it("returns all fields from verifyWebhookRegistration in the response body", async () => {
    const res = await request(app)
      .post("/api/admin/paypal/webhook-health/refresh")
      .set("Content-Type", "application/json")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      checked: true,
      ok: true,
      checkedAt: "2026-06-03T00:00:00.000Z",
      urlMatch: true,
      registeredUrl: "https://api.cash-clip.app/api/paypal/webhook",
      missingEvents: [],
      warnings: [],
    });
  });

  it("still returns 200 with the result when verifyWebhookRegistration reports ok: false", async () => {
    mockVerifyResult = {
      ok: false,
      checkedAt: "2026-06-03T01:00:00.000Z",
      webhookId: "WH-FAIL",
      urlMatch: false,
      registeredUrl: null,
      missingEvents: ["PAYMENT.PAYOUTSBATCH.DENIED"],
      warnings: ["Webhook URL mismatch", "Missing required event subscriptions: PAYMENT.PAYOUTSBATCH.DENIED"],
      error: "PayPal webhook lookup failed: 404",
    };

    const res = await request(app)
      .post("/api/admin/paypal/webhook-health/refresh")
      .set("Content-Type", "application/json")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.checked).toBe(true);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe("PayPal webhook lookup failed: 404");
  });

  it("returns 500 when verifyWebhookRegistration throws an unexpected error", async () => {
    mockVerifyThrows = true;

    const res = await request(app)
      .post("/api/admin/paypal/webhook-health/refresh")
      .set("Content-Type", "application/json")
      .send({});

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 401 for unauthenticated requests", async () => {
    adminAllowed = false;

    const res = await request(app)
      .post("/api/admin/paypal/webhook-health/refresh")
      .set("Content-Type", "application/json")
      .send({});

    expect(res.status).toBe(401);
  });
});
