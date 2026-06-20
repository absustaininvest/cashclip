import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Hoisted module mocks — vi.mock() is lifted before any import by vitest's
// transform, so these factories run before storage.ts or paypal.ts are ever
// evaluated. vi.hoisted() makes the mock-function values available inside the
// factory closures even though they are textually defined before the factory.
// ---------------------------------------------------------------------------
const storageMocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getWebhookAudits: vi.fn(),
  getWebhookAuditOffenders: vi.fn(),
  getWebhookAuditProviders: vi.fn(),
  // Must return a resolved promise: logWebhookVerificationFailure (in
  // webhookAuth.ts) fires this best-effort and calls `.catch(...)` on the
  // result. A bare vi.fn() returns undefined, so `.catch` throws an unhandled
  // rejection that fails the whole suite.
  insertWebhookAudit: vi.fn().mockResolvedValue(undefined),
  countWebhookAuditByIp: vi.fn().mockResolvedValue(0),
  // Stubs for additional storage methods referenced by the route bundle at
  // registration time. Returning undefined is safe — they are not invoked by
  // the admin webhook-audit handler.
  updateUserBalance: vi.fn(),
  createEarningsLedgerEntry: vi.fn(),
  getRewardSession: vi.fn(),
  createWithdrawal: vi.fn(),
  getWithdrawals: vi.fn(),
  getBalance: vi.fn(),
  getTransactions: vi.fn(),
  getUserByUsername: vi.fn(),
  insertWebhookAuditBatch: vi.fn(),
}));

vi.mock("../storage", () => ({ storage: storageMocks }));

vi.mock("../paypal", () => ({
  sendPayPalPayout: vi.fn(),
  isPayPalConfigured: () => false,
  initPayPal: vi.fn(),
}));

// Mock auth.ts so that adminMiddleware uses jwt.decode (no signature
// verification). This removes the JWT_SECRET capture-at-init-time dependency
// that otherwise causes all authenticated admin route tests to return 401 when
// auth.ts is loaded with a secret that differs from what signToken uses.
vi.mock("../auth", async () => {
  const { default: jwt } = await import("jsonwebtoken");

  const adminMiddleware = async (req: any, res: any, next: any): Promise<void> => {
    const authHeader = (req.headers as Record<string, string>)["authorization"];
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "No token provided" });
      return;
    }
    const token = authHeader.split(" ")[1]!;
    const payload = jwt.decode(token) as { userId?: string; role?: string } | null;
    if (!payload?.userId) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }
    const user = await storageMocks.getUser(payload.userId);
    if (!user) {
      res.status(401).json({ error: "User not found" });
      return;
    }
    if ((user as any).role !== "admin") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    req.userId = (user as any).id;
    req.userRole = (user as any).role;
    next();
  };

  return {
    RESERVED_ADMIN_USERNAMES: new Set<string>(),
    registerAuthRoutes: () => {},
    authMiddleware: (_req: any, _res: any, next: any) => next(),
    adminMiddleware,
  };
});

const SECRETS = {
  POLLFISH_WEBHOOK_SECRET: "pollfish-secret-route",
  CINT_WEBHOOK_SECRET: "cint-secret-route",
  LUCID_WEBHOOK_SECRET: "lucid-secret-route",
  TAPJOY_WEBHOOK_SECRET: "tapjoy-secret-route",
  ADGATE_WEBHOOK_SECRET: "adgate-secret-route",
  OFFERTORO_WEBHOOK_SECRET: "offertoro-secret-route",
  LOOTABLY_WEBHOOK_SECRET: "lootably-secret-route",
  ADJOE_WEBHOOK_SECRET: "adjoe-secret-route",
};

beforeAll(() => {
  for (const [k, v] of Object.entries(SECRETS)) {
    process.env[k] = v;
  }
  process.env.JWT_SECRET ??= "test-jwt-secret-padded-to-meet-minimum-64-character-length-requirement";
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
  process.env.WEBHOOK_RATE_LIMIT_RPM ??= "10000";
});

let app: Express;

