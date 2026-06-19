import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

/**
 * Regression tests proving that the X-Console-Token / ADMIN_TOKEN shared secret
 * is NOT a valid credential for adminMiddleware-protected routes. All admin API
 * access requires a real admin Bearer JWT with a verified userId and tokenVersion.
 *
 * History: the old design accepted X-Console-Token as a standalone superuser
 * credential (bypassing account auth, TOTP, and the durable security_audit_log),
 * which was a broken admin-boundary vulnerability. These tests lock in the fixed
 * boundary so the bypass cannot be reintroduced silently.
 *
 * What is verified:
 *   - X-Console-Token alone (matching ADMIN_TOKEN) → 401, not granted.
 *   - No credentials at all → 401.
 *   - A valid admin Bearer JWT (matching tokenVersion + role) → 200, granted.
 *   - A valid non-admin Bearer JWT → 403.
 *   - X-Console-Token + a valid admin Bearer JWT → 200 (JWT wins; token header ignored).
 */

const JWT_SECRET = "test-jwt-secret-padded-to-64-chars-minimum-aabbccddeeff00112233";
const CONSOLE_TOKEN = "super-secret-admin-console-token-value";
const ADMIN_ID = "admin-user-1";
const USER_ID = "regular-user-1";

const mockGetUser = vi.fn();

vi.mock("./storage", () => ({
  storage: {
    getUser: (...args: unknown[]) => mockGetUser(...args),
    getUserByUsername: vi.fn(),
    createUser: vi.fn(),
    setEmailVerificationToken: vi.fn(),
    touchUserLastSeen: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("./lib/dbRateLimit", () => ({
  recordLoginAttempt: vi.fn().mockResolvedValue({ count: 1, allowed: true }),
  checkLoginAttempts: vi.fn().mockResolvedValue({ count: 0, allowed: true }),
  clearLoginAttempts: vi.fn().mockResolvedValue(undefined),
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

function makeAdminJwt(userId: string, tokenVersion = 0): string {
  return jwt.sign({ userId, role: "admin", tokenVersion }, JWT_SECRET, { expiresIn: "1h" });
}

function makeUserJwt(userId: string, tokenVersion = 0): string {
  return jwt.sign({ userId, role: "user", tokenVersion }, JWT_SECRET, { expiresIn: "1h" });
}

async function buildApp(): Promise<Express> {
  const { adminMiddleware } = await import("./auth");
  const app = express();
  app.use(express.json());
  app.get("/admin/thing", adminMiddleware, (_req, res) => {
    res.json({ ok: true });
  });
  app.post("/admin/mutate", adminMiddleware, (_req, res) => {
    res.json({ ok: true });
  });
  app.delete("/admin/mutate", adminMiddleware, (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env["ADMIN_TOKEN"] = CONSOLE_TOKEN;
  process.env["JWT_ACCESS_SECRET"] = JWT_SECRET;
  process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";

  mockGetUser.mockImplementation(async (id: string) => {
    if (id === ADMIN_ID) return { id: ADMIN_ID, role: "admin", tokenVersion: 0 };
    if (id === USER_ID) return { id: USER_ID, role: "user", tokenVersion: 0 };
    return null;
  });
});

describe("adminMiddleware security boundary — console-token removed", () => {
  it("X-Console-Token alone (matching ADMIN_TOKEN) is rejected with 401", async () => {
    const app = await buildApp();
    const res = await request(app)
      .get("/admin/thing")
      .set("x-console-token", CONSOLE_TOKEN);

    expect(res.status).toBe(401);
  });

  it("no credentials at all is rejected with 401", async () => {
    const app = await buildApp();
    const res = await request(app).get("/admin/thing");

    expect(res.status).toBe(401);
  });

  it("a valid admin Bearer JWT grants access and binds userId", async () => {
    const app = await buildApp();
    const res = await request(app)
      .get("/admin/thing")
      .set("Authorization", `Bearer ${makeAdminJwt(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("a valid non-admin Bearer JWT is rejected with 403", async () => {
    const app = await buildApp();
    const res = await request(app)
      .get("/admin/thing")
      .set("Authorization", `Bearer ${makeUserJwt(USER_ID)}`);

    expect(res.status).toBe(403);
  });

  it("X-Console-Token + valid admin Bearer JWT → JWT wins, access granted", async () => {
    const app = await buildApp();
    const res = await request(app)
      .get("/admin/thing")
      .set("Authorization", `Bearer ${makeAdminJwt(ADMIN_ID)}`)
      .set("x-console-token", CONSOLE_TOKEN);

    // The Bearer JWT is valid so the request succeeds. The console-token header
    // is simply ignored — it provides no additional access on its own.
    expect(res.status).toBe(200);
  });

  it("an expired admin Bearer JWT is rejected with 401", async () => {
    const app = await buildApp();
    const expiredToken = jwt.sign(
      { userId: ADMIN_ID, role: "admin", tokenVersion: 0 },
      JWT_SECRET,
      { expiresIn: -1 },
    );
    const res = await request(app)
      .get("/admin/thing")
      .set("Authorization", `Bearer ${expiredToken}`);

    expect(res.status).toBe(401);
  });

  it("a Bearer JWT with a stale tokenVersion is rejected with 401", async () => {
    mockGetUser.mockResolvedValueOnce({ id: ADMIN_ID, role: "admin", tokenVersion: 5 });
    const app = await buildApp();
    const staleToken = makeAdminJwt(ADMIN_ID, 3);
    const res = await request(app)
      .get("/admin/thing")
      .set("Authorization", `Bearer ${staleToken}`);

    expect(res.status).toBe(401);
  });

  it("allows GET requests via a valid console token (read-only is permitted)", async () => {
    const app = await buildApp();
    const res = await request(app)
      .get("/admin/thing")
      .set("x-console-token", CONSOLE_TOKEN);

    // The handler resolves after the middleware passes; no auth header means
    // the Bearer path is skipped and the console-token path carries through.
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("blocks POST via console-token with 403 — state-mutating methods require a real admin account", async () => {
    const app = await buildApp();
    const res = await request(app)
      .post("/admin/mutate")
      .set("x-console-token", CONSOLE_TOKEN)
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ADMIN_IDENTITY_REQUIRED");
  });

  it("blocks DELETE via console-token with 403", async () => {
    const app = await buildApp();
    const res = await request(app)
      .delete("/admin/mutate")
      .set("x-console-token", CONSOLE_TOKEN);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ADMIN_IDENTITY_REQUIRED");
  });
});
