/**
 * Integration tests: sponsored visit /begin endpoint.
 *
 * These tests exercise the full POST /api/earn/sponsored/:id/begin handler
 * path — from HTTP request through the mock DB layer — and assert the
 * outcomes required to prevent silent regressions in:
 *
 *   1. Happy path — begin returns an attempt token + redirect URL.
 *   2. postbackSecret guard — campaigns missing the secret are rejected (503).
 *   3. Self-visit guard — users cannot begin a visit on their own campaign (400).
 *   4. Already-visited guard — prior click record → 409.
 *   5. Budget-exhausted guard — no remaining budget → 400.
 *   6. Install-token validation — missing/malformed/unknown/cross-user → 400/403.
 *   7. Campaign-not-found / inactive → 404/400.
 *
 * The DB is replaced by a mock driven by shared mutable state so tests can
 * exercise every guard without a real Postgres connection, following the
 * pattern in `cashclip.sponsoredVisitSettlement.test.ts`.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import type { Express } from "express";

const TEST_JWT_SECRET = "test-jwt-secret-for-begin-tests-padded-to-64chars-aabbccddeeff00";
const INSTALL_TOKEN   = "cd".repeat(32); // valid 64-char hex X-Install-Token
const CAMPAIGN_ID     = "camp-begin-1";
const USER_ID         = "user-begin-1";
const CAMP_OWNER_ID   = "camp-owner-begin-1"; // campaign owner — NOT the visitor

// ── Shared mutable state ──────────────────────────────────────────────────────

let campaignRow: Record<string, unknown> | null = null;
let clickRow:    Record<string, unknown> | null = null;
let installRow:  Record<string, unknown> | null = null;
let insertedAttempt = false;

// ── @workspace/db mock ────────────────────────────────────────────────────────

vi.mock("@workspace/db", async () => {
  const actual = await vi.importActual<typeof import("@workspace/db")>("@workspace/db");

  const db = {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockImplementation((table: unknown) => ({
        where: vi.fn().mockImplementation(async () => {
          if (table === actual.campaigns) {
            return campaignRow ? [campaignRow] : [];
          }
          if (table === actual.campaignClicks) {
            return clickRow ? [clickRow] : [];
          }
          if (table === actual.deviceInstalls) {
            return installRow ? [installRow] : [];
          }
          return [];
        }),
      })),
    })),

    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockImplementation(async () => {
        insertedAttempt = true;
        return [];
      }),
    })),

    update: vi.fn(),
    execute: vi.fn().mockResolvedValue({ rows: [] }),
    transaction: vi.fn(),
  };

  return { ...actual, db };
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

vi.mock("../auth", () => ({
  RESERVED_ADMIN_USERNAMES: new Set<string>(),
  registerAuthRoutes: () => {},
  authMiddleware: (req: any, _res: any, next: any) => {
    req.userId = USER_ID;
    next();
  },
  adminMiddleware: async (_req: any, res: any) => {
    res.status(401).json({ error: "No token" });
  },
}));

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

  insertedAttempt = false;
  clickRow        = null;

  campaignRow = {
    id:             CAMPAIGN_ID,
    userId:         CAMP_OWNER_ID,
    title:          "Begin Test Campaign",
    rewardPerVisit: "0.05",
    totalBudget:    "100.00",
    spent:          "0.00",
    clicks:         0,
    status:         "active",
    postbackSecret: "secret-abc123",
    createdAt:      new Date(),
    updatedAt:      new Date(),
  };

  installRow = {
    userId:    USER_ID,
    tokenHash: "any-hash",
    createdAt: new Date(),
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function doBegin(opts: { installToken?: string; omitInstallToken?: boolean } = {}) {
  const { installToken = INSTALL_TOKEN, omitInstallToken = false } = opts;
  const req = request(app)
    .post(`/api/earn/sponsored/${CAMPAIGN_ID}/begin`)
    .set("Content-Type", "application/json");
  if (!omitInstallToken) req.set("X-Install-Token", installToken);
  return req.send({});
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/earn/sponsored/:id/begin", () => {

  // ── 1. Happy path ───────────────────────────────────────────────────────────
  describe("happy path", () => {
    it("returns 200 with an attemptToken and redirectUrl", async () => {
      const res = await doBegin();

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("attemptToken");
      expect(res.body).toHaveProperty("redirectUrl");
    });

    it("attemptToken is a 64-char hex string", async () => {
      const res = await doBegin();

      expect(res.status).toBe(200);
      expect(res.body.attemptToken).toMatch(/^[a-f0-9]{64}$/);
    });

    it("redirectUrl contains the issued attempt token", async () => {
      const res = await doBegin();

      expect(res.status).toBe(200);
      expect(res.body.redirectUrl).toContain(res.body.attemptToken);
    });

    it("visitSessionToken is present in the response", async () => {
      const res = await doBegin();

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("visitSessionToken");
      expect(typeof res.body.visitSessionToken).toBe("string");
      expect(res.body.visitSessionToken.length).toBeGreaterThan(0);
    });

    it("writes an attempt row to the DB", async () => {
      expect(insertedAttempt).toBe(false);
      await doBegin();
      expect(insertedAttempt).toBe(true);
    });
  });

  // ── 2. postbackSecret guard ─────────────────────────────────────────────────
  describe("postbackSecret guard", () => {
    it("returns 503 when the campaign has no postbackSecret (null)", async () => {
      campaignRow = { ...campaignRow, postbackSecret: null };

      const res = await doBegin();

      expect(res.status).toBe(503);
    });

    it("503 response mentions configuration / support", async () => {
      campaignRow = { ...campaignRow, postbackSecret: null };

      const res = await doBegin();

      expect(res.body.error).toMatch(/not fully configured|contact support/i);
    });

    it("does not write an attempt row when postbackSecret is missing", async () => {
      campaignRow = { ...campaignRow, postbackSecret: null };

      await doBegin();

      expect(insertedAttempt).toBe(false);
    });
  });

  // ── 3. Self-visit guard ─────────────────────────────────────────────────────
  describe("self-visit guard", () => {
    it("returns 400 when the visitor owns the campaign", async () => {
      campaignRow = { ...campaignRow, userId: USER_ID };

      const res = await doBegin();

      expect(res.status).toBe(400);
    });

    it("400 response mentions own campaign", async () => {
      campaignRow = { ...campaignRow, userId: USER_ID };

      const res = await doBegin();

      expect(res.body.error).toMatch(/own campaign/i);
    });

    it("does not write an attempt row on a self-visit", async () => {
      campaignRow = { ...campaignRow, userId: USER_ID };

      await doBegin();

      expect(insertedAttempt).toBe(false);
    });
  });

  // ── 4. Already-visited guard ────────────────────────────────────────────────
  describe("already-visited guard", () => {
    it("returns 409 when the user already has a click record for this campaign", async () => {
      clickRow = { campaignId: CAMPAIGN_ID, visitorUserId: USER_ID };

      const res = await doBegin();

      expect(res.status).toBe(409);
      expect(res.body.alreadyVisited).toBe(true);
    });

    it("does not write a new attempt row when already visited", async () => {
      clickRow = { campaignId: CAMPAIGN_ID, visitorUserId: USER_ID };

      await doBegin();

      expect(insertedAttempt).toBe(false);
    });
  });

  // ── 5. Budget-exhausted guard ───────────────────────────────────────────────
  describe("budget exhausted", () => {
    it("returns 400 when remaining budget is less than rewardPerVisit", async () => {
      campaignRow = { ...campaignRow, rewardPerVisit: "5.00", totalBudget: "4.00", spent: "0.00" };

      const res = await doBegin();

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/budget/i);
    });

    it("does not write an attempt row when budget is exhausted", async () => {
      campaignRow = { ...campaignRow, rewardPerVisit: "5.00", totalBudget: "4.00", spent: "0.00" };

      await doBegin();

      expect(insertedAttempt).toBe(false);
    });
  });

  // ── 6. Campaign-not-found / inactive ────────────────────────────────────────
  describe("campaign lookup guards", () => {
    it("returns 404 when the campaign does not exist", async () => {
      campaignRow = null;

      const res = await doBegin();

      expect(res.status).toBe(404);
    });

    it("returns 400 when the campaign is not active (paused)", async () => {
      campaignRow = { ...campaignRow, status: "paused" };

      const res = await doBegin();

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/not active/i);
    });

    it("returns 400 when the campaign is not active (completed)", async () => {
      campaignRow = { ...campaignRow, status: "completed" };

      const res = await doBegin();

      expect(res.status).toBe(400);
    });
  });

  // ── 7. Install-token validation ─────────────────────────────────────────────
  describe("install token validation", () => {
    it("returns 400 when X-Install-Token header is absent", async () => {
      const res = await doBegin({ omitInstallToken: true });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/missing|install token/i);
    });

    it("returns 400 when X-Install-Token is not a 64-char hex string", async () => {
      const res = await doBegin({ installToken: "not-valid-hex" });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid|missing|install token/i);
    });

    it("returns 400 for a token that is only 63 chars (one short)", async () => {
      const res = await doBegin({ installToken: "a".repeat(63) });

      expect(res.status).toBe(400);
    });

    it("returns 403 when the install token is not found in the DB", async () => {
      installRow = null;

      const res = await doBegin();

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/unrecogni[sz]ed|install token/i);
    });

    it("does not write an attempt row when the install token is unknown", async () => {
      installRow = null;

      await doBegin();

      expect(insertedAttempt).toBe(false);
    });

    it("returns 403 when the install token belongs to a different user", async () => {
      installRow = { userId: "some-other-user", tokenHash: "any-hash", createdAt: new Date() };

      const res = await doBegin();

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/does not belong/i);
    });

    it("does not write an attempt row when the install token is cross-user", async () => {
      installRow = { userId: "some-other-user", tokenHash: "any-hash", createdAt: new Date() };

      await doBegin();

      expect(insertedAttempt).toBe(false);
    });
  });
});