beforeAll(async () => {
  const { verifyWebhook, logWebhookVerificationFailure, reloadWebhookSecrets } =
    await import("./webhookAuth");
  const { webhookRateLimiter } = await import("./webhookRateLimit");

  reloadWebhookSecrets();

  app = express();
  app.use(express.json());

  // Mirror the surveys.ts/offerwalls.ts route wiring exactly: each route runs
  // verifyWebhook(provider, req) and returns 403 with the route's own response
  // shape on failure. We deliberately stub the credit side-effects so these
  // tests exercise the auth gate without requiring a database.
  type Shape = "text" | "json" | "tapjoy";
  const responders: Record<Shape, { ok: (res: express.Response) => void; deny: (res: express.Response) => void }> = {
    text: {
      ok: (res) => { res.status(200).send("OK"); },
      deny: (res) => { res.status(403).send("Forbidden"); },
    },
    json: {
      ok: (res) => { res.status(200).json({ status: "received" }); },
      deny: (res) => { res.status(403).json({ error: "Forbidden" }); },
    },
    tapjoy: {
      ok: (res) => { res.status(200).send("1"); },
      deny: (res) => { res.status(403).send("0"); },
    },
  };

  function mount(
    method: "get" | "post",
    path: string,
    provider: string,
    shape: Shape,
  ) {
    app[method](path, webhookRateLimiter, (req, res) => {
      const auth = verifyWebhook(provider, req);
      if (!auth.ok) {
        logWebhookVerificationFailure(req, provider, auth.reason ?? "unknown");
        return responders[shape].deny(res);
      }
      return responders[shape].ok(res);
    });
  }

  mount("get",  "/api/surveys/webhook/pollfish",   "pollfish",  "text");
  mount("post", "/api/surveys/webhook/cint",       "cint",      "json");
  mount("post", "/api/surveys/webhook/lucid",      "lucid",     "json");
  mount("get",  "/api/offerwalls/webhook/tapjoy",  "tapjoy",    "tapjoy");
  mount("post", "/api/offerwalls/webhook/adgate",  "adgate",    "json");
  mount("post", "/api/offerwalls/webhook/offertoro", "offertoro", "json");
  mount("post", "/api/offerwalls/webhook/lootably",  "lootably",  "json");
  mount("post", "/api/offerwalls/webhook/adjoe",     "adjoe",     "json");
});

beforeEach(async () => {
  for (const [k, v] of Object.entries(SECRETS)) {
    process.env[k] = v;
  }
  const { reloadWebhookSecrets } = await import("./webhookAuth");
  reloadWebhookSecrets();
});

const md5 = (s: string) => crypto.createHash("md5").update(s).digest("hex");

