/**
 * Integration tests proving the FAIL-CLOSED guarantee of the self-service
 * security-sensitive auth flows: the account mutation and its audit-log write
 * commit together in ONE db.transaction, so if storage.recordSecurityAudit
 * throws inside the transaction the whole thing rolls back — there is never a
 * security-sensitive change without a persisted audit trail, and the request
 * surfaces a 5xx instead of a deceptive success.
 *
 * Flows covered (each is wrapped in db.transaction in auth.ts):
 *   - 2FA enable            → totp_enabled
 *   - backup-code regen     → backup_codes_regenerated
 *   - 2FA disable           → totp_disabled
 *   - change password       → password_changed
 *   - OTP password reset    → password_reset
 *
 * The db fake models transaction atomicity: mutations issued through the `tx`
 * handed to the callback are buffered and only flushed to `committedWrites`
 * when the callback resolves. If the callback rejects (because the mocked audit
 * write throws), the buffer is discarded — exactly mirroring a Postgres
 * ROLLBACK. We assert the mutation was attempted but never committed, and the
 * HTTP status is 5xx. A success-path sanity check proves the model DOES commit
 * when nothing throws, so the rollback assertions can never pass vacuously.
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

// ── Transaction-aware test state ────────────────────────────────────────────
// `auditThrows` flips recordSecurityAudit into a failing dependency.
// `committedWrites` only ever receives the buffered mutations of a transaction
// that resolved successfully (i.e. it models the post-COMMIT row state).
// `mutationAttempted` flips true the moment a user mutation is *issued* inside a
// transaction, regardless of whether that transaction later commits — so we can
// prove the mutation ran and was then rolled back, not merely skipped.
let auditThrows = false;
let committedWrites: string[] = [];
let mutationAttempted = false;
let resetTokenRows: unknown[] = [];
let consumeRows: unknown[] = [];

vi.mock("./storage", () => ({
  storage: {
    getUser: (...args: unknown[]) => mockGetUser(...args),
    getUserByUsername: (...args: unknown[]) => mockGetUserByUsername(...args),
    updateUserPassword: (...args: unknown[]) => mockUpdateUserPassword(...args),
    setTotpBackupCodes: (...args: unknown[]) => mockSetTotpBackupCodes(...args),
    recordSecurityAudit: (...args: unknown[]) => mockRecordSecurityAudit(...args),
    createUser: vi.fn(),
    setEmailVerificationToken: vi.fn(),
    touchUserLastSeen: vi.fn().mockResolvedValue(undefined),
  },
}));

// ── Atomicity-modelling @workspace/db fake ──────────────────────────────────
// Every builder node is chainable AND thenable. Mutations on the `users` table
// push into the active transaction's `pending` buffer; the buffer is flushed to
// `committedWrites` only when the transaction callback resolves. Top-level
// (non-tx) calls — the reset-token lookup/consume — use a throwaway buffer so
// they never pollute the committed-write assertions.
function makeNode(pending: string[], op: string | null, table?: unknown) {
  const node: Record<string, unknown> = {};
  let isReturning = false;
  node["from"] = () => node;
  node["set"] = () => node;
  node["where"] = () => {
    if (op === "update" && table === "users_table") {
      mutationAttempted = true;
      pending.push("user_update");
    }
    return node;
  };
  node["limit"] = () => node;
  node["values"] = () => {
    pending.push("audit_insert");
    return Promise.resolve(undefined);
  };
  node["returning"] = () => {
    isReturning = true;
    return node;
  };
  node["then"] = (onF: (v: unknown[]) => unknown, onR?: (e: unknown) => unknown) =>
    Promise.resolve(isReturning ? consumeRows : resetTokenRows).then(onF, onR);
  return node;
}

function makeExecutor(pending: string[]) {
  return {
    select: (..._a: unknown[]) => makeNode(pending, "select"),
    update: (table: unknown) => makeNode(pending, "update", table),
    insert: (..._a: unknown[]) => makeNode(pending, "insert"),
    // Storage mocks that participate in a transaction call tx.__record(...) so
    // their mutation lands in the same buffer as direct tx.update() writes.
    __record: (label: string) => {
      mutationAttempted = true;
      pending.push(label);
    },
  };
}

const dbFake = {
  ...makeExecutor([]),
  transaction: async <T>(fn: (tx: ReturnType<typeof makeExecutor>) => Promise<T>): Promise<T> => {
    const pending: string[] = [];
    const tx = makeExecutor(pending);
    const result = await fn(tx); // throws ⇒ pending discarded (ROLLBACK)
    committedWrites.push(...pending); // only reached on success (COMMIT)
    return result;
  },
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
  auditThrows = false;
  committedWrites = [];
  mutationAttempted = false;
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

  // updateUserPassword / setTotpBackupCodes are storage methods that, in
  // production, run on the executor (tx) handed to them. The mocks mirror that:
  // when called with a tx they record the mutation into the tx buffer so it is
  // subject to the same commit/rollback as the audit write.
  mockUpdateUserPassword.mockImplementation((_id: string, _hash: string, tx?: { __record?: (l: string) => void }) => {
    tx?.__record?.("password_update");
    return Promise.resolve({ tokenVersion: 1 });
  });
  mockSetTotpBackupCodes.mockImplementation((_id: string, _hashes: string[], tx?: { __record?: (l: string) => void }) => {
    tx?.__record?.("backup_codes_set");
    return Promise.resolve(undefined);
  });
  mockRecordSecurityAudit.mockImplementation((_args: unknown, tx?: { __record?: (l: string) => void }) => {
    if (auditThrows) return Promise.reject(new Error("audit write failed"));
    tx?.__record?.("audit_insert");
    return Promise.resolve(undefined);
  });
});

// ── 2FA enable ──────────────────────────────────────────────────────────────
async function callTotpEnable() {
  mockGetUser.mockResolvedValue({
    id: ADMIN_USER_ID, username: "admin", email: "admin@example.com",
    role: "admin", tokenVersion: 0, totpEnabled: false, totpSecret: null,
  });
  return request(app)
    .post("/api/auth/totp/enable")
    .set("Authorization", `Bearer ${accessToken()}`)
    .send({ secret: TOTP_SECRET, code: "123456" });
}

async function callBackupRegen() {
  return request(app)
    .post("/api/auth/totp/backup-codes/regenerate")
    .set("Authorization", `Bearer ${accessToken()}`)
    .send({ code: "123456" });
}

async function callTotpDisable() {
  return request(app)
    .post("/api/auth/totp/disable")
    .set("Authorization", `Bearer ${accessToken()}`)
    .send({ code: "123456" });
}

async function callChangePassword() {
  return request(app)
    .patch("/api/auth/change-password")
    .set("Authorization", `Bearer ${accessToken()}`)
    .send({ currentPassword: "old-password", newPassword: "new-password-123" });
}

async function callResetPassword() {
  const code = "123456";
  const tokenHash = crypto.createHash("sha256").update(code).digest("hex");
  const future = new Date(Date.now() + 60 * 60 * 1000);
  resetTokenRows = [{ id: "rt-1", userId: ADMIN_USER_ID, tokenHash, usedAt: null, expiresAt: future, failedAttempts: 0 }];
  consumeRows = [{ id: "rt-1" }];
  mockGetUserByUsername.mockResolvedValue({
    id: ADMIN_USER_ID, username: "admin", email: "admin@example.com", role: "admin", tokenVersion: 0,
  });
  return request(app)
    .post("/api/auth/reset-password")
    .send({ username: "admin", code, newPassword: "new-password-123" });
}

const flows: Array<{ name: string; run: () => Promise<request.Response> }> = [
  { name: "2FA enable (totp_enabled)", run: callTotpEnable },
  { name: "backup-code regeneration (backup_codes_regenerated)", run: callBackupRegen },
  { name: "2FA disable (totp_disabled)", run: callTotpDisable },
  { name: "change password (password_changed)", run: callChangePassword },
  { name: "OTP reset password (password_reset)", run: callResetPassword },
];

describe("self-service fail-closed: audit failure rolls back the account change", () => {
  for (const { name, run } of flows) {
    it(`${name}: audit write throwing rolls back the mutation and returns 5xx`, async () => {
      auditThrows = true;

      const res = await run();

      // The request must NOT report success when the audit trail could not be
      // persisted.
      expect(res.status).toBeGreaterThanOrEqual(500);
      // The mutation was attempted inside the transaction…
      expect(mutationAttempted).toBe(true);
      // …the audit write was attempted (and threw)…
      expect(mockRecordSecurityAudit).toHaveBeenCalledTimes(1);
      // …and because both shared one transaction, NOTHING committed (rollback).
      expect(committedWrites).toEqual([]);
    });
  }

  // Sanity: the same model DOES commit both the mutation and the audit entry on
  // the happy path. Without this, the rollback assertions above could pass even
  // if the fake simply never committed anything.
  it("control: when the audit write succeeds, mutation + audit BOTH commit and the request succeeds", async () => {
    auditThrows = false;

    const res = await callChangePassword();

    expect(res.status).toBe(200);
    expect(mockRecordSecurityAudit).toHaveBeenCalledTimes(1);
    expect(committedWrites).toContain("password_update");
    expect(committedWrites).toContain("audit_insert");
  });
});
