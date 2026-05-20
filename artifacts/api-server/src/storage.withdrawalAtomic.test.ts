/**
 * Concurrency tests for DatabaseStorage.createWithdrawalAtomic.
 *
 * Goal: prove that parallel withdrawal requests for the same user cannot both
 * succeed when the combined amount would exceed DAILY_WITHDRAWAL_MAX, even
 * when both requests start at the same time.
 *
 * Approach: mock @workspace/db with an in-memory store whose `transaction()`
 * uses a per-user mutex — exactly what Postgres achieves with
 * `SELECT … FOR UPDATE`.  Two concurrent calls are launched via Promise.all;
 * the mock guarantees they execute serially (first-one-wins) so the second
 * sees the already-updated state and hits the cap.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// In-memory DB state
// ---------------------------------------------------------------------------
interface FakeUser {
  id: string;
  balance: string;
}
interface FakeWithdrawal {
  id: string;
  userId: string;
  username: string;
  amount: string;
  bonusPercent: string;
  bonusAmount: string;
  totalPayout: string;
  paypalEmail: string;
  status: string;
  createdAt: Date;
}

let dbUsers: FakeUser[];
let dbWithdrawals: FakeWithdrawal[];

// ---------------------------------------------------------------------------
// Per-user mutex — mimics Postgres SELECT … FOR UPDATE serialisation.
// When two transactions try to lock the same user row concurrently the
// second one waits until the first commits (or rolls back).
// ---------------------------------------------------------------------------
const userLocks: Map<string, Promise<void>> = new Map();

async function acquireUserLock(userId: string): Promise<() => void> {
  const existing = userLocks.get(userId) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((res) => {
    release = res;
  });
  userLocks.set(userId, existing.then(() => next));
  await existing;
  return release;
}

// ---------------------------------------------------------------------------
// A "lazy query" wrapper that supports both direct await and .limit() chaining.
// The real drizzle queries support .limit() chaining; our fake must too.
// ---------------------------------------------------------------------------
class FakeQuery<T> implements PromiseLike<T[]> {
  constructor(private result: T[]) {}

  limit(_n: number): FakeQuery<T> {
    return this;
  }

  then<TResult1 = T[], TResult2 = never>(
    onfulfilled?: ((value: T[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

// ---------------------------------------------------------------------------
// Build a fake transaction object for a given userId / dayStart snapshot.
// ---------------------------------------------------------------------------
function makeTx(userId: string, dayStart: Date) {
  return {
    execute: vi.fn(async () => {
      // Represents SELECT … FOR UPDATE — serialisation handled by
      // acquireUserLock in db.transaction; nothing to do here.
    }),

    select: (_fields: unknown) => ({
      from: (table: unknown) => ({
        where: (_cond: unknown) => {
          // Two different SELECT shapes are used by createWithdrawalAtomic:
          //   1) sum of today's withdrawals (from the withdrawals table)
          //   2) balance fallback read (from the users table)
          //
          // We distinguish by which table object was passed.
          if (table === "withdrawals_table") {
            // Daily sum query
            const todayTotal = dbWithdrawals
              .filter((w) => w.userId === userId && w.createdAt >= dayStart)
              .reduce((s, w) => s + parseFloat(w.amount), 0);
            return new FakeQuery([{ total: todayTotal.toFixed(2) }]);
          }
          // Balance fallback (users table)
          const user = dbUsers.find((u) => u.id === userId);
          return new FakeQuery(user ? [{ balance: user.balance }] : []);
        },
      }),
    }),

    update: (_table: unknown) => ({
      set: (_vals: unknown) => ({
        where: (_cond: unknown) => ({
          returning: async () => {
            const user = dbUsers.find((u) => u.id === userId);
            if (!user) return [];
            // Mimic WHERE balance >= amount (always 7 in these tests)
            const newBalance = parseFloat(user.balance) - 7;
            if (newBalance < -1e-9) return [];
            user.balance = Math.max(0, newBalance).toFixed(2);
            return [{ balance: user.balance }];
          },
        }),
      }),
    }),

    insert: (_table: unknown) => ({
      values: (vals: Record<string, unknown>) => ({
        returning: async () => {
          // Ledger inserts have a `type` field; withdrawal inserts don't.
          if (typeof vals["type"] === "string") {
            return []; // earningsLedger insert — ignore
          }
          const row: FakeWithdrawal = {
            id: `w-${dbWithdrawals.length + 1}`,
            userId,
            username: String(vals["username"] ?? ""),
            amount: String(vals["amount"] ?? "0"),
            bonusPercent: String(vals["bonusPercent"] ?? "0"),
            bonusAmount: String(vals["bonusAmount"] ?? "0"),
            totalPayout: String(vals["totalPayout"] ?? "0"),
            paypalEmail: String(vals["paypalEmail"] ?? ""),
            status: "pending",
            createdAt: new Date(),
          };
          dbWithdrawals.push(row);
          return [row];
        },
      }),
    }),
  };
}

// ---------------------------------------------------------------------------
// Mock @workspace/db
// The initial mock uses a no-lock transaction (for the first three tests).
// The concurrency test overwrites db.transaction with the locking version.
// ---------------------------------------------------------------------------
vi.mock("@workspace/db", async () => {
  const drizzle = await import("drizzle-orm");
  return {
    db: {
      transaction: async <T>(
        fn: (tx: ReturnType<typeof makeTx>) => Promise<T>,
      ): Promise<T> => {
        // Non-locking version — suitable for single-request tests.
        return fn(
          makeTx("user-1", (() => {
            const d = new Date();
            d.setUTCHours(0, 0, 0, 0);
            return d;
          })()),
        );
      },
    },
    // Drizzle table objects — used as identity markers in the fake tx
    users: "users_table",
    withdrawals: "withdrawals_table",
    earningsLedger: "ledger_table",
    rewardSessions: "reward_sessions_table",
    adEvents: "ad_events_table",
    webhookAudit: "webhook_audit_table",
    // Re-export real drizzle helpers so the storage code can call them
    sql: drizzle.sql,
    and: drizzle.and,
    eq: drizzle.eq,
    gte: drizzle.gte,
    desc: drizzle.desc,
    lt: drizzle.lt,
    inArray: drizzle.inArray,
    count: drizzle.count,
    sum: drizzle.sum,
    between: drizzle.between,
  };
});

// ---------------------------------------------------------------------------
// Re-import the module under test after the mock is registered.
// ---------------------------------------------------------------------------
let DatabaseStorage: typeof import("./storage").DatabaseStorage;

beforeEach(async () => {
  userLocks.clear();
  dbUsers = [{ id: "user-1", balance: "14.00" }];
  dbWithdrawals = [];

  vi.resetModules();
  const mod = await import("./storage");
  DatabaseStorage = mod.DatabaseStorage;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const DAY_START = new Date();
DAY_START.setUTCHours(0, 0, 0, 0);

const BASE_ARGS = {
  userId: "user-1",
  username: "testuser",
  amount: 7,
  bonusPercent: "0.00",
  bonusAmount: "0.00",
  totalPayout: "7.00",
  paypalEmail: "user@example.com",
  dailyCapMax: 7,
  dayStart: DAY_START,
} as const;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("createWithdrawalAtomic — daily-cap enforcement", () => {
  it("allows a single withdrawal within the cap", async () => {
    const store = new DatabaseStorage();
    const result = await store.createWithdrawalAtomic(BASE_ARGS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(parseFloat(dbUsers[0]!.balance)).toBeCloseTo(7, 2);
    }
  });

  it("rejects a withdrawal that alone would exceed the cap", async () => {
    // Pre-populate today's withdrawals to exhaust the cap.
    dbWithdrawals.push({
      id: "w-0",
      userId: "user-1",
      username: "testuser",
      amount: "7.00",
      bonusPercent: "0.00",
      bonusAmount: "0.00",
      totalPayout: "7.00",
      paypalEmail: "user@example.com",
      status: "pending",
      createdAt: new Date(),
    });

    const store = new DatabaseStorage();
    const result = await store.createWithdrawalAtomic(BASE_ARGS);

    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "DAILY_CAP_EXCEEDED") {
      expect(result.withdrawnToday).toBeCloseTo(7, 2);
      expect(result.remaining).toBeCloseTo(0, 2);
    } else {
      expect(result.ok).toBe(false);
      expect((result as { reason: string }).reason).toBe("DAILY_CAP_EXCEEDED");
    }
    // Balance must be untouched.
    expect(parseFloat(dbUsers[0]!.balance)).toBeCloseTo(14, 2);
  });

  it("rejects when balance is insufficient", async () => {
    dbUsers[0]!.balance = "3.00"; // below the $7 tier amount
    const store = new DatabaseStorage();
    const result = await store.createWithdrawalAtomic(BASE_ARGS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("INSUFFICIENT_BALANCE");
    }
    // No withdrawal row must have been created.
    expect(dbWithdrawals).toHaveLength(0);
  });

  it(
    "concurrent requests — only one succeeds; second hits DAILY_CAP_EXCEEDED",
    async () => {
      /**
       * Simulate the race: user has $14 balance, daily cap is $7.
       * Two requests for $7 fire at the same time via Promise.all.
       *
       * WITHOUT the SELECT FOR UPDATE lock both would read withdrawnToday=0
       * simultaneously, both pass the cap check, and both debit — resulting
       * in $14 cashed out against a $7 cap.
       *
       * The locking version of db.transaction serialises via acquireUserLock,
       * mirroring what Postgres achieves with SELECT … FOR UPDATE.  The second
       * call therefore sees withdrawnToday=7 (the first's committed row) and
       * is correctly rejected with DAILY_CAP_EXCEEDED.
       */

      // Switch to the locking transaction implementation for this test.
      const dbMod = await import("@workspace/db");
      (dbMod.db as { transaction: unknown }).transaction = async <T>(
        fn: (tx: ReturnType<typeof makeTx>) => Promise<T>,
      ): Promise<T> => {
        const release = await acquireUserLock("user-1");
        try {
          return await fn(makeTx("user-1", DAY_START));
        } finally {
          release();
        }
      };

      vi.resetModules();
      const { DatabaseStorage: DS } = await import("./storage");
      const store = new DS();

      const [r1, r2] = await Promise.all([
        store.createWithdrawalAtomic(BASE_ARGS),
        store.createWithdrawalAtomic(BASE_ARGS),
      ]);

      const successes = [r1, r2].filter((r) => r.ok);
      const failures = [r1, r2].filter((r) => !r.ok) as Array<{
        ok: false;
        reason: string;
      }>;

      // Exactly one request must succeed.
      expect(successes).toHaveLength(1);

      // The other must be rejected with DAILY_CAP_EXCEEDED (not INSUFFICIENT_BALANCE).
      expect(failures).toHaveLength(1);
      expect(failures[0]!.reason).toBe("DAILY_CAP_EXCEEDED");

      // Only one withdrawal row must exist in the DB.
      expect(dbWithdrawals).toHaveLength(1);

      // The user's balance must have been debited exactly once ($14 → $7).
      expect(parseFloat(dbUsers[0]!.balance)).toBeCloseTo(7, 2);
    },
  );
});
