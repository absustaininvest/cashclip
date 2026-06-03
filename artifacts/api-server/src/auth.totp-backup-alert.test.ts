import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

/**
 * Tests for the backup-code-used admin alert on POST /api/auth/totp/verify.
 *
 * When an admin signs in with a single-use TOTP backup code (not a live
 * authenticator code), the server consumes the code and emails the admin a
 * heads-up with the number of codes remaining, recommending regeneration when
 * the count is low. A live authenticator code must NOT trigger the alert.
 *
 * All external dependencies are mocked so tests run without a real DB.
 */

const TEST_SECRET = "test-jwt-secret-for-auth-tests-padded-to-64-chars-minimum-aabbccdd";
const ADMIN_USER_ID = "admin-1";
const TOTP_SECRET = "JBSWY3DPEHPK3PXP";

const mockGetUser = vi.hoisted(() => vi.fn());
const mockConsumeTotpBackupCode = vi.hoisted(() => vi.fn());
const mockGetTotpBackupCodesRemaining = vi.hoisted(() => vi.fn());
const mockVerifyTotp = vi.fn();
const mockSendBackupCodeUsedAlert = vi.fn();

vi.mock("./storage", async () => {
  const { createStorageMock } = await import("./testHelpers/mockStorage");
  return {
    storage: {
      ...createStorageMock({
        getUser: mockGetUser,
        consumeTotpBackupCode: mockConsumeTotpBackupCode,
        getTotpBackupCodesRemaining: mockGetTotpBackupCodesRemaining,
      }),
      setEmailVerificationToken: vi.fn().mockResolvedValue(undefined),
    },
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
  return {
    ...actual,
    verifyTotp: (...args: unknown[]) => mockVerifyTotp(...args),
  };
});

vi.mock("./lib/email", () => ({
  sendEmailVerification: vi.fn(),
  sendPasswordResetOTP: vi.fn(),
  sendBackupCodeUsedAlert: (...args: unknown[]) => mockSendBackupCodeUsedAlert(...args),
}));

vi.mock("./lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

let app: Express;

function makeSessionToken(): string {
  return jwt.sign(
    { userId: ADMIN_USER_ID, type: "totp-pending", tokenVersion: 0 },
    TEST_SECRET,
    { expiresIn: "5m" },
  );
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
  mockGetUser.mockResolvedValue({
    id: ADMIN_USER_ID,
    username: "admin",
    email: "admin@example.com",
    role: "admin",
    tokenVersion: 0,
    totpEnabled: true,
    totpSecret: TOTP_SECRET,
  });
  mockConsumeTotpBackupCode.mockResolvedValue(true);
  mockGetTotpBackupCodesRemaining.mockResolvedValue(5);
  mockVerifyTotp.mockReturnValue(false);
});

describe("POST /api/auth/totp/verify — backup code used alert", () => {
  it("emails the admin with the remaining count when a backup code is consumed", async () => {
    mockGetTotpBackupCodesRemaining.mockResolvedValue(3);
    const res = await request(app)
      .post("/api/auth/totp/verify")
      .send({ totpSessionToken: makeSessionToken(), code: "backup-code-1" });

    expect(res.status).toBe(200);
    expect(mockConsumeTotpBackupCode).toHaveBeenCalledTimes(1);
    expect(mockSendBackupCodeUsedAlert).toHaveBeenCalledTimes(1);
    expect(mockSendBackupCodeUsedAlert).toHaveBeenCalledWith(
      expect.objectContaining({ to: "admin@example.com", username: "admin", remaining: 3 }),
    );
  });

  it("does NOT email the admin when a live authenticator code is used", async () => {
    mockVerifyTotp.mockReturnValue(true);
    const res = await request(app)
      .post("/api/auth/totp/verify")
      .send({ totpSessionToken: makeSessionToken(), code: "123456" });

    expect(res.status).toBe(200);
    expect(mockConsumeTotpBackupCode).not.toHaveBeenCalled();
    expect(mockSendBackupCodeUsedAlert).not.toHaveBeenCalled();
  });

  it("skips the alert (but still logs in) when the admin has no email on file", async () => {
    mockGetUser.mockResolvedValue({
      id: ADMIN_USER_ID,
      username: "admin",
      email: null,
      role: "admin",
      tokenVersion: 0,
      totpEnabled: true,
      totpSecret: TOTP_SECRET,
    });
    const res = await request(app)
      .post("/api/auth/totp/verify")
      .send({ totpSessionToken: makeSessionToken(), code: "backup-code-1" });

    expect(res.status).toBe(200);
    expect(mockSendBackupCodeUsedAlert).not.toHaveBeenCalled();
  });

  it("still logs the admin in if sending the alert throws", async () => {
    mockGetTotpBackupCodesRemaining.mockRejectedValue(new Error("db down"));
    const res = await request(app)
      .post("/api/auth/totp/verify")
      .send({ totpSessionToken: makeSessionToken(), code: "backup-code-1" });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("token");
  });
});