describe("webhook routes — 403 on bad signature, 200 on good signature", () => {
  describe("GET /api/surveys/webhook/pollfish (text response)", () => {
    it("returns 403 Forbidden when the secret token is missing", async () => {
      const res = await request(app).get("/api/surveys/webhook/pollfish");
      expect(res.status).toBe(403);
      expect(res.text).toBe("Forbidden");
    });

    it("returns 403 Forbidden when the secret token is wrong", async () => {
      const res = await request(app)
        .get("/api/surveys/webhook/pollfish")
        .query({ secret: "nope" });
      expect(res.status).toBe(403);
    });

    it("returns 200 OK when the secret token matches", async () => {
      const res = await request(app)
        .get("/api/surveys/webhook/pollfish")
        .query({ secret: SECRETS.POLLFISH_WEBHOOK_SECRET });
      expect(res.status).toBe(200);
      expect(res.text).toBe("OK");
    });
  });

  describe("POST /api/surveys/webhook/cint (JSON response)", () => {
    it("returns 403 with JSON body when no signature is provided", async () => {
      const res = await request(app)
        .post("/api/surveys/webhook/cint")
        .send({ survey_id: "s1", respondent_id: "r1" });
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "Forbidden" });
    });

    it("returns 200 when ?token= matches the configured secret", async () => {
      const res = await request(app)
        .post("/api/surveys/webhook/cint")
        .query({ token: SECRETS.CINT_WEBHOOK_SECRET })
        .send({ survey_id: "s1", respondent_id: "r1" });
      expect(res.status).toBe(200);
    });
  });

  describe("POST /api/surveys/webhook/lucid (JSON response)", () => {
    it("returns 403 when HMAC signature is invalid", async () => {
      const res = await request(app)
        .post("/api/surveys/webhook/lucid")
        .set("x-webhook-signature", "deadbeef")
        .send({ SurveyNumber: "1" });
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "Forbidden" });
    });

    it("returns 200 when ?sig= matches the configured secret", async () => {
      const res = await request(app)
        .post("/api/surveys/webhook/lucid")
        .query({ sig: SECRETS.LUCID_WEBHOOK_SECRET })
        .send({ SurveyNumber: "1" });
      expect(res.status).toBe(200);
    });
  });

  describe("GET /api/offerwalls/webhook/tapjoy (tapjoy '0'/'1' response)", () => {
    it("returns 403 with body '0' when the verifier is missing", async () => {
      const res = await request(app)
        .get("/api/offerwalls/webhook/tapjoy")
        .query({ id: "a", snuid: "b", currency: "c" });
      expect(res.status).toBe(403);
      expect(res.text).toBe("0");
    });

    it("returns 403 with body '0' when the verifier is wrong", async () => {
      const verifier = md5("a:b:c:WRONG-SECRET");
      const res = await request(app)
        .get("/api/offerwalls/webhook/tapjoy")
        .query({ id: "a", snuid: "b", currency: "c", verifier });
      expect(res.status).toBe(403);
      expect(res.text).toBe("0");
    });

    it("returns 200 with body '1' when the verifier MD5 matches", async () => {
      const verifier = md5(`a:b:c:${SECRETS.TAPJOY_WEBHOOK_SECRET}`);
      const res = await request(app)
        .get("/api/offerwalls/webhook/tapjoy")
        .query({ id: "a", snuid: "b", currency: "c", verifier });
      expect(res.status).toBe(200);
      expect(res.text).toBe("1");
    });

    it("returns 403 even when a generic ?secret= is provided (provider verifier is exclusive)", async () => {
      const res = await request(app)
        .get("/api/offerwalls/webhook/tapjoy")
        .query({ secret: SECRETS.TAPJOY_WEBHOOK_SECRET });
      expect(res.status).toBe(403);
    });
  });

  describe("POST /api/offerwalls/webhook/adgate (hash_value)", () => {
    it("returns 403 when hash_value is wrong", async () => {
      const res = await request(app)
        .post("/api/offerwalls/webhook/adgate")
        .send({
          transaction_id: "tx",
          user_id: "u",
          payout: "1",
          hash_value: "deadbeef",
        });
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "Forbidden" });
    });

    it("returns 200 when hash_value MD5 matches", async () => {
      const hash_value = md5(`tx${"u"}${"1"}${SECRETS.ADGATE_WEBHOOK_SECRET}`);
      const res = await request(app)
        .post("/api/offerwalls/webhook/adgate")
        .send({ transaction_id: "tx", user_id: "u", payout: "1", hash_value });
      expect(res.status).toBe(200);
    });
  });

  describe("POST /api/offerwalls/webhook/offertoro (ot_sig)", () => {
    it("returns 403 when ot_sig is missing", async () => {
      const res = await request(app)
        .post("/api/offerwalls/webhook/offertoro")
        .send({ offer_id: "o", user_id: "u", payout: "1" });
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "Forbidden" });
    });

    it("returns 403 when ot_sig is wrong", async () => {
      const res = await request(app)
        .post("/api/offerwalls/webhook/offertoro")
        .send({ offer_id: "o", user_id: "u", payout: "1", ot_sig: "abc" });
      expect(res.status).toBe(403);
    });

    it("returns 200 when ot_sig MD5 matches", async () => {
      const ot_sig = md5(`o${"u"}${"1"}${SECRETS.OFFERTORO_WEBHOOK_SECRET}`);
      const res = await request(app)
        .post("/api/offerwalls/webhook/offertoro")
        .send({ offer_id: "o", user_id: "u", payout: "1", ot_sig });
      expect(res.status).toBe(200);
    });
  });

  describe("POST /api/offerwalls/webhook/lootably (hash_value)", () => {
    it("returns 403 when hash_value is missing", async () => {
      const res = await request(app)
        .post("/api/offerwalls/webhook/lootably")
        .send({ transaction_id: "tx", user_id: "u", payout: "1" });
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "Forbidden" });
    });

    it("returns 403 when hash_value is wrong", async () => {
      const res = await request(app)
        .post("/api/offerwalls/webhook/lootably")
        .send({ transaction_id: "tx", user_id: "u", payout: "1", hash_value: "deadbeef" });
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "Forbidden" });
    });

    it("returns 200 when hash_value MD5 matches", async () => {
      const hash_value = md5(`tx${"u"}${"1"}${SECRETS.LOOTABLY_WEBHOOK_SECRET}`);
      const res = await request(app)
        .post("/api/offerwalls/webhook/lootably")
        .send({ transaction_id: "tx", user_id: "u", payout: "1", hash_value });
      expect(res.status).toBe(200);
    });
  });

  describe("POST /api/offerwalls/webhook/adjoe (hash_value)", () => {
    it("returns 403 when hash_value is missing", async () => {
      const res = await request(app)
        .post("/api/offerwalls/webhook/adjoe")
        .send({ transaction_id: "tx", user_id: "u", payout: "1" });
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "Forbidden" });
    });

    it("returns 403 when hash_value is wrong", async () => {
      const res = await request(app)
        .post("/api/offerwalls/webhook/adjoe")
        .send({ transaction_id: "tx", user_id: "u", payout: "1", hash_value: "deadbeef" });
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "Forbidden" });
    });

    it("returns 200 when hash_value MD5 matches", async () => {
      const hash_value = md5(`tx${"u"}${"1"}${SECRETS.ADJOE_WEBHOOK_SECRET}`);
      const res = await request(app)
        .post("/api/offerwalls/webhook/adjoe")
        .send({ transaction_id: "tx", user_id: "u", payout: "1", hash_value });
      expect(res.status).toBe(200);
    });
  });

  describe("when a secret is not configured", () => {
    it("returns 403 even with what would otherwise be a valid token", async () => {
      delete process.env.POLLFISH_WEBHOOK_SECRET;
      const { reloadWebhookSecrets } = await import("./webhookAuth");
      reloadWebhookSecrets();
      const res = await request(app)
        .get("/api/surveys/webhook/pollfish")
        .query({ secret: "anything" });
      expect(res.status).toBe(403);
    });
  });
});

