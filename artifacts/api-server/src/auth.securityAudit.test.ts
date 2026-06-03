/**
 * Integration tests asserting that every SELF-SERVICE security-sensitive auth
 * flow writes a security_audit_log entry via storage.recordSecurityAudit, with
 * the correct event name, the acting user as the actor, and NO target user
 * (self-service events are their own subject — target_user_id stays null).
 *
 * Flows covered:
 *   - 2FA enable            → totp_enabled
 *   - backup-code regen     → backup_codes_regenerated
 *   - 2FA disable           → totp_disabled
 *   - change password       → password_changed
 *   - OTP password reset    → password_reset
 *
 * The real route handlers in auth.ts are exercised end-to-end via supertest.
 * storage is mocked so recordSecurityAudit is a spy we can assert on; the few
 * direct db calls the handlers make (the reset-token lookup/consume and the
 * in-transaction user updates) are served by a small chainable @workspace/db
 * fake. This guarantees the test fails if a refactor ever drops one of the
 * audit writes or mislabels an event/actor/target.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";

const TEST_SECRET = "test-jwt-secret-for-auth-tests-padded-to-64-chars-minimum-aabbccdd";
const ADMIN_USER_ID = "admin-1";
const TOTP_SECRET = "JBSWY3DPEHPK3PXP";

const mockGetUser = vi.fn();
const mockGetUserByUsername = vi.fn();
const mockUpdateUserPassword = vi.fn();
const mockSetTotpBackupCodes = vi.fn();
const mockRecordSecurityAudit = vi.fn();

vi.mock("./storage", () => ({
  storage: {
    getUser: (...args: unknown[]) => mockGetUser(...args),
    getUserByUsername: (...args: unknown[]) => mockGetUserByUsername(...args),
    updateUserPassword: (...args: unknown[]) => mockUpdateUserPassword(...args),
    setTotpBackupCodes: (...args: unknown[]) => mockSetTotpBackupCodes(...args),
    recordSecurityAudit: (...args: unknown[]) => mockRecordSecurityAudit(...args),
    createUser: vi.fn().mockResolvedValue(undefined),
    setEmailVerificationToken: vi.fn().mockResolvedValue(undefined),
  },
}));

// ── Chainable @workspace/db fake ────────────────────────────────────────────
// Every node is awaitable AND chainable. `select()` chains resolve to the
// configured reset-token rows; `.returning()` chains resolve to the configured
// consume result. In-transaction `tx.update(users)...` calls just resolve.
let resetTokenRows: unknown[];
let consumeRows: unknown[];

function makeChain() {
  const node: Record<string, unknown> = {};
  let isReturning = false;
  const chainable = (..._a: unknown[]) => node;
  node["from"] = chainable;
  node["set"] = chainable;
  node["where"] = chainable;
  node["limit"] = chainable;
  node["values"] = () => Promise.resolve(undefined);
  node["returning"] = (..._a: unknown[]) => {
    isReturning = true;
    return node;
  };
  node["then"] = (onF: (v: unknown[]) => unknown, onR?: (e: unknown) => unknown) =>
    Promise.resolve(isReturning ? consumeRows : resetTokenRows).then(onF, onR);
  return node;
}

const txLike = {
  select: (..._a: unknown[]) => makeChain(),
  update: (..._a: unknown[]) => makeChain(),
  insert: (..._a: unknown[]) => makeChain(),
};

const dbFake = {
  ...txLike,
  transaction: async <T>(fn: (tx: typeof txLike) => Promise<T>): Promise<T> => fn(txLike),
};

vi.mock("@workspace/db", async () => {
  const drizzle = await import("drizzle-orm");
  return {
    db: dbFake,
    users: "users_table",
    passwordResetTokens: "password_reset_tokens_table",
    eq: drizzle.eq,
    and: drizzle.and,
    isNull: drizzle.isNull,
    gte: drizzle.gte,
    lt: drizzle.lt,
    sql: drizzle.sql,
  };
});

vi.mock("./lib/dbRateLimit", () => ({
  recordLoginAttempt: vi.fn().mockResolvedValue({ count: 1, allowed: true }),
  pruneExpiredLoginAttempts: vi.fn().mockResolvedValue(undefined),
  checkLoginAttempts: vi.fn().mockResolvedValue({ count: 0, allowed: true }),
  clearLoginAttempts: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./lib/totp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/totp")>();
  return { ...actual, verifyTotp: vi.fn().mockReturnValue(true) };
});

vi.mock("bcryptjs", () => ({
  default: {
    compare: vi.fn().mockResolvedValue(true),
    hash: vi.fn().mockResolvedValue("hashed-password-value"),
  },
}));

vi.mock("./lib/email", () => ({
  sendEmailVerification: vi.fn(),
  sendPasswordResetOTP: vi.fn(),
  sendBackupCodeUsedAlert: vi.fn(),
  sendTwoFactorActiveNotice: vi.fn(),
  sendTwoFactorDisabledNotice: vi.fn(),
  sendPasswordChangedNotice: vi.fn(),
}));

vi.mock("./lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

let app: Express;

function accessToken(): string {
  return jwt.sign({ userId: ADMIN_USER_ID, role: "admin", tokenVersion: 0 }, TEST_SECRET);
}

beforeAll(async () => {
  process.env["JWT_ACCESS_SECRET"] = TEST_SECRET;
  process.env["JWT_SECRET"] = TEST_SECRET;
  delete process.env["ADMIN_TOKEN"];
  delete process.env["JWT_REFRESH_SECRET"];
  process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";

  vi.resetModules();
  const { registerAuthRoutes } = await import("./auth");
  app = express();
  app.use(express.json());
  registerAuthRoutes(app);
});

beforeEach(() => {
  vi.clearAllMocks();
  resetTokenRows = [];
  consumeRows = [];
  mockGetUser.mockResolvedValue({
    id: ADMIN_USER_ID,
    username: "admin",
    email: "admin@example.com",
    password: "stored-hash",
    role: "admin",
    tokenVersion: 0,
    totpEnabled: true,
    totpSecret: TOTP_SECRET,
  });
  mockUpdateUserPassword.mockResolvedValue({ tokenVersion: 1 });
  mockSetTotpBackupCodes.mockResolvedValue(undefined);
  mockRecordSecurityAudit.mockResolvedValue(undefined);
});

/** The single audit call recorded during a request, with its first argument. */
function soleAuditArg(): Record<string, unknown> {
  expect(mockRecordSecurityAudit).toHaveBeenCalledTimes(1);
  return mockRecordSecurityAudit.mock.calls[0]![0] as Record<string, unknown>;
}

