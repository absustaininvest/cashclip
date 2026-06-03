/**
 * Integration tests: sponsored visit /r/:token redirect-proxy endpoint.
 *
 * GET /api/earn/sponsored/r/:token is the first server-observed step after
 * /begin.  The handler:
 *   1. Validates the token format and looks up the attempt row.
 *   2. Validates the ?vst= visitSessionToken (HMAC-SHA256 bound to the
 *      attempt token and userId — only producible from the /begin response).
 *   3. Stamps redirectedAt once (COALESCE — idempotent) and stores a
 *      fresh witnessNonce in the DB.
 *   4. Returns interstitial HTML (200) — NOT a 302; the HTML's JS later
 *      navigates the browser to /c/:token after the dwell timer fires.
 *
 * Cases covered:
 *   1. Happy path — DB update called, 200 HTML returned.
 *   2. Already-redirected — idempotent; update still called (COALESCE guards).
 *   3. Token not found → 404.
 *   4. Expired attempt → 410.
 *   5. Already-settled attempt → 410.
 *   6. Invalid token format → 404 (no DB hit).
 *   7. Missing VST → 403.
 *   8. Wrong VST → 403.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { createHmac } from "crypto";
import express from "express";
import request from "supertest";
import type { Express } from "express";

const TEST_JWT_SECRET = "test-jwt-secret-for-redirect-tests-padded-to-64chars-aabbccddeeff0";
const ATTEMPT_TOKEN   = "cc".repeat(32); // valid 64-char hex token
const CAMPAIGN_ID     = "camp-redirect-1";
const USER_ID         = "user-redirect-1";
const WITNESS_NONCE   = "redirect-witness-nonce-abc123456";

function makeVst(token: string, userId: string): string {
  return createHmac("sha256", TEST_JWT_SECRET)
    .update(token + ":" + userId + ":vst")
    .digest("hex");
}

// ── Shared mutable state ──────────────────────────────────────────────────────

let attemptRow: Record<string, unknown> | null = null;
let campaignRow: Record<string, unknown> | null = null;
let lastSetPayload: Record<string, unknown> | null = null;
let updateCalled = false;

// ── @workspace/db mock ────────────────────────────────────────────────────────

vi.mock("@workspace/db", async () => {
  const actual = await vi.importActual<typeof import("@workspace/db")>("@workspace/db");

  const db = {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockImplementation((table: unknown) => ({
        where: vi.fn().mockImplementation(async () => {
          if (table === actual.campaignVisitAttempts) {
            return attemptRow ? [attemptRow] : [];
          }
          if (table === actual.campaigns) {
            return campaignRow ? [campaignRow] : [];
          }
          return [];
        }),
      })),
    })),

    update: vi.fn().mockImplementation(() => {
      let capturedPayload: Record<string, unknown> | null = null;
      return {
        set: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
          capturedPayload = payload;
          return {
            where: vi.fn().mockImplementation(async () => {
              updateCalled = true;
              lastSetPayload = capturedPayload;
              return [{ token: ATTEMPT_TOKEN }];
            }),
          };
        }),
      };
    }),

    insert: vi.fn(),
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
  process.env.JWT_ACCESS_SECRET       = TEST_JWT_SECRET;
  process.env.JWT_SECRET              = TEST_JWT_SECRET;
  process.env.DATABASE_URL          ??= "postgres://test:test@127.0.0.1:5432/test";
  process.env.MIN_INTERSTITIAL_DWELL_MS = "0";  // disable dwell gate for tests
  process.env.SPONSORED_REDIRECT_IP_LIMIT   = "1000";
  process.env.SPONSORED_REDIRECT_USER_LIMIT = "1000";

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

  updateCalled = false;
  lastSetPayload = null;

  const now = Date.now();
  attemptRow = {
    token:          ATTEMPT_TOKEN,
    campaignId:     CAMPAIGN_ID,
    userId:         USER_ID,
    rewardSnapshot: "0.05",
    createdAt:      new Date(now - 3_600_000),
    expiresAt:      new Date(now + 900_000),
    redirectedAt:   null,
    witnessedAt:    null,
    settledAt:      null,
    witnessNonce:   null,
    redirectIpHash: null,
    redirectUaHash: null,
  };

  campaignRow = {
    id:             CAMPAIGN_ID,
    userId:         "camp-owner-redirect",
    title:          "Redirect Test Campaign",
    targetUrl:      "https://example-advertiser.com/offer",
    rewardPerVisit: "0.05",
    totalBudget:    "100.00",
    spent:          "0.00",
    clicks:         0,
    status:         "active",
    postbackSecret: "secret-redirect-abc",
    createdAt:      new Date(),
    updatedAt:      new Date(),
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function doRedirect(opts: { vst?: string; omitVst?: boolean; token?: string } = {}) {
  const { token = ATTEMPT_TOKEN, omitVst = false } = opts;
  const vst = opts.vst ?? makeVst(token, USER_ID);
  const url = `/api/earn/sponsored/r/${token}` + (omitVst ? "" : `?vst=${vst}`);
  return request(app).get(url);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/earn/sponsored/r/:token — redirect proxy / interstitial", () => {

  // ── 1. Happy path ────────────────────────────────────────────────────────────
  describe("happy path", () => {
    it("returns 200 with HTML content type", async () => {
      const res = await doRedirect();

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/html/i);
    });

    it("response body is HTML (contains doctype)", async () => {
      const res = await doRedirect();

      expect(res.status).toBe(200);
      expect(res.text.toLowerCase()).toContain("<!doctype html>");
    });

    it("calls DB update to stamp redirectedAt", async () => {
      expect(updateCalled).toBe(false);
      await doRedirect();
      expect(updateCalled).toBe(true);
    });

    it("DB update payload includes the redirectedAt field (stamp semantics)", async () => {
      await doRedirect();

      expect(lastSetPayload).not.toBeNull();
      // The handler sets `redirectedAt: drizzleSql\`NOW()\`` — the value is a
      // SQL expression object, not a JS Date, but the key must be present.
      expect(lastSetPayload).toHaveProperty("redirectedAt");
    });

    it("DB update payload includes a fresh witnessNonce", async () => {
      await doRedirect();

      expect(lastSetPayload).not.toBeNull();
      expect(lastSetPayload).toHaveProperty("witnessNonce");
      expect(typeof lastSetPayload!["witnessNonce"]).toBe("string");
      expect((lastSetPayload!["witnessNonce"] as string).length).toBeGreaterThan(0);
    });

    it("DB update payload includes the client IP and UA hashes for binding", async () => {
      await doRedirect();

      expect(lastSetPayload).not.toBeNull();
      expect(lastSetPayload).toHaveProperty("redirectIpHash");
      expect(lastSetPayload).toHaveProperty("redirectUaHash");
    });

    it("sets Cache-Control: no-store", async () => {
      const res = await doRedirect();

      expect(res.headers["cache-control"]).toMatch(/no-store/i);
    });

    it("embeds the ack path in the returned HTML", async () => {
      const res = await doRedirect();

      expect(res.text).toContain(`/api/earn/sponsored/ack/${ATTEMPT_TOKEN}`);
    });
  });

  // ── 2. Already-redirected (idempotent) ───────────────────────────────────────
  describe("already-redirected token (idempotent)", () => {
    it("returns 200 when redirectedAt is already stamped", async () => {
      attemptRow = { ...attemptRow, redirectedAt: new Date(Date.now() - 120_000) };

      const res = await doRedirect();

      expect(res.status).toBe(200);
    });

    it("still calls DB update on second visit (COALESCE guards prevent rebind)", async () => {
      attemptRow = { ...attemptRow, redirectedAt: new Date(Date.now() - 120_000) };

      await doRedirect();

      expect(updateCalled).toBe(true);
    });
  });

  // ── 3. Token not found ───────────────────────────────────────────────────────
  describe("token not found", () => {
    it("returns 404 when the attempt row does not exist", async () => {
      attemptRow = null;

      const res = await doRedirect();

      expect(res.status).toBe(404);
    });

    it("does not call DB update when attempt is missing", async () => {
      attemptRow = null;

      await doRedirect();

      expect(updateCalled).toBe(false);
    });
  });

  // ── 4. Expired attempt ───────────────────────────────────────────────────────
  describe("expired attempt", () => {
    it("returns 410 when expiresAt is in the past", async () => {
      attemptRow = { ...attemptRow, expiresAt: new Date(Date.now() - 1_000) };

      const res = await doRedirect();

      expect(res.status).toBe(410);
    });

    it("does not call DB update for an expired attempt", async () => {
      attemptRow = { ...attemptRow, expiresAt: new Date(Date.now() - 1_000) };

      await doRedirect();

      expect(updateCalled).toBe(false);
    });
  });

  // ── 5. Already-settled attempt ────────────────────────────────────────────────
  describe("already-settled attempt", () => {
    it("returns 410 when settledAt is already set", async () => {
      attemptRow = { ...attemptRow, settledAt: new Date(Date.now() - 5_000) };

      const res = await doRedirect();

      expect(res.status).toBe(410);
    });

    it("does not call DB update for an already-settled attempt", async () => {
      attemptRow = { ...attemptRow, settledAt: new Date(Date.now() - 5_000) };

      await doRedirect();

      expect(updateCalled).toBe(false);
    });
  });

  // ── 6. Invalid token format ──────────────────────────────────────────────────
  describe("invalid token format", () => {
    it("returns 404 for a non-hex token", async () => {
      const res = await request(app).get("/api/earn/sponsored/r/not-valid-hex");

      expect(res.status).toBe(404);
    });

    it("returns 404 for a token that is only 63 chars (one short)", async () => {
      const shortToken = "a".repeat(63);
      const res = await request(app).get(`/api/earn/sponsored/r/${shortToken}`);

      expect(res.status).toBe(404);
    });

    it("does not hit the DB for an invalid token format", async () => {
      const { db } = await import("@workspace/db");
      await request(app).get("/api/earn/sponsored/r/not-valid-hex");

      expect(db.select).not.toHaveBeenCalled();
    });
  });

  // ── 7. Missing VST ───────────────────────────────────────────────────────────
  describe("missing visitSessionToken (?vst=)", () => {
    it("returns 403 when ?vst is absent", async () => {
      const res = await doRedirect({ omitVst: true });

      expect(res.status).toBe(403);
    });

    it("does not call DB update when VST is missing", async () => {
      await doRedirect({ omitVst: true });

      expect(updateCalled).toBe(false);
    });
  });

  // ── 8. Wrong VST ─────────────────────────────────────────────────────────────
  describe("invalid visitSessionToken (?vst=)", () => {
    it("returns 403 when ?vst is a wrong value", async () => {
      const res = await doRedirect({ vst: "0".repeat(64) });

      expect(res.status).toBe(403);
    });

    it("returns 403 when ?vst was signed for a different user", async () => {
      const wrongVst = makeVst(ATTEMPT_TOKEN, "other-user-id");
      const res = await doRedirect({ vst: wrongVst });

      expect(res.status).toBe(403);
    });

    it("returns 403 when ?vst was signed for a different token", async () => {
      const wrongVst = makeVst("dd".repeat(32), USER_ID);
      const res = await doRedirect({ vst: wrongVst });

      expect(res.status).toBe(403);
    });

    it("does not call DB update when VST is wrong", async () => {
      await doRedirect({ vst: "0".repeat(64) });

      expect(updateCalled).toBe(false);
    });
  });
});
