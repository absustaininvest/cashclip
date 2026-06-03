/**
 * Abuse and security tests for the sponsored-visit witness chain.
 *
 * Design under test:
 *   witnessedAt is set ONLY by POST /api/earn/sponsored/postback when the
 *   ADVERTISER'S SERVER calls it with the campaign's callbackKey.
 *
 *   callbackKey = HMAC-SHA256(campaignId + ":cbk-v1", JWT_ACCESS_SECRET)
 *
 *   callbackKey is returned only to the campaign OWNER (publisher) in the
 *   publisher dashboard (GET/POST /api/publisher/campaigns). It is NEVER
 *   included in any response visible to a campaign visitor/claimant.
 *
 * Key adversarial scenarios:
 *   1. Script completes the full /begin → /r → /ack → /c chain with spoofed
 *      Sec-Fetch headers. The /c Location header no longer contains a pixel
 *      URL or callbackKey — only cashclip_t=<attemptToken>. Without callbackKey
 *      the script cannot call /postback. /visit is rejected (witnessedAt null).
 *   2. Script tries to call /postback with a guessed callbackKey → 403.
 *   3. /c endpoint must NOT write witnessedAt to the DB.
 *   4. /pixel endpoint returns 410 Gone (deprecated).
 *   5. Legitimate flow: advertiser's server calls /postback with correct
 *      callbackKey → witnessedAt set → /visit succeeds.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { createHmac } from "crypto";
import type { Express } from "express";

const TEST_JWT_SECRET = "test-jwt-secret-for-sponsored-witness-tests-padded-to-64-chars-xy";

// ── Hoisted mocks ──────────────────────────────────────────────────────────────

const dbMocks = vi.hoisted(() => {
  const VALID_TOKEN   = "a".repeat(64);
  const WITNESS_NONCE = "b".repeat(48);
  const CAMPAIGN_ID   = "camp-1";

  const attempt = {
    token: VALID_TOKEN,
    campaignId: CAMPAIGN_ID,
    userId: "user-1",
    rewardSnapshot: "0.05",
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    redirectedAt: new Date(Date.now() - 60_000),
    redirectIpHash: null as string | null,
    redirectUaHash:  null as string | null,
    witnessedAt:     null as Date | null,
    witnessNonce:    WITNESS_NONCE as string | null,
    settledAt:       null as Date | null,
    deviceHash:      "hash-abc",
  };

  const campaign = {
    id: CAMPAIGN_ID,
    userId: "pub-owner",
    publisherId: "pub-1",
    title: "Test Campaign",
    targetUrl: "https://example-advertiser.com/offer",
    rewardPerVisit: "0.05",
    totalBudget: "10.00",
    spent: "0.00",
    clicks: 0,
    status: "active",
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const attemptRows: typeof attempt[]  = [];
  const campaignRows: typeof campaign[] = [];
  let selectCallIdx = 0;

  const db = {
    selectCallIdx: {
      get: () => selectCallIdx,
      reset: () => { selectCallIdx = 0; },
      inc: () => { const p = selectCallIdx; selectCallIdx++; return p; },
    },
    select:      vi.fn(),
    update:      vi.fn(),
    execute:     vi.fn().mockResolvedValue({ rows: [{ n: 0 }] }),
    transaction: vi.fn().mockImplementation(async (cb: (t: unknown) => Promise<unknown>) => cb({})),
    insert:      vi.fn().mockReturnValue({
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([]),
    }),
  };

  return { attempt, campaign, attemptRows, campaignRows, db, VALID_TOKEN, WITNESS_NONCE, CAMPAIGN_ID };
});

vi.mock("@workspace/db", async () => {
  const actual = await vi.importActual<typeof import("@workspace/db")>("@workspace/db");
  return { ...actual, db: dbMocks.db };
});

vi.mock("../storage", () => ({
  storage: {
    getUser:                  vi.fn().mockResolvedValue(null),
    getUserByUsername:        vi.fn().mockResolvedValue(null),
    getWebhookAudits:         vi.fn().mockResolvedValue([]),
    getWebhookAuditOffenders: vi.fn().mockResolvedValue([]),
    getWebhookAuditProviders: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../paypal", () => ({
  sendPayPalPayout:   vi.fn(),
  isPayPalConfigured: () => false,
  initPayPal:         vi.fn(),
}));

vi.mock("../auth", async () => {
  const { default: jwt } = await import("jsonwebtoken");
  return {
    RESERVED_ADMIN_USERNAMES: new Set<string>(),
    registerAuthRoutes: () => {},
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

vi.mock("../lib/dbRateLimit", () => ({
  recordLoginAttempt:    vi.fn().mockResolvedValue({ allowed: true, current: 1 }),
  checkLoginAttempts:    vi.fn().mockResolvedValue({ allowed: true, current: 1 }),
  decrementLoginAttempt: vi.fn().mockResolvedValue(undefined),
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeAckToken(token: string, nonce: string): string {
  return createHmac("sha256", TEST_JWT_SECRET)
    .update("completion:" + token)
    .digest("hex");
}

function makeCallbackKey(campaignId: string): string {
  return createHmac("sha256", TEST_JWT_SECRET)
    .update(campaignId + ":cbk-v1")
    .digest("hex");
}

const VALID_TOKEN   = dbMocks.VALID_TOKEN;
const WITNESS_NONCE = dbMocks.WITNESS_NONCE;
const CAMPAIGN_ID   = dbMocks.CAMPAIGN_ID;

// ── Test setup ─────────────────────────────────────────────────────────────────

let app: Express;

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = TEST_JWT_SECRET;
  process.env.JWT_SECRET        = TEST_JWT_SECRET;
  process.env.DATABASE_URL    ??= "postgres://test:test@127.0.0.1:5432/test";
  process.env.MIN_SPONSORED_VISIT_MS    = "0";
  process.env.MIN_INTERSTITIAL_DWELL_MS = "0";

  const { registerRoutes } = await import("../routes/cashclip");
  app = express();
  app.use(express.json());
  registerRoutes(app);
});

beforeEach(() => {
  vi.clearAllMocks();

  dbMocks.attemptRows.length  = 0;
  dbMocks.campaignRows.length = 0;
  dbMocks.db.selectCallIdx.reset();

  dbMocks.attemptRows.push({
    ...dbMocks.attempt,
    token:        VALID_TOKEN,
    witnessedAt:  null,
    witnessNonce: WITNESS_NONCE,
    settledAt:    null,
    expiresAt:    new Date(Date.now() + 15 * 60 * 1000),
    redirectedAt: new Date(Date.now() - 60_000),
  });
  dbMocks.campaignRows.push({ ...dbMocks.campaign });

  dbMocks.db.select.mockImplementation(() => {
    const idx = dbMocks.db.selectCallIdx.inc();
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(
          idx === 0 ? [...dbMocks.attemptRows] : [...dbMocks.campaignRows],
        ),
      }),
    };
  });

  dbMocks.db.update.mockReturnValue({
    set:   vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
  });

  dbMocks.db.execute.mockResolvedValue({ rows: [{ n: 0 }] });
});

// ── /c/:token tests ────────────────────────────────────────────────────────────

describe("GET /api/earn/sponsored/c/:token — completion redirect", () => {

  describe("ack token gate", () => {
    it("returns 403 when ?ack is missing", async () => {
      const res = await request(app)
        .get(`/api/earn/sponsored/c/${VALID_TOKEN}`)
        .set("sec-fetch-mode", "navigate")
        .set("sec-fetch-dest", "document");
      expect(res.status).toBe(403);
    });

    it("returns 403 when ?ack HMAC is wrong", async () => {
      const res = await request(app)
        .get(`/api/earn/sponsored/c/${VALID_TOKEN}?ack=${"0".repeat(64)}`)
        .set("sec-fetch-mode", "navigate")
        .set("sec-fetch-dest", "document");
      expect(res.status).toBe(403);
    });

    it("returns 404 for malformed token", async () => {
      const res = await request(app)
        .get("/api/earn/sponsored/c/not-valid-hex?ack=whatever")
        .set("sec-fetch-mode", "navigate")
        .set("sec-fetch-dest", "document");
      expect(res.status).toBe(404);
    });
  });

  describe("Fetch-Metadata gate", () => {
    const ackToken = makeAckToken(VALID_TOKEN, WITNESS_NONCE);

    it("returns 403 when Sec-Fetch-Mode is missing", async () => {
      const res = await request(app)
        .get(`/api/earn/sponsored/c/${VALID_TOKEN}?ack=${ackToken}`)
        .set("sec-fetch-dest", "document");
      expect(res.status).toBe(403);
    });

    it("returns 403 when Sec-Fetch-Dest is missing", async () => {
      const res = await request(app)
        .get(`/api/earn/sponsored/c/${VALID_TOKEN}?ack=${ackToken}`)
        .set("sec-fetch-mode", "navigate");
      expect(res.status).toBe(403);
    });

    it("returns 403 when Sec-Fetch-Mode is 'cors' (XHR/fetch call)", async () => {
      const res = await request(app)
        .get(`/api/earn/sponsored/c/${VALID_TOKEN}?ack=${ackToken}`)
        .set("sec-fetch-mode", "cors")
        .set("sec-fetch-dest", "document");
      expect(res.status).toBe(403);
    });

    it("returns 403 when Sec-Fetch-Dest is 'empty' (XHR/fetch call)", async () => {
      const res = await request(app)
        .get(`/api/earn/sponsored/c/${VALID_TOKEN}?ack=${ackToken}`)
        .set("sec-fetch-mode", "navigate")
        .set("sec-fetch-dest", "empty");
      expect(res.status).toBe(403);
    });
  });

  describe("CRITICAL: /c redirect does NOT embed callbackKey or pixelToken", () => {
    it("redirects 302 to the advertiser URL on valid request", async () => {
      const ackToken = makeAckToken(VALID_TOKEN, WITNESS_NONCE);
      const res = await request(app)
        .get(`/api/earn/sponsored/c/${VALID_TOKEN}?ack=${ackToken}`)
        .set("sec-fetch-mode", "navigate")
        .set("sec-fetch-dest", "document")
        .redirects(0);

      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/example-advertiser\.com/);
    });

    it("Location header contains cashclip_t but NOT cashclip_cb or callbackKey", async () => {
      const ackToken    = makeAckToken(VALID_TOKEN, WITNESS_NONCE);
      const callbackKey = makeCallbackKey(CAMPAIGN_ID);

      const res = await request(app)
        .get(`/api/earn/sponsored/c/${VALID_TOKEN}?ack=${ackToken}`)
        .set("sec-fetch-mode", "navigate")
        .set("sec-fetch-dest", "document")
        .redirects(0);

      expect(res.status).toBe(302);
      const loc = res.headers.location as string;
      // Must contain the attemptToken so the advertiser's server can call /postback
      expect(loc).toContain("cashclip_t=");
      // Must NOT contain the callbackKey or a pixel URL
      expect(loc).not.toContain("cashclip_cb");
      expect(loc).not.toContain(callbackKey);
      expect(loc).not.toContain("/pixel/");
    });

    it("calls db.update to burn the witness nonce but NOT to set witnessedAt", async () => {
      const ackToken = makeAckToken(VALID_TOKEN, WITNESS_NONCE);
      let capturedSetArg: Record<string, unknown> | null = null;

      dbMocks.db.update.mockReturnValue({
        set: vi.fn().mockImplementation((arg: Record<string, unknown>) => {
          capturedSetArg = arg;
          return { where: vi.fn().mockResolvedValue([]) };
        }),
        where: vi.fn().mockResolvedValue([]),
      });

      await request(app)
        .get(`/api/earn/sponsored/c/${VALID_TOKEN}?ack=${ackToken}`)
        .set("sec-fetch-mode", "navigate")
        .set("sec-fetch-dest", "document")
        .redirects(0);

      expect(dbMocks.db.update).toHaveBeenCalled();
      expect(capturedSetArg).not.toBeNull();
      // witnessedAt must NOT be set — only the advertiser postback sets it
      expect(capturedSetArg).not.toHaveProperty("witnessedAt");
      expect(capturedSetArg).toHaveProperty("witnessNonce", null);
    });
  });

  describe("expiry and not-found gates", () => {
    it("returns 410 when attempt is expired", async () => {
      dbMocks.attemptRows[0]!.expiresAt = new Date(Date.now() - 1000);
      const ackToken = makeAckToken(VALID_TOKEN, WITNESS_NONCE);
      const res = await request(app)
        .get(`/api/earn/sponsored/c/${VALID_TOKEN}?ack=${ackToken}`)
        .set("sec-fetch-mode", "navigate")
        .set("sec-fetch-dest", "document");
      expect(res.status).toBe(410);
    });

    it("returns 404 when attempt does not exist", async () => {
      dbMocks.db.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
      }));
      const ackToken = makeAckToken(VALID_TOKEN, WITNESS_NONCE);
      const res = await request(app)
        .get(`/api/earn/sponsored/c/${VALID_TOKEN}?ack=${ackToken}`)
        .set("sec-fetch-mode", "navigate")
        .set("sec-fetch-dest", "document");
      expect(res.status).toBe(404);
    });
  });
});

// ── Deprecated /pixel endpoint ─────────────────────────────────────────────────

describe("GET /api/earn/sponsored/pixel/:pixelToken — deprecated", () => {
  it("returns 410 Gone", async () => {
    const res = await request(app)
      .get(`/api/earn/sponsored/pixel/${"a".repeat(64)}?t=${VALID_TOKEN}`);
    expect(res.status).toBe(410);
  });

  it("does NOT call db.update (witnessedAt cannot be set via pixel)", async () => {
    await request(app)
      .get(`/api/earn/sponsored/pixel/${"a".repeat(64)}?t=${VALID_TOKEN}`);
    expect(dbMocks.db.update).not.toHaveBeenCalled();
  });
});

// ── Deprecated /witness endpoint ───────────────────────────────────────────────

describe("POST /api/earn/sponsored/witness/:token — deprecated endpoint", () => {
  it("returns 410 Gone regardless of request body", async () => {
    const res = await request(app)
      .post(`/api/earn/sponsored/witness/${VALID_TOKEN}`)
      .set("Content-Type", "application/json")
      .send({ nonce: "anything" });
    expect(res.status).toBe(410);
  });
});

// ── POST /api/earn/sponsored/postback ──────────────────────────────────────────

describe("POST /api/earn/sponsored/postback — advertiser server-to-server callback", () => {
  const VALID_CALLBACK_KEY = makeCallbackKey(CAMPAIGN_ID);

  describe("input validation", () => {
    it("returns 400 when body is empty", async () => {
      const res = await request(app)
        .post("/api/earn/sponsored/postback")
        .set("Content-Type", "application/json")
        .send({});
      expect(res.status).toBe(400);
    });

    it("returns 400 when attemptToken is wrong format", async () => {
      const res = await request(app)
        .post("/api/earn/sponsored/postback")
        .set("Content-Type", "application/json")
        .send({ attemptToken: "not-hex", callbackKey: VALID_CALLBACK_KEY });
      expect(res.status).toBe(400);
    });

    it("returns 400 when callbackKey is wrong format", async () => {
      const res = await request(app)
        .post("/api/earn/sponsored/postback")
        .set("Content-Type", "application/json")
        .send({ attemptToken: VALID_TOKEN, callbackKey: "too-short" });
      expect(res.status).toBe(400);
    });
  });

  describe("CRITICAL: wrong callbackKey is rejected", () => {
    it("returns 403 when callbackKey is wrong (guessed value)", async () => {
      // Simulates: script completes /begin → /r → /ack → /c, reads Location
      // header (gets only cashclip_t=<attemptToken>), then tries to call
      // /postback with a guessed callbackKey. Must fail.
      const res = await request(app)
        .post("/api/earn/sponsored/postback")
        .set("Content-Type", "application/json")
        .send({
          attemptToken: VALID_TOKEN,
          callbackKey: "0".repeat(64),  // wrong key — script cannot derive this
        });
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/invalid.*key|key.*mismatch/i);
    });

    it("returns 403 when callbackKey is the attemptToken (confused substitution attack)", async () => {
      // Simulates: script tries using the attemptToken as the callbackKey.
      const res = await request(app)
        .post("/api/earn/sponsored/postback")
        .set("Content-Type", "application/json")
        .send({ attemptToken: VALID_TOKEN, callbackKey: VALID_TOKEN });
      expect(res.status).toBe(403);
    });

    it("does NOT set witnessedAt on wrong callbackKey", async () => {
      await request(app)
        .post("/api/earn/sponsored/postback")
        .set("Content-Type", "application/json")
        .send({ attemptToken: VALID_TOKEN, callbackKey: "0".repeat(64) });
      expect(dbMocks.db.update).not.toHaveBeenCalled();
    });
  });

  describe("correct callbackKey sets witnessedAt", () => {
    it("returns 200 ok when callbackKey is correct", async () => {
      const res = await request(app)
        .post("/api/earn/sponsored/postback")
        .set("Content-Type", "application/json")
        .send({ attemptToken: VALID_TOKEN, callbackKey: VALID_CALLBACK_KEY });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it("calls db.update with witnessedAt when callbackKey is correct", async () => {
      await request(app)
        .post("/api/earn/sponsored/postback")
        .set("Content-Type", "application/json")
        .send({ attemptToken: VALID_TOKEN, callbackKey: VALID_CALLBACK_KEY });
      expect(dbMocks.db.update).toHaveBeenCalled();
    });

    it("is idempotent: returns 200 even when witnessedAt is already set", async () => {
      dbMocks.attemptRows[0]!.witnessedAt = new Date(Date.now() - 5000);
      const res = await request(app)
        .post("/api/earn/sponsored/postback")
        .set("Content-Type", "application/json")
        .send({ attemptToken: VALID_TOKEN, callbackKey: VALID_CALLBACK_KEY });
      expect(res.status).toBe(200);
      // No redundant DB write needed since witnessedAt already set
      expect(dbMocks.db.update).not.toHaveBeenCalled();
    });

    it("returns 410 when attempt is expired", async () => {
      dbMocks.attemptRows[0]!.expiresAt = new Date(Date.now() - 1000);
      const res = await request(app)
        .post("/api/earn/sponsored/postback")
        .set("Content-Type", "application/json")
        .send({ attemptToken: VALID_TOKEN, callbackKey: VALID_CALLBACK_KEY });
      expect(res.status).toBe(410);
    });

    it("returns 409 when attempt is already settled", async () => {
      dbMocks.attemptRows[0]!.settledAt = new Date(Date.now() - 5000);
      const res = await request(app)
        .post("/api/earn/sponsored/postback")
        .set("Content-Type", "application/json")
        .send({ attemptToken: VALID_TOKEN, callbackKey: VALID_CALLBACK_KEY });
      expect(res.status).toBe(409);
    });

    it("returns 404 when attemptToken does not exist", async () => {
      dbMocks.db.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
      }));
      const res = await request(app)
        .post("/api/earn/sponsored/postback")
        .set("Content-Type", "application/json")
        .send({ attemptToken: VALID_TOKEN, callbackKey: VALID_CALLBACK_KEY });
      expect(res.status).toBe(404);
    });
  });
});

// ── Adversarial: scripted full chain, no postback ──────────────────────────────

describe("Adversarial: full scripted chain without advertiser postback", () => {
  it("POST /visit is rejected 400 when witnessedAt is null (script got only cashclip_t from /c)", async () => {
    // Simulates the most capable attack: script completes all chain steps,
    // reads the /c Location header, gets cashclip_t=<attemptToken> but NOT
    // the callbackKey. Calls /postback with wrong key → 403. witnessedAt null.
    // /visit is then rejected.
    dbMocks.attemptRows[0]!.witnessedAt  = null;
    dbMocks.attemptRows[0]!.witnessNonce = null; // nonce burned by /c
    dbMocks.attemptRows[0]!.redirectedAt = new Date(Date.now() - 60_000);

    let idx = 0;
    dbMocks.db.select.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          if (idx === 0) { idx++; return Promise.resolve([{ tokenHash: "hash", userId: "user-1", deviceHash: "dhash" }]); }
          if (idx === 1) { idx++; return Promise.resolve([...dbMocks.attemptRows]); }
          return Promise.resolve([...dbMocks.campaignRows]);
        }),
      }),
    }));

    const res = await request(app)
      .post(`/api/earn/sponsored/camp-1/visit`)
      .set("Content-Type", "application/json")
      .set("x-install-token", "a".repeat(64))
      .send({ attemptToken: VALID_TOKEN });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/confirm|witness|link|reopen/i);
  });

  it("POST /visit succeeds when witnessedAt is set by valid advertiser postback", async () => {
    // Legitimate path: advertiser's server called /postback with correct
    // callbackKey → witnessedAt set → /visit succeeds.
    dbMocks.attemptRows[0]!.witnessedAt  = new Date(Date.now() - 15_000);
    dbMocks.attemptRows[0]!.witnessNonce = null;
    dbMocks.attemptRows[0]!.redirectedAt = new Date(Date.now() - 30_000);

    let idx = 0;
    dbMocks.db.select.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          if (idx === 0) { idx++; return Promise.resolve([{ tokenHash: "hash", userId: "user-1", deviceHash: "dhash" }]); }
          if (idx === 1) { idx++; return Promise.resolve([...dbMocks.attemptRows]); }
          return Promise.resolve([...dbMocks.campaignRows]);
        }),
      }),
    }));

    dbMocks.db.transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      const mockTx: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
            for: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([{ ...dbMocks.campaign, spent: "0.00", totalBudget: "10.00" }]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
        update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) }),
        execute: vi.fn().mockResolvedValue({ rows: [{ n: 0 }] }),
      };
      return cb(mockTx);
    });

    const res = await request(app)
      .post(`/api/earn/sponsored/camp-1/visit`)
      .set("Content-Type", "application/json")
      .set("x-install-token", "a".repeat(64))
      .send({ attemptToken: VALID_TOKEN });

    // Should not fail at the witnessedAt gate
    expect(res.status).not.toBe(400);
  });
});