// No audit argument may ever carry a credential-bearing field.
const SENSITIVE_KEY_RE = /password|passwd|code|secret|seed|hash|token|otp/i;
function expectNoSecretsInAuditArg(arg: Record<string, unknown>): void {
  for (const key of Object.keys(arg)) {
    expect(key).not.toMatch(SENSITIVE_KEY_RE);
  }
}

describe("self-service security-audit logging", () => {
  it("2FA enable writes a totp_enabled entry (actor = self, no target)", async () => {
    // totpSecret absent so the handler treats this as a first-time enable.
    mockGetUser.mockResolvedValue({
      id: ADMIN_USER_ID, username: "admin", email: "admin@example.com",
      role: "admin", tokenVersion: 0, totpEnabled: false, totpSecret: null,
    });

    const res = await request(app)
      .post("/api/auth/totp/enable")
      .set("Authorization", `Bearer ${accessToken()}`)
      .send({ secret: TOTP_SECRET, code: "123456" });

    expect(res.status).toBe(200);
    const arg = soleAuditArg();
    expect(arg).toMatchObject({ actorUserId: ADMIN_USER_ID, event: "totp_enabled" });
    expect(arg["targetUserId"]).toBeUndefined();
    expectNoSecretsInAuditArg(arg);
  });

  it("backup-code regeneration writes a backup_codes_regenerated entry", async () => {
    const res = await request(app)
      .post("/api/auth/totp/backup-codes/regenerate")
      .set("Authorization", `Bearer ${accessToken()}`)
      .send({ code: "123456" });

    expect(res.status).toBe(200);
    const arg = soleAuditArg();
    expect(arg).toMatchObject({ actorUserId: ADMIN_USER_ID, event: "backup_codes_regenerated" });
    expect(arg["targetUserId"]).toBeUndefined();
    expectNoSecretsInAuditArg(arg);
  });

  it("2FA disable writes a totp_disabled entry", async () => {
    const res = await request(app)
      .post("/api/auth/totp/disable")
      .set("Authorization", `Bearer ${accessToken()}`)
      .send({ code: "123456" });

    expect(res.status).toBe(200);
    const arg = soleAuditArg();
    expect(arg).toMatchObject({ actorUserId: ADMIN_USER_ID, event: "totp_disabled" });
    expect(arg["targetUserId"]).toBeUndefined();
    expectNoSecretsInAuditArg(arg);
  });

  it("change-password writes a password_changed entry", async () => {
    const res = await request(app)
      .patch("/api/auth/change-password")
      .set("Authorization", `Bearer ${accessToken()}`)
      .send({ currentPassword: "old-password", newPassword: "new-password-123" });

    expect(res.status).toBe(200);
    const arg = soleAuditArg();
    expect(arg).toMatchObject({ actorUserId: ADMIN_USER_ID, event: "password_changed" });
    expect(arg["targetUserId"]).toBeUndefined();
    expectNoSecretsInAuditArg(arg);
  });

  it("OTP reset-password writes a password_reset entry", async () => {
    const code = "123456";
    const tokenHash = crypto.createHash("sha256").update(code).digest("hex");
    const future = new Date(Date.now() + 60 * 60 * 1000);
    resetTokenRows = [{ id: "rt-1", userId: ADMIN_USER_ID, tokenHash, usedAt: null, expiresAt: future, failedAttempts: 0 }];
    consumeRows = [{ id: "rt-1" }];
    mockGetUserByUsername.mockResolvedValue({
      id: ADMIN_USER_ID, username: "admin", email: "admin@example.com", role: "admin", tokenVersion: 0,
    });

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ username: "admin", code, newPassword: "new-password-123" });

    expect(res.status).toBe(200);
    const arg = soleAuditArg();
    expect(arg).toMatchObject({ actorUserId: ADMIN_USER_ID, event: "password_reset" });
    expect(arg["targetUserId"]).toBeUndefined();
    expectNoSecretsInAuditArg(arg);
  });
});
