/**
 * Route-level coverage for POST /api/earn/spin/complete.
 *
 * Locks in that each anti-cheat outcome from the shared, cross-replica
 * `consumeSpinChallenge` store is mapped to the correct HTTP status:
 *   - not_found  -> 403  (forged / already-consumed / lost-the-race token)
 *   - wrong_user -> 403  (token belongs to another user)
 *   - expired    -> 403  (past TTL)
 *   - too_early  -> 425  (completed faster than the min-wait gate; + retryAfterMs)
 *   - ok         -> 201  (challenge consumed; earn token issued)
 *
 * We mock the store module so each test drives one branch, and mock the DB /
 * auth so the happy path can issue a token without a real database.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import type { Express } from "express";

// ── Mock the spin challenge store: the route's anti-cheat decision point ──────
const { mockConsume, mockIssue } = vi.hoisted(() => ({
  mockConsume: vi.fn(),
  mockIssue: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/spinChallengeStore", () => ({
  consumeSpinChallenge: mockConsume,
  issueSpinChallenge: mockIssue,
}));

// ── Mock auth so requests are treated as an authenticated user ───────────────
vi.mock("../auth", () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.userId = "user-1";
    next();
  },
}));

// ── Mock the DB: the happy path runs a transaction that issues an earn token ──
const { mockTransaction } = vi.hoisted(() => ({
  mockTransaction: vi.fn(),
}));

vi.mock("@workspace/db", async () => {
  const actual = await vi.importActual<typeof import("@workspace/db")>("@workspace/db");
  return {
    ...actual,
    db: {
      transaction: mockTransaction,
      execute: vi.fn().mockResolvedValue({ rows: [] }),
    },
  };
});

vi.mock("../lib/pointsEconomy", async () => {
  const actual = await vi.importActual<typeof import("../lib/pointsEconomy")>("../lib/pointsEconomy");
  return { ...actual, snapshotRateString: vi.fn().mockResolvedValue("0.001") };
});

const COMPLETE = "/api/earn/spin/complete";
const TOKEN = "a".repeat(64);

let app: Express;

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = "test-secret-padded-to-some-length-aaaaaaaaaaaaaaaaaaaaaaaa";
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";

  const { registerEarningsRoutes } = await import("../routes/earnings");
  app = express();
  app.use(express.json());
  registerEarningsRoutes(app);
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/earn/spin/complete — status mapping", () => {
  it("returns 400 when challengeToken is missing", async () => {
    const res = await request(app).post(COMPLETE).send({});
    expect(res.status).toBe(400);
    expect(mockConsume).not.toHaveBeenCalled();
  });

  it('maps "not_found" -> 403 (forged / already-consumed / lost-the-race token)', async () => {
    mockConsume.mockResolvedValueOnce({ status: "not_found" });
    const res = await request(app).post(COMPLETE).send({ challengeToken: TOKEN });
    expect(res.status).toBe(403);
  });

  it('maps "wrong_user" -> 403', async () => {
    mockConsume.mockResolvedValueOnce({ status: "wrong_user" });
    const res = await request(app).post(COMPLETE).send({ challengeToken: TOKEN });
    expect(res.status).toBe(403);
  });

  it('maps "expired" -> 403', async () => {
    mockConsume.mockResolvedValueOnce({ status: "expired" });
    const res = await request(app).post(COMPLETE).send({ challengeToken: TOKEN });
    expect(res.status).toBe(403);
  });

  it('maps "too_early" -> 425 and echoes retryAfterMs', async () => {
    mockConsume.mockResolvedValueOnce({ status: "too_early", retryAfterMs: 1500 });
    const res = await request(app).post(COMPLETE).send({ challengeToken: TOKEN });
    expect(res.status).toBe(425);
    expect(res.body.retryAfterMs).toBe(1500);
  });

  it('maps "ok" -> 201 and issues an earn token', async () => {
    mockConsume.mockResolvedValueOnce({ status: "ok" });
    mockTransaction.mockResolvedValueOnce({
      ok: true,
      tokenId: "tok-1",
      points: 180,
      claimableAt: new Date().toISOString(),
      dailyUsed: 1,
      dailyCap: 12,
    });

    const res = await request(app).post(COMPLETE).send({ challengeToken: TOKEN });

    expect(res.status).toBe(201);
    expect(res.body.tokenId).toBe("tok-1");
    expect(res.body.points).toBe(180);
    expect(mockConsume).toHaveBeenCalledWith(TOKEN, "user-1", expect.any(Number));
  });

  it("does not run the issuing transaction when the challenge is rejected", async () => {
    mockConsume.mockResolvedValueOnce({ status: "not_found" });
    await request(app).post(COMPLETE).send({ challengeToken: TOKEN });
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});

// ── In-transaction money guards: daily cap + 2h cooldown ─────────────────────
// These tests drive the actual `db.transaction` callback (not a pre-baked
// result), so the per-day cap (12) and 2h cooldown branches inside the
// row-locked transaction are exercised end-to-end. The mocked `tx` mirrors the
// two `tx.select` calls the route makes: (1) the daily COUNT, awaited directly,
// then (2) the recent-spin lookup, awaited via `.limit(1)`.
const DAILY_CAP = 12;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

type SpinTxOptions = {
  todayCount: number;
  recentSpin?: { earnedAt: Date } | null;
  insertedToken?: { id: string };
  onInsertValues?: (values: Record<string, unknown>) => void;
};

function makeSpinTx(opts: SpinTxOptions) {
  let selectIdx = 0;
  return {
    execute: vi.fn().mockResolvedValue({ rows: [] }),
    select: vi.fn().mockImplementation(() => {
      const idx = selectIdx++;
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            // First select = daily count (awaited directly).
            if (idx === 0) {
              return Promise.resolve([{ todayCount: opts.todayCount }]);
            }
            // Second select = recent-spin cooldown lookup (awaited via .limit).
            return {
              limit: vi
                .fn()
                .mockResolvedValue(opts.recentSpin ? [opts.recentSpin] : []),
            };
          }),
        }),
      };
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockImplementation((values: Record<string, unknown>) => {
        opts.onInsertValues?.(values);
        return {
          returning: vi
            .fn()
            .mockResolvedValue([opts.insertedToken ?? { id: "tok-default" }]),
        };
      }),
    }),
  };
}

function runTransactionWith(opts: SpinTxOptions) {
  mockTransaction.mockImplementationOnce(
    async (cb: (tx: unknown) => Promise<unknown>) => cb(makeSpinTx(opts)),
  );
}

describe("POST /api/earn/spin/complete — daily cap + 2h cooldown", () => {
  it("returns 429 'Daily spin limit reached' when todayCount >= dailyCap", async () => {
    mockConsume.mockResolvedValueOnce({ status: "ok" });
    runTransactionWith({ todayCount: DAILY_CAP });

    const res = await request(app).post(COMPLETE).send({ challengeToken: TOKEN });

    expect(res.status).toBe(429);
    expect(res.body.error).toBe("Daily spin limit reached");
    expect(res.body.cap).toBe(DAILY_CAP);
    // Hit the cap before inserting any new earn token.
    expect(res.body.tokenId).toBeUndefined();
  });

  it("returns 429 'Spin cooldown active' with nextAvailableAt when a recent spin is inside the 2h window", async () => {
    mockConsume.mockResolvedValueOnce({ status: "ok" });
    const earnedAt = new Date(Date.now() - 30 * 60 * 1000); // 30 min ago
    runTransactionWith({ todayCount: 1, recentSpin: { earnedAt } });

    const res = await request(app).post(COMPLETE).send({ challengeToken: TOKEN });

    expect(res.status).toBe(429);
    expect(res.body.error).toBe("Spin cooldown active");
    // nextAvailableAt = recent spin time + 2h.
    expect(res.body.nextAvailableAt).toBe(
      new Date(earnedAt.getTime() + TWO_HOURS_MS).toISOString(),
    );
  });

  it("inserts a pending 'spin' earn token on the happy path (under both limits)", async () => {
    mockConsume.mockResolvedValueOnce({ status: "ok" });
    let insertedValues: Record<string, unknown> | null = null;
    runTransactionWith({
      todayCount: 0,
      recentSpin: null,
      insertedToken: { id: "tok-happy" },
      onInsertValues: (v) => { insertedValues = v; },
    });

    const res = await request(app).post(COMPLETE).send({ challengeToken: TOKEN });

    expect(res.status).toBe(201);
    expect(res.body.tokenId).toBe("tok-happy");
    expect(res.body.dailyCap).toBe(DAILY_CAP);
    expect(res.body.dailyUsed).toBe(1);

    // The row written to earnTokens must be a pending spin.
    expect(insertedValues).not.toBeNull();
    expect(insertedValues!).toMatchObject({
      userId: "user-1",
      actionType: "spin",
      status: "pending",
    });
  });
});
