import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

/**
 * Integration tests for POST /api/auth/login rate-limit behaviour.
 *
 * Three-layer defence:
 *   1. ip:       Per-source-IP ceiling (DB-backed, 10/15 min).
 *   2. acctip:   Per-(IP, account) ceiling (DB-backed, 5/15 min).
 *   3. acct:     Global per-account failure budget across ALL IPs
 *                (DB-backed, 20 failures/15 min).  This is the primary
 *                defence against distributed password spraying where the
 *                attacker rotates IPs to evade layers 1 and 2.
 *
 * Key invariants:
 *   - Layer 3 uses checkLoginAttempts (read-only) before bcrypt to gate
 *     attempts without burning a slot on an already-blocked account.
 *   - Only genuine password failures increment the layer-3 counter; the
 *     counter is cleared on successful login.
 *   - No plain per-account counter keyed on username alone is used because
 *     that would let any single IP lock out any known account (DoS surface).
 *
 * All external dependencies are mocked so tests run without a real DB.
 */

const KNOWN_USERNAME = "testuser";
const KNOWN_USER_ID  = "user-1";
// bcrypt hash of "correct-password" at cost 10
const KNOWN_HASH = "$2b$10$6Wye/JHXdiO.Luqd19FJ0uryaP.hwRgKLsrocN6BTITCwWpyIiY12";

const mockGetUserByUsername = vi.fn();
const mockRecordLoginAttempt = vi.fn();
const mockCheckLoginAttempts = vi.fn();
const mockClearLoginAttempts = vi.fn();

