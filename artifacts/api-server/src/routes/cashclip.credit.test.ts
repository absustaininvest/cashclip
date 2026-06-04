/**
 * Integration tests for the manager-override credit/correction tool and its
 * audit log. These routes move real money on user balances, so they need
 * regression coverage around validation, the audit ledger read, the receipt
 * email side effect, and admin auth enforcement.
 *
 * Routes covered (all in cashclip.ts):
 *   - POST /api/admin/credit       → signed credit (+) / correction (-)
 *   - GET  /api/admin/adjustments  → audit ledger read (getAdjustmentLedger)
 *
 * The REAL adminMiddleware from ../auth is used so the auth gate is genuinely
 * exercised: handler-logic tests present a real admin Bearer JWT (signed with
 * the test JWT_ACCESS_SECRET, with storage.getUser returning an admin), while
 * the auth-enforcement test sends no token and expects 401. storage and the
 * mailer are mocked so the suite runs without a database or SMTP.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

const ADMIN_ID = "admin-1";
const TARGET_ID = "user-9";
const JWT_SECRET = "test-jwt-secret-for-credit-tests-padded-to-64-chars-minimum-aabbccdd";

const mockGetUser = vi.fn();
const mockGetUserByUsername = vi.fn();
const mockCreditUser = vi.fn();
const mockDebitUser = vi.fn();
const mockGetAdjustmentLedger = vi.fn();
const mockSendAdminCreditReceipt = vi.fn();
const mockSendMail = vi.fn().mockResolvedValue({});

// Mock the SMTP transport so the REAL sendAdminCreditReceipt (exercised via
// vi.importActual below) can be observed without touching the network.
vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: mockSendMail })) },
}));

vi.mock("../storage", () => ({
  storage: {
    getUser: (...args: unknown[]) => mockGetUser(...args),
    getUserByUsername: (...args: unknown[]) => mockGetUserByUsername(...args),
    creditUser: (...args: unknown[]) => mockCreditUser(...args),
    debitUser: (...args: unknown[]) => mockDebitUser(...args),
    getAdjustmentLedger: (...args: unknown[]) => mockGetAdjustmentLedger(...args),
  },
}));

vi.mock("../lib/dbRateLimit", () => ({
  recordLoginAttempt: vi.fn().mockResolvedValue({ count: 1, allowed: true }),
  checkLoginAttempts: vi.fn().mockResolvedValue({ count: 0, allowed: true }),
  clearLoginAttempts: vi.fn().mockResolvedValue(undefined),
  pruneExpiredLoginAttempts: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/secretsPassphrase", () => ({
  secretsPassphraseMiddleware: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    db: { transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn({}) },
  };
});

// Sibling route registrations are irrelevant here — stub them out.
vi.mock("../surveys", () => ({ registerSurveyRoutes: vi.fn() }));
vi.mock("../offerwalls", () => ({ registerOfferwallRoutes: vi.fn() }));
vi.mock("./earnings", () => ({ registerEarningsRoutes: vi.fn() }));
vi.mock("./ventures", () => ({ default: express.Router() }));

vi.mock("../lib/email", () => ({
  sendWithdrawalRequestedAdmin: vi.fn(),
  sendWithdrawalRequestedUser: vi.fn(),
  sendWithdrawalVelocityAdmin: vi.fn(),
  sendWithdrawalStatusUpdate: vi.fn(),
  sendSupportTicket: vi.fn(),
  sendPasswordChangedNotice: vi.fn(),
  sendAdminCreditReceipt: (...args: unknown[]) => mockSendAdminCreditReceipt(...args),
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

let app: Express;
let adminToken: string;

beforeAll(async () => {
  process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";
  process.env["JWT_ACCESS_SECRET"] = JWT_SECRET;
  // Keep the console-token fallback out of the picture so the Bearer path is
  // the only way in; a tokenless request must then 401.
  delete process.env["ADMIN_TOKEN"];

  adminToken = jwt.sign({ userId: ADMIN_ID, role: "admin", tokenVersion: 0 }, JWT_SECRET, {
    expiresIn: "1h",
  });

  vi.resetModules();
  const { registerRoutes } = await import("./cashclip");
  app = express();
  app.use(express.json());
  await registerRoutes(app);
});

beforeEach(() => {
  vi.clearAllMocks();
  // adminMiddleware resolves the acting admin via storage.getUser.
  mockGetUser.mockResolvedValue({ id: ADMIN_ID, role: "admin", tokenVersion: 0 });
  // Default target user for the credit/correction handler.
  mockGetUserByUsername.mockResolvedValue({
    id: TARGET_ID, username: "victim", email: "victim@example.com", role: "user",
  });
  mockCreditUser.mockResolvedValue({ balance: 15, totalEarned: 15 });
  mockDebitUser.mockResolvedValue({ balance: 5, totalEarned: 15 });
  mockGetAdjustmentLedger.mockResolvedValue([]);
});

function asAdmin(req: request.Test): request.Test {
  return req.set("Authorization", `Bearer ${adminToken}`);
}

describe("POST /api/admin/credit — manager-override credit/correction", () => {
  it("credits a positive amount via creditUser and returns the new balance", async () => {
    const res = await asAdmin(
      request(app).post("/api/admin/credit").send({ username: "victim", amount: 10, note: "support refund" }),
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ userId: TARGET_ID, amount: 10, balance: 15 });
    expect(mockCreditUser).toHaveBeenCalledTimes(1);
    expect(mockDebitUser).not.toHaveBeenCalled();
    expect(mockCreditUser).toHaveBeenCalledWith(
      expect.objectContaining({ userId: TARGET_ID, amount: 10, type: "adjustment" }),
    );
  });

  it("corrects a balance down for a negative amount via debitUser", async () => {
    const res = await asAdmin(
      request(app).post("/api/admin/credit").send({ username: "victim", amount: -4, note: "reverse error" }),
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ userId: TARGET_ID, amount: -4, balance: 5 });
    expect(mockDebitUser).toHaveBeenCalledTimes(1);
    expect(mockCreditUser).not.toHaveBeenCalled();
    expect(mockDebitUser).toHaveBeenCalledWith(
      expect.objectContaining({ userId: TARGET_ID, amount: 4, type: "adjustment" }),
    );
  });

  it("rejects a zero amount", async () => {
    const res = await asAdmin(
      request(app).post("/api/admin/credit").send({ username: "victim", amount: 0 }),
    );
    expect(res.status).toBe(400);
    expect(mockCreditUser).not.toHaveBeenCalled();
    expect(mockDebitUser).not.toHaveBeenCalled();
  });

  it("rejects an amount whose magnitude exceeds 1000", async () => {
    const tooBig = await asAdmin(
      request(app).post("/api/admin/credit").send({ username: "victim", amount: 1000.01 }),
    );
    expect(tooBig.status).toBe(400);

    const tooNegative = await asAdmin(
      request(app).post("/api/admin/credit").send({ username: "victim", amount: -1000.01 }),
    );
    expect(tooNegative.status).toBe(400);

    expect(mockCreditUser).not.toHaveBeenCalled();
    expect(mockDebitUser).not.toHaveBeenCalled();
  });

  it("rejects a missing or empty username", async () => {
    const missing = await asAdmin(
      request(app).post("/api/admin/credit").send({ amount: 10 }),
    );
    expect(missing.status).toBe(400);

    const empty = await asAdmin(
      request(app).post("/api/admin/credit").send({ username: "   ", amount: 10 }),
    );
    expect(empty.status).toBe(400);

    expect(mockGetUserByUsername).not.toHaveBeenCalled();
  });

  it("returns 404 when the target user does not exist", async () => {
    mockGetUserByUsername.mockResolvedValue(null);
    const res = await asAdmin(
      request(app).post("/api/admin/credit").send({ username: "ghost", amount: 10 }),
    );
    expect(res.status).toBe(404);
    expect(mockCreditUser).not.toHaveBeenCalled();
    expect(mockDebitUser).not.toHaveBeenCalled();
  });

  it("returns 400 when a correction would push the balance below zero", async () => {
    mockDebitUser.mockRejectedValue(new Error("INSUFFICIENT_BALANCE"));
    const res = await asAdmin(
      request(app).post("/api/admin/credit").send({ username: "victim", amount: -50 }),
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/below zero/i);
  });

  it("sends the receipt to the user with the signed amount and reason", async () => {
    await asAdmin(
      request(app).post("/api/admin/credit").send({ username: "victim", amount: 10, note: "support refund" }),
    );

    expect(mockSendAdminCreditReceipt).toHaveBeenCalledTimes(1);
    expect(mockSendAdminCreditReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "victim@example.com",
        username: "victim",
        amount: 10,
        newBalance: 15,
        note: "support refund",
      }),
    );
  });
});

describe("GET /api/admin/adjustments — audit ledger", () => {
  it("returns the adjustment ledger from getAdjustmentLedger", async () => {
    const rows = [
      { id: "l1", userId: TARGET_ID, username: "victim", email: "victim@example.com", amount: "10.00", description: "support refund", createdAt: new Date("2026-06-01T00:00:00Z") },
      { id: "l2", userId: TARGET_ID, username: "victim", email: "victim@example.com", amount: "-4.00", description: "reverse error", createdAt: new Date("2026-06-02T00:00:00Z") },
    ];
    mockGetAdjustmentLedger.mockResolvedValue(rows);

    const res = await asAdmin(request(app).get("/api/admin/adjustments"));

    expect(res.status).toBe(200);
    expect(mockGetAdjustmentLedger).toHaveBeenCalledTimes(1);
    expect(res.body.adjustments).toHaveLength(2);
    expect(res.body.adjustments[0]).toMatchObject({ id: "l1", amount: "10.00" });
    expect(res.body.adjustments[1]).toMatchObject({ id: "l2", amount: "-4.00" });
  });

  it("a credit and a correction are both recorded as adjustment rows readable via the ledger", async () => {
    await asAdmin(request(app).post("/api/admin/credit").send({ username: "victim", amount: 10 }));
    await asAdmin(request(app).post("/api/admin/credit").send({ username: "victim", amount: -4 }));

    // Both mutations went through the adjustment-typed ledger writers.
    expect(mockCreditUser).toHaveBeenCalledWith(expect.objectContaining({ type: "adjustment" }));
    expect(mockDebitUser).toHaveBeenCalledWith(expect.objectContaining({ type: "adjustment" }));

    // And the audit read surfaces adjustment rows.
    mockGetAdjustmentLedger.mockResolvedValue([
      { id: "l1", userId: TARGET_ID, username: "victim", email: null, amount: "10.00", description: "x", createdAt: new Date() },
      { id: "l2", userId: TARGET_ID, username: "victim", email: null, amount: "-4.00", description: "y", createdAt: new Date() },
    ]);
    const res = await asAdmin(request(app).get("/api/admin/adjustments"));
    expect(res.status).toBe(200);
    expect(res.body.adjustments.map((a: { amount: string }) => a.amount)).toEqual(["10.00", "-4.00"]);
  });
});

describe("admin auth enforcement", () => {
  it("rejects an unauthenticated POST /api/admin/credit with 401", async () => {
    const res = await request(app).post("/api/admin/credit").send({ username: "victim", amount: 10 });
    expect(res.status).toBe(401);
    expect(mockGetUserByUsername).not.toHaveBeenCalled();
    expect(mockCreditUser).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated GET /api/admin/adjustments with 401", async () => {
    const res = await request(app).get("/api/admin/adjustments");
    expect(res.status).toBe(401);
    expect(mockGetAdjustmentLedger).not.toHaveBeenCalled();
  });
});

/**
 * Audit-trail parity. The route suite above mocks sendAdminCreditReceipt, so it
 * only proves the call happens with the right args. These tests exercise the REAL
 * sendAdminCreditReceipt against a mocked SMTP transport to lock in that the
 * website's signed /api/admin/credit tool always produces the support@ audit copy
 * — for BOTH the credit (positive) and correction (negative) paths, which is the
 * extra path this tool has over the app's credit-only /api/admin/credit-balance.
 * Both routes share this single receipt function, so this mirrors the matching
 * coverage in cashclip.credit-balance.test.ts.
 */
