import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

/**
 * Integration tests for POST /api/auth/login login-lockout behaviour.
 *
 * Key invariant being tested:
 *   - Repeated bad-password attempts against a known username must NOT produce
 *     a 429 "Account temporarily locked" response.  Per-account lockout was
 *     removed because the counter was keyed on username alone, making it
 *     trivially attacker-triggerable for any publicly-known username (including
 *     the seeded admin accounts).
 *   - The per-IP DB-backed counter is still the authoritative brute-force
 *     boundary and must still produce 429 when its limit is exhausted.
 *
 * All external dependencies (storage, dbRateLimit, email, logger) are mocked
 * so the tests run without a real database or network.
 */

const KNOWN_USERNAME = "testuser";
// bcrypt hash of "correct-password" at cost 10
const KNOWN_HASH = "$2b$10$6Wye/JHXdiO.Luqd19FJ0uryaP.hwRgKLsrocN6BTITCwWpyIiY12";

const mockGetUserByUsername = vi.fn();
const mockRecordLoginAttempt = vi.fn();

vi.mock("./storage", () => ({
  storage: {
    getUserByUsername: (...args: unknown[]) => mockGetUserByUsername(...args),
    getUser: vi.fn().mockResolvedValue(null),
    createUser: vi.fn(),
    setEmailVerificationToken: vi.fn(),
  },
}));

vi.mock("./lib/dbRateLimit", () => ({
  recordLoginAttempt: (...args: unknown[]) => mockRecordLoginAttempt(...args),
  pruneExpiredLoginAttempts: vi.fn().mockResolvedValue(undefined),
  checkLoginAttempts: vi.fn().mockResolvedValue({ count: 0, allowed: true }),
  clearLoginAttempts: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./lib/email", () => ({
  sendEmailVerification: vi.fn(),
}));

vi.mock("./lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

let app: Express;

beforeAll(async () => {
  const TEST_SECRET = "test-jwt-secret-for-auth-tests-padded-to-64-chars-minimum-aabbccdd";
  // Pin JWT_TRIDENTE so the module uses the test secret (not a real Replit env value).
  process.env["JWT_TRIDENTE"] = TEST_SECRET;
  process.env["JWT_SECRET"] = TEST_SECRET;
  // Clear cookie-signing secrets so login doesn't attempt signed cookies
  // (the test app has no cookie-parser middleware).
  delete process.env["INVECE"];
  delete process.env["RIPRENDERE"];
  process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";

  vi.resetModules();
  const { registerAuthRoutes } = await import("./auth");

  app = express();
  app.use(express.json());
  registerAuthRoutes(app);
});

beforeEach(() => {
  vi.clearAllMocks();

  // Default: IP limit not exceeded
  mockRecordLoginAttempt.mockResolvedValue({ count: 1, allowed: true });

  // Default: known user exists with a real bcrypt hash
  mockGetUserByUsername.mockResolvedValue({
    id: "user-1",
    username: KNOWN_USERNAME,
    password: KNOWN_HASH,
    role: "user",
    tokenVersion: 0,
    emailVerified: true,
    balance: "0.00",
    totalEarned: "0.00",
    createdAt: new Date(),
  });
});

describe("POST /api/auth/login — per-account lockout removed", () => {
  it("returns 401 (not 429) on the first bad-password attempt for a known username", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: KNOWN_USERNAME, password: "wrong-password-1" });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid credentials");
  });

  it("still returns 401 after five consecutive bad-password attempts — no account lockout", async () => {
    for (let i = 1; i <= 5; i++) {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ username: KNOWN_USERNAME, password: `wrong-password-${i}` });

      expect(res.status, `attempt ${i} should be 401, not 429`).toBe(401);
      expect(res.body.error).toBe("Invalid credentials");
      expect(res.body.error).not.toMatch(/locked/i);
    }
  });

  it("returns 401 for an unknown username — no lockout on non-existent accounts", async () => {
    mockGetUserByUsername.mockResolvedValue(null);

    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: "ghost-user", password: "anything" });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid credentials");
    expect(res.body.error).not.toMatch(/locked/i);
  });

  it("returns 200 with a token on correct credentials", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: KNOWN_USERNAME, password: "correct-password" });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");
    expect(res.body.user.username).toBe(KNOWN_USERNAME);
  });
});

describe("POST /api/auth/login — per-IP rate limit still enforced", () => {
  it("returns 429 when the IP-level counter is exhausted", async () => {
    mockRecordLoginAttempt.mockResolvedValue({ count: 11, allowed: false });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: KNOWN_USERNAME, password: "wrong-password" });

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/too many attempts/i);
  });

  it("only calls recordLoginAttempt once per request (the IP counter)", async () => {
    await request(app)
      .post("/api/auth/login")
      .send({ username: KNOWN_USERNAME, password: "wrong-password" });

    expect(mockRecordLoginAttempt).toHaveBeenCalledTimes(1);
    const [key] = mockRecordLoginAttempt.mock.calls[0] as [string, ...unknown[]];
    expect(key).toMatch(/^ip:/);
  });

  it("does not call recordLoginAttempt with an acct: key under any circumstance", async () => {
    // Attempt multiple times with a known username
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post("/api/auth/login")
        .send({ username: KNOWN_USERNAME, password: `wrong-${i}` });
    }

    const acctCalls = mockRecordLoginAttempt.mock.calls.filter(
      ([key]: [string, ...unknown[]]) => key.startsWith("acct:"),
    );
    expect(acctCalls).toHaveLength(0);
  });
});
