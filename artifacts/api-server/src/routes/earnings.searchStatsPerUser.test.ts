/**
 * Integration tests: GET /api/admin/search-stats-per-user
 *
 * Verifies:
 *  1.  Non-admin request is rejected (401).
 *  2.  Admin request returns 200.
 *  3.  Default range (no ?range param) echoes "30d" and uses a 30-day window.
 *  4.  ?range=7d uses a 7-day window — records older than 7 days are excluded.
 *  5.  ?range=30d includes records up to 30 days old.
 *  6.  A user with records only in the 8–30 day band appears in 30d but NOT 7d.
 *  7.  Multiple earn_token rows for the same user are aggregated (grouped) correctly.
 *  8.  Users are returned in descending order by search count.
 *  9.  Points are summed correctly per user.
 * 10.  ?limit=N is forwarded to the DB query (small explicit limit is respected).
 * 11.  ?limit=999 is clamped to 100 before reaching the DB.
 * 12.  No search records → empty users array.
 * 13.  searches and points are numbers (not strings) in the JSON response.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import type { Express } from "express";

const TEST_JWT_SECRET = "test-jwt-secret-search-stats-per-user-padded-64chars-xx";

// ── Mutable control variables ─────────────────────────────────────────────────

let adminAllowed = true;

/**
 * Raw token records that the mock DB "table" holds.
 * Populate in each test; reset in beforeEach.
 */
interface TokenRecord {
  userId:     string;
  username:   string;
  actionType: string;
  earnedAt:   Date;
  points:     number;
}
let tokenRecords: TokenRecord[] = [];

/**
 * Captures the limit value actually passed to the final `.limit()` call.
 * Lets us assert limit-clamping without needing a real DB.
 */
let capturedLimit: number | null = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns a Date that is `daysAgo` days before now. */
function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

/**
 * Recursively scan a Drizzle SQL condition object (arbitrary nesting of
 * queryChunks arrays) for the first Date instance stored in a `value` field.
 * This works because Drizzle's `gte(col, date)` embeds the date as a Param
 * with a `.value` property, and `and(...)` wraps inner SQL objects whose
 * queryChunks we can recurse into.
 */
function extractDateFromCond(node: any): Date | undefined {
  if (!node || typeof node !== "object") return undefined;
  if (node.value instanceof Date) return node.value;
  if (Array.isArray(node.queryChunks)) {
    for (const chunk of node.queryChunks) {
      const found = extractDateFromCond(chunk);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Simulate the DB query: filter tokenRecords by `since`, group by userId,
 * sort by search count desc, then apply limit.
 * This mirrors what the real Drizzle query does.
 */
function computeRows(since: Date | undefined, limit: number): object[] {
  const filtered = tokenRecords.filter(
    (r) =>
      r.actionType === "search" &&
      (since === undefined || r.earnedAt >= since),
  );

  const groups = new Map<string, { username: string; count: number; points: number }>();
  for (const r of filtered) {
    const g = groups.get(r.userId) ?? { username: r.username, count: 0, points: 0 };
    g.count++;
    g.points += r.points;
    groups.set(r.userId, g);
  }

  return [...groups.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, limit)
    .map(([userId, g]) => ({
      userId,
      username: g.username,
      searches: g.count,
      // The real query uses COALESCE(SUM(...)) which Drizzle types as string;
      // the endpoint calls Number() on it, so simulate both types here.
      points: String(g.points),
    }));
}

// ── @workspace/db mock ────────────────────────────────────────────────────────
// The endpoint runs a Drizzle chain:
//   db.select({...}).from(...).innerJoin(...).where(...).groupBy(...).orderBy(...).limit(n)
//
// Each intermediate method returns the same chain object; `.limit(n)` is the
// terminal call that resolves with simulated results.

vi.mock("@workspace/db", async () => {
  const actual = await vi.importActual<typeof import("@workspace/db")>("@workspace/db");

  const makeChain = (): any => {
    let sinceDateCapture: Date | undefined;

    const chain: any = {
      from:      ()        => chain,
      innerJoin: ()        => chain,
      where:     (cond: any) => {
        sinceDateCapture = extractDateFromCond(cond);
        return chain;
      },
      groupBy:   ()        => chain,
      orderBy:   ()        => chain,
      limit:     (n: number) => {
        capturedLimit = n;
        return Promise.resolve(computeRows(sinceDateCapture, n));
      },
    };
    return chain;
  };

  const db = {
    select:      vi.fn().mockImplementation(() => makeChain()),
    insert:      vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
    delete:      vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
    }),
    update:      vi.fn(),
    transaction: vi.fn(),
    execute:     vi.fn().mockResolvedValue({ rows: [] }),
  };

  return { ...actual, db };
});

// ── storage mock ──────────────────────────────────────────────────────────────

vi.mock("../storage", async () => {
  const { createStorageMock } = await import("../testHelpers/mockStorage");
  return { storage: createStorageMock({}) };
});

// ── paypal mock ───────────────────────────────────────────────────────────────

vi.mock("../paypal", () => ({
  sendPayPalPayout:   vi.fn(),
  isPayPalConfigured: () => false,
  initPayPal:         vi.fn(),
}));

// ── auth mock ─────────────────────────────────────────────────────────────────

vi.mock("../auth", () => ({
  RESERVED_ADMIN_USERNAMES: new Set<string>(),
  registerAuthRoutes: () => {},
  authMiddleware: (req: any, _res: any, next: any) => {
    req.userId = "admin-user-id";
    next();
  },
  adminMiddleware: async (_req: any, res: any, next: any) => {
    if (!adminAllowed) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  },
}));

// ── dbRateLimit mock ──────────────────────────────────────────────────────────

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

  const { registerEarningsRoutes } = await import("../routes/earnings");
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
  registerEarningsRoutes(app);
});

