/**
 * Tests for POST /api/earn/ad-fill — the client-reported LevelPlay fill state
 * endpoint.
 *
 * Goals:
 *   1. Unauthenticated requests → 401 (auth gate is real).
 *   2. Authenticated requests with a non-boolean body → 400.
 *   3. Two consecutive authenticated POSTs (true then false) → the in-memory
 *      store reflects only the latest value (one record per replica, not
 *      accumulated state).
 *
 * The real authMiddleware and adminMiddleware from ../auth are used so the
 * auth gate is genuinely exercised.  storage and the mailer are mocked so
 * the suite runs without a database or SMTP.  The fill state is read back
 * via GET /api/admin/ad-status (admin-only) so we verify the write without
 * reaching into module internals.
 */

import { describe, it, expect, beforeAll, beforeEach, vi, type MockInstance } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

const USER_ID = "user-fill-test-1";
const ADMIN_ID = "admin-fill-test-1";
const JWT_SECRET = "test-jwt-secret-for-ad-fill-tests-padded-to-64-chars-minimum-aabb";

const mockGetUser = vi.fn();

vi.mock("../storage", () => ({
  storage: {
    getUser: (...args: unknown[]) => mockGetUser(...args),
    getUserByUsername: vi.fn(),
    creditUser: vi.fn(),
    debitUser: vi.fn(),
    getAdjustmentLedger: vi.fn().mockResolvedValue([]),
    createSupportTicket: vi.fn(),
    listSupportTickets: vi.fn().mockResolvedValue([]),
    getSupportTicket: vi.fn(),
    updateSupportTicketStatus: vi.fn(),
    createSupportReply: vi.fn(),
    listSupportReplies: vi.fn().mockResolvedValue([]),
    listSentReplies: vi.fn().mockResolvedValue([]),
    getWithdrawalRequests: vi.fn().mockResolvedValue([]),
    getUserWithdrawals: vi.fn().mockResolvedValue([]),
    createWithdrawalRequest: i vi.fn(),
    updateWithdrawalStatus: vi.fn(),
    listUsers: vi.fn().mockResolvedValue([]),
    deleteUser: vi.fn(),
    banUser: vi.fn(),
    unbanUser: vi.fn(),
    updateUserProfile: vi.fn(),
    getUserByEmail: vi.fn(),
    createPasswordResetToken: vi.fn(),
    getPasswordResetToken: vi.fn(),
    deletePasswordResetToken: vi.fn(),
    updateUserPassword: vi.fn(),
    getEarningsTokensByUser: vi.fn().mockResolvedValue([]),
    updateUserLastSeen: vi.fn(),
    touchUserLastSeen: vi.fn().mockResolvedValue(undefined),
    getOnlineUserCount: vi.fn().mockResolvedValue(0),
    SECURITY_AUDIT_EVENTS: [],
    createSecurityAuditEvent: vi.fn(),
    listSecurityAuditEvents: vi.fn().mockResolvedValue([]),
  },
  SECURITY_AUDIT_EVENTS: [],
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockRecordLoginAttempt = vi.fn().mockResolvedValue({ count: 1, allowed: true });

vi.mock("../lib/dbRateLimit", () => ({
  recordLoginAttempt: (...args: unknown[]) => mockRecordLoginAttempt(...args),
  checkLoginAttempts: vi.fn().mockResolvedValue({ count: 0, allowed: true }),
  clearLoginAttempts: vi.fn().mockResolvedValue(undefined),
  pruneExpiredLoginAttempts: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/secretsPassphrase", () => ({
  secretsPassphraseMiddleware: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: vi.fn().mockResolvedValue({}) })) },
}));

vi.mock("../lib/email", () => ({
  sendWithdrawalRequestedAdmin: vi.fn(),
  sendWithdrawalRequestedUser: vi.fn(),
  sendWithdrawalVelocityAdmin: vi.fn(),
  sendWithdrawalStatusUpdate: vi.fn(),
  sendSupportTicket: vi.fn(),
  sendPasswordChangedNotice: vi.fn(),
  sendAdminCreditReceipt: vi.fn(),
  sendSupportReply: vi.fn(),
  sendReferralBonusEarned: vi.fn(),
}));

vi.mock("../surveys", () => ({ registerSurveyRoutes: vi.fn() }));
vi.mock("../offerwalls", () => ({ registerOfferwallRoutes: vi.fn() }));
vi.mock("./earnings", () => ({ registerEarningsRoutes: vi.fn() }));
vi.mock("./ventures", () => ({ default: express.Router() }));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    db: {
      transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn({}),
      select: vi.fn(),
    },
    pool: {
      connect: vi.fn(),
      end: vi.fn(),
      on: vi.fn(),
      query: vi.fn(),
    },
  };
});

let app: Express;
let userToken: string;
let adminToken: string;

beforeAll(async () => {
  process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";
  process.env["JWT_ACCESS_SECRET"] = JWT_SECRET;
  delete process.env["ADMIN_TOKEN"];

  userToken = jwt.sign({ userId: USER_ID, role: "user", tokenVersion: 0 }, JWT_SECRET, {
    expiresIn: "1h",
  });
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
  mockGetUser.mockImplementation(async (id: string) => {
    if (id === ADMIN_ID) return { id, role: "admin", tokenVersion: 0 };
    if (id === USER_ID) return { id, role: "user", tokenVersion: 0 };
    return null;
  });
});

function asUser(req: request.Test): request.Test {
  return req.set("Authorization", `Bearer ${userToken}`);
}

function asAdmin(req: request.Test): request.Test {
  return req.set("Authorization", `Bearer ${adminToken}`);
}

describe("POST /api/earn/ad-fill — fill state reporting", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(app)
      .post("/api/earn/ad-fill")
      .send({ rewardedFillAvailable: true });

    expect(res.status).toBe(401);
  });

  it("rejects a non-boolean body with 400", async () => {
    const stringVal = await asUser(
      request(app).post("/api/earn/ad-fill").send({ rewardedFillAvailable: "yes" }),
    );
    expect(stringVal.status).toBe(400);
    expect(stringVal.body).toMatchObject({ error: expect.stringContaining("boolean") });

    const numberVal = await asUser(
      request(app).post("/api/earn/ad-fill").send({ rewardedFillAvailable: 1 }),
    );
    expect(numberVal.status).toBe(400);

    const missingVal = await asUser(
      request(app).post("/api/earn/ad-fill").send({}),
    );
    expect(missingVal.status).toBe(400);
  });

  it("returns 429 when the per-user rate limit is exceeded", async () => {
    mockRecordLoginAttempt.mockResolvedValueOnce({ count: 11, allowed: false });

    const res = await asUser(
      request(app).post("/api/earn/ad-fill").send({ rewardedFillAvailable: true }),
    );

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: expect.stringContaining("fill reports") });
  });

  it("stores only the latest value when two POSTs arrive in sequence", async () => {
    const first = await asUser(
      request(app).post("/api/earn/ad-fill").send({ rewardedFillAvailable: true }),
    );
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ ok: true });

    const second = await asUser(
      request(app).post("/api/earn/ad-fill").send({ rewardedFillAvailable: false }),
    );
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ ok: true });

    const status = await asAdmin(request(app).get("/api/admin/ad-status"));
    expect(status.status).toBe(200);
    expect(status.body.rewardedFillAvailable).toBe(false);
    expect(status.body.fillReportedAt).toBeTypeOf("number");
  });
});