vi.mock("./storage", () => ({
  storage: {
    getUserByUsername: (...args: unknown[]) => mockGetUserByUsername(...args),
    getUser: vi.fn().mockResolvedValue(null),
    createUser: vi.fn().mockResolvedValue(undefined),
    setEmailVerificationToken: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("./lib/dbRateLimit", () => ({
  recordLoginAttempt: (...args: unknown[]) => mockRecordLoginAttempt(...args),
  pruneExpiredLoginAttempts: vi.fn().mockResolvedValue(undefined),
  checkLoginAttempts: (...args: unknown[]) => mockCheckLoginAttempts(...args),
  clearLoginAttempts: (...args: unknown[]) => mockClearLoginAttempts(...args),
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

  // Default: all rate-limit counters are under their limits.
  mockRecordLoginAttempt.mockResolvedValue({ count: 1, allowed: true });
  mockCheckLoginAttempts.mockResolvedValue({ count: 0, allowed: true });
  mockClearLoginAttempts.mockResolvedValue(undefined);

  // Default: known user exists with a real bcrypt hash.
  mockGetUserByUsername.mockResolvedValue({
    id: KNOWN_USER_ID,
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

// ── Layer 1: per-IP ───────────────────────────────────────────────────────────

describe("POST /api/auth/login — layer 1: per-IP rate limit", () => {
  it("returns 429 when the per-IP counter is exhausted", async () => {
    mockRecordLoginAttempt.mockResolvedValue({ count: 11, allowed: false });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: KNOWN_USERNAME, password: "wrong-password" });

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/too many attempts/i);
  });
});

// ── Layer 2: per-(IP, account) ────────────────────────────────────────────────

describe("POST /api/auth/login — layer 2: per-(IP, account) rate limit", () => {
  it("returns 429 when the per-(IP, account) counter is exhausted", async () => {
    // ip: allowed; acctip: blocked.
    mockRecordLoginAttempt
      .mockResolvedValueOnce({ count: 1, allowed: true })   // ip:
      .mockResolvedValueOnce({ count: 6, allowed: false });  // acctip:

    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: KNOWN_USERNAME, password: "wrong-password" });

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/too many attempts/i);
  });

  it("uses an acctip: key that encodes the normalised username", async () => {
    await request(app)
      .post("/api/auth/login")
      .send({ username: KNOWN_USERNAME, password: "wrong-password" });

    const acctipCall = mockRecordLoginAttempt.mock.calls.find(
      ([key]: [string, ...unknown[]]) => (key as string).startsWith("acctip:"),
    );
    expect(acctipCall).toBeDefined();
    const [acctipKey] = acctipCall as [string, ...unknown[]];
    expect(acctipKey).toContain(KNOWN_USERNAME.toLowerCase());
  });
});

// ── Layer 3: global per-account ───────────────────────────────────────────────

describe("POST /api/auth/login — layer 3: global per-account failure budget", () => {
  it("returns 429 when the global per-account budget is exhausted, regardless of IP", async () => {
    // Both IP-scoped counters allow; the account-level gate blocks.
    mockCheckLoginAttempts.mockResolvedValue({ count: 20, allowed: false });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: KNOWN_USERNAME, password: "wrong-password" });

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/too many attempts/i);
  });

  it("increments the global account counter on a bad password", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: KNOWN_USERNAME, password: "wrong-password" });

    expect(res.status).toBe(401);

    const acctRecordCall = mockRecordLoginAttempt.mock.calls.find(
      ([key]: [string, ...unknown[]]) => (key as string).startsWith("acct:"),
    );
    expect(acctRecordCall).toBeDefined();
    const [acctKey] = acctRecordCall as [string, ...unknown[]];
    // Key must encode user ID, not username, to be enumeration-safe.
    expect(acctKey).toContain(KNOWN_USER_ID);
  });

  it("clears the global account counter on a successful login", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: KNOWN_USERNAME, password: "correct-password" });

    expect(res.status).toBe(200);
    expect(mockClearLoginAttempts).toHaveBeenCalledWith(`acct:${KNOWN_USER_ID}`);
  });

  it("does NOT increment the global account counter on a successful login", async () => {
    await request(app)
      .post("/api/auth/login")
      .send({ username: KNOWN_USERNAME, password: "correct-password" });

    const acctRecordCall = mockRecordLoginAttempt.mock.calls.find(
      ([key]: [string, ...unknown[]]) => (key as string).startsWith("acct:"),
    );
    expect(acctRecordCall).toBeUndefined();
  });

  it("checks the global account budget before running bcrypt (short-circuits expensive hash)", async () => {
    // Gate fires → 429.  If bcrypt ran, getUserByUsername would need a valid
    // password to return 401 instead.  We verify 429 is returned without
    // a successful bcrypt result being possible.
    mockCheckLoginAttempts.mockResolvedValue({ count: 20, allowed: false });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: KNOWN_USERNAME, password: "wrong-password" });

    expect(res.status).toBe(429);
    // recordLoginAttempt for acct: must NOT have been called (no slot burned).
    const acctRecordCall = mockRecordLoginAttempt.mock.calls.find(
      ([key]: [string, ...unknown[]]) => (key as string).startsWith("acct:"),
    );
    expect(acctRecordCall).toBeUndefined();
  });
});

// ── Combined behaviour ────────────────────────────────────────────────────────

describe("POST /api/auth/login — combined behaviour", () => {
  it("returns 401 on bad password when all three layers are under their limits", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: KNOWN_USERNAME, password: "wrong-password-1" });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid credentials");
  });

  it("returns 200 with a token on correct credentials", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: KNOWN_USERNAME, password: "correct-password" });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");
    expect(res.body.user.username).toBe(KNOWN_USERNAME);
  });

  it("returns 401 for an unknown username", async () => {
    mockGetUserByUsername.mockResolvedValue(null);

    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: "ghost-user", password: "anything" });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid credentials");
  });

  it("does not use a plain per-username-only key in recordLoginAttempt (no single-IP account DoS surface)", async () => {
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post("/api/auth/login")
        .send({ username: KNOWN_USERNAME, password: `wrong-${i}` });
    }

    // A plain per-username key would be exactly KNOWN_USERNAME with no IP
    // component.  Such a key lets any single IP deny service to a known account.
    const plainUsernameCalls = mockRecordLoginAttempt.mock.calls.filter(
      ([key]: [string, ...unknown[]]) => (key as string) === KNOWN_USERNAME ||
        (key as string) === `acct:${KNOWN_USERNAME}`,
    );
    expect(plainUsernameCalls).toHaveLength(0);
  });
});
