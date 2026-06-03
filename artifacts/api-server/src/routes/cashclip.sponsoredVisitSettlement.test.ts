/**
 * Integration tests: end-to-end sponsored visit settlement flow.
 *
 * These tests exercise the full POST /api/earn/sponsored/:id/visit handler
 * path — from HTTP request through the mock DB layer — and assert the outcomes
 * that the silent ReferenceError regression would have broken:
 *
 *   1. Happy path — a properly-witnessed attempt settles with 200 + reward.
 *   2. Per-account daily visit cap (SPONSORED_VISIT_ACCOUNT_DAILY_MAX) —
 *      requests beyond the cap receive 429 "daily sponsored-visit limit".
 *   3. Duplicate-campaign visit (unique constraint 23505) — rejected with 409.
 *   4. Already-settled attempt (attempt.settledAt non-null) — rejected with 409.
 *
 * The DB is replaced by a mock that tracks settled visits in-process so that
 * the in-transaction per-account daily cap recheck (the primary race-safe gate)
 * is exercised without a real Postgres connection.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import type { Express } from "express";

const TEST_JWT_SECRET = "test-jwt-secret-for-settlement-tests-padded-to-64ch-aabbccddeeff";
const INSTALL_TOKEN   = "ff".repeat(32); // valid 64-char hex X-Install-Token
const ATTEMPT_TOKEN   = "ab".repeat(32); // valid 64-char hex attempt token
const CAMPAIGN_ID     = "camp-settle-1";
const USER_ID         = "user-settle-1";

// ── Shared mutable state ──────────────────────────────────────────────────────

// settledCount mirrors the number of campaign_click rows committed so the
// in-lock COUNT recheck mock can return an accurate value.
let settledCount = 0;

// attemptRow is the row returned by db.select().from(campaignVisitAttempts).
// Tests override fields to simulate different attempt states.
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
          if (table === actual.campaigns) {
            return [
              {
                id: CAMPAIGN_ID,
                userId: "camp-owner",           // different from USER_ID → no self-visit block
                title: "Settle Test Campaign",
                rewardPerVisit: "0.05",
                totalBudget: "100.00",
                spent: "0.00",
                clicks: 0,
                status: "active",
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            ];
          }
          if (table === actual.deviceInstalls) {
            return [
              {
                userId: USER_ID,
                tokenHash: "any-hash",
                deviceHash: "device-hash-settle",
                createdAt: new Date(),
              },
            ];
          }
          return [];
        }),
      })),
    })),

    // execute() is used for:
    //   • outer (pre-lock) per-account visit COUNT check
    // Always returns 0 to simulate the worst-case race window where the outer
    // check passes for every request. The in-lock recheck (inside transaction)
    // is the authoritative gate and reads settledCount.
    execute: vi.fn().mockResolvedValue({ rows: [{ n: 0 }] }),

    transaction: vi.fn().mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      let txExecCount = 0;

      const tx = {
        execute: vi.fn().mockImplementation(async () => {
          txExecCount++;
          if (txExecCount === 1) {
            // Advisory lock call — no-op in the mock.
            return {};
          }
          if (txExecCount === 2) {
            // In-lock per-account visit COUNT recheck.
            // Reads the real settled count so requests beyond the cap throw
            // VISIT_COUNT_CAP even if the outer check returned 0.
            return { rows: [{ n: settledCount }] };
          }
          // txExecCount === 3: daily earnings SUM — only reached when
          // SPONSORED_DAILY_CAP > 0 (disabled in beforeAll).
          return { rows: [{ total: "0.00" }] };
        }),

        insert: vi.fn().mockImplementation((table: unknown) => ({
          values: vi.fn().mockImplementation(async () => {
            if (table === actual.campaignClicks) {
              settledCount++;
            }
            // earningsLedger insert: no return value needed.
            return [];
          }),
        })),

        update: vi.fn().mockImplementation(() => ({
          set: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          // All updates (campaign spend, user credit, attempt settled) return a
          // non-empty array to signal success.
          returning: vi.fn().mockResolvedValue([{ id: "row-1" }]),
        })),
      };

      return cb(tx);
    }),

    insert: vi.fn(),
    update: vi.fn(),
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
  recordLoginAttempt:      vi.fn().mockResolvedValue({ allowed: true, current: 1 }),
  checkLoginAttempts:      vi.fn().mockResolvedValue({ allowed: true, current: 1 }),
  clearLoginAttempts:      vi.fn().mockResolvedValue(undefined),
  pruneExpiredLoginAttempts: vi.fn().mockResolvedValue(undefined),
  decrementLoginAttempt:   vi.fn().mockResolvedValue(undefined),
}));

// ── App setup ─────────────────────────────────────────────────────────────────

let app: Express;

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET      = TEST_JWT_SECRET;
  process.env.JWT_SECRET             = TEST_JWT_SECRET;
  process.env.DATABASE_URL         ??= "postgres://test:test@127.0.0.1:5432/test";
  process.env.MIN_SPONSORED_VISIT_MS = "0";   // disable dwell-time gate
  process.env.SPONSORED_DAILY_CAP    = "0";   // disable daily earnings cap
  process.env.SPONSORED_VISIT_IP_LIMIT = "100"; // high IP limit — not under test here

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

  settledCount = 0;

  // Default: a valid, un-settled attempt with all required fields set.
  // deviceHash is null → skips the cross-step install-token consistency check.
  const now = Date.now();
  attemptRow = {
    token:          ATTEMPT_TOKEN,
    campaignId:     CAMPAIGN_ID,
    userId:         USER_ID,
    rewardSnapshot: "0.05",
    createdAt:      new Date(now - 3_600_000),
    expiresAt:      new Date(now + 900_000),
    redirectedAt:   new Date(now - 120_000),
    witnessedAt:    new Date(now - 60_000),
    settledAt:      null,
    deviceHash:     null,
  };
});

// ── Helper ────────────────────────────────────────────────────────────────────

function doVisit(token = ATTEMPT_TOKEN) {
  return request(app)
    .post(`/api/earn/sponsored/${CAMPAIGN_ID}/visit`)
    .set("Content-Type", "application/json")
    .set("X-Install-Token", INSTALL_TOKEN)
    .send({ attemptToken: token });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/earn/sponsored/:id/visit — end-to-end settlement", () => {

  // ── 1. Happy path ───────────────────────────────────────────────────────────
  describe("happy path", () => {
    it("returns 200 with a positive reward amount on a valid attempt", async () => {
      const res = await doVisit();

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body).toHaveProperty("reward");
      expect(Number(res.body.reward)).toBeGreaterThan(0);
    });

    it("reward equals the amount captured in the attempt snapshot (0.05)", async () => {
      const res = await doVisit();

      expect(res.status).toBe(200);
      expect(Number(res.body.reward)).toBeCloseTo(0.05, 5);
    });

    it("increments the settled-visit counter after a successful settlement", async () => {
      expect(settledCount).toBe(0);
      await doVisit();
      expect(settledCount).toBe(1);
    });
  });

  // ── 2. Per-account daily visit cap ─────────────────────────────────────────
  describe("per-account daily visit cap (SPONSORED_VISIT_ACCOUNT_DAILY_MAX)", () => {
    describe("cap = 1", () => {
      beforeEach(() => {
        process.env.SPONSORED_VISIT_ACCOUNT_DAILY_MAX = "1";
      });

      it("allows the first settlement and blocks the second with 429", async () => {
        const first = await doVisit();
        expect(first.status).toBe(200);
        expect(settledCount).toBe(1);

        const second = await doVisit();
        expect(second.status).toBe(429);
        // Only one visit should have been committed.
        expect(settledCount).toBe(1);
      });

      it("429 response mentions the daily sponsored-visit limit", async () => {
        await doVisit(); // consume the cap
        const res = await doVisit();

        expect(res.status).toBe(429);
        expect(res.body.error).toMatch(/daily sponsored-visit limit/i);
      });
    });

    describe("cap = 3 (sequential settlements)", () => {
      beforeEach(() => {
        process.env.SPONSORED_VISIT_ACCOUNT_DAILY_MAX = "3";
      });

      it("allows exactly 3 settlements and blocks the 4th", async () => {
        for (let i = 0; i < 3; i++) {
          const res = await doVisit();
          expect(res.status).toBe(200);
        }

        const fourth = await doVisit();
        expect(fourth.status).toBe(429);
        expect(settledCount).toBe(3);
      });
    });
  });

  // ── 3. Duplicate visit — unique constraint (23505) ─────────────────────────
  describe("duplicate visit rejection via unique constraint (23505)", () => {
    it("returns 409 when the DB signals a unique-constraint violation (23505)", async () => {
      // Override the transaction mock so the campaignClicks insert throws a
      // 23505 unique-constraint error (same user, same campaign).
      const { db } = await import("@workspace/db");
      const actual = await vi.importActual<typeof import("@workspace/db")>("@workspace/db");

      (db.transaction as ReturnType<typeof vi.fn>).mockImplementationOnce(
        async (cb: (tx: unknown) => Promise<unknown>) => {
          let txExecCount = 0;
          const tx = {
            execute: vi.fn().mockImplementation(async () => {
              txExecCount++;
              if (txExecCount === 1) return {};                            // advisory lock
              return { rows: [{ n: 0 }] };                                // count recheck
            }),
            insert: vi.fn().mockImplementation((table: unknown) => ({
              values: vi.fn().mockImplementation(async () => {
                if (table === actual.campaignClicks) {
                  const err = new Error(
                    "duplicate key value violates unique constraint \"campaign_clicks_campaign_id_visitor_user_id_key\"",
                  ) as Error & { code?: string };
                  err.code = "23505";
                  throw err;
                }
                return [];
              }),
            })),
            update: vi.fn().mockImplementation(() => ({
              set:       vi.fn().mockReturnThis(),
              where:     vi.fn().mockReturnThis(),
              returning: vi.fn().mockResolvedValue([{ id: "row-1" }]),
            })),
          };
          return cb(tx);
        },
      );

      const res = await doVisit();

      expect(res.status).toBe(409);
      expect(res.body.alreadyVisited).toBe(true);
    });
  });

  // ── 4. Already-settled attempt ─────────────────────────────────────────────
  describe("already-settled attempt", () => {
    it("returns 409 when attempt.settledAt is already set", async () => {
      attemptRow = { ...attemptRow, settledAt: new Date(Date.now() - 5_000) };

      const res = await doVisit();

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already claimed/i);
      // No new settlement should have been committed.
      expect(settledCount).toBe(0);
    });
  });

  // ── 5. Guard checks that gate the settlement ────────────────────────────────
  describe("pre-settlement guard failures", () => {
    it("returns 400 when attemptToken is missing", async () => {
      const res = await request(app)
        .post(`/api/earn/sponsored/${CAMPAIGN_ID}/visit`)
        .set("Content-Type", "application/json")
        .set("X-Install-Token", INSTALL_TOKEN)
        .send({});

      expect(res.status).toBe(400);
    });

    it("returns 400 when X-Install-Token header is absent", async () => {
      const res = await request(app)
        .post(`/api/earn/sponsored/${CAMPAIGN_ID}/visit`)
        .set("Content-Type", "application/json")
        .send({ attemptToken: ATTEMPT_TOKEN });

      expect(res.status).toBe(400);
    });

    it("returns 400 when the attempt has no witnessedAt (visit not confirmed)", async () => {
      attemptRow = { ...attemptRow, witnessedAt: null };

      const res = await doVisit();

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/not confirmed/i);
      expect(settledCount).toBe(0);
    });

    it("returns 400 when the attempt has no redirectedAt (link never opened)", async () => {
      attemptRow = { ...attemptRow, redirectedAt: null };

      const res = await doVisit();

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/open the visit link/i);
      expect(settledCount).toBe(0);
    });

    it("returns 400 when the attempt token belongs to a different campaign", async () => {
      attemptRow = { ...attemptRow, campaignId: "other-campaign" };

      const res = await doVisit();

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/does not match this campaign/i);
      expect(settledCount).toBe(0);
    });

    it("returns 400 when the attempt has expired", async () => {
      attemptRow = { ...attemptRow, expiresAt: new Date(Date.now() - 1_000) };

      const res = await doVisit();

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/expired/i);
      expect(settledCount).toBe(0);
    });
  });
});
