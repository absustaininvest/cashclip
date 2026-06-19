/**
 * Integration tests for the simpler credit-only admin tool used by the mobile
 * app: POST /api/admin/credit-balance. Unlike the website's signed
 * /api/admin/credit (covered in cashclip.credit.test.ts), this endpoint only
 * credits (positive amounts) — there is no correction/debit path — but it still
 * moves real money, writes an "adjustment" earnings_ledger row via creditUser,
 * and emails the user a receipt via sendAdminCreditReceipt. A regression here is
 * just as costly, so we cover validation, the ledger write, the receipt side
 * effect, and admin auth enforcement.
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
  // Default target user for the credit handler.
  mockGetUserByUsername.mockResolvedValue({
    id: TARGET_ID, username: "victim", email: "victim@example.com", role: "user",
  });
  mockCreditUser.mockResolvedValue({ balance: 15, totalEarned: 15 });
});

function asAdmin(req: request.Test): request.Test {
  return req.set("Authorization", `Bearer ${adminToken}`);
}

describe("POST /api/admin/credit-balance — app credit-only tool", () => {
  it("credits a positive amount via creditUser and returns the new balance", async () => {
    const res = await asAdmin(
      request(app).post("/api/admin/credit-balance").send({ username: "victim", amount: 10, description: "support refund" }),
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ userId: TARGET_ID, username: "victim", credited: 10, balance: 15 });
    expect(mockCreditUser).toHaveBeenCalledTimes(1);
    expect(mockDebitUser).not.toHaveBeenCalled();
    expect(mockCreditUser).toHaveBeenCalledWith(
      expect.objectContaining({ userId: TARGET_ID, amount: 10, type: "adjustment" }),
    );
  });

  it("writes an adjustment-typed ledger row carrying the description", async () => {
    await asAdmin(
      request(app).post("/api/admin/credit-balance").send({ username: "victim", amount: 7, description: "promo bonus" }),
    );

    expect(mockCreditUser).toHaveBeenCalledWith(
      expect.objectContaining({ userId: TARGET_ID, amount: 7, type: "adjustment", description: "promo bonus" }),
    );
  });

  it("rejects a zero amount", async () => {
    const res = await asAdmin(
      request(app).post("/api/admin/credit-balance").send({ username: "victim", amount: 0 }),
    );
    expect(res.status).toBe(400);
    expect(mockCreditUser).not.toHaveBeenCalled();
  });

  it("rejects a negative amount", async () => {
    const res = await asAdmin(
      request(app).post("/api/admin/credit-balance").send({ username: "victim", amount: -5 }),
    );
    expect(res.status).toBe(400);
    expect(mockCreditUser).not.toHaveBeenCalled();
  });

  it("rejects an amount greater than 1000", async () => {
    const res = await asAdmin(
      request(app).post("/api/admin/credit-balance").send({ username: "victim", amount: 1000.01 }),
    );
    expect(res.status).toBe(400);
    expect(mockCreditUser).not.toHaveBeenCalled();
  });

  it("rejects a missing username", async () => {
    const res = await asAdmin(
      request(app).post("/api/admin/credit-balance").send({ amount: 10 }),
    );
    expect(res.status).toBe(400);
    expect(mockGetUserByUsername).not.toHaveBeenCalled();
    expect(mockCreditUser).not.toHaveBeenCalled();
  });

  it("rejects an empty/whitespace username", async () => {
    const res = await asAdmin(
      request(app).post("/api/admin/credit-balance").send({ username: "   ", amount: 10 }),
    );
    expect(res.status).toBe(400);
    expect(mockGetUserByUsername).not.toHaveBeenCalled();
    expect(mockCreditUser).not.toHaveBeenCalled();
  });

  it("returns 404 when the target user does not exist", async () => {
    mockGetUserByUsername.mockResolvedValue(null);
    const res = await asAdmin(
      request(app).post("/api/admin/credit-balance").send({ username: "ghost", amount: 10 }),
    );
    expect(res.status).toBe(404);
    expect(mockCreditUser).not.toHaveBeenCalled();
  });

  it("sends the receipt to the user with the amount, new balance, and note", async () => {
    await asAdmin(
      request(app).post("/api/admin/credit-balance").send({ username: "victim", amount: 10, description: "support refund" }),
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

describe("admin auth enforcement", () => {
  it("rejects an unauthenticated POST /api/admin/credit-balance with 401", async () => {
    const res = await request(app).post("/api/admin/credit-balance").send({ username: "victim", amount: 10 });
    expect(res.status).toBe(401);
    expect(mockGetUserByUsername).not.toHaveBeenCalled();
    expect(mockCreditUser).not.toHaveBeenCalled();
  });
});

/**
 * Audit-trail parity. The route above hands off to sendAdminCreditReceipt (mocked
 * in the route suite, so those tests only prove the call happens with the right
 * args). These tests exercise the REAL sendAdminCreditReceipt against a mocked SMTP
 * transport to lock in that every app credit also produces the support@ audit copy,
 * exactly like the website's /api/admin/credit tool. Both routes share this single
 * receipt function, so proving the copy here proves it for /api/admin/credit-balance.
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

  it("sends a support@ audit copy alongside the user's receipt", async () => {
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

  it("still sends the support@ audit copy when the user has no email on file", async () => {
    const { sendAdminCreditReceipt } = await loadReal();

    sendAdminCreditReceipt({
      to: "",
      username: "victim",
      amount: 10,
      newBalance: 15,
      note: "support refund",
    });

    await vi.waitFor(() => expect(mockSendMail).toHaveBeenCalledTimes(1));

    const recipients = mockSendMail.mock.calls.map((c) => (c[0] as { to: string }).to);
    expect(recipients).toEqual([SUPPORT_EMAIL]);
  });

  it("attributes the acting admin in the support@ audit copy", async () => {
    const { sendAdminCreditReceipt } = await loadReal();

    sendAdminCreditReceipt({
      to: "victim@example.com",
      username: "victim",
      amount: 10,
      newBalance: 15,
      note: "support refund",
      actor: ADMIN_ID,
    });

    await vi.waitFor(() => expect(mockSendMail).toHaveBeenCalledTimes(2));

    const auditCopy = mockSendMail.mock.calls
      .map((c) => c[0] as { to: string; text: string; html: string })
      .find((m) => m.to === SUPPORT_EMAIL);
    expect(auditCopy).toBeDefined();
    expect(auditCopy!.text).toContain(`Issued by: ${ADMIN_ID}`);
    expect(auditCopy!.html).toContain(ADMIN_ID);
  });

  it("falls back to 'unknown admin' in the audit copy when no actor is given", async () => {
    const { sendAdminCreditReceipt } = await loadReal();

    sendAdminCreditReceipt({
      to: "victim@example.com",
      username: "victim",
      amount: 10,
      newBalance: 15,
      note: "support refund",
    });

    await vi.waitFor(() => expect(mockSendMail).toHaveBeenCalledTimes(2));

    const auditCopy = mockSendMail.mock.calls
      .map((c) => c[0] as { to: string; text: string })
      .find((m) => m.to === SUPPORT_EMAIL);
    expect(auditCopy).toBeDefined();
    expect(auditCopy!.text).toContain("Issued by: unknown admin");
  });
});
