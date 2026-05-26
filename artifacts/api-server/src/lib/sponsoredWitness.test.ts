/**
 * Abuse tests for the server-observed completion redirect flow.
 *
 * Adversarial scenario being tested:
 *   A script that calls /begin, fetches /r/:token (parses the completion URL),
 *   and then POSTs directly to /visit WITHOUT following /c/:token must NOT
 *   receive a reward — /visit rejects with 400 because witnessedAt is null.
 *
 * /c/:token is the server-observed gate:
 *   - The browser MUST route through GET /c/:token?q=<sig> to reach the
 *     advertiser; the server records witnessedAt during that GET.
 *   - sig = HMAC-SHA256(JWT_SECRET, "completion:"+token) — unforgeable
 *     without the server secret.
 *   - Without a valid sig, /c/:token returns 403 and witnessedAt stays null,
 *     so /visit rejects settlement.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { createHmac } from "crypto";
import type { Express } from "express";

const TEST_JWT_SECRET = "test-jwt-secret-for-sponsored-witness-tests-padded-to-64-chars-xy";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const dbMocks = vi.hoisted(() => {
  const attempt = {
    token: "a".repeat(64),
    campaignId: "camp-1",
    userId: "user-1",
    rewardSnapshot: "0.05",
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    redirectedAt: new Date(Date.now() - 60_000),
    redirectIpHash: "dummy-ip-hash",
    redirectUaHash: "dummy-ua-hash",
    witnessedAt: null as Date | null,
    settledAt: null as Date | null,
  };

  const campaign = {
    id: "camp-1",
    publisherId: "pub-1",
    title: "Test Campaign",
    targetUrl: "https://example-advertiser.com/offer",
    rewardPerVisit: "0.05",
    totalBudget: "10.00",
    spent: "0.00",
    clicks: 0,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Mutable state reset in beforeEach
  const attemptRows: typeof attempt[] = [];
  const campaignRows: typeof campaign[] = [];

  // Call-count-based select: first call → attemptRows, second → campaignRows.
  // Reset via selectCallIdx in beforeEach.
  let selectCallIdx = 0;

  const db = {
    selectCallIdx: { get: () => selectCallIdx, reset: () => { selectCallIdx = 0; }, inc: () => selectCallIdx++ },
    select: vi.fn(),
    update: vi.fn(),
    execute: vi.fn().mockResolvedValue({ rows: [{ n: 0 }] }), // device-cap check
    transaction: vi.fn().mockImplementation(async (cb: (t: unknown) => Promise<unknown>) => cb({})),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnThis(), returning: vi.fn().mockResolvedValue([]) }),
  };

  return { attempt, campaign, attemptRows, campaignRows, db };
});

vi.mock("@workspace/db", async () => {
  const actual = await vi.importActual<typeof import("@workspace/db")>("@workspace/db");
  return { ...actual, db: dbMocks.db };
});

vi.mock("../storage", () => ({
  storage: {
    getUser: vi.fn().mockResolvedValue(null),
    getUserByUsername: vi.fn().mockResolvedValue(null),
    getWebhookAudits: vi.fn().mockResolvedValue([]),
    getWebhookAuditOffenders: vi.fn().mockResolvedValue([]),
    getWebhookAuditProviders: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../paypal", () => ({
  sendPayPalPayout: vi.fn(),
  isPayPalConfigured: () => false,
  initPayPal: vi.fn(),
}));

vi.mock("../auth", async () => {
  const { default: jwt } = await import("jsonwebtoken");
  return {
    RESERVED_ADMIN_USERNAMES: new Set<string>(),
    registerAuthRoutes: () => {},
    // Simulate an authenticated ordinary user (userId "user-1") so that the
    // /visit userId === attempt.userId guard does not short-circuit the test.
    authMiddleware: (req: any, _res: any, next: any) => {
      req.userId = "user-1";
      next();
    },
    adminMiddleware: async (req: any, res: any, next: any) => {
      const header = req.headers["authorization"];
      if (!header?.startsWith("Bearer ")) { res.status(401).json({ error: "No token" }); return; }
      const payload = jwt.decode(header.split(" ")[1]!) as { role?: string } | null;
      if (payload?.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
      next();
    },
  };
});

// Mock DB-backed rate limiter so rate-limit gates don't error out in tests.
vi.mock("../lib/dbRateLimit", () => ({
  recordLoginAttempt: vi.fn().mockResolvedValue({ allowed: true, current: 1 }),
  checkLoginAttempts: vi.fn().mockResolvedValue({ allowed: true, current: 1 }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCompletionSig(token: string): string {
  return createHmac("sha256", TEST_JWT_SECRET)
    .update("completion:" + token)
    .digest("hex");
}

const VALID_TOKEN = "a".repeat(64);
const OTHER_TOKEN  = "b".repeat(64);

// ── Test setup ────────────────────────────────────────────────────────────────

let app: Express;

beforeAll(async () => {
  // Pin JWT_ACCESS_SECRET to the test secret so the HMAC sig matches.
  process.env.JWT_ACCESS_SECRET = TEST_JWT_SECRET;
  process.env.JWT_SECRET      = TEST_JWT_SECRET;
  process.env.DATABASE_URL  ??= "postgres://test:test@127.0.0.1:5432/test";
  process.env.MIN_SPONSORED_VISIT_MS = "0"; // disable dwell-time gate for tests

  const { registerRoutes } = await import("../routes/cashclip");
  app = express();
  app.use(express.json());
  registerRoutes(app);
});

beforeEach(() => {
  vi.clearAllMocks();

  // Reset rows
  dbMocks.attemptRows.length  = 0;
  dbMocks.campaignRows.length = 0;
  dbMocks.attemptRows.push({
    ...dbMocks.attempt,
    token: VALID_TOKEN,
    witnessedAt: null,
    settledAt:   null,
    expiresAt:   new Date(Date.now() + 15 * 60 * 1000),
    redirectedAt: new Date(Date.now() - 60_000),
  });
  dbMocks.campaignRows.push({ ...dbMocks.campaign });

  // Reset call counter
  dbMocks.db.selectCallIdx.reset();

  // Call-count-based select: call 0 → attemptRows, call 1+ → campaignRows.
  // This mirrors the actual handler call order (attempt first, campaign second).
  dbMocks.db.select.mockImplementation(() => {
    const idx = dbMocks.db.selectCallIdx.inc(); // returns the PREVIOUS value (0-based)
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(
          // selectCallIdx.inc() post-increments via the actual counter value
          idx === 0 ? [...dbMocks.attemptRows] : [...dbMocks.campaignRows],
        ),
      }),
    };
  });

  dbMocks.db.update.mockReturnValue({
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([{ id: "1" }]),
  });

  // Device-cap raw SQL returns 0 distinct accounts.
  dbMocks.db.execute.mockResolvedValue({ rows: [{ n: 0 }] });
});

// ── Tests: completion redirect /c/:token ──────────────────────────────────────

describe("GET /api/earn/sponsored/c/:token — server-observed completion redirect", () => {
  describe("signature gate (no DB access on failure)", () => {
    it("returns 403 when ?q sig is missing", async () => {
      const res = await request(app).get(`/api/earn/sponsored/c/${VALID_TOKEN}`);
      expect(res.status).toBe(403);
      expect(dbMocks.db.select).not.toHaveBeenCalled();
    });

    it("returns 403 when ?q sig is wrong (attacker guessing)", async () => {
      const res = await request(app)
        .get(`/api/earn/sponsored/c/${VALID_TOKEN}?q=${"0".repeat(64)}`);
      expect(res.status).toBe(403);
      expect(dbMocks.db.select).not.toHaveBeenCalled();
    });

    it("returns 403 when sig is for a different token (replay)", async () => {
      const wrongSig = makeCompletionSig(OTHER_TOKEN);
      const res = await request(app)
        .get(`/api/earn/sponsored/c/${VALID_TOKEN}?q=${wrongSig}`);
      expect(res.status).toBe(403);
      expect(dbMocks.db.select).not.toHaveBeenCalled();
    });

    it("returns 404 for a malformed token regardless of sig", async () => {
      const res = await request(app)
        .get("/api/earn/sponsored/c/not-valid-hex?q=anything");
      expect(res.status).toBe(404);
      expect(dbMocks.db.select).not.toHaveBeenCalled();
    });
  });

  describe("with correct sig — happy path", () => {
    it("redirects 302 to the campaign target URL", async () => {
      const sig = makeCompletionSig(VALID_TOKEN);
      const res = await request(app)
        .get(`/api/earn/sponsored/c/${VALID_TOKEN}?q=${sig}`)
        .redirects(0);

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(dbMocks.campaign.targetUrl);
    });

    it("calls DB update to set witnessedAt on first call", async () => {
      const sig = makeCompletionSig(VALID_TOKEN);
      await request(app)
        .get(`/api/earn/sponsored/c/${VALID_TOKEN}?q=${sig}`)
        .redirects(0);

      expect(dbMocks.db.update).toHaveBeenCalledTimes(1);
    });

    it("skips DB update when attempt is already witnessed (idempotent)", async () => {
      dbMocks.attemptRows[0]!.witnessedAt = new Date(Date.now() - 5000);
      const sig = makeCompletionSig(VALID_TOKEN);
      const res = await request(app)
        .get(`/api/earn/sponsored/c/${VALID_TOKEN}?q=${sig}`)
        .redirects(0);

      expect(res.status).toBe(302);
      expect(dbMocks.db.update).not.toHaveBeenCalled();
    });

    it("returns 410 when the attempt has expired", async () => {
      dbMocks.attemptRows[0]!.expiresAt = new Date(Date.now() - 1000);
      const sig = makeCompletionSig(VALID_TOKEN);
      const res = await request(app)
        .get(`/api/earn/sponsored/c/${VALID_TOKEN}?q=${sig}`);

      expect(res.status).toBe(410);
    });

    it("returns 404 when the attempt does not exist", async () => {
      dbMocks.attemptRows.length = 0;
      // Re-wire select so first call returns empty array
      dbMocks.db.selectCallIdx.reset();
      dbMocks.db.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
      }));

      const sig = makeCompletionSig(VALID_TOKEN);
      const res = await request(app)
        .get(`/api/earn/sponsored/c/${VALID_TOKEN}?q=${sig}`);

      expect(res.status).toBe(404);
    });
  });
});

// ── Tests: deprecated /witness/:token ────────────────────────────────────────

describe("POST /api/earn/sponsored/witness/:token — deprecated endpoint", () => {
  it("returns 410 Gone regardless of request body", async () => {
    const res = await request(app)
      .post(`/api/earn/sponsored/witness/${VALID_TOKEN}`)
      .set("Content-Type", "application/json")
      .send({ nonce: "anything" });

    expect(res.status).toBe(410);
  });

  it("returns 410 for an empty body (old scripted-attack pattern)", async () => {
    const res = await request(app)
      .post(`/api/earn/sponsored/witness/${VALID_TOKEN}`)
      .set("Content-Type", "application/json")
      .send({});

    expect(res.status).toBe(410);
  });
});

// ── Tests: adversarial full-flow proof ───────────────────────────────────────

describe("Adversarial: scripted begin→r→visit (skipping /c/:token)", () => {
  it("POST /visit is rejected 400 when witnessedAt is null", async () => {
    // Simulate the attempt state AFTER /r/:token was fetched
    // (redirectedAt set, enough dwell time elapsed) but BEFORE /c/:token was
    // called (witnessedAt null). This is the scripted-API attack path:
    //   GET /r/:token → parse sig → POST /visit (skip /c/:token entirely)
    // /visit must reject because witnessedAt is still null.

    dbMocks.attemptRows[0]!.witnessedAt  = null;
    dbMocks.attemptRows[0]!.redirectedAt = new Date(Date.now() - 60_000);

    // Re-wire select so both attempt and campaign queries succeed in order.
    let idx2 = 0;
    dbMocks.db.select.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(
          idx2++ === 0 ? [...dbMocks.attemptRows] : [...dbMocks.campaignRows],
        ),
      }),
    }));

    const res = await request(app)
      .post("/api/earn/sponsored/camp-1/visit")
      .set("Content-Type", "application/json")
      .send({ attemptToken: VALID_TOKEN });

    // 400 — witnessedAt gate fires before any money movement
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/confirm|witness|link|reopen/i);
  });
});
