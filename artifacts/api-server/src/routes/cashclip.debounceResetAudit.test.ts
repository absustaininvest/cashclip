/**
 * Tests asserting that the sponsored-visit alert debounce-reset endpoint
 * (`POST /api/admin/health/sponsored-visits/reset-alert`) writes a
 * `sponsored_visit_alert_reset` security-audit row attributing the action to
 * the acting admin — and that a DB failure during the audit write does NOT
 * break the response (fire-and-forget best-effort pattern).
 *
 * Pattern mirrors cashclip.securityAudit.test.ts, with one key difference:
 * the reset-alert handler uses dynamic imports (`await import(...)`) inside
 * its body for `sponsoredVisitMonitor` and `clientIp`. Those imports happen at
 * request-time, so calling `vi.resetModules()` before loading cashclip.ts
 * would clear the mock factory registry and let the real modules through.
 * We omit `vi.resetModules()` here; because this file is isolated, cashclip.ts
 * has not been loaded yet and will be imported fresh with all mocks intact.
 *
 * vi.hoisted is used for all functions referenced inside vi.mock factories —
 * required because vi.mock is hoisted above variable declarations but
 * vi.hoisted runs even earlier, ensuring the stubs exist in time.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";

const ADMIN_ID = "admin-42";
const FAKE_IP = "10.0.0.1";

const {
  mockRecordSecurityAudit,
  mockClearDebounce,
  mockGetClientIp,
} = vi.hoisted(() => ({
  mockRecordSecurityAudit: vi.fn(),
  mockClearDebounce: vi.fn(),
  mockGetClientIp: vi.fn().mockReturnValue("10.0.0.1"),
}));

vi.mock("../storage", () => ({
  storage: {
    recordSecurityAudit: (...args: unknown[]) => mockRecordSecurityAudit(...args),
    getUser: vi.fn().mockResolvedValue(undefined),
    getUserByUsername: vi.fn().mockResolvedValue(undefined),
    getUserByEmail: vi.fn().mockResolvedValue(undefined),
    getAllUsers: vi.fn().mockResolvedValue({ users: [], total: 0 }),
    createUser: vi.fn().mockResolvedValue(undefined),
    updateUserPassword: vi.fn().mockResolvedValue({ tokenVersion: 1 }),
    incrementTokenVersion: vi.fn().mockResolvedValue({ tokenVersion: 1 }),
    setTotpBackupCodes: vi.fn().mockResolvedValue(undefined),
    getSecurityAuditEntries: vi.fn().mockResolvedValue({ entries: [], total: 0 }),
    getTotpBackupCodesRemaining: vi.fn().mockResolvedValue(0),
    consumeTotpBackupCode: vi.fn().mockResolvedValue(false),
    factoryResetUser: vi.fn().mockResolvedValue({ tokenVersion: 1 }),
    deleteUser: vi.fn().mockResolvedValue(undefined),
    getUserProfile: vi.fn().mockResolvedValue(undefined),
    updateUserProfile: vi.fn().mockResolvedValue(undefined),
    getUserBalance: vi.fn().mockResolvedValue({ balance: 0, totalEarned: 0 }),
    creditUser: vi.fn().mockResolvedValue({ balance: 0, totalEarned: 0 }),
    debitUser: vi.fn().mockResolvedValue({ balance: 0, totalEarned: 0 }),
    getUserLedger: vi.fn().mockResolvedValue([]),
    createWithdrawal: vi.fn().mockResolvedValue(undefined),
    createWithdrawalAtomic: vi.fn().mockResolvedValue(undefined),
    getWithdrawals: vi.fn().mockResolvedValue([]),
    getWithdrawalById: vi.fn().mockResolvedValue(undefined),
    getUserWithdrawals: vi.fn().mockResolvedValue([]),
    updateWithdrawalStatus: vi.fn().mockResolvedValue(undefined),
    updateWithdrawalStatusIfStatus: vi.fn().mockResolvedValue(undefined),
    createRewardSession: vi.fn().mockResolvedValue(undefined),
    getRewardSession: vi.fn().mockResolvedValue(undefined),
    findCompletedRewardSession: vi.fn().mockResolvedValue(undefined),
    findPendingRewardSession: vi.fn().mockResolvedValue(undefined),
    completeRewardSessionAtomic: vi.fn().mockResolvedValue(undefined),
    findCompletedSessionByProviderTransactionId: vi.fn().mockResolvedValue(undefined),
    completeRewardSessionAndCredit: vi.fn().mockResolvedValue(undefined),
    insertWebhookAudit: vi.fn().mockResolvedValue(undefined),
    countWebhookAuditByIp: vi.fn().mockResolvedValue(0),
    getWebhookAudits: vi.fn().mockResolvedValue([]),
    getWebhookAuditOffenders: vi.fn().mockResolvedValue([]),
    getWebhookAuditProviders: vi.fn().mockResolvedValue([]),
    pruneWebhookAudit: vi.fn().mockResolvedValue(0),
    pruneSecurityAudit: vi.fn().mockResolvedValue(0),
  },
}));

vi.mock("../auth", () => ({
  registerAuthRoutes: vi.fn(),
  authMiddleware: (req: Request & { userId?: string; userRole?: string }, _res: Response, next: NextFunction) => {
    req.userId = ADMIN_ID;
    req.userRole = "admin";
    next();
  },
  adminMiddleware: (req: Request & { userId?: string; userRole?: string }, _res: Response, next: NextFunction) => {
    req.userId = ADMIN_ID;
    req.userRole = "admin";
    next();
  },
}));

vi.mock("../lib/secretsPassphrase", () => ({
  secretsPassphraseMiddleware: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    db: {
      transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn({}),
      execute: vi.fn().mockResolvedValue({ rowCount: 0 }),
    },
  };
});

// sponsoredVisitMonitor is dynamically imported inside the handler body.
// The mock factory must stay registered (no vi.resetModules()) so that the
// import at request-time resolves to the stub, not the real module.
vi.mock("../lib/sponsoredVisitMonitor", () => ({
  clearSponsoredVisitAlertDebounce: (...args: unknown[]) => mockClearDebounce(...args),
  startSponsoredVisitAlertMonitor: vi.fn().mockResolvedValue(undefined),
  stopSponsoredVisitAlertMonitor: vi.fn().mockResolvedValue(undefined),
  isSponsoredVisitAlertMonitorRunning: vi.fn().mockReturnValue(false),
  getSponsoredVisitAlertDebounceState: vi.fn().mockReturnValue({ alertActive: false }),
}));

vi.mock("../lib/clientIp", () => ({
  getClientIp: (...args: unknown[]) => mockGetClientIp(...args),
}));

vi.mock("../surveys", () => ({ registerSurveyRoutes: vi.fn() }));
vi.mock("../offerwalls", () => ({ registerOfferwallRoutes: vi.fn() }));
vi.mock("./earnings", () => ({ registerEarningsRoutes: vi.fn() }));
vi.mock("./ventures", () => ({ default: express.Router() }));

vi.mock("../lib/email", () => ({
  sendWithdrawalRequestedAdmin: vi.fn(),
  sendWithdrawalStatusUpdate: vi.fn(),
  sendSupportTicket: vi.fn(),
  sendPasswordChangedNotice: vi.fn(),
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

let app: Express;

beforeAll(async () => {
  process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";
  process.env["JWT_ACCESS_SECRET"] = "test-jwt-secret-for-auth-tests-padded-to-64-chars-minimum-aabbccdd";

  // NOTE: vi.resetModules() is intentionally omitted here. The handler uses
  // dynamic imports at request-time, so resetting the module registry would
  // clear the vi.mock factory for sponsoredVisitMonitor and clientIp, causing
  // the real modules to be loaded when tests run.
  const { registerRoutes } = await import("./cashclip");
  app = express();
  app.use(express.json());

  // The reset-alert handler calls req.log.info/error without optional chaining.
  // In production pino-http adds req.log; stub it here so the handler doesn't
  // throw a TypeError before it can reach the audit write or res.json call.
  app.use((req: Request & { log?: Record<string, unknown> }, _res, next) => {
    req.log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Record<string, unknown>;
    next();
  });

  await registerRoutes(app);
});

beforeEach(() => {
  vi.clearAllMocks();
  mockClearDebounce.mockResolvedValue(undefined);
  mockRecordSecurityAudit.mockResolvedValue(undefined);
  mockGetClientIp.mockReturnValue(FAKE_IP);
});

const RESET_PATH = "/api/admin/health/sponsored-visits/reset-alert";

describe("debounce-reset audit log", () => {
  it("calls recordSecurityAudit with actorUserId and event=sponsored_visit_alert_reset on success", async () => {
    const res = await request(app).post(RESET_PATH).send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ cleared: true });

    // Give the fire-and-forget promise a tick to resolve
    await new Promise((r) => setImmediate(r));

    expect(mockRecordSecurityAudit).toHaveBeenCalledTimes(1);
    const arg = mockRecordSecurityAudit.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg).toMatchObject({
      actorUserId: ADMIN_ID,
      event: "sponsored_visit_alert_reset",
    });
  });

  it("includes the client IP in the audit entry", async () => {
    const res = await request(app).post(RESET_PATH).send({});

    expect(res.status).toBe(200);
    await new Promise((r) => setImmediate(r));

    const arg = mockRecordSecurityAudit.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg["ip"]).toBe(FAKE_IP);
  });

  it("still returns { cleared: true } even if the audit write rejects", async () => {
    mockRecordSecurityAudit.mockRejectedValue(new Error("DB is down"));

    const res = await request(app).post(RESET_PATH).send({});

    // Response must not be affected by the fire-and-forget audit failure
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ cleared: true });

    // Let the rejected promise settle — must not throw
    await new Promise((r) => setImmediate(r));
  });

  it("does not call recordSecurityAudit when clearSponsoredVisitAlertDebounce throws", async () => {
    mockClearDebounce.mockRejectedValue(new Error("monitor failure"));

    const res = await request(app).post(RESET_PATH).send({});

    expect(res.status).toBe(500);
    await new Promise((r) => setImmediate(r));
    expect(mockRecordSecurityAudit).not.toHaveBeenCalled();
  });
});