beforeEach(() => {
  adminAllowed   = true;
  tokenRecords   = [];
  capturedLimit  = null;
});

// ── Request helper ────────────────────────────────────────────────────────────

function getStatsPerUser(query: Record<string, string> = {}) {
  const qs = new URLSearchParams(query).toString();
  const path = qs
    ? `/api/admin/search-stats-per-user?${qs}`
    : "/api/admin/search-stats-per-user";
  return request(app).get(path);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/admin/search-stats-per-user", () => {

  // ── 1. Access control ──────────────────────────────────────────────────────

  describe("access control", () => {
    it("returns 401 when the request is not authenticated as admin", async () => {
      adminAllowed = false;
      const res = await getStatsPerUser();
      expect(res.status).toBe(401);
    });

    it("returns 200 for an admin request", async () => {
      const res = await getStatsPerUser();
      expect(res.status).toBe(200);
    });
  });

  // ── 2. Range label ─────────────────────────────────────────────────────────

  describe("range label in response", () => {
    it("defaults to range=30d when no ?range param is supplied", async () => {
      const res = await getStatsPerUser();
      expect(res.body.range).toBe("30d");
    });

    it("returns range=7d for ?range=7d", async () => {
      const res = await getStatsPerUser({ range: "7d" });
      expect(res.body.range).toBe("7d");
    });

    it("returns range=30d for ?range=30d", async () => {
      const res = await getStatsPerUser({ range: "30d" });
      expect(res.body.range).toBe("30d");
    });

    it("falls back to range=30d for an unrecognised value", async () => {
      const res = await getStatsPerUser({ range: "90d" });
      expect(res.body.range).toBe("30d");
    });
  });

  // ── 3. Range filtering — different windows produce different results ────────

  describe("range filtering", () => {
    beforeEach(() => {
      // alice: 1 search 3 days ago — within both 7d and 30d
      tokenRecords.push({
        userId: "alice", username: "alice", actionType: "search",
        earnedAt: daysAgo(3), points: 5,
      });
      // bob: 1 search 15 days ago — only within 30d, NOT within 7d
      tokenRecords.push({
        userId: "bob", username: "bob", actionType: "search",
        earnedAt: daysAgo(15), points: 5,
      });
    });

    it("7d window includes alice (3d ago) but excludes bob (15d ago)", async () => {
      const res = await getStatsPerUser({ range: "7d" });
      const userIds = res.body.users.map((u: any) => u.userId);
      expect(userIds).toContain("alice");
      expect(userIds).not.toContain("bob");
    });

    it("30d window includes both alice (3d ago) and bob (15d ago)", async () => {
      const res = await getStatsPerUser({ range: "30d" });
      const userIds = res.body.users.map((u: any) => u.userId);
      expect(userIds).toContain("alice");
      expect(userIds).toContain("bob");
    });

    it("non-search action types are excluded from results", async () => {
      tokenRecords.push({
        userId: "carol", username: "carol", actionType: "offerwall",
        earnedAt: daysAgo(1), points: 10,
      });
      const res = await getStatsPerUser({ range: "30d" });
      const userIds = res.body.users.map((u: any) => u.userId);
      expect(userIds).not.toContain("carol");
    });
  });

  // ── 4. Grouping ────────────────────────────────────────────────────────────

  describe("per-user grouping", () => {
    it("aggregates multiple search records for the same user into one row", async () => {
      tokenRecords.push(
        { userId: "u1", username: "alice", actionType: "search", earnedAt: daysAgo(1), points: 5 },
        { userId: "u1", username: "alice", actionType: "search", earnedAt: daysAgo(2), points: 5 },
        { userId: "u1", username: "alice", actionType: "search", earnedAt: daysAgo(3), points: 5 },
        { userId: "u2", username: "bob",   actionType: "search", earnedAt: daysAgo(1), points: 5 },
      );
      const res = await getStatsPerUser({ range: "30d" });
      expect(res.body.users).toHaveLength(2);

      const alice = res.body.users.find((u: any) => u.userId === "u1");
      expect(alice?.searches).toBe(3);
    });

    it("sums points correctly across multiple rows for the same user", async () => {
      tokenRecords.push(
        { userId: "u1", username: "alice", actionType: "search", earnedAt: daysAgo(1), points: 10 },
        { userId: "u1", username: "alice", actionType: "search", earnedAt: daysAgo(2), points: 20 },
        { userId: "u1", username: "alice", actionType: "search", earnedAt: daysAgo(3), points: 15 },
      );
      const res = await getStatsPerUser({ range: "30d" });
      const alice = res.body.users.find((u: any) => u.userId === "u1");
      expect(alice?.points).toBe(45);
    });

    it("returns searches and points as numbers, not strings", async () => {
      tokenRecords.push(
        { userId: "u1", username: "alice", actionType: "search", earnedAt: daysAgo(1), points: 5 },
      );
      const res = await getStatsPerUser();
      expect(typeof res.body.users[0].searches).toBe("number");
      expect(typeof res.body.users[0].points).toBe("number");
    });
  });

  // ── 5. Ordering ────────────────────────────────────────────────────────────

  describe("ordering", () => {
    it("returns users in descending order by search count", async () => {
      // charlie: 4 searches, alice: 2, bob: 1 — expect charlie, alice, bob
      tokenRecords.push(
        { userId: "charlie", username: "charlie", actionType: "search", earnedAt: daysAgo(1), points: 5 },
        { userId: "charlie", username: "charlie", actionType: "search", earnedAt: daysAgo(2), points: 5 },
        { userId: "charlie", username: "charlie", actionType: "search", earnedAt: daysAgo(3), points: 5 },
        { userId: "charlie", username: "charlie", actionType: "search", earnedAt: daysAgo(4), points: 5 },
        { userId: "alice",   username: "alice",   actionType: "search", earnedAt: daysAgo(1), points: 5 },
        { userId: "alice",   username: "alice",   actionType: "search", earnedAt: daysAgo(2), points: 5 },
        { userId: "bob",     username: "bob",     actionType: "search", earnedAt: daysAgo(1), points: 5 },
      );
      const res = await getStatsPerUser({ range: "30d" });
      const ids = res.body.users.map((u: any) => u.userId);
      expect(ids[0]).toBe("charlie");
      expect(ids[1]).toBe("alice");
      expect(ids[2]).toBe("bob");
    });
  });

  // ── 6. Limit parameter and clamping ────────────────────────────────────────

  describe("limit parameter", () => {
    beforeEach(() => {
      // Seed 10 distinct users so there is something to limit
      for (let i = 0; i < 10; i++) {
        tokenRecords.push({
          userId: `u${i}`, username: `user${i}`,
          actionType: "search", earnedAt: daysAgo(1), points: 5,
        });
      }
    });

    it("passes the requested ?limit= value to the DB query", async () => {
      await getStatsPerUser({ limit: "5" });
      expect(capturedLimit).toBe(5);
    });

    it("clamps ?limit=999 to 100 before passing to the DB", async () => {
      await getStatsPerUser({ limit: "999" });
      expect(capturedLimit).toBe(100);
    });

    it("uses 20 as the default limit when none is specified", async () => {
      await getStatsPerUser();
      expect(capturedLimit).toBe(20);
    });
  });

  // ── 7. Empty results ───────────────────────────────────────────────────────

  describe("empty results", () => {
    it("returns an empty users array when there are no matching records", async () => {
      tokenRecords = [];
      const res = await getStatsPerUser();
      expect(res.status).toBe(200);
      expect(res.body.users).toEqual([]);
    });
  });
});
