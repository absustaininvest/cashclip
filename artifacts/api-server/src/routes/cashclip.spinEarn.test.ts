/**
 * Integration tests: spin wheel earn endpoints.
 *
 * POST /api/earn/spin/begin    — issues a server-side challenge token.
 * POST /api/earn/spin/complete — validates challenge + credits a random point
 *                                value from SPIN_POOL.
 *
 * Cases covered:
 *   1. Happy path — /begin issues a challengeToken; /complete (after ≥3 s) returns 201.
 *   2. Too-fast completion — /complete called before 3 s elapses → 425.
 *   3. Expired challenge — /complete called after 60 s TTL → 403.
 *   4. Wrong-user challenge — /complete called by a different user → 403.
 *   5. Daily cap — todayCount ≥ 12 (spin dailyCap) → 429.
 *   6. Missing challengeToken body field → 400.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import type { Express } from "express";

const TEST_JWT_SECRET = "test-jwt-secret-for-spin-earn-tests-padded64chars-aabbccddeeff00";
const USER_ID       = "user-spin-earn-1";
const OTHER_USER_ID = "user-spin-earn-2";
const FAKE_TOKEN_ID = "earn-token-uuid-spin-1";

// ── Mutable control variables ─────────────────────────────────────────────────

let currentUserId  = USER_ID;
let mockTodayCount = 0;
let mockHasRecentSpin = false;  // controls the 2h cooldown select

// ── @workspace/db mock ────────────────────────────────────────────────────────
// The spin /complete transaction runs two selects:
//   1. Daily-cap count  — tx.select().from().where()          → [{ todayCount }]
//   2. Cooldown check   — tx.select().from().where().limit(1) → [] or [{ earnedAt }]
// We model this by returning a thenable with an additional .limit() method so
// the mock value is driven by mockTodayCount and mockHasRecentSpin.

vi.mock("@workspace/db", async () => {
  const actual = await vi.importActual<typeof import("@workspace/db")>("@workspace/db");

  const makeTx = () => ({
    execute: vi.fn().mockResolvedValue({ rows: [] }),
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockImplementation(() => {
          // Produce a thenable that resolves as the daily-cap count result.
          // Also expose .limit() so the cooldown .limit(1) call works.
          const capResult = [{ todayCount: mockTodayCount }];
          const cooldownResult = mockHasRecentSpin
            ? [{ earnedAt: new Date(Date.now() - 60_000) }]
            : [];

          const thenable: any = {
            then(onFulfilled: any, onRejected: any) {
              return Promise.resolve(capResult).then(onFulfilled, onRejected);
            },
            limit: vi.fn().mockReturnValue({
              then(onFulfilled: any, onRejected: any) {
                return Promise.resolve(cooldownResult).then(onFulfilled, onRejected);
              },
            }),
          };
          return thenable;
        }),
      })),
    })),
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockImplementation(() => ({
        returning: vi.fn().mockResolvedValue([{ id: FAKE_TOKEN_ID }]),
      })),
    })),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    })),
  });

  const db = {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockResolvedValue([]),
      })),
    })),
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockImplementation(() => ({
        returning: vi.fn().mockResolvedValue([{ id: FAKE_TOKEN_ID }]),
      })),
    })),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    })),
    execute: vi.fn().mockResolvedValue({ rows: [] }),
    transaction: vi.fn().mockImplementation(async (cb: (tx: ReturnType<typeof makeTx>) => unknown) => {
      return cb(makeTx());
    }),
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
    req.userId = currentUserId;
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
  currentUserId      = USER_ID;
  mockTodayCount     = 0;
  mockHasRecentSpin  = false;
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function doBegin() {
  return request(app)
    .post("/api/earn/spin/begin")
    .set("Content-Type", "application/json")
    .send({});
}

function doComplete(challengeToken: string) {
  return request(app)
    .post("/api/earn/spin/complete")
    .set("Content-Type", "application/json")
    .send({ challengeToken });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

// SPIN_POOL values: [50, 50, 80, 80, 100, 100, 150, 150, 200, 300, 400, 500]
const SPIN_POOL_VALUES = new Set([50, 80, 100, 150, 200, 300, 400, 500]);

describe("POST /api/earn/spin/begin + POST /api/earn/spin/complete", () => {

  // ── 1. Happy path ─────────────────────────────────────────────────────────

  describe("happy path — /begin then /complete after ≥3 s", () => {
    it("/begin returns 201 with a challengeToken", async () => {
      const res = await doBegin();

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("challengeToken");
      expect(typeof res.body.challengeToken).toBe("string");
      expect(res.body.challengeToken.length).toBeGreaterThan(0);
    });

    it("/complete returns 201 with a point value from the spin pool after ≥3 s", async () => {
      vi.useFakeTimers();
      const beginRes = await doBegin();
      expect(beginRes.status).toBe(201);
      const { challengeToken } = beginRes.body as { challengeToken: string };

      vi.advanceTimersByTime(3_001);

      const res = await doComplete(challengeToken);

      expect(res.status).toBe(201);
      expect(SPIN_POOL_VALUES.has(res.body.points)).toBe(true);
    });

    it("/complete response includes tokenId, claimableAt, dailyUsed, dailyCap", async () => {
      vi.useFakeTimers();
      const beginRes = await doBegin();
      const { challengeToken } = beginRes.body as { challengeToken: string };

      vi.advanceTimersByTime(3_001);

      const res = await doComplete(challengeToken);

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("tokenId");
      expect(res.body).toHaveProperty("claimableAt");
      expect(res.body).toHaveProperty("dailyUsed");
      expect(res.body).toHaveProperty("dailyCap");
      expect(res.body.dailyCap).toBe(12);
    });

    it("challenge token is consumed — a second /complete with same token returns 403", async () => {
      vi.useFakeTimers();
      const beginRes = await doBegin();
      const { challengeToken } = beginRes.body as { challengeToken: string };

      vi.advanceTimersByTime(3_001);

      await doComplete(challengeToken);
      const res2 = await doComplete(challengeToken);

      expect(res2.status).toBe(403);
    });
  });

  // ── 2. Too-fast completion (425) ──────────────────────────────────────────

  describe("too-fast completion — /complete called before 3 s elapses", () => {
    it("returns 425 when called immediately after /begin", async () => {
      vi.useFakeTimers();
      const beginRes = await doBegin();
      expect(beginRes.status).toBe(201);
      const { challengeToken } = beginRes.body as { challengeToken: string };

      const res = await doComplete(challengeToken);

      expect(res.status).toBe(425);
    });

    it("returns 425 when only 1 s has elapsed (under 3 s threshold)", async () => {
      vi.useFakeTimers();
      const beginRes = await doBegin();
      const { challengeToken } = beginRes.body as { challengeToken: string };

      vi.advanceTimersByTime(1_000);

      const res = await doComplete(challengeToken);

      expect(res.status).toBe(425);
    });

    it("425 response includes a retryAfterMs field", async () => {
      vi.useFakeTimers();
      const beginRes = await doBegin();
      const { challengeToken } = beginRes.body as { challengeToken: string };

      const res = await doComplete(challengeToken);

      expect(res.status).toBe(425);
      expect(res.body).toHaveProperty("retryAfterMs");
      expect(typeof res.body.retryAfterMs).toBe("number");
      expect(res.body.retryAfterMs).toBeGreaterThan(0);
    });

    it("does not consume the challenge on a too-fast attempt", async () => {
      vi.useFakeTimers();
      const beginRes = await doBegin();
      const { challengeToken } = beginRes.body as { challengeToken: string };

      await doComplete(challengeToken);

      vi.advanceTimersByTime(3_001);
      const res2 = await doComplete(challengeToken);

      expect(res2.status).toBe(201);
    });
  });

  // ── 3. Expired challenge (403) ────────────────────────────────────────────

  describe("expired challenge — /complete called after 60 s TTL", () => {
    it("returns 403 when the challenge TTL (60 s) has elapsed", async () => {
      vi.useFakeTimers();
      const beginRes = await doBegin();
      expect(beginRes.status).toBe(201);
      const { challengeToken } = beginRes.body as { challengeToken: string };

      vi.advanceTimersByTime(60_000 + 1);

      const res = await doComplete(challengeToken);

      expect(res.status).toBe(403);
    });

    it("returns 403 for a challengeToken that was never issued", async () => {
      const res = await doComplete("never-issued-token-xyz");

      expect(res.status).toBe(403);
    });

    it("403 for unknown token includes an error message", async () => {
      const res = await doComplete("totally-unknown-spin-token");

      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty("error");
    });
  });

  // ── 4. Wrong-user challenge (403) ─────────────────────────────────────────

  describe("wrong-user challenge — /complete called by a different user", () => {
    it("returns 403 when a different user attempts to claim another user's challenge", async () => {
      vi.useFakeTimers();

      currentUserId = USER_ID;
      const beginRes = await doBegin();
      expect(beginRes.status).toBe(201);
      const { challengeToken } = beginRes.body as { challengeToken: string };

      vi.advanceTimersByTime(3_001);

      currentUserId = OTHER_USER_ID;
      const res = await doComplete(challengeToken);

      expect(res.status).toBe(403);
    });

    it("403 wrong-user response includes an error mentioning the challenge", async () => {
      vi.useFakeTimers();

      currentUserId = USER_ID;
      const beginRes = await doBegin();
      const { challengeToken } = beginRes.body as { challengeToken: string };

      vi.advanceTimersByTime(3_001);

      currentUserId = OTHER_USER_ID;
      const res = await doComplete(challengeToken);

      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty("error");
    });

    it("does not consume the challenge on a wrong-user attempt", async () => {
      vi.useFakeTimers();

      currentUserId = USER_ID;
      const beginRes = await doBegin();
      const { challengeToken } = beginRes.body as { challengeToken: string };

      vi.advanceTimersByTime(3_001);

      currentUserId = OTHER_USER_ID;
      await doComplete(challengeToken);

      currentUserId = USER_ID;
      const res2 = await doComplete(challengeToken);

      expect(res2.status).toBe(201);
    });
  });

  // ── 5. Daily cap enforcement (429) ────────────────────────────────────────

  describe("daily cap — todayCount ≥ dailyCap (12) → 429", () => {
    it("returns 429 when the daily spin cap (12) has been reached", async () => {
      vi.useFakeTimers();
      mockTodayCount = 12;

      const beginRes = await doBegin();
      expect(beginRes.status).toBe(201);
      const { challengeToken } = beginRes.body as { challengeToken: string };

      vi.advanceTimersByTime(3_001);

      const res = await doComplete(challengeToken);

      expect(res.status).toBe(429);
    });

    it("429 response includes an error mentioning the daily limit", async () => {
      vi.useFakeTimers();
      mockTodayCount = 12;

      const beginRes = await doBegin();
      const { challengeToken } = beginRes.body as { challengeToken: string };

      vi.advanceTimersByTime(3_001);

      const res = await doComplete(challengeToken);

      expect(res.status).toBe(429);
      expect(res.body.error).toMatch(/daily spin limit|cap/i);
    });

    it("returns 201 when todayCount is 11 (one below the cap)", async () => {
      vi.useFakeTimers();
      mockTodayCount = 11;

      const beginRes = await doBegin();
      const { challengeToken } = beginRes.body as { challengeToken: string };

      vi.advanceTimersByTime(3_001);

      const res = await doComplete(challengeToken);

      expect(res.status).toBe(201);
    });
  });

  // ── 6. Missing / invalid challengeToken body field ────────────────────────

  describe("missing or invalid challengeToken in request body", () => {
    it("returns 400 when challengeToken is absent from body", async () => {
      const res = await request(app)
        .post("/api/earn/spin/complete")
        .set("Content-Type", "application/json")
        .send({});

      expect(res.status).toBe(400);
    });

    it("returns 400 when challengeToken is a non-string (number)", async () => {
      const res = await request(app)
        .post("/api/earn/spin/complete")
        .set("Content-Type", "application/json")
        .send({ challengeToken: 99999 });

      expect(res.status).toBe(400);
    });
  });
});
