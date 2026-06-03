/**
 * Integration tests: per-account daily visit-count cap under parallel requests.
 *
 * The sponsored-visit settlement handler enforces the cap with a two-layer design:
 *
 *   1. Outer (pre-lock) count check — reads campaign_clicks before the transaction.
 *      This is an optimisation that lets the handler short-circuit cheaply when the
 *      user is clearly over-limit. It is NOT race-safe on its own.
 *
 *   2. PostgreSQL advisory lock per user (pg_advisory_xact_lock) — serialises
 *      concurrent /visit settlements from the same user account so that parallel
 *      requests do not all read the same pre-update count.
 *
 *   3. In-lock count recheck — re-reads campaign_clicks while the advisory lock is
 *      held, inside the transaction. This is the authoritative, race-safe enforcement.
 *
 * The race condition that the advisory lock + recheck fixes:
 *   - N concurrent requests all call the outer count check before any of them commits.
 *   - All N read count = 0 (or some value below the cap) and all pass the outer check.
 *   - Without the in-lock recheck, all N would proceed to insert and exceed the cap.
 *   - With the in-lock recheck, only the first `acctVisitMax` requests succeed; the
 *     rest receive 429 VISIT_COUNT_CAP.
 *
 * These tests verify that invariant using a mock that simulates the advisory lock's
 * serialisation by running transaction callbacks through a mutex, and has the outer
 * count check always return 0 (worst-case race window) while the in-lock recheck
 * tracks the real settled count.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import type { Express } from "express";

const TEST_JWT_SECRET = "test-jwt-secret-for-visit-cap-tests-padded-to-64-chars-aabbccdd";

// ── Attempt token fixtures ────────────────────────────────────────────────────

const INSTALL_TOKEN = "cc".repeat(32); // valid 64-char hex X-Install-Token

// Six distinct 64-hex attempt tokens, one per concurrent request.
const TOKENS = [
  "aa".repeat(32),
  "bb".repeat(32),
  "11".repeat(32),
  "22".repeat(32),
  "33".repeat(32),
  "44".repeat(32),
];

// ── Shared mutable state ──────────────────────────────────────────────────────

// settledCount tracks how many click rows have been "inserted" (i.e. how many
// /visit transactions completed successfully). The in-lock count recheck mock
// reads this, and the click insert mock increments it.
let settledCount = 0;

// Queue of attempt rows returned by db.select().from(campaignVisitAttempts).where().
// Each concurrent request consumes one entry; populated in beforeEach.
const attemptQueue: Array<{
  token: string;
  campaignId: string;
  userId: string;
  rewardSnapshot: string;
  createdAt: Date;
  expiresAt: Date;
  redirectedAt: Date;
  witnessedAt: Date;
  settledAt: null;
  deviceHash: null;
}> = [];

// ── Async mutex (simulates pg_advisory_xact_lock serialisation) ───────────────
// Real Postgres advisory locks ensure that only one transaction per user runs
// the in-lock count recheck at a time. In our mock environment there is no real
// DB, so we simulate that serialisation with a simple promise-based mutex.
// Without this, all six async transaction callbacks could run concurrently and
// all read settledCount = 0 before any of them increments it — the same race
// that the advisory lock was introduced to prevent.

let _mutexHeld = false;
const _mutexQueue: Array<() => void> = [];

function acquireMutex(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (!_mutexHeld) {
      _mutexHeld = true;
      resolve();
    } else {
      _mutexQueue.push(resolve);
    }
  });
}

function releaseMutex(): void {
  const next = _mutexQueue.shift();
  if (next) {
    next();
  } else {
    _mutexHeld = false;
  }
}

// ── @workspace/db mock ────────────────────────────────────────────────────────
// We import the actual module to get the real Drizzle table objects so we can
// use reference identity (===) to dispatch select() calls to the right fixture
// data. The `db` export is replaced with our mock that controls the count cap.

vi.mock("@workspace/db", async () => {
  const actual = await vi.importActual<typeof import("@workspace/db")>("@workspace/db");

  const db = {
    // select().from(table).where(pred) — dispatches by table object identity.
    // The tables exported by this mock are the real Drizzle table objects, so
    // comparing with === works correctly.
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockImplementation((table: unknown) => ({
        where: vi.fn().mockImplementation(async () => {
          if (table === actual.campaignVisitAttempts) {
            // Return the next queued attempt. Each parallel request consumes
            // one entry; all point to "camp-1" / "user-1" so they pass the
            // userId and campaignId guards without needing different entries.
            const row = attemptQueue.shift();
            return row ? [row] : [];
          }
          if (table === actual.campaigns) {
            // Active campaign owned by a user other than "user-1".
            return [
              {
                id: "camp-1",
                userId: "camp-owner",
                title: "Test Campaign",
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
            // Valid install belonging to "user-1". deviceHash = null in the
            // attempt row disables the cross-step token consistency check, so
            // the actual tokenHash value here does not matter.
            return [
              {
                userId: "user-1",
                tokenHash: "any-hash",
                deviceHash: "device-hash",
                createdAt: new Date(),
              },
            ];
          }
          return [];
        }),
      })),
    })),

    // execute() is used for the outer (pre-lock) per-account visit count check.
    // Always returns 0 to simulate the worst-case race window where all
    // parallel requests read the count before any of them has committed. This
    // means the outer check passes for every request; only the in-lock recheck
    // (inside the transaction mock) enforces the cap.
    execute: vi.fn().mockResolvedValue({ rows: [{ n: 0 }] }),

    // transaction() serialises callbacks through the mutex, mirroring what
    // pg_advisory_xact_lock achieves in the real Postgres implementation.
    transaction: vi.fn().mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      await acquireMutex();
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
            // Returns the real settled count so requests beyond the cap throw.
            return { rows: [{ n: settledCount }] };
          }
          // Daily earnings cap SUM (txExecCount === 3, only reached when
          // SPONSORED_DAILY_CAP > 0; disabled in beforeAll via SPONSORED_DAILY_CAP=0).
          return { rows: [{ total: "0.00" }] };
        }),

        insert: vi.fn().mockImplementation((table: unknown) => ({
          values: vi.fn().mockImplementation(async () => {
            if (table === actual.campaignClicks) {
              // Simulate an INSERT into campaign_clicks. Increment the shared
              // counter so subsequent in-lock rechecks see the updated count.
              settledCount++;
            }
            return [];
          }),
        })),

        update: vi.fn().mockImplementation(() => ({
          set: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          // All updates (campaign spend, user credit, attempt settled) return a
          // non-empty array — success. The unique constraint violation path
          // (ALREADY_VISITED) is not tested here.
          returning: vi.fn().mockResolvedValue([{ id: "1" }]),
        })),
      };

      try {
        return await cb(tx);
      } finally {
        releaseMutex();
      }
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
  // Inject a fixed userId so all requests appear to come from "user-1".
  authMiddleware: (req: any, _res: any, next: any) => {
    req.userId = "user-1";
    next();
  },
  adminMiddleware: async (_req: any, res: any) => {
    res.status(401).json({ error: "No token" });
  },
}));

// Allow all IP rate-limit checks to pass. The IP cap (SPONSORED_VISIT_IP_LIMIT)
// is set high enough in beforeAll that it does not interfere with the tests.
vi.mock("../lib/dbRateLimit", () => ({
  recordLoginAttempt: vi.fn().mockResolvedValue({ allowed: true, current: 1 }),
  checkLoginAttempts: vi.fn().mockResolvedValue({ allowed: true, current: 1 }),
  clearLoginAttempts: vi.fn().mockResolvedValue(undefined),
  pruneExpiredLoginAttempts: vi.fn().mockResolvedValue(undefined),
  decrementLoginAttempt: vi.fn().mockResolvedValue(undefined),
}));

// ── App setup ─────────────────────────────────────────────────────────────────

let app: Express;

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = TEST_JWT_SECRET;
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
  // Disable dwell-time gate so requests don't fail on elapsed time.
  process.env.MIN_SPONSORED_VISIT_MS = "0";
  // Disable per-account daily earnings cap; only the visit-count cap is tested.
  process.env.SPONSORED_DAILY_CAP = "0";
  // High IP slot limit so it never interferes.
  process.env.SPONSORED_VISIT_IP_LIMIT = "100";

  const { registerRoutes } = await import("../routes/cashclip");
  app = express();
  app.use(express.json());

  // Inject a no-op req.log so handlers that call req.log.warn/error don't throw.
  // The real application uses pino-http which attaches a per-request child logger
  // to req.log; in tests we provide a silent stand-in.
  app.use((req: any, _res, next) => {
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

  // Reset shared state.
  settledCount = 0;
  _mutexHeld = false;
  _mutexQueue.length = 0;
  attemptQueue.length = 0;

  // Repopulate the attempt queue with 6 fresh rows.
  // All point to camp-1 / user-1; each has a unique token.
  // witnessedAt is set 60 s in the past so the dwell-time gate (disabled via
  // MIN_SPONSORED_VISIT_MS=0) would also pass if it were active.
  const now = Date.now();
  for (let i = 0; i < TOKENS.length; i++) {
    attemptQueue.push({
      token:        TOKENS[i]!,
      campaignId:   "camp-1",
      userId:       "user-1",
      rewardSnapshot: "0.05",
      createdAt:    new Date(now - 3_600_000),
      expiresAt:    new Date(now + 900_000),
      redirectedAt: new Date(now - 120_000),
      witnessedAt:  new Date(now - 60_000),
      settledAt:    null,
      // null skips the cross-step install-token consistency check (attempt.deviceHash === null).
      deviceHash:   null,
    });
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Fire a single POST /visit for camp-1 using the given attempt token. */
function visitRequest(token: string) {
  return request(app)
    .post("/api/earn/sponsored/camp-1/visit")
    .set("Content-Type", "application/json")
    .set("X-Install-Token", INSTALL_TOKEN)
    .send({ attemptToken: token });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/earn/sponsored/:id/visit — visit-count cap under concurrency", () => {
  describe("cap = 1 (minimum boundary)", () => {
    beforeEach(() => {
      process.env.SPONSORED_VISIT_ACCOUNT_DAILY_MAX = "1";
    });

    it("allows exactly 1 settlement when 3 requests arrive concurrently", async () => {
      const results = await Promise.all([
        visitRequest(TOKENS[0]!),
        visitRequest(TOKENS[1]!),
        visitRequest(TOKENS[2]!),
      ]);

      const succeeded = results.filter((r) => r.status === 200).length;
      const capped    = results.filter((r) => r.status === 429).length;

      expect(succeeded).toBe(1);
      expect(capped).toBe(2);
    });

    it("returns the correct 429 error body for capped requests", async () => {
      const results = await Promise.all([
        visitRequest(TOKENS[0]!),
        visitRequest(TOKENS[1]!),
        visitRequest(TOKENS[2]!),
      ]);

      const cappedResponses = results.filter((r) => r.status === 429);
      for (const res of cappedResponses) {
        expect(res.body.error).toMatch(/daily sponsored-visit limit/i);
      }
    });
  });

  describe("cap = 3 (default-like boundary)", () => {
    beforeEach(() => {
      process.env.SPONSORED_VISIT_ACCOUNT_DAILY_MAX = "3";
    });

    it("allows exactly 3 settlements when 6 requests arrive concurrently", async () => {
      const results = await Promise.all(TOKENS.map((t) => visitRequest(t)));

      const succeeded = results.filter((r) => r.status === 200).length;
      const capped    = results.filter((r) => r.status === 429).length;

      expect(succeeded).toBe(3);
      expect(capped).toBe(3);
    });

    it("settledCount equals the cap value after all requests complete", async () => {
      await Promise.all(TOKENS.map((t) => visitRequest(t)));
      expect(settledCount).toBe(3);
    });

    it("successful responses report a positive reward amount", async () => {
      const results = await Promise.all(TOKENS.map((t) => visitRequest(t)));

      const successes = results.filter((r) => r.status === 200);
      for (const res of successes) {
        expect(res.body).toHaveProperty("reward");
        expect(Number(res.body.reward)).toBeGreaterThan(0);
      }
    });

    it("capped responses cite the daily-visit-limit error message", async () => {
      const results = await Promise.all(TOKENS.map((t) => visitRequest(t)));

      const capped = results.filter((r) => r.status === 429);
      expect(capped.length).toBe(3);
      for (const res of capped) {
        expect(res.body.error).toMatch(/daily sponsored-visit limit/i);
      }
    });
  });

  describe("outer-check race does not inflate settlement beyond cap", () => {
    beforeEach(() => {
      process.env.SPONSORED_VISIT_ACCOUNT_DAILY_MAX = "2";
    });

    it("cap=2 holds even though the outer count check always returns 0", async () => {
      // db.execute() (the outer pre-lock count check) always returns { n: 0 }
      // regardless of how many commits have landed. This simulates the race window
      // where all parallel requests read the count before any of them commits.
      // Without the in-lock recheck + serialisation, all 6 would succeed.
      // With the recheck, exactly cap=2 succeed.
      const results = await Promise.all(TOKENS.map((t) => visitRequest(t)));

      const succeeded = results.filter((r) => r.status === 200).length;
      expect(succeeded).toBe(2);
      expect(settledCount).toBe(2);
    });

    it("does not exceed cap=2 across three sequential batches of parallel requests", async () => {
      // Three separate Promise.all batches to verify the count holds across
      // batches (settledCount is not reset between them).
      const batch1 = await Promise.all([visitRequest(TOKENS[0]!), visitRequest(TOKENS[1]!)]);
      const batch2 = await Promise.all([visitRequest(TOKENS[2]!), visitRequest(TOKENS[3]!)]);
      const batch3 = await Promise.all([visitRequest(TOKENS[4]!), visitRequest(TOKENS[5]!)]);

      const allResults    = [...batch1, ...batch2, ...batch3];
      const totalSucceeded = allResults.filter((r) => r.status === 200).length;

      // The outer check always returns 0 across all three batches, so every
      // request passes the outer gate. The in-lock recheck is the only control.
      expect(totalSucceeded).toBe(2);
      expect(settledCount).toBe(2);
    });
  });

  describe("cap = 0 edge case (handler clamps to 1)", () => {
    beforeEach(() => {
      // The handler does Math.max(1, parsed value), so 0 → effective cap of 1.
      process.env.SPONSORED_VISIT_ACCOUNT_DAILY_MAX = "0";
    });

    it("allows exactly 1 settlement (handler clamps 0 → 1)", async () => {
      const results = await Promise.all([
        visitRequest(TOKENS[0]!),
        visitRequest(TOKENS[1]!),
        visitRequest(TOKENS[2]!),
      ]);

      const succeeded = results.filter((r) => r.status === 200).length;
      expect(succeeded).toBe(1);
      expect(settledCount).toBe(1);
    });
  });
});
