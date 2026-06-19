/**
 * Tests for the DB-backed brute-force throttle on the high-privilege
 * secrets-passphrase gate.
 *
 * What is verified:
 *   - A wrong passphrase records a failed attempt against both the per-IP
 *     and per-admin keys (replica-safe counters).
 *   - Once the read-only gate reports the limit is exceeded, the request is
 *     rejected with 429 before the passphrase is even compared.
 *   - A correct passphrase clears both counters and passes through.
 *   - If the DB gate check throws, the middleware fails closed (503).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const mockRecordLoginAttempt = vi.fn();
const mockCheckLoginAttempts = vi.fn();
const mockClearLoginAttempts = vi.fn();

vi.mock("./dbRateLimit.js", () => ({
  recordLoginAttempt: (...args: unknown[]) => mockRecordLoginAttempt(...args),
  checkLoginAttempts: (...args: unknown[]) => mockCheckLoginAttempts(...args),
  clearLoginAttempts: (...args: unknown[]) => mockClearLoginAttempts(...args),
}));

vi.mock("./logger.js", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const PASSPHRASE = "correct-horse-battery-staple";

async function buildApp() {
  const { secretsPassphraseMiddleware } = await import("./secretsPassphrase.js");
  const app = express();
  app.use(express.json());
  // Simulate adminMiddleware having attached a userId.
  app.use((req, _res, next) => {
    (req as unknown as { userId: string }).userId = "admin-1";
    next();
  });
  app.post("/gated", secretsPassphraseMiddleware, (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe("secretsPassphraseMiddleware rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["SECRETS_PASSPHRASE"] = PASSPHRASE;
    delete process.env["SECRETS_PASSPHRASE_IP_LIMIT"];
    delete process.env["SECRETS_PASSPHRASE_USER_LIMIT"];
    mockCheckLoginAttempts.mockResolvedValue({ count: 0, allowed: true });
    mockRecordLoginAttempt.mockResolvedValue({ count: 1, allowed: true });
    mockClearLoginAttempts.mockResolvedValue(undefined);
  });

  it("records a failed attempt against both per-ip and per-admin keys on wrong passphrase", async () => {
    const app = await buildApp();
    const res = await request(app)
      .post("/gated")
      .set("x-secrets-passphrase", "wrong")
      .send({});

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("SECRETS_PASSPHRASE_INVALID");
    const keys = mockRecordLoginAttempt.mock.calls.map((c) => c[0]);
    expect(keys).toContainEqual(expect.stringContaining("secpass:ip:"));
    expect(keys).toContainEqual("secpass:user:admin-1");
  });

  it("returns 429 (before comparing) once the gate check reports the limit exceeded", async () => {
    mockCheckLoginAttempts.mockResolvedValue({ count: 99, allowed: false });
    const app = await buildApp();
    const res = await request(app)
      .post("/gated")
      .set("x-secrets-passphrase", PASSPHRASE)
      .send({});

    expect(res.status).toBe(429);
    expect(res.body.code).toBe("SECRETS_PASSPHRASE_RATE_LIMITED");
    // The correct passphrase must not have been "accepted" — no clear, no pass-through.
    expect(mockClearLoginAttempts).not.toHaveBeenCalled();
  });

  it("clears both counters and passes through on correct passphrase", async () => {
    const app = await buildApp();
    const res = await request(app)
      .post("/gated")
      .set("x-secrets-passphrase", PASSPHRASE)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const cleared = mockClearLoginAttempts.mock.calls.map((c) => c[0]);
    expect(cleared).toContainEqual(expect.stringContaining("secpass:ip:"));
    expect(cleared).toContainEqual("secpass:user:admin-1");
    expect(mockRecordLoginAttempt).not.toHaveBeenCalled();
  });

  it("fails closed with 503 if the gate DB check throws", async () => {
    mockCheckLoginAttempts.mockRejectedValue(new Error("db down"));
    const app = await buildApp();
    const res = await request(app)
      .post("/gated")
      .set("x-secrets-passphrase", PASSPHRASE)
      .send({});

    expect(res.status).toBe(503);
    expect(res.body.code).toBe("SECRETS_PASSPHRASE_RATE_LIMIT_UNAVAILABLE");
  });

  it("does not record an attempt when the header is missing", async () => {
    const app = await buildApp();
    const res = await request(app).post("/gated").send({});

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("SECRETS_PASSPHRASE_MISSING");
    expect(mockRecordLoginAttempt).not.toHaveBeenCalled();
  });
});
