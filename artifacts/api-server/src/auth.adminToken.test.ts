import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

/**
 * Tests for the DB-backed brute-force throttle on the high-privilege
 * ADMIN_TOKEN console-token gate in `adminMiddleware`.
 *
 * The console-token path is the internal/programmatic operator entry point.
 * Its abuse control mirrors the secrets-passphrase gate: failed attempts are
 * counted per IP in the shared `login_attempts` table so the limit holds
 * across autoscaled replicas.
 *
 * What is verified:
 *   - A wrong x-console-token records a failed attempt against the per-IP key.
 *   - Repeated wrong tokens from one IP get a 429 once the limit is exceeded
 *     (using a stateful in-memory simulation of the DB counter).
 *   - A correct token clears the per-IP counter.
 *   - If the read-only gate check throws, the middleware fails closed (503),
 *     not open.
 *
 * All external dependencies are mocked so tests run without a real DB.
 */

const mockGetUser = vi.fn();
const mockRecordLoginAttempt = vi.fn();
const mockCheckLoginAttempts = vi.fn();
const mockClearLoginAttempts = vi.fn();

vi.mock("./storage", () => ({
  storage: {
    getUser: (...args: unknown[]) => mockGetUser(...args),
    getUserByUsername: vi.fn(),
    createUser: vi.fn(),
    setEmailVerificationToken: vi.fn(),
  },
}));

vi.mock("./lib/dbRateLimit", () => ({
  recordLoginAttempt: (...args: unknown[]) => mockRecordLoginAttempt(...args),
  checkLoginAttempts: (...args: unknown[]) => mockCheckLoginAttempts(...args),
  clearLoginAttempts: (...args: unknown[]) => mockClearLoginAttempts(...args),
  pruneExpiredLoginAttempts: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./lib/email", () => ({
  sendEmailVerification: vi.fn(),
  sendPasswordResetOTP: vi.fn(),
  sendBackupCodeUsedAlert: vi.fn(),
  sendTwoFactorActiveNotice: vi.fn(),
}));

vi.mock("./lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const CONSOLE_TOKEN = "super-secret-admin-console-token-value";

async function buildApp(): Promise<Express> {
  const { adminMiddleware } = await import("./auth");
  const app = express();
  app.use(express.json());
  app.get("/admin/thing", adminMiddleware, (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env["ADMIN_TOKEN"] = CONSOLE_TOKEN;
  process.env["JWT_ACCESS_SECRET"] = "test-jwt-secret-padded-to-64-chars-minimum-aabbccddeeff00112233";
  process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";
  delete process.env["ADMIN_TOKEN_IP_LIMIT"];

  // Defaults: counters under their limits, no admin user resolvable.
  mockCheckLoginAttempts.mockResolvedValue({ count: 0, allowed: true });
  mockRecordLoginAttempt.mockResolvedValue({ count: 1, allowed: true });
  mockClearLoginAttempts.mockResolvedValue(undefined);
  mockGetUser.mockResolvedValue(null);
});

describe("adminMiddleware console-token throttle", () => {
  it("records a failed attempt against the per-ip key on a wrong console token", async () => {
    const app = await buildApp();
    const res = await request(app)
      .get("/admin/thing")
      .set("x-console-token", "wrong-token");

    // No valid Bearer JWT, so the request is ultimately rejected.
    expect(res.status).toBe(401);
    const keys = mockRecordLoginAttempt.mock.calls.map((c) => c[0]);
    expect(keys).toContainEqual(expect.stringContaining("admintoken:ip:"));
    // A wrong token must never clear the counter.
    expect(mockClearLoginAttempts).not.toHaveBeenCalled();
  });

  it("returns 429 (before comparing) once the gate check reports the limit exceeded", async () => {
    mockCheckLoginAttempts.mockResolvedValue({ count: 99, allowed: false });
    const app = await buildApp();
    const res = await request(app)
      .get("/admin/thing")
      .set("x-console-token", CONSOLE_TOKEN);

    expect(res.status).toBe(429);
    expect(res.body.code).toBe("ADMIN_TOKEN_RATE_LIMITED");
    // Even a correct token must not be accepted or recorded once blocked.
    expect(mockClearLoginAttempts).not.toHaveBeenCalled();
    expect(mockRecordLoginAttempt).not.toHaveBeenCalled();
  });

  it("blocks repeated wrong guesses from one IP with a 429 after the limit", async () => {
    process.env["ADMIN_TOKEN_IP_LIMIT"] = "3";

    // Stateful in-memory simulation of the shared login_attempts counter so the
    // test proves the throttle actually trips after repeated guesses, mirroring
    // the real DB semantics (check uses count < max; record uses count <= max).
    const store = new Map<string, number>();
    mockCheckLoginAttempts.mockImplementation(async (key: string, max: number) => {
      const count = store.get(key) ?? 0;
      return { count, allowed: count < max };
    });
    mockRecordLoginAttempt.mockImplementation(async (key: string, max: number) => {
      const count = (store.get(key) ?? 0) + 1;
      store.set(key, count);
      return { count, allowed: count <= max };
    });

    const app = await buildApp();

    // First 3 wrong attempts are evaluated (and rejected with 401).
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .get("/admin/thing")
        .set("x-console-token", `wrong-${i}`);
      expect(res.status).toBe(401);
    }

    // The 4th wrong attempt is blocked by the throttle before comparison.
    const blocked = await request(app)
      .get("/admin/thing")
      .set("x-console-token", "wrong-final");
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe("ADMIN_TOKEN_RATE_LIMITED");
  });

  it("clears the per-ip counter on a correct console token", async () => {
    const app = await buildApp();
    await request(app)
      .get("/admin/thing")
      .set("x-console-token", CONSOLE_TOKEN);

    const cleared = mockClearLoginAttempts.mock.calls.map((c) => c[0]);
    expect(cleared).toContainEqual(expect.stringContaining("admintoken:ip:"));
    // A correct token must not burn a slot.
    expect(mockRecordLoginAttempt).not.toHaveBeenCalled();
  });

  it("fails closed with 503 if the gate DB check throws", async () => {
    mockCheckLoginAttempts.mockRejectedValue(new Error("db down"));
    const app = await buildApp();
    const res = await request(app)
      .get("/admin/thing")
      .set("x-console-token", CONSOLE_TOKEN);

    expect(res.status).toBe(503);
    expect(res.body.code).toBe("ADMIN_TOKEN_RATE_LIMIT_UNAVAILABLE");
    // Failing closed must not record or clear anything.
    expect(mockRecordLoginAttempt).not.toHaveBeenCalled();
    expect(mockClearLoginAttempts).not.toHaveBeenCalled();
  });
});
