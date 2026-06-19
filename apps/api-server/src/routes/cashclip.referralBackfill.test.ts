/**
 * Integration tests for the one-time referral backfill admin action.
 *
 * Referral enforcement is forward-looking — it only credits a referrer when a
 * referred user creates a NEW qualifying withdrawal. Users who cashed out before
 * the feature shipped never triggered it, so this guarded action backfills them
 * by running each candidate through the same idempotent `qualifyReferral` path.
 *
 * Route covered (in cashclip.ts):
 *   - POST /api/admin/referrals/backfill  (adminMiddleware + passphrase-gated)
 *
 * The REAL adminMiddleware from ../auth is used so the auth gate is genuinely
 * exercised; secretsPassphrase and storage are mocked so the suite runs without
 * a database. The passphrase middleware is mocked to a pass-through here (its own
 * enforcement is covered in secretsPassphrase.test.ts); we assert the route is
 * registered behind it and that admin auth is required.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

const ADMIN_ID = "admin-1";
const JWT_SECRET = "test-jwt-secret-for-backfill-tests-padded-to-64-chars-minimum-aabbccdd";

const mockGetUser = vi.fn();
const mockGetReferralBackfillCandidates = vi.fn();
const mockQualifyReferral = vi.fn();

vi.mock("../storage", () => ({
  storage: {
    getUser: (...args: unknown[]) => mockGetUser(...args),
    getReferralBackfillCandidates: (...args: unknown[]) => mockGetReferralBackfillCandidates(...args),
    qualifyReferral: (...args: unknown[]) => mockQualifyReferral(...args),
  },
}));

vi.mock("../lib/dbRateLimit", () => ({
  recordLoginAttempt: vi.fn().mockResolvedValue({ count: 1, allowed: true }),
  checkLoginAttempts: vi.fn().mockResolvedValue({ count: 0, allowed: true }),
  clearLoginAttempts: vi.fn().mockResolvedValue(undefined),
  pruneExpiredLoginAttempts: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/secretsPassphrase", () => ({
  secretsPassphraseMiddleware: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    db: { transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn({}) },
  };
});

// Sibling route registrations are irrelevant here — stub them out.
vi.mock("../surveys", () => ({ registerSurveyRoutes: vi.fn() }));
vi.mock("../offerwalls", () => ({ registerOfferwallRoutes: vi.fn() }));
vi.mock("./earnings", () => ({ registerEarningsRoutes: vi.fn() }));
vi.mock("./ventures", () => ({ default: express.Router() }));

vi.mock("../lib/email", () => ({
  sendWithdrawalRequestedAdmin: vi.fn(),
  sendWithdrawalRequestedUser: vi.fn(),
  sendWithdrawalVelocityAdmin: vi.fn(),
  sendWithdrawalStatusUpdate: vi.fn(),
  sendSupportTicket: vi.fn(),
  sendPasswordChangedNotice: vi.fn(),
  sendAdminCreditReceipt: vi.fn(),
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

let app: Express;
let adminToken: string;

beforeAll(async () => {
  process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";
  process.env["JWT_ACCESS_SECRET"] = JWT_SECRET;
  delete process.env["ADMIN_TOKEN"];

  adminToken = jwt.sign({ userId: ADMIN_ID, role: "admin", tokenVersion: 0 }, JWT_SECRET, {
    expiresIn: "1h",
  });

  vi.resetModules();
  const { registerRoutes } = await import("./cashclip");
  app = express();
  app.use(express.json());
  await registerRoutes(app);
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ id: ADMIN_ID, role: "admin", tokenVersion: 0 });
  mockGetReferralBackfillCandidates.mockResolvedValue([]);
  mockQualifyReferral.mockResolvedValue({ credited: true });
});

function asAdmin(req: request.Test): request.Test {
  return req.set("Authorization", `Bearer ${adminToken}`);
}

describe("POST /api/admin/referrals/backfill", () => {
  it("dry run previews the candidate count without crediting anyone", async () => {
    mockGetReferralBackfillCandidates.mockResolvedValue([
      { id: "u1", username: "alice", referredBy: "carol" },
      { id: "u2", username: "bob", referredBy: "dave" },
    ]);

    const res = await asAdmin(
      request(app).post("/api/admin/referrals/backfill").send({ dryRun: true }),
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ dryRun: true, candidates: 2 });
    expect(mockQualifyReferral).not.toHaveBeenCalled();
  });

  it("runs each candidate through the idempotent qualifyReferral path and tallies the result", async () => {
    mockGetReferralBackfillCandidates.mockResolvedValue([
      { id: "u1", username: "alice", referredBy: "carol" },
      { id: "u2", username: "bob", referredBy: "dave" },
      { id: "u3", username: "erin", referredBy: "frank" },
    ]);
    // First credits, second already credited (idempotent skip), third throws.
    mockQualifyReferral
      .mockResolvedValueOnce({ credited: true, referrerId: "carol-id" })
      .mockResolvedValueOnce({ credited: false })
      .mockRejectedValueOnce(new Error("boom"));

    const res = await asAdmin(
      request(app).post("/api/admin/referrals/backfill").send({}),
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      dryRun: false,
      candidates: 3,
      credited: 1,
      skipped: 1,
      failed: 1,
    });
    expect(mockQualifyReferral).toHaveBeenCalledTimes(3);
    expect(mockQualifyReferral).toHaveBeenCalledWith(
      expect.objectContaining({ referredUserId: "u1" }),
    );
  });

  it("returns an itemized breakdown of credited, skipped, and failed referrers", async () => {
    mockGetReferralBackfillCandidates.mockResolvedValue([
      { id: "u1", username: "alice", referredBy: "carol" },
      { id: "u2", username: "bob", referredBy: "dave" },
      { id: "u3", username: "erin", referredBy: "frank" },
    ]);
    mockQualifyReferral
      .mockResolvedValueOnce({ credited: true, referrerId: "carol-id" })
      .mockResolvedValueOnce({ credited: false })
      .mockRejectedValueOnce(new Error("boom"));

    const res = await asAdmin(request(app).post("/api/admin/referrals/backfill").send({}));

    expect(res.status).toBe(200);
    expect(res.body.creditedReferrers).toEqual([
      { referrer: "carol", referredFriend: "alice", amount: expect.any(Number) },
    ]);
    expect(res.body.skippedReferrals).toEqual([
      { referrer: "dave", referredFriend: "bob" },
    ]);
    expect(res.body.failedReferrals).toEqual([
      { referrer: "frank", referredFriend: "erin", error: "boom" },
    ]);
  });

  it("returns zero counts when there are no candidates (safe re-run)", async () => {
    mockGetReferralBackfillCandidates.mockResolvedValue([]);

    const res = await asAdmin(request(app).post("/api/admin/referrals/backfill").send({}));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ candidates: 0, credited: 0, skipped: 0, failed: 0 });
    expect(mockQualifyReferral).not.toHaveBeenCalled();
  });
});

describe("admin auth enforcement", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const res = await request(app).post("/api/admin/referrals/backfill").send({});
    expect(res.status).toBe(401);
    expect(mockGetReferralBackfillCandidates).not.toHaveBeenCalled();
    expect(mockQualifyReferral).not.toHaveBeenCalled();
  });
});
