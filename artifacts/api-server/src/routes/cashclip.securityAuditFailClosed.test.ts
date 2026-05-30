/**
 * Integration tests proving the FAIL-CLOSED guarantee of the ADMIN-INITIATED
 * account-recovery flows in cashclip.ts:
 *   - POST /api/admin/users/:userId/reset-password  → admin_password_reset
 *   - POST /api/admin/users/:userId/factory-reset   → admin_factory_reset
 *
 * Each handler wraps its account mutation and the audit-log write in ONE
 * db.transaction, so if storage.recordSecurityAudit throws inside the
 * transaction the whole thing rolls back — an operator can never alter or take
 * over a user's credentials without a persisted audit trail, and the request
 * surfaces a 5xx instead of a deceptive success.
 *
 * The db fake models transaction atomicity: mutations issued through the `tx`
 * handed to the callback are buffered and only flushed to `committedWrites` when
 * the callback resolves. If the callback rejects (because the mocked audit write
 * throws), the buffer is discarded — exactly mirroring a Postgres ROLLBACK. We
 * assert the mutation was attempted but never committed, and the HTTP status is
 * 5xx. A success-path control proves the model DOES commit when nothing throws,
 * so the rollback assertions can never pass vacuously.
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

// ── Transaction-aware test state ────────────────────────────────────────────
// `auditThrows` flips recordSecurityAudit into a failing dependency.
// `committedWrites` only receives the buffered mutations of a transaction that
// resolved successfully (models post-COMMIT state). `mutationAttempted` flips
// true the moment a mutation is issued inside a transaction — so we can prove
// the mutation ran and was then rolled back, not merely skipped.
let auditThrows = false;
let committedWrites: string[] = [];
let mutationAttempted = false;

vi.mock("../storage", () => ({
  storage: {
    getUser: (...args: unknown[]) => mockGetUser(...args),
    updateUserPassword: (...args: unknown[]) => mockUpdateUserPassword(...args),
    factoryResetUser: (...args: unknown[]) => mockFactoryResetUser(...args),
    recordSecurityAudit: (...args: unknown[]) => mockRecordSecurityAudit(...args),
  },
}));

// ── Atomicity-modelling @workspace/db fake ──────────────────────────────────
// The admin handlers only touch the DB through the storage methods (which
// receive the tx executor), so the fake just needs a transaction that buffers
// and commits/rolls back. The storage mocks below record into the tx via
// tx.__record(...).
function makeExecutor(pending: string[]) {
  return {
    __record: (label: string) => {
      mutationAttempted = true;
      pending.push(label);
    },
  };
}

const dbFake = {
  transaction: async <T>(fn: (tx: ReturnType<typeof makeExecutor>) => Promise<T>): Promise<T> => {
    const pending: string[] = [];
    const tx = makeExecutor(pending);
    const result = await fn(tx); // throws ⇒ pending discarded (ROLLBACK)
    committedWrites.push(...pending); // only reached on success (COMMIT)
    return result;
  },
};

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, db: dbFake };
});

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
  auditThrows = false;
  committedWrites = [];
  mutationAttempted = false;

  mockGetUser.mockResolvedValue({
    id: TARGET_ID, username: "victim", email: "victim@example.com", role: "user", tokenVersion: 0,
  });

  // The mutations run on the tx executor handed to them; the mocks mirror that
  // by recording into the tx buffer so they share the audit write's
  // commit/rollback fate.
  mockUpdateUserPassword.mockImplementation((_id: string, _hash: string, tx?: { __record?: (l: string) => void }) => {
    tx?.__record?.("password_update");
    return Promise.resolve({ tokenVersion: 1 });
  });
  mockFactoryResetUser.mockImplementation((_id: string, _hash: string, tx?: { __record?: (l: string) => void }) => {
    tx?.__record?.("factory_reset");
    return Promise.resolve({ tokenVersion: 1 });
  });
  mockRecordSecurityAudit.mockImplementation((_args: unknown, tx?: { __record?: (l: string) => void }) => {
    if (auditThrows) return Promise.reject(new Error("audit write failed"));
    tx?.__record?.("audit_insert");
    return Promise.resolve(undefined);
  });
});

describe("admin recovery fail-closed: audit failure rolls back the account change", () => {
  it("admin reset-password: audit write throwing rolls back the mutation and returns 5xx", async () => {
    auditThrows = true;

    const res = await request(app)
      .post(`/api/admin/users/${TARGET_ID}/reset-password`)
      .send({ newPassword: "brand-new-password" });

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(mutationAttempted).toBe(true);
    expect(mockRecordSecurityAudit).toHaveBeenCalledTimes(1);
    expect(mockRecordSecurityAudit.mock.calls[0]![0]).toMatchObject({
      actorUserId: ADMIN_ID,
      targetUserId: TARGET_ID,
      event: "admin_password_reset",
    });
    // Both the mutation and the audit write shared one transaction, so NOTHING
    // committed (rollback).
    expect(committedWrites).toEqual([]);
  });

  it("admin factory-reset: audit write throwing rolls back the mutation and returns 5xx", async () => {
    auditThrows = true;

    const res = await request(app)
      .post(`/api/admin/users/${TARGET_ID}/factory-reset`)
      .send({});

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(mutationAttempted).toBe(true);
    expect(mockRecordSecurityAudit).toHaveBeenCalledTimes(1);
    expect(mockRecordSecurityAudit.mock.calls[0]![0]).toMatchObject({
      actorUserId: ADMIN_ID,
      targetUserId: TARGET_ID,
      event: "admin_factory_reset",
    });
    expect(committedWrites).toEqual([]);
  });

  // Sanity: the same model DOES commit both the mutation and the audit entry on
  // the happy path. Without this, the rollback assertions above could pass even
  // if the fake simply never committed anything.
  it("control: when the audit write succeeds, mutation + audit BOTH commit and reset-password returns 200", async () => {
    auditThrows = false;

    const res = await request(app)
      .post(`/api/admin/users/${TARGET_ID}/reset-password`)
      .send({ newPassword: "brand-new-password" });

    expect(res.status).toBe(200);
    expect(mockRecordSecurityAudit).toHaveBeenCalledTimes(1);
    expect(committedWrites).toContain("password_update");
    expect(committedWrites).toContain("audit_insert");
  });
});
