/**
 * Tests for the spin wheel's DB-resilience failure policy.
 *
 * The spin challenge store is DB-backed (lib/spinChallengeStore). If a
 * `spin_challenges` query throws during /api/earn/spin/begin or
 * /api/earn/spin/complete (e.g. a brief database blip), the routes must return
 * a clear, retryable 503 — not a bare 500 — consistent with how
 * sponsoredBeginRateLimiter fails closed. Genuine validation rejections
 * (missing/invalid challenge) must still return their deliberate 4xx codes.
 *
 * The real handlers in earnings.ts are exercised via supertest. The store
 * module is mocked so issue/consume can be made to throw a real
 * SpinChallengeStoreError (or return a validation result) without a database;
 * auth is stubbed to inject a user so we test the handler, not the gate.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";

const USER_ID = "user-1";

const mockIssue = vi.fn();
const mockConsume = vi.fn();
const mockLoggerError = vi.fn();
const mockTransaction = vi.fn();

// Keep the REAL SpinChallengeStoreError class so `instanceof` checks in the
// route match, but swap the issue/consume implementations for spies.
vi.mock("../lib/spinChallengeStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/spinChallengeStore")>();
  return {
    ...actual,
    issueSpinChallenge: (...args: unknown[]) => mockIssue(...args),
    consumeSpinChallenge: (...args: unknown[]) => mockConsume(...args),
  };
});

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: (...a: unknown[]) => mockLoggerError(...a) },
}));

// Stub auth: inject a user so the handler runs (the gate itself is covered
// elsewhere).
vi.mock("../auth", () => ({
  authMiddleware: (req: Request & { userId?: string }, _res: Response, next: NextFunction) => {
    req.userId = USER_ID;
    next();
  },
  adminMiddleware: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// The complete route's transaction is reached only when consume succeeds.
// A vi.fn() lets tests configure the result; the default behaviour (no mock
// set up) is to call through with an empty tx, which is fine for all cases
// where consume throws or returns a non-ok status before the transaction runs.
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    db: {
      transaction: (...args: unknown[]) => mockTransaction(...args),
    },
  };
});

let app: Express;
let SpinChallengeStoreError: typeof import("../lib/spinChallengeStore").SpinChallengeStoreError;

beforeAll(async () => {
  // Default transaction: pass-through with empty tx object (safe for all paths
  // where the transaction is never reached because consume throws first).
  mockTransaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  );

  const store = await import("../lib/spinChallengeStore");
  SpinChallengeStoreError = store.SpinChallengeStoreError;
  const { registerEarningsRoutes } = await import("./earnings");
  app = express();
  app.use(express.json());
  registerEarningsRoutes(app);
});

beforeEach(() => {
  vi.clearAllMocks();
  // Restore default pass-through after each test clears all mocks.
  mockTransaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  );
});

describe("POST /api/earn/spin/begin — DB resilience", () => {
  it("returns a retryable 503 (not 500) when the challenge store throws", async () => {
    mockIssue.mockRejectedValueOnce(new SpinChallengeStoreError("issue", new Error("connection reset")));

    const res = await request(app).post("/api/earn/spin/begin").send({});

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ retryable: true });
    expect(typeof res.body.error).toBe("string");
  });

  it("logs the store failure distinctly from a generic error", async () => {
    mockIssue.mockRejectedValueOnce(new SpinChallengeStoreError("issue", new Error("timeout")));

    await request(app).post("/api/earn/spin/begin").send({});

    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID }),
      "earn/spin/begin store unavailable — failing retryable",
    );
  });

  it("still returns 500 for a non-store (unexpected) error", async () => {
    mockIssue.mockRejectedValueOnce(new Error("something else"));

    const res = await request(app).post("/api/earn/spin/begin").send({});

    expect(res.status).toBe(500);
  });

  it("returns 201 with a challenge token on success", async () => {
    mockIssue.mockResolvedValueOnce(undefined);

    const res = await request(app).post("/api/earn/spin/begin").send({});

    expect(res.status).toBe(201);
    expect(typeof res.body.challengeToken).toBe("string");
  });
});

describe("POST /api/earn/spin/complete — DB resilience", () => {
  it("returns a retryable 503 (not 500) when consume throws a store error", async () => {
    mockConsume.mockRejectedValueOnce(new SpinChallengeStoreError("consume", new Error("connection reset")));

    const res = await request(app)
      .post("/api/earn/spin/complete")
      .send({ challengeToken: "a".repeat(64) });

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ retryable: true });
  });

  it("logs the consume store failure distinctly", async () => {
    mockConsume.mockRejectedValueOnce(new SpinChallengeStoreError("consume", new Error("blip")));

    await request(app)
      .post("/api/earn/spin/complete")
      .send({ challengeToken: "a".repeat(64) });

    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID }),
      "earn/spin/complete store unavailable — failing retryable",
    );
  });

  it("still returns a deliberate 403 for a genuine invalid-challenge rejection", async () => {
    mockConsume.mockResolvedValueOnce({ status: "not_found" });

    const res = await request(app)
      .post("/api/earn/spin/complete")
      .send({ challengeToken: "a".repeat(64) });

    expect(res.status).toBe(403);
  });

  it("returns 400 when the challengeToken is missing (no DB touched)", async () => {
    const res = await request(app).post("/api/earn/spin/complete").send({});

    expect(res.status).toBe(400);
    expect(mockConsume).not.toHaveBeenCalled();
  });

  it("does not consume the challenge on a store error — a retry with the same token still succeeds", async () => {
    const TOKEN = "b".repeat(64);

    // ── Call 1: consume throws (brief DB blip) ───────────────────────────────
    // The route must return 503 retryable. Because the consume query threw,
    // the challenge row was never deleted from the store — the token is intact.
    mockConsume.mockRejectedValueOnce(
      new SpinChallengeStoreError("consume", new Error("connection reset")),
    );

    const failRes = await request(app)
      .post("/api/earn/spin/complete")
      .send({ challengeToken: TOKEN });

    expect(failRes.status).toBe(503);
    expect(failRes.body).toMatchObject({ retryable: true });

    // ── Call 2: retry with the same token — now the store responds normally ──
    // Because the first call never consumed the token, this retry can succeed.
    // The transaction is pre-baked to return a successful earn result so we
    // exercise the full happy-path response without a real database.
    mockConsume.mockResolvedValueOnce({ status: "ok", points: 180 });
    mockTransaction.mockResolvedValueOnce({
      ok: true,
      tokenId: "tok-retry-ok",
      points: 180,
      claimableAt: new Date().toISOString(),
      dailyUsed: 1,
      dailyCap: 12,
    });

    const retryRes = await request(app)
      .post("/api/earn/spin/complete")
      .send({ challengeToken: TOKEN });

    expect(retryRes.status).toBe(201);
    expect(retryRes.body.tokenId).toBe("tok-retry-ok");
    // The same token was accepted: consume was called exactly twice (once
    // throwing, once succeeding) — proving the first failure did not mark it used.
    expect(mockConsume).toHaveBeenCalledTimes(2);
    expect(mockConsume).toHaveBeenNthCalledWith(1, TOKEN, USER_ID, expect.any(Number));
    expect(mockConsume).toHaveBeenNthCalledWith(2, TOKEN, USER_ID, expect.any(Number));
  });
});
