/**
 * Integration tests: sponsored visit /c/:token completion-redirect endpoint.
 *
 * GET /api/earn/sponsored/c/:token is the server-observed witness step.
 * The browser is navigated here (via top-level browser navigation, enforced by
 * Sec-Fetch-Mode: navigate) by the interstitial JS after /ack returns an ackToken.
 *
 * What this endpoint does:
 *   1. Validates the HMAC-signed ?ack= token
 *      (= HMAC-SHA256(token:witnessNonce, JWT_ACCESS_SECRET)).
 *   2. Enforces Sec-Fetch-Mode: navigate (rejects XHR/fetch callers).
 *   3. Enforces redirectedAt set + dwell time elapsed.
 *   4. Rotates witnessNonce to a fresh pixelNonce (single-use; consumed on /pixel).
 *   5. 302-redirects the browser to the advertiser URL with ?cashclip_cb=<pixelUrl>.
 *
 * Note: /c does NOT stamp witnessedAt — only the /pixel callback does.
 *
 * Cases covered:
 *   1. Happy path — valid ackToken + Sec-Fetch-Mode:navigate → 302 to advertiser.
 *   2. DB update (nonce rotation) is called on first visit.
 *   3. Redirect Location contains the campaign targetUrl.
 *   4. Missing ackToken → 403 (no DB update).
 *   5. Wrong ackToken (guessing) → 403 (no DB update).
 *   6. Replayed ackToken for a different token → 403.
 *   7. Sec-Fetch-Mode absent → 403.
 *   8. Sec-Fetch-Mode = cors (browser XHR) → 403.
 *   9. Already-witnessed attempt — skips ack check + skips DB update (idempotent 302).
 *  10. Already-settled attempt — skips ack check + skips DB update (idempotent 302).
 *  11. Missing redirectedAt → 400.
 *  12. Dwell time not elapsed → 425.
 *  13. Attempt not found → 404.
 *  14. Expired attempt → 410.
 *  15. witnessNonce absent from DB (nonce already consumed) → 403.
 *  16. Invalid token format → 404 (no DB hit).
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { createHmac } from "crypto";
import express from "express";
import request from "supertest";
import type { Express } from "express";

const TEST_JWT_SECRET = "test-jwt-secret-for-completion-tests-padded-to-64chars-aabbccdde0";
const ATTEMPT_TOKEN   = "11".repeat(32); // valid 64-char hex token
const OTHER_TOKEN     = "22".repeat(32);
const CAMPAIGN_ID     = "camp-completion-1";
const USER_ID         = "user-completion-1";
const WITNESS_NONCE   = "completion-witness-nonce-abc12345";
const TARGET_URL      = "https://example-advertiser.com/offer";

function makeAckToken(token: string, nonce: string): string {
  return createHmac("sha256", TEST_JWT_SECRET)
    .update(token + ":" + nonce)
    .digest("hex");
}

// ── Shared mutable state ──────────────────────────────────────────────────────

let attemptRow: Record<string, unknown> | null = null;
let campaignRow: Record<string, unknown> | null = null;
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

    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockImplementation(async () => {
        updateCalled = true;
        return [{ token: ATTEMPT_TOKEN }];
      }),
    })),

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
  process.env.JWT_ACCESS_SECRET         = TEST_JWT_SECRET;
  process.env.JWT_SECRET                = TEST_JWT_SECRET;
  process.env.DATABASE_URL            ??= "postgres://test:test@127.0.0.1:5432/test";
  process.env.MIN_INTERSTITIAL_DWELL_MS = "0";  // disable dwell gate for most tests
  process.env.SPONSORED_COMPLETE_IP_LIMIT = "1000";

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

  const now = Date.now();
  // Default: a valid, un-settled attempt with redirectedAt set far enough in
  // the past that the dwell gate passes (MIN_INTERSTITIAL_DWELL_MS=0).
  attemptRow = {
    token:          ATTEMPT_TOKEN,
    campaignId:     CAMPAIGN_ID,
    userId:         USER_ID,
    rewardSnapshot: "0.05",
    createdAt:      new Date(now - 3_600_000),
    expiresAt:      new Date(now + 900_000),
    redirectedAt:   new Date(now - 120_000),  // 2 min ago — past any dwell gate
    witnessedAt:    null,
    settledAt:      null,
    witnessNonce:   WITNESS_NONCE,
    redirectIpHash: null,  // null → IP/UA binding check skipped
    redirectUaHash: null,
  };

  campaignRow = {
    id:             CAMPAIGN_ID,
    userId:         "camp-owner-completion",
    title:          "Completion Test Campaign",
    targetUrl:      TARGET_URL,
    rewardPerVisit: "0.05",
    totalBudget:    "100.00",
    spent:          "0.00",
    clicks:         0,
    status:         "active",
    postbackSecret: null,
    createdAt:      new Date(),
    updatedAt:      new Date(),
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function doComplete(opts: {
  ack?:     string;
  omitAck?: boolean;
  token?:   string;
  mode?:    string;
  omitMode?: boolean;
} = {}) {
  const { token = ATTEMPT_TOKEN, omitAck = false, omitMode = false } = opts;
  const ack  = opts.ack  ?? makeAckToken(token, WITNESS_NONCE);
  const mode = opts.mode ?? "navigate";

  const qs  = omitAck ? "" : `?ack=${ack}`;
  const req = request(app).get(`/api/earn/sponsored/c/${token}${qs}`).redirects(0);
  if (!omitMode) req.set("Sec-Fetch-Mode", mode);
  return req;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/earn/sponsored/c/:token — completion redirect / witness step", () => {

  // ── 1. Happy path ────────────────────────────────────────────────────────────
  describe("happy path", () => {
    it("302-redirects to the campaign advertiser URL", async () => {
      const res = await doComplete();

      expect(res.status).toBe(302);
      expect(res.headers["location"]).toContain(TARGET_URL);
    });

    it("Location header includes cashclip_cb pixel URL parameter", async () => {
      const res = await doComplete();

      expect(res.status).toBe(302);
      expect(res.headers["location"]).toContain("cashclip_cb=");
    });

    it("calls DB update to rotate the witnessNonce to a fresh pixelNonce", async () => {
      expect(updateCalled).toBe(false);
      await doComplete();
      expect(updateCalled).toBe(true);
    });

    it("sets Cache-Control: no-store", async () => {
      const res = await doComplete();

      expect(res.headers["cache-control"]).toMatch(/no-store/i);
    });
  });

  // ── 2. Missing ackToken ──────────────────────────────────────────────────────
  describe("missing ack token (?ack=)", () => {
    it("returns 403 when ?ack is absent", async () => {
      const res = await doComplete({ omitAck: true });

      expect(res.status).toBe(403);
    });

    it("does not call DB update when ack is missing", async () => {
      await doComplete({ omitAck: true });

      expect(updateCalled).toBe(false);
    });
  });

  // ── 3. Wrong ackToken ────────────────────────────────────────────────────────
  describe("wrong ack token", () => {
    it("returns 403 when ?ack is an all-zeros value (attacker guess)", async () => {
      const res = await doComplete({ ack: "0".repeat(64) });

      expect(res.status).toBe(403);
    });

    it("returns 403 when ackToken was signed for a different nonce", async () => {
      const wrongAck = makeAckToken(ATTEMPT_TOKEN, "wrong-nonce-value-abcde");
      const res = await doComplete({ ack: wrongAck });

      expect(res.status).toBe(403);
    });

    it("returns 403 when ackToken was signed for a different token (replay)", async () => {
      const replayAck = makeAckToken(OTHER_TOKEN, WITNESS_NONCE);
      const res = await doComplete({ ack: replayAck });

      expect(res.status).toBe(403);
    });

    it("does not call DB update when ack is wrong", async () => {
      await doComplete({ ack: "0".repeat(64) });

      expect(updateCalled).toBe(false);
    });
  });

  // ── 4. Sec-Fetch-Mode enforcement ────────────────────────────────────────────
  describe("Sec-Fetch-Mode enforcement", () => {
    it("returns 403 when Sec-Fetch-Mode header is absent", async () => {
      const res = await doComplete({ omitMode: true });

      expect(res.status).toBe(403);
    });

    it("returns 403 when Sec-Fetch-Mode is 'cors' (browser XHR/fetch)", async () => {
      const res = await doComplete({ mode: "cors" });

      expect(res.status).toBe(403);
    });

    it("returns 403 when Sec-Fetch-Mode is 'same-origin' (background fetch)", async () => {
      const res = await doComplete({ mode: "same-origin" });

      expect(res.status).toBe(403);
    });

    it("does not call DB update when Sec-Fetch-Mode is rejected", async () => {
      await doComplete({ mode: "cors" });

      expect(updateCalled).toBe(false);
    });
  });

  // ── 5. Already-witnessed attempt (idempotent) ────────────────────────────────
  describe("already-witnessed attempt (idempotent)", () => {
    it("returns 302 when witnessedAt is already stamped", async () => {
      attemptRow = { ...attemptRow, witnessedAt: new Date(Date.now() - 5_000) };

      const res = await doComplete();

      expect(res.status).toBe(302);
    });

    it("does not call DB update for an already-witnessed attempt", async () => {
      attemptRow = { ...attemptRow, witnessedAt: new Date(Date.now() - 5_000) };

      await doComplete();

      expect(updateCalled).toBe(false);
    });
  });

  // ── 6. Already-settled attempt (idempotent) ──────────────────────────────────
  describe("already-settled attempt (idempotent)", () => {
    it("returns 302 when settledAt is already set", async () => {
      attemptRow = { ...attemptRow, settledAt: new Date(Date.now() - 5_000) };

      const res = await doComplete();

      expect(res.status).toBe(302);
    });

    it("does not call DB update for an already-settled attempt", async () => {
      attemptRow = { ...attemptRow, settledAt: new Date(Date.now() - 5_000) };

      await doComplete();

      expect(updateCalled).toBe(false);
    });
  });

  // ── 7. Missing redirectedAt ───────────────────────────────────────────────────
  describe("redirect step not completed", () => {
    it("returns 400 when redirectedAt is null", async () => {
      attemptRow = { ...attemptRow, redirectedAt: null };

      const res = await doComplete();

      expect(res.status).toBe(400);
    });

    it("does not call DB update when redirectedAt is missing", async () => {
      attemptRow = { ...attemptRow, redirectedAt: null };

      await doComplete();

      expect(updateCalled).toBe(false);
    });
  });

  // ── 8. Dwell gate (too early) ─────────────────────────────────────────────────
  describe("dwell gate — too early", () => {
    it("returns 425 when called before the interstitial dwell time elapses", async () => {
      process.env.MIN_INTERSTITIAL_DWELL_MS = "60000"; // 60 s

      attemptRow = {
        ...attemptRow,
        redirectedAt: new Date(Date.now() - 100), // only 100ms ago
      };

      const res = await doComplete();

      process.env.MIN_INTERSTITIAL_DWELL_MS = "0";

      expect(res.status).toBe(425);
    });

    it("does not call DB update when too early", async () => {
      process.env.MIN_INTERSTITIAL_DWELL_MS = "60000";

      attemptRow = {
        ...attemptRow,
        redirectedAt: new Date(Date.now() - 100),
      };

      await doComplete();

      process.env.MIN_INTERSTITIAL_DWELL_MS = "0";

      expect(updateCalled).toBe(false);
    });
  });

  // ── 9. Attempt not found ─────────────────────────────────────────────────────
  describe("attempt not found", () => {
    it("returns 404 when the attempt row does not exist", async () => {
      attemptRow = null;

      const res = await doComplete();

      expect(res.status).toBe(404);
    });
  });

  // ── 10. Expired attempt ───────────────────────────────────────────────────────
  describe("expired attempt", () => {
    it("returns 410 when expiresAt is in the past", async () => {
      attemptRow = { ...attemptRow, expiresAt: new Date(Date.now() - 1_000) };

      const res = await doComplete();

      expect(res.status).toBe(410);
    });

    it("does not call DB update for an expired attempt", async () => {
      attemptRow = { ...attemptRow, expiresAt: new Date(Date.now() - 1_000) };

      await doComplete();

      expect(updateCalled).toBe(false);
    });
  });

  // ── 11. witnessNonce consumed (null in DB) ────────────────────────────────────
  describe("witnessNonce already consumed (null in DB)", () => {
    it("returns 403 when the DB row has a null witnessNonce", async () => {
      // This means /c was already called once (nonce was rotated to pixelNonce
      // and then consumed) — re-calling /c with the old ackToken is rejected.
      attemptRow = { ...attemptRow, witnessNonce: null };

      const res = await doComplete();

      expect(res.status).toBe(403);
    });

    it("does not call DB update when nonce is already null", async () => {
      attemptRow = { ...attemptRow, witnessNonce: null };

      await doComplete();

      expect(updateCalled).toBe(false);
    });
  });

  // ── 12. Invalid token format ──────────────────────────────────────────────────
  describe("invalid token format", () => {
    it("returns 404 for a non-hex token (no DB hit)", async () => {
      const res = await request(app)
        .get("/api/earn/sponsored/c/not-valid-hex?ack=anything")
        .set("Sec-Fetch-Mode", "navigate")
        .redirects(0);

      expect(res.status).toBe(404);
    });

    it("returns 404 for a 63-char token (one short)", async () => {
      const shortToken = "a".repeat(63);
      const res = await request(app)
        .get(`/api/earn/sponsored/c/${shortToken}?ack=anything`)
        .set("Sec-Fetch-Mode", "navigate")
        .redirects(0);

      expect(res.status).toBe(404);
    });

    it("does not hit the DB for an invalid token format", async () => {
      const { db } = await import("@workspace/db");
      await request(app)
        .get("/api/earn/sponsored/c/not-valid-hex?ack=anything")
        .set("Sec-Fetch-Mode", "navigate")
        .redirects(0);

      expect(db.select).not.toHaveBeenCalled();
    });
  });
});
