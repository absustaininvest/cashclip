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
