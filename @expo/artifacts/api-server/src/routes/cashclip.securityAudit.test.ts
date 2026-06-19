/**
 * Integration tests asserting that ADMIN-INITIATED account-recovery flows write
 * a security_audit_log entry attributing the action to the acting admin (actor)
 * AND the affected user (target).
 *
 * Flows covered:
 *   - POST /api/admin/users/:userId/reset-password  → admin_password_reset
 *   - POST /api/admin/users/:userId/factory-reset   → admin_factory_reset
 *
 * The real handlers in cashclip.ts are exercised via supertest. storage is
 * mocked so recordSecurityAudit is a spy; the admin/passphrase middlewares and
 * the sibling route registrations are stubbed so registerRoutes wires only the
 * real handlers under test without needing a database. This fails loudly if a
 * refactor ever drops the audit write or loses the actor/target attribution.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";

const ADMIN_ID = "admin-1";
const TARGET_ID = "user-9";

const mockGetUser = vi.fn();
const mockUpdateUserPassword = vi.fn();
const mockFactoryResetUser = vi.fn();
const mockRecordSecurityAudit = vi.fn();

vi.mock("../storage", () => ({
  storage: {
    getUser: (...args: unknown[]) => mockGetUser(...args),
    updateUserPassword: (...args: unknown[]) => mockUpdateUserPassword(...args),
    factoryResetUser: (...args: unknown[]) => mockFactoryResetUser(...args),
    recordSecurityAudit: (...args: unknown[]) => mockRecordSecurityAudit(...args),
  },
}));

// Stub auth: registerAuthRoutes is a no-op; authMiddleware/adminMiddleware
// inject the acting admin so we test the handler, not the gate (the gate is
// covered by auth.adminToken.test.ts).
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

// The admin handlers wrap their mutation + audit write in db.transaction. Run
// the callback with a throwaway tx so the (already-mocked) storage methods are
// exercised; real schema/drizzle exports are preserved via importOriginal.
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

  vi.resetModules();
  const { registerRoutes } = await import("./cashclip");
  app = express();
  app.use(express.json());
  await registerRoutes(app);
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({
    id: TARGET_ID, username: "victim", email: "victim@example.com", role: "user", tokenVersion: 0,
  });
  mockUpdateUserPassword.mockResolvedValue({ tokenVersion: 1 });
  mockFactoryResetUser.mockResolvedValue({ tokenVersion: 1 });
  mockRecordSecurityAudit.mockResolvedValue(undefined);
});

function soleAuditArg(): Record<string, unknown> {
  expect(mockRecordSecurityAudit).toHaveBeenCalledTimes(1);
  return mockRecordSecurityAudit.mock.calls[0]![0] as Record<string, unknown>;
}

const SENSITIVE_KEY_RE = /password|passwd|code|secret|seed|hash|token|otp/i;
function expectNoSecretsInAuditArg(arg: Record<string, unknown>): void {
  for (const key of Object.keys(arg)) {
    expect(key).not.toMatch(SENSITIVE_KEY_RE);
  }
}

describe("admin-initiated security-audit logging", () => {
  it("admin reset-password writes admin_password_reset with actor = admin, target = affected user", async () => {
    const res = await request(app)
      .post(`/api/admin/users/${TARGET_ID}/reset-password`)
      .send({ newPassword: "brand-new-password" });

    expect(res.status).toBe(200);
    const arg = soleAuditArg();
    expect(arg).toMatchObject({
      actorUserId: ADMIN_ID,
      targetUserId: TARGET_ID,
      event: "admin_password_reset",
    });
    expect(arg["actorUserId"]).not.toBe(arg["targetUserId"]);
    expectNoSecretsInAuditArg(arg);
  });

  it("admin factory-reset writes admin_factory_reset with actor = admin, target = affected user", async () => {
    const res = await request(app)
      .post(`/api/admin/users/${TARGET_ID}/factory-reset`)
      .send({});

    expect(res.status).toBe(200);
    const arg = soleAuditArg();
    expect(arg).toMatchObject({
      actorUserId: ADMIN_ID,
      targetUserId: TARGET_ID,
      event: "admin_factory_reset",
    });
    expect(arg["actorUserId"]).not.toBe(arg["targetUserId"]);
    expectNoSecretsInAuditArg(arg);
  });

  it("the regenerated password is never passed to the audit log", async () => {
    await request(app)
      .post(`/api/admin/users/${TARGET_ID}/factory-reset`)
      .send({});

    const arg = soleAuditArg();
    // Defence-in-depth: no value in the audit arg should look like the strong
    // generated password (the handler must only log metadata).
    for (const value of Object.values(arg)) {
      if (typeof value === "string") {
        expect(value.length).toBeLessThan(24);
      }
    }
  });
});
