/**
 * Unit tests: search-challenge startup sweep (runSearchChallengeSweep).
 *
 * The sweep runs db.delete(searchChallenges).where(lt(expiresAt, now)) on boot
 * to flush stale rows that the periodic 60-second cleanup missed across
 * autoscale idle periods or restarts.
 *
 * Cases covered:
 *   1. Expired rows are deleted; the deleted count is logged.
 *   2. Non-expired rows are untouched (rowCount 0 reported).
 *   3. Mix of expired + non-expired — only expired are removed.
 *   4. INFO log line "search challenge startup sweep complete" is always emitted.
 *   5. DB failure is caught and emits a WARN log instead of crashing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Logger mock ───────────────────────────────────────────────────────────────

const mockLogInfo = vi.fn();
const mockLogWarn = vi.fn();

vi.mock("./lib/logger", () => ({
  logger: {
    info:  (...args: unknown[]) => mockLogInfo(...args),
    warn:  (...args: unknown[]) => mockLogWarn(...args),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  },
}));

// ── Mutable DB state ──────────────────────────────────────────────────────────
// challengeRows holds all "rows" currently in the table.
// When db.delete(searchChallenges).where(lt(expiresAt, now)) executes:
//   - the mock inspects the lt Param chunk to get the cutoff Date
//   - any row whose expiresAt < cutoff is removed and counted

interface MockRow { id: string; expiresAt: Date; }
let challengeRows: MockRow[] = [];
let dbShouldThrow = false;

// Extract the cutoff Date from a Drizzle lt() condition queryChunks.
// lt(col, date) → queryChunks = [StringChunk, Column, StringChunk(" < "), Param(date), …]
// The Param chunk has `value` as a Date (non-string, non-array).
function getCutoffFromCond(cond: any): Date | undefined {
  const chunks = cond?.queryChunks;
  if (!Array.isArray(chunks)) return undefined;
  for (const chunk of chunks) {
    if (chunk != null && chunk.value instanceof Date) {
      return chunk.value as Date;
    }
  }
  return undefined;
}

// ── @workspace/db mock ────────────────────────────────────────────────────────

vi.mock("@workspace/db", async () => {
  const actual = await vi.importActual<typeof import("@workspace/db")>("@workspace/db");

  const db = {
    delete: vi.fn().mockImplementation((table: any) => ({
      where: vi.fn().mockImplementation((cond: any) => {
        if (dbShouldThrow) {
          return Promise.reject(new Error("DB connection error (simulated)"));
        }

        const isSearchTable = table === actual.searchChallenges;
        if (!isSearchTable) {
          return Promise.resolve({ rowCount: 0 });
        }

        const cutoff = getCutoffFromCond(cond);
        let deleted = 0;

        if (cutoff !== undefined) {
          const kept: MockRow[] = [];
          for (const row of challengeRows) {
            if (row.expiresAt < cutoff) {
              deleted++;
            } else {
              kept.push(row);
            }
          }
          challengeRows = kept;
        }

        return Promise.resolve({ rowCount: deleted });
      }),
    })),
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    execute: vi.fn(),
    transaction: vi.fn(),
  };

  return { ...actual, db };
});

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  challengeRows = [];
  dbShouldThrow = false;
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function expiredRow(id: string, secondsAgo = 120): MockRow {
  return { id, expiresAt: new Date(Date.now() - secondsAgo * 1000) };
}

function freshRow(id: string, secondsFromNow = 300): MockRow {
  return { id, expiresAt: new Date(Date.now() + secondsFromNow * 1000) };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("runSearchChallengeSweep", () => {

  // ── 1. Expired rows are deleted ──────────────────────────────────────────

  describe("expired rows", () => {
    it("deletes all expired rows (store is empty after sweep)", async () => {
      challengeRows = [expiredRow("a"), expiredRow("b"), expiredRow("c")];

      const { runSearchChallengeSweep } = await import("./lib/searchChallengeSweep");
      await runSearchChallengeSweep();

      expect(challengeRows).toHaveLength(0);
    });

    it("logs the correct deleted count for expired rows", async () => {
      challengeRows = [expiredRow("x1"), expiredRow("x2")];

      const { runSearchChallengeSweep } = await import("./lib/searchChallengeSweep");
      await runSearchChallengeSweep();

      expect(mockLogInfo).toHaveBeenCalledWith(
        expect.objectContaining({ deleted: 2 }),
        "search challenge startup sweep complete"
      );
    });
  });

  // ── 2. Non-expired rows are untouched ─────────────────────────────────────

  describe("non-expired rows", () => {
    it("leaves fresh rows intact", async () => {
      challengeRows = [freshRow("f1"), freshRow("f2"), freshRow("f3")];

      const { runSearchChallengeSweep } = await import("./lib/searchChallengeSweep");
      await runSearchChallengeSweep();

      expect(challengeRows).toHaveLength(3);
    });

    it("logs deleted: 0 when no rows are expired", async () => {
      challengeRows = [freshRow("f1"), freshRow("f2")];

      const { runSearchChallengeSweep } = await import("./lib/searchChallengeSweep");
      await runSearchChallengeSweep();

      expect(mockLogInfo).toHaveBeenCalledWith(
        expect.objectContaining({ deleted: 0 }),
        "search challenge startup sweep complete"
      );
    });
  });

  // ── 3. Mixed expired + non-expired ────────────────────────────────────────

  describe("mixed expired and non-expired rows", () => {
    it("removes only expired rows, leaving fresh rows untouched", async () => {
      const fresh1 = freshRow("f1");
      const fresh2 = freshRow("f2");
      challengeRows = [expiredRow("e1"), fresh1, expiredRow("e2"), fresh2, expiredRow("e3")];

      const { runSearchChallengeSweep } = await import("./lib/searchChallengeSweep");
      await runSearchChallengeSweep();

      expect(challengeRows).toHaveLength(2);
      expect(challengeRows.map((r) => r.id).sort()).toEqual(["f1", "f2"]);
    });

    it("logs the exact count of expired rows deleted (not the fresh ones)", async () => {
      challengeRows = [expiredRow("e1"), freshRow("f1"), expiredRow("e2"), freshRow("f2")];

      const { runSearchChallengeSweep } = await import("./lib/searchChallengeSweep");
      await runSearchChallengeSweep();

      expect(mockLogInfo).toHaveBeenCalledWith(
        expect.objectContaining({ deleted: 2 }),
        "search challenge startup sweep complete"
      );
    });
  });

  // ── 4. INFO log is always emitted ─────────────────────────────────────────

  describe("INFO log emission", () => {
    it("emits the correct INFO log message on success with empty table", async () => {
      challengeRows = [];

      const { runSearchChallengeSweep } = await import("./lib/searchChallengeSweep");
      await runSearchChallengeSweep();

      expect(mockLogInfo).toHaveBeenCalledWith(
        expect.objectContaining({ deleted: expect.any(Number) }),
        "search challenge startup sweep complete"
      );
    });

    it("does not emit a sweep WARN log on success", async () => {
      challengeRows = [expiredRow("e1")];

      const { runSearchChallengeSweep } = await import("./lib/searchChallengeSweep");
      await runSearchChallengeSweep();

      const sweepWarnCalls = mockLogWarn.mock.calls.filter(
        (args) => typeof args[1] === "string" && args[1].includes("search challenge startup sweep")
      );
      expect(sweepWarnCalls).toHaveLength(0);
    });
  });

  // ── 5. DB failure is caught gracefully ────────────────────────────────────

  describe("DB failure handling", () => {
    it("does not throw when the DB rejects", async () => {
      dbShouldThrow = true;

      const { runSearchChallengeSweep } = await import("./lib/searchChallengeSweep");
      await expect(runSearchChallengeSweep()).resolves.toBeUndefined();
    });

    it("emits a WARN log when the DB rejects", async () => {
      dbShouldThrow = true;

      const { runSearchChallengeSweep } = await import("./lib/searchChallengeSweep");
      await runSearchChallengeSweep();

      expect(mockLogWarn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        "search challenge startup sweep failed"
      );
    });

    it("does not emit INFO on DB failure", async () => {
      dbShouldThrow = true;

      const { runSearchChallengeSweep } = await import("./lib/searchChallengeSweep");
      await runSearchChallengeSweep();

      const sweepInfoCalls = mockLogInfo.mock.calls.filter(
        (args) => typeof args[1] === "string" && args[1].includes("search challenge startup sweep")
      );
      expect(sweepInfoCalls).toHaveLength(0);
    });
  });
});
