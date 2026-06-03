/**
 * Integration tests: sponsored visit /ack/:token endpoint.
 *
 * GET /api/earn/sponsored/ack/:token exchanges the DB-stored witnessNonce
 * (embedded as a JS variable in the /r interstitial HTML body) plus a valid
 * visitSessionToken (?vst=) for a short-lived HMAC-signed ackToken that
 * /c/:token later requires.
 *
 * Security design assertions:
 *   - witnessNonce must match the DB-stored value (timing-safe compare).
 *   - VST must be HMAC-SHA256(token:userId:vst, JWT_ACCESS_SECRET) — only
 *     producible from the /begin response (not from /r headers or body alone).
 *   - redirectedAt must be set (the /r step must have completed first).
 *   - Dwell time (MIN_INTERSTITIAL_DWELL_MS) must have elapsed since /r.
 *   - ackToken = HMAC-SHA256(token:witnessNonce, JWT_ACCESS_SECRET).
 *
 * Cases covered:
 *   1. Happy path — valid nonce + valid VST + enough dwell time → 200 { ackToken }.
 *   2. ackToken format and value — HMAC derivation matches expected formula.
 *   3. Missing witnessNonce (?w=) → 403.
 *   4. Wrong witnessNonce → 403.
 *   5. Missing VST (?vst=) → 403.
 *   6. Wrong VST → 403.
 *   7. Missing redirectedAt → 400.
 *   8. Too early (dwell time not elapsed) → 425.
 *   9. Token not found → 404.
 *  10. Expired attempt → 410.
 *  11. Already settled → 410.
 *  12. witnessNonce absent from DB row → 403.
 *  13. Invalid token format → 404.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { createHmac } from "crypto";
import express from "express";
import request from "supertest";
import type { Express } from "express";

const TEST_JWT_SECRET = "test-jwt-secret-for-ack-tests-padded-to-64chars-aabbccddeeff0011";
const ATTEMPT_TOKEN   = "ee".repeat(32); // valid 64-char hex token
const CAMPAIGN_ID     = "camp-ack-1";
const USER_ID         = "user-ack-1";
const WITNESS_NONCE   = "ack-witness-nonce-abc123456789xyz";

function makeVst(token: string, userId: string): string {
  return createHmac("sha256", TEST_JWT_SECRET)
    .update(token + ":" + userId + ":vst")
    .digest("hex");
}

function makeAckToken(token: string, nonce: string): string {
  return createHmac("sha256", TEST_JWT_SECRET)
    .update(token + ":" + nonce)
    .digest("hex");
}

// ── Shared mutable state ──────────────────────────────────────────────────────

let attemptRow: Record<string, unknown> | null = null;

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
          return [];
        }),
      })),
    })),

    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ token: ATTEMPT_TOKEN }]),
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
  process.env.MIN_INTERSTITIAL_DWELL_MS = "0";   // disable dwell gate for most tests
  process.env.SPONSORED_ACK_IP_LIMIT   = "1000";

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

  const now = Date.now();
  // Default: a valid, un-settled attempt with redirectedAt already set far
  // enough in the past that the dwell gate passes (MIN_INTERSTITIAL_DWELL_MS=0).
  attemptRow = {
    token:          ATTEMPT_TOKEN,
    campaignId:     CAMPAIGN_ID,
    userId:         USER_ID,
    rewardSnapshot: "0.05",
    createdAt:      new Date(now - 3_600_000),
    expiresAt:      new Date(now + 900_000),
    redirectedAt:   new Date(now - 120_000),  // 2 min ago — well past any dwell gate
    witnessedAt:    null,
    settledAt:      null,
    witnessNonce:   WITNESS_NONCE,
    redirectIpHash: null,   // null → IP/UA binding check is skipped in tests
    redirectUaHash: null,
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function doAck(opts: {
  nonce?:    string;
  omitNonce?: boolean;
  vst?:      string;
  omitVst?:  boolean;
  token?:    string;
} = {}) {
  const { token = ATTEMPT_TOKEN, omitNonce = false, omitVst = false } = opts;
  const nonce = opts.nonce ?? WITNESS_NONCE;
  const vst   = opts.vst   ?? makeVst(token, USER_ID);

  const params = new URLSearchParams();
  if (!omitNonce) params.set("w",   nonce);
  if (!omitVst)   params.set("vst", vst);

  const qs  = params.toString() ? `?${params.toString()}` : "";
  return request(app).get(`/api/earn/sponsored/ack/${token}${qs}`);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/earn/sponsored/ack/:token — nonce exchange", () => {

  // ── 1. Happy path ────────────────────────────────────────────────────────────
  describe("happy path", () => {
    it("returns 200 with an ackToken field", async () => {
      const res = await doAck();

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("ackToken");
      expect(typeof res.body.ackToken).toBe("string");
      expect(res.body.ackToken.length).toBeGreaterThan(0);
    });

    it("ackToken is a 64-char lowercase hex string", async () => {
      const res = await doAck();

      expect(res.status).toBe(200);
      expect(res.body.ackToken).toMatch(/^[a-f0-9]{64}$/);
    });

    it("ackToken equals HMAC-SHA256(token:witnessNonce, JWT_ACCESS_SECRET)", async () => {
      const res = await doAck();

      expect(res.status).toBe(200);
      const expected = makeAckToken(ATTEMPT_TOKEN, WITNESS_NONCE);
      expect(res.body.ackToken).toBe(expected);
    });

    it("sets Cache-Control: no-store", async () => {
      const res = await doAck();

      expect(res.headers["cache-control"]).toMatch(/no-store/i);
    });
  });

  // ── 2. Missing witness nonce (?w=) ───────────────────────────────────────────
  describe("missing witness nonce (?w=)", () => {
    it("returns 403 when ?w is absent", async () => {
      const res = await doAck({ omitNonce: true });

      expect(res.status).toBe(403);
    });

    it("403 response has an error field", async () => {
      const res = await doAck({ omitNonce: true });

      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty("error");
    });
  });

  // ── 3. Wrong witness nonce ────────────────────────────────────────────────────
  describe("wrong witness nonce", () => {
    it("returns 403 when ?w does not match the DB-stored nonce", async () => {
      const res = await doAck({ nonce: "totally-wrong-nonce-value-xyz99" });

      expect(res.status).toBe(403);
    });

    it("returns 403 for a nonce that is almost correct (off by one char)", async () => {
      const almostRight = WITNESS_NONCE.slice(0, -1) + "X";
      const res = await doAck({ nonce: almostRight });

      expect(res.status).toBe(403);
    });
  });

  // ── 4. Missing VST (?vst=) ────────────────────────────────────────────────────
  describe("missing visitSessionToken (?vst=)", () => {
    it("returns 403 when ?vst is absent", async () => {
      const res = await doAck({ omitVst: true });

      expect(res.status).toBe(403);
    });
  });

  // ── 5. Wrong VST ──────────────────────────────────────────────────────────────
  describe("invalid visitSessionToken (?vst=)", () => {
    it("returns 403 when ?vst is a garbage value", async () => {
      const res = await doAck({ vst: "0".repeat(64) });

      expect(res.status).toBe(403);
    });

    it("returns 403 when VST was signed for a different userId", async () => {
      const wrongVst = makeVst(ATTEMPT_TOKEN, "attacker-user-id");
      const res = await doAck({ vst: wrongVst });

      expect(res.status).toBe(403);
    });

    it("returns 403 when VST was signed for a different token", async () => {
      const wrongVst = makeVst("dd".repeat(32), USER_ID);
      const res = await doAck({ vst: wrongVst });

      expect(res.status).toBe(403);
    });
  });

  // ── 6. Missing redirectedAt ───────────────────────────────────────────────────
  describe("redirectedAt not yet set", () => {
    it("returns 400 when redirectedAt is null (redirect step incomplete)", async () => {
      attemptRow = { ...attemptRow, redirectedAt: null };

      const res = await doAck();

      expect(res.status).toBe(400);
    });

    it("400 response mentions redirect step", async () => {
      attemptRow = { ...attemptRow, redirectedAt: null };

      const res = await doAck();

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/redirect/i);
    });
  });

  // ── 7. Dwell time not elapsed (too early) ────────────────────────────────────
  describe("dwell gate — too early", () => {
    it("returns 425 when called before the interstitial dwell time elapses", async () => {
      // Set MIN_INTERSTITIAL_DWELL_MS high enough that a redirect 1ms ago
      // hasn't satisfied the dwell gate.
      process.env.MIN_INTERSTITIAL_DWELL_MS = "60000"; // 60 s

      attemptRow = {
        ...attemptRow,
        redirectedAt: new Date(Date.now() - 100), // only 100ms ago
      };

      const res = await doAck();

      // Restore for subsequent tests
      process.env.MIN_INTERSTITIAL_DWELL_MS = "0";

      expect(res.status).toBe(425);
    });

    it("425 response includes retryAfterMs", async () => {
      process.env.MIN_INTERSTITIAL_DWELL_MS = "60000";

      attemptRow = {
        ...attemptRow,
        redirectedAt: new Date(Date.now() - 100),
      };

      const res = await doAck();

      process.env.MIN_INTERSTITIAL_DWELL_MS = "0";

      expect(res.status).toBe(425);
      expect(res.body).toHaveProperty("retryAfterMs");
      expect(Number(res.body.retryAfterMs)).toBeGreaterThan(0);
    });
  });

  // ── 8. Token not found ───────────────────────────────────────────────────────
  describe("token not found", () => {
    it("returns 404 when the attempt row does not exist", async () => {
      attemptRow = null;

      const res = await doAck();

      expect(res.status).toBe(404);
    });
  });

  // ── 9. Expired attempt ───────────────────────────────────────────────────────
  describe("expired attempt", () => {
    it("returns 410 when expiresAt is in the past", async () => {
      attemptRow = { ...attemptRow, expiresAt: new Date(Date.now() - 1_000) };

      const res = await doAck();

      expect(res.status).toBe(410);
    });
  });

  // ── 10. Already-settled attempt ──────────────────────────────────────────────
  describe("already-settled attempt", () => {
    it("returns 410 when settledAt is already set", async () => {
      attemptRow = { ...attemptRow, settledAt: new Date(Date.now() - 5_000) };

      const res = await doAck();

      expect(res.status).toBe(410);
    });
  });

  // ── 11. witnessNonce absent from DB row ──────────────────────────────────────
  describe("witnessNonce missing from DB", () => {
    it("returns 403 when the DB row has a null witnessNonce", async () => {
      attemptRow = { ...attemptRow, witnessNonce: null };

      const res = await doAck({ nonce: WITNESS_NONCE });

      expect(res.status).toBe(403);
    });

    it("403 mentions reopen the link", async () => {
      attemptRow = { ...attemptRow, witnessNonce: null };

      const res = await doAck({ nonce: WITNESS_NONCE });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/reopen|nonce|missing/i);
    });
  });

  // ── 12. Invalid token format ─────────────────────────────────────────────────
  describe("invalid token format", () => {
    it("returns 404 for a non-hex token (no DB hit)", async () => {
      const res = await request(app).get("/api/earn/sponsored/ack/not-valid-hex");

      expect(res.status).toBe(404);
    });

    it("returns 404 for a 63-char token (one char short)", async () => {
      const shortToken = "a".repeat(63);
      const res = await request(app).get(`/api/earn/sponsored/ack/${shortToken}`);

      expect(res.status).toBe(404);
    });

    it("does not hit the DB for an invalid token format", async () => {
      const { db } = await import("@workspace/db");
      await request(app).get("/api/earn/sponsored/ack/not-valid-hex");

      expect(db.select).not.toHaveBeenCalled();
    });
  });
});