// ---------------------------------------------------------------------------
// Admin webhook-audit route — integration tests
// ---------------------------------------------------------------------------
//
// Mounts the real production handler (the one in src/routes/cashclip.ts) on a
// minimal Express app and exercises:
//   - 401 / 403 for unauthenticated and non-admin callers
//   - provider / ip / since(Ms) filters are forwarded to storage
//   - the offenders array is grouped by (ip, provider) with stable shape
//
// `storage` is mocked so the tests do not require a database. `adminMiddleware`
// reads `storage.getUser`, so that is mocked to return either an admin or a
// regular user depending on the JWT.

describe("admin webhook-audit route", () => {
  let adminApp: Express;
  let signToken: (userId: string, role: string) => string;

  const sampleEntries = [
    {
      id: "a1",
      provider: "pollfish",
      reason: "Invalid token",
      ip: "203.0.113.7",
      forwardedFor: "203.0.113.7, 10.0.0.1",
      userAgent: "agent/1",
      method: "POST",
      path: "/api/surveys/webhook/pollfish",
      hasSignatureHeader: false,
      secretConfigured: true,
      statusCode: 401,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    },
    {
      id: "a2",
      provider: "cint",
      reason: "Invalid signature",
      ip: "198.51.100.4",
      forwardedFor: null,
      userAgent: null,
      method: "POST",
      path: "/api/surveys/webhook/cint",
      hasSignatureHeader: true,
      secretConfigured: true,
      statusCode: 401,
      createdAt: new Date("2026-01-02T00:00:00Z"),
    },
  ];

  const sampleOffenders = [
    {
      ip: "203.0.113.7",
      provider: "pollfish",
      count: 12,
      lastSeenAt: new Date("2026-01-03T00:00:00Z"),
    },
    {
      ip: "198.51.100.4",
      provider: "cint",
      count: 4,
      lastSeenAt: new Date("2026-01-02T00:00:00Z"),
    },
  ];

  // Mock function references — resolved from the hoisted storageMocks object
  // so we never need vi.doMock / vi.resetModules in this describe block.
  const getUserMock = storageMocks.getUser;
  const getWebhookAuditsMock = storageMocks.getWebhookAudits;
  const getWebhookAuditOffendersMock = storageMocks.getWebhookAuditOffenders;
  const getWebhookAuditProvidersMock = storageMocks.getWebhookAuditProviders;

  beforeAll(async () => {
    // adminMiddleware is mocked (see vi.mock("../auth") at the top of this
    // file) to use jwt.decode instead of jwt.verify, so the signing key does
    // not need to match JWT_SECRET. Any stable key produces valid test tokens.
    const jwt = (await import("jsonwebtoken")).default;
    signToken = (userId, role) =>
      jwt.sign({ userId, role }, "test-secret", { expiresIn: "1h" });

    const { registerRoutes } = await import("../routes/cashclip");

    adminApp = express();
    adminApp.use(express.json());
    // Attach a noop request-scoped logger to mirror what pino-http normally
    // provides in production. Without this, route handlers that call
    // `req.log.error(...)` would throw and produce an empty 500 body.
    adminApp.use((req, _res, next) => {
      const noop = () => {};
      (req as unknown as { log: Record<string, unknown> }).log = {
        info: noop, warn: noop, error: noop, debug: noop, trace: noop, fatal: noop,
        child: () => (req as unknown as { log: unknown }).log,
      };
      next();
    });
    await registerRoutes(adminApp);
  });

  beforeEach(() => {
    getUserMock.mockReset();
    getWebhookAuditsMock.mockReset();
    getWebhookAuditOffendersMock.mockReset();
    getWebhookAuditProvidersMock.mockReset();

    getWebhookAuditsMock.mockResolvedValue(sampleEntries);
    getWebhookAuditOffendersMock.mockResolvedValue(sampleOffenders);
    getWebhookAuditProvidersMock.mockResolvedValue(["cint", "pollfish"]);

    getUserMock.mockImplementation(async (id: string) => {
      if (id === "admin-1") return { id: "admin-1", role: "admin", tokenVersion: undefined, emailVerified: true };
      if (id === "user-1") return { id: "user-1", role: "user", tokenVersion: undefined, emailVerified: true };
      return undefined;
    });
  });

  it("returns 401 when no Authorization header is provided", async () => {
    const res = await request(adminApp).get("/api/admin/webhook-audit");
    expect(res.status).toBe(401);
    expect(getWebhookAuditsMock).not.toHaveBeenCalled();
  });

  it("returns 401 when the bearer token is invalid", async () => {
    const res = await request(adminApp)
      .get("/api/admin/webhook-audit")
      .set("Authorization", "Bearer not-a-real-token");
    expect(res.status).toBe(401);
    expect(getWebhookAuditsMock).not.toHaveBeenCalled();
  });

  it("returns 403 for an authenticated non-admin user", async () => {
    const token = signToken("user-1", "user");
    const res = await request(adminApp)
      .get("/api/admin/webhook-audit")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: /admin/i });
    expect(getWebhookAuditsMock).not.toHaveBeenCalled();
  });

  it("returns audit data shaped for the dashboard for an admin", async () => {
    const token = signToken("admin-1", "admin");
    const res = await request(adminApp)
      .get("/api/admin/webhook-audit")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(getWebhookAuditsMock).toHaveBeenCalledTimes(1);
    expect(getWebhookAuditOffendersMock).toHaveBeenCalledTimes(1);
    expect(getWebhookAuditProvidersMock).toHaveBeenCalledTimes(1);

    expect(res.body.knownProviders).toEqual(["cint", "pollfish"]);
    expect(res.body.filters).toEqual({
      provider: null,
      ip: null,
      since: null,
      limit: 100,
    });

    expect(res.body.entries).toHaveLength(2);
    expect(res.body.entries[0]).toMatchObject({
      id: "a1",
      provider: "pollfish",
      ip: "203.0.113.7",
      forwardedFor: "203.0.113.7, 10.0.0.1",
      hasSignatureHeader: false,
      secretConfigured: true,
      statusCode: 401,
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    // Offenders are grouped by (ip, provider) with a numeric count and ISO ts.
    expect(res.body.offenders).toHaveLength(2);
    expect(res.body.offenders[0]).toEqual({
      ip: "203.0.113.7",
      provider: "pollfish",
      count: 12,
      lastSeenAt: "2026-01-03T00:00:00.000Z",
    });
    expect(res.body.offenders[1]).toEqual({
      ip: "198.51.100.4",
      provider: "cint",
      count: 4,
      lastSeenAt: "2026-01-02T00:00:00.000Z",
    });
  });

  it("forwards provider/ip/limit filters to storage and echoes them back", async () => {
    const token = signToken("admin-1", "admin");
    const res = await request(adminApp)
      .get("/api/admin/webhook-audit")
      .query({ provider: "pollfish", ip: "203.0.113.7", limit: "25" })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(getWebhookAuditsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "pollfish",
        ip: "203.0.113.7",
        limit: 25,
        since: undefined,
      }),
    );
    expect(res.body.filters).toEqual({
      provider: "pollfish",
      ip: "203.0.113.7",
      since: null,
      limit: 25,
    });
  });

  it("computes `since` from sinceMs and forwards it to both list and offenders queries", async () => {
    const token = signToken("admin-1", "admin");
    const sinceMs = 60 * 60 * 1000; // 1 hour
    const before = Date.now();
    const res = await request(adminApp)
      .get("/api/admin/webhook-audit")
      .query({ sinceMs: String(sinceMs) })
      .set("Authorization", `Bearer ${token}`);
    const after = Date.now();

    expect(res.status).toBe(200);

    const auditsArg = getWebhookAuditsMock.mock.calls[0]![0] as {
      since?: Date;
    };
    const offendersArg = getWebhookAuditOffendersMock.mock.calls[0]![0] as {
      since?: Date;
    };
    expect(auditsArg.since).toBeInstanceOf(Date);
    expect(offendersArg.since).toBeInstanceOf(Date);
    // since == now - sinceMs, computed somewhere in [before-sinceMs, after-sinceMs]
    expect(auditsArg.since!.getTime()).toBeGreaterThanOrEqual(before - sinceMs);
    expect(auditsArg.since!.getTime()).toBeLessThanOrEqual(after - sinceMs);
    expect(res.body.filters.since).toBe(auditsArg.since!.toISOString());
  });

  it("parses ISO `since` strings", async () => {
    const token = signToken("admin-1", "admin");
    const since = "2026-01-01T00:00:00.000Z";
    const res = await request(adminApp)
      .get("/api/admin/webhook-audit")
      .query({ since })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const arg = getWebhookAuditsMock.mock.calls[0]![0] as { since?: Date };
    expect(arg.since?.toISOString()).toBe(since);
    expect(res.body.filters.since).toBe(since);
  });

  it("ignores unparseable `since` values (treats as no filter)", async () => {
    const token = signToken("admin-1", "admin");
    const res = await request(adminApp)
      .get("/api/admin/webhook-audit")
      .query({ since: "not-a-date" })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const arg = getWebhookAuditsMock.mock.calls[0]![0] as { since?: Date };
    expect(arg.since).toBeUndefined();
    expect(res.body.filters.since).toBeNull();
  });

  it("clamps unreasonably large limit values to the route's max (500)", async () => {
    const token = signToken("admin-1", "admin");
    const res = await request(adminApp)
      .get("/api/admin/webhook-audit")
      .query({ limit: "999999" })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const arg = getWebhookAuditsMock.mock.calls[0]![0] as { limit?: number };
    expect(arg.limit).toBe(500);
    expect(res.body.filters.limit).toBe(500);
  });

  it("returns 500 if the storage layer throws", async () => {
    getWebhookAuditsMock.mockRejectedValueOnce(new Error("db boom"));
    const token = signToken("admin-1", "admin");
    const res = await request(adminApp)
      .get("/api/admin/webhook-audit")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: expect.any(String) });
  });
});