describe("admin credit audit-trail copy (real sendAdminCreditReceipt)", () => {
  const SUPPORT_EMAIL = "support@absustaininvest.com";
  let prevSmtpPassword: string | undefined;

  beforeAll(() => {
    prevSmtpPassword = process.env["ZOHO_SMTP_PASSWORD"];
    // createTransport() returns null (no-op) without a password; set one so the
    // mocked transport is used.
    process.env["ZOHO_SMTP_PASSWORD"] = "test-smtp-password";
  });

  afterAll(() => {
    if (prevSmtpPassword === undefined) delete process.env["ZOHO_SMTP_PASSWORD"];
    else process.env["ZOHO_SMTP_PASSWORD"] = prevSmtpPassword;
  });

  beforeEach(() => {
    mockSendMail.mockClear();
  });

  async function loadReal() {
    return vi.importActual<typeof import("../lib/email")>("../lib/email");
  }

  it("sends a support@ audit copy alongside the user's receipt for a credit", async () => {
    const { sendAdminCreditReceipt } = await loadReal();

    sendAdminCreditReceipt({
      to: "victim@example.com",
      username: "victim",
      amount: 10,
      newBalance: 15,
      note: "support refund",
    });

    await vi.waitFor(() => expect(mockSendMail).toHaveBeenCalledTimes(2));

    const recipients = mockSendMail.mock.calls.map((c) => (c[0] as { to: string }).to);
    expect(recipients).toContain("victim@example.com");
    expect(recipients).toContain(SUPPORT_EMAIL);
  });

  it("sends a support@ audit copy alongside the user's receipt for a correction (negative amount)", async () => {
    const { sendAdminCreditReceipt } = await loadReal();

    sendAdminCreditReceipt({
      to: "victim@example.com",
      username: "victim",
      amount: -4,
      newBalance: 5,
      note: "reverse error",
    });

    await vi.waitFor(() => expect(mockSendMail).toHaveBeenCalledTimes(2));

    const recipients = mockSendMail.mock.calls.map((c) => (c[0] as { to: string }).to);
    expect(recipients).toContain("victim@example.com");
    expect(recipients).toContain(SUPPORT_EMAIL);

    // The audit copy clearly labels the correction so support@ can tell it apart
    // from a credit in their inbox.
    const auditCall = mockSendMail.mock.calls.find(
      (c) => (c[0] as { to: string }).to === SUPPORT_EMAIL,
    );
    expect((auditCall?.[0] as { subject: string }).subject).toMatch(/correction/i);
  });

  it("still sends the support@ audit copy for a correction when the user has no email on file", async () => {
    const { sendAdminCreditReceipt } = await loadReal();

    sendAdminCreditReceipt({
      to: "",
      username: "victim",
      amount: -4,
      newBalance: 5,
      note: "reverse error",
    });

    await vi.waitFor(() => expect(mockSendMail).toHaveBeenCalledTimes(1));

    const recipients = mockSendMail.mock.calls.map((c) => (c[0] as { to: string }).to);
    expect(recipients).toEqual([SUPPORT_EMAIL]);
  });
});
