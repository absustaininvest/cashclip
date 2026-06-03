/**
 * Integration tests for POST /api/admin/paypal-ping.
 *
 * The real cashclip.ts routes are mounted via registerRoutes so that
 * the route path, status-code mapping, and adminMiddleware attachment are
 * exercised exactly as they are in production. pingPayPal() is mocked so
 * no real PayPal credentials or network I/O are required.
 *
 * Cases covered:
 *   - 200 + {ok:true, mode:"live"} when pingPayPal() resolves successfully
 *   - 502 + {ok:false, error:"..."} when pingPayPal() returns a failure result
 *   - 401 when the request arrives without a valid admin token (admin gate enforced)
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";

const ADMIN_ID = "admin-1";

// ── Mutable admin middleware flag ─────────────────────────────────────────────
// Flipped per-test: true → inject admin identity and pass; false → reject 401.
let adminShouldPass = true;

// ── pingPayPal mock ───────────────────────────────────────────────────────────
const mockPingPayPal = vi.fn();

vi.mock("../paypal", () => ({
  pingPayPal:                (...args: unknown[]) => mockPingPayPal(...args),
  sendPayPalPayout:          vi.fn().mockResolvedValue(undefined),
  isPayPalConfigured:        vi.fn().mockReturnValue(false),
  verifyPayPalWebhook:       vi.fn().mockResolvedValue({ verified: false }),
  verifyWebhookRegistration: vi.fn().mockResolvedValue({ ok: false }),
}));

// ── Stub auth so the test controls adminMiddleware behaviour ──────────────────
vi.mock("../auth", () => ({
  registerAuthRoutes: vi.fn(),
  authMiddleware: (_req: Request, _res: Response, next: NextFunction) => next(),
  adminMiddleware: (
    req: Request & { userId?: string; userRole?: string },
    res: Response,
    next: NextFunction,
  ) => {
    if (adminShouldPass) {
      req.userId   = ADMIN_ID;
      req.userRole = "admin";
      next();
    } else {
      res.status(401).json({ error: "Unauthorized" });
    }
  },
}));

vi.mock("../lib/secretsPassphrase", () => ({
  secretsPassphraseMiddleware: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// ── @workspace/db stub — registerRoutes imports db.transaction ────────────────
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    db: { transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn({}) },
  };
});

// ── Storage stub ──────────────────────────────────────────────────────────────
vi.mock("../storage", async () => {
  const { createStorageMock } = await import("../testHelpers/mockStorage");
  return { storage: createStorageMock() };
});

// ── Sibling route registrations — no-ops so registerRoutes stays self-contained
vi.mock("../surveys",   () => ({ registerSurveyRoutes:    vi.fn() }));
vi.mock("../offerwalls", () => ({ registerOfferwallRoutes: vi.fn() }));
vi.mock("./earnings",   () => ({ registerEarningsRoutes:  vi.fn() }));
vi.mock("./ventures",   () => ({ default: express.Router() }));

// ── Email / logger stubs ──────────────────────────────────────────────────────
vi.mock("../lib/email", () => ({
  sendWithdrawalRequestedAdmin: vi.fn(),
  sendWithdrawalStatusUpdate:   vi.fn(),
  sendSupportTicket:            vi.fn(),
  sendPasswordChangedNotice:    vi.fn(),
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── App bootstrap ─────────────────────────────────────────────────────────────

let app: Express;

beforeAll(async () => {
  process.env["DATABASE_URL"]       ??= "postgres://test:test@127.0.0.1:5432/test";
  process.env["JWT_ACCESS_SECRET"]    = "test-jwt-secret-for-paypal-ping-tests-padded-to-64-chars-aabbccdd";

  vi.resetModules();
  const { registerRoutes } = await import("./cashclip");
  app = express();
  app.use(express.json());
  await registerRoutes(app);
});

beforeEach(() => {
  vi.clearAllMocks();
  adminShouldPass = true;
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/admin/paypal-ping", () => {
  it("200 + {ok:true, mode:'live'} when pingPayPal resolves successfully", async () => {
    mockPingPayPal.mockResolvedValue({ ok: true, mode: "live" });

    const res = await request(app).post("/api/admin/paypal-ping").send();

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.mode).toBe("live");
    expect(res.body.error).toBeUndefined();
    expect(mockPingPayPal).toHaveBeenCalledTimes(1);
  });

  it("502 + {ok:false, error:'...'} when pingPayPal returns a failure result", async () => {
    mockPingPayPal.mockResolvedValue({
      ok: false,
      mode: "sandbox",
      error: "401 Unauthorized — check client ID / secret",
    });

    const res = await request(app).post("/api/admin/paypal-ping").send();

    expect(res.status).toBe(502);
    expect(res.body.ok).toBe(false);
    expect(typeof res.body.error).toBe("string");
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(mockPingPayPal).toHaveBeenCalledTimes(1);
  });

  it("401 when the request has no valid admin token (route is admin-gated)", async () => {
    adminShouldPass = false;

    const res = await request(app).post("/api/admin/paypal-ping").send();

    expect(res.status).toBe(401);
    expect(mockPingPayPal).not.toHaveBeenCalled();
  });
});
