/**
 * Tests for POST /api/paypal/webhook — inbound payout-status callbacks from PayPal.
 *
 * Covers:
 *   1. Valid signature + PAYMENT.PAYOUTS-ITEM.SUCCEEDED  → withdrawal marked paid
 *   2. Valid signature + failure events                  → withdrawal marked rejected, balance refunded
 *   3. Valid signature + unrecognised event type         → 200 no-op (ignored)
 *   4. Invalid (rejected) signature                     → 401, no storage side-effects
 *   5. Missing PayPal signature headers                  → 401, no storage side-effects
 *   6. Missing rawBody                                   → 400
 *   7. Missing event_type in body                        → 400
 *   8. No withdrawal ID derivable from body              → 200 ignored
 *   9. Withdrawal ID present but not found in DB         → 200 ignored
 *  10. Batch-level sender_batch_id (cashclip_ prefix)    → ID extracted and withdrawal marked paid
 *  11. Rate-limit exceeded                               → 429
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

const TEST_JWT_SECRET = "test-jwt-secret-for-paypal-payout-webhook-padded-64c";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockVerifyPayPalWebhook,
  mockLogWebhookVerificationFailure,
  mockGetWithdrawalById,
  mockUpdateWithdrawalStatusIfStatus,
  mockCreditUser,
  mockSendWithdrawalStatusUpdate,
  mockRecordLoginAttempt,
  mockGetClientIp,
} = vi.hoisted(() => ({
  mockVerifyPayPalWebhook:            vi.fn(),
  mockLogWebhookVerificationFailure:  vi.fn(),
  mockGetWithdrawalById:              vi.fn(),
  mockUpdateWithdrawalStatusIfStatus: vi.fn(),
  mockCreditUser:                     vi.fn(),
  mockSendWithdrawalStatusUpdate:     vi.fn(),
  mockRecordLoginAttempt:             vi.fn(),
  mockGetClientIp:                    vi.fn().mockReturnValue("1.2.3.4"),
}));

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@workspace/db", async () => {
  const actual = await vi.importActual<typeof import("@workspace/db")>("@workspace/db");
  const db = {
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }) }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    execute: vi.fn().mockResolvedValue({ rows: [] }),
    transaction: vi.fn().mockImplementation(async (cb: (tx: any) => unknown) => cb({})),
  };
  return { ...actual, db };
});

vi.mock("../storage", () => ({
  storage: {
    getUser:                                     vi.fn().mockResolvedValue(undefined),
    getUserByUsername:                           vi.fn().mockResolvedValue(undefined),
    getUserByEmail:                              vi.fn().mockResolvedValue(undefined),
    getAllUsers:                                 vi.fn().mockResolvedValue({ users: [], total: 0 }),
    createUser:                                  vi.fn().mockResolvedValue(undefined),
    updateUserPassword:                          vi.fn().mockResolvedValue({ tokenVersion: 1 }),
    incrementTokenVersion:                       vi.fn().mockResolvedValue({ tokenVersion: 1 }),
    setTotpBackupCodes:                          vi.fn().mockResolvedValue(undefined),
    recordSecurityAudit:                         vi.fn().mockResolvedValue(undefined),
    getSecurityAuditEntries:                     vi.fn().mockResolvedValue({ entries: [], total: 0 }),
    getTotpBackupCodesRemaining:                 vi.fn().mockResolvedValue(0),
    consumeTotpBackupCode:                       vi.fn().mockResolvedValue(false),
    factoryResetUser:                            vi.fn().mockResolvedValue({ tokenVersion: 1 }),
    deleteUser:                                  vi.fn().mockResolvedValue(undefined),
    getUserProfile:                              vi.fn().mockResolvedValue(undefined),
    updateUserProfile:                           vi.fn().mockResolvedValue(undefined),
    getUserBalance:                              vi.fn().mockResolvedValue({ balance: 0, totalEarned: 0 }),
    creditUser:                                  (...args: unknown[]) => mockCreditUser(...args),
    debitUser:                                   vi.fn().mockResolvedValue({ balance: 0, totalEarned: 0 }),
    getUserLedger:                               vi.fn().mockResolvedValue([]),
    createWithdrawal:                            vi.fn().mockResolvedValue(undefined),
    createWithdrawalAtomic:                      vi.fn().mockResolvedValue(undefined),
    getWithdrawals:                              vi.fn().mockResolvedValue([]),
    getWithdrawalById:                           (...args: unknown[]) => mockGetWithdrawalById(...args),
    getUserWithdrawals:                          vi.fn().mockResolvedValue([]),
    updateWithdrawalStatus:                      vi.fn().mockResolvedValue(undefined),
    updateWithdrawalStatusIfStatus:              (...args: unknown[]) => mockUpdateWithdrawalStatusIfStatus(...args),
    createRewardSession:                         vi.fn().mockResolvedValue(undefined),
    getRewardSession:                            vi.fn().mockResolvedValue(undefined),
    findCompletedRewardSession:                  vi.fn().mockResolvedValue(undefined),
    findPendingRewardSession:                    vi.fn().mockResolvedValue(undefined),
    completeRewardSessionAtomic:                 vi.fn().mockResolvedValue(undefined),
    findCompletedSessionByProviderTransactionId: vi.fn().mockResolvedValue(undefined),
    completeRewardSessionAndCredit:              vi.fn().mockResolvedValue(undefined),
    insertWebhookAudit:                          vi.fn().mockResolvedValue(undefined),
    countWebhookAuditByIp:                       vi.fn().mockResolvedValue(0),
    getWebhookAudits:                            vi.fn().mockResolvedValue([]),
    getWebhookAuditOffenders:                    vi.fn().mockResolvedValue([]),
    getWebhookAuditProviders:                    vi.fn().mockResolvedValue([]),
    pruneWebhookAudit:                           vi.fn().mockResolvedValue(0),
    pruneSecurityAudit:                          vi.fn().mockResolvedValue(0),
  },
}));

vi.mock("../paypal", () => ({
  sendPayPalPayout:                    vi.fn(),
  isPayPalConfigured:                  () => false,
  initPayPal:                          vi.fn(),
  pingPayPal:                          vi.fn().mockResolvedValue({ ok: false }),
  verifyPayPalWebhook:                 (...args: unknown[]) => mockVerifyPayPalWebhook(...args),
  getCachedWebhookRegistrationResult:  vi.fn().mockReturnValue(null),
  verifyWebhookRegistration:           vi.fn().mockResolvedValue({ ok: false }),
}));

vi.mock("../lib/webhookAuth", () => ({
  verifyWebhook:                       vi.fn().mockReturnValue({ ok: true }),
  logWebhookVerificationFailure:       (...args: unknown[]) => mockLogWebhookVerificationFailure(...args),
}));

vi.mock("../lib/dbRateLimit", () => ({
  recordLoginAttempt:        (...args: unknown[]) => mockRecordLoginAttempt(...args),
  checkLoginAttempts:        vi.fn().mockResolvedValue({ allowed: true, current: 1 }),
  clearLoginAttempts:        vi.fn().mockResolvedValue(undefined),
  pruneExpiredLoginAttempts: vi.fn().mockResolvedValue(undefined),
  decrementLoginAttempt:     vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/clientIp", () => ({
  getClientIp: (...args: unknown[]) => mockGetClientIp(...args),
}));

vi.mock("../lib/email", () => ({
  sendWithdrawalRequestedAdmin: vi.fn(),
  sendWithdrawalStatusUpdate:   (...args: unknown[]) => mockSendWithdrawalStatusUpdate(...args),
  sendSupportTicket:            vi.fn(),
  sendPasswordChangedNotice:    vi.fn(),
  sendOtpEmail:                 vi.fn(),
  sendVerificationEmail:        vi.fn(),
}));

vi.mock("../auth", () => ({
  RESERVED_ADMIN_USERNAMES: new Set<string>(),
  registerAuthRoutes: () => {},
  authMiddleware: (_req: any, _res: any, next: any) => next(),
  adminMiddleware: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../lib/sponsoredVisitMonitor", () => ({
  getSponsoredVisitMonitor: vi.fn().mockReturnValue({
    getStatus: vi.fn().mockReturnValue({ alertActive: false }),
    clearDebounce: vi.fn(),
  }),
}));

vi.mock("../lib/surveyProviders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/surveyProviders")>();
  return {
    ...actual,
    fetchExternalSurveys: vi.fn().mockResolvedValue([]),
    verifyProviderCompletion: vi.fn().mockResolvedValue({ verified: false, reward: 0 }),
    getProviderStatus: vi.fn().mockReturnValue([]),
    buildCpxWallUrl: vi.fn().mockReturnValue("https://cpx.example.com"),
  };
});

vi.mock("../lib/offerwallProviders", () => ({
  fetchAllOffers: vi.fn().mockResolvedValue([]),
  verifyOfferCompletion: vi.fn().mockResolvedValue({ verified: false }),
  getOfferwallProviderStatus: vi.fn().mockReturnValue([]),
}));

vi.mock("../issuedOffers", () => ({
  recordIssuedOffers: vi.fn(),
  getIssuedOffer: vi.fn().mockReturnValue(undefined),
  generateSessionToken: vi.fn().mockReturnValue("mock-token"),
}));

vi.mock("../lib/demographicUrl", () => ({
  buildDemographicEntryUrl: vi.fn().mockImplementation((url: string) => url),
}));

vi.mock("../lib/webhookRateLimit", () => ({
  webhookRateLimiter: (_req: any, _res: any, next: any) => next(),
}));

// ── Test fixtures ─────────────────────────────────────────────────────────────

function makeWithdrawal(overrides: Partial<{
  id: string;
  userId: string;
  username: string;
  paypalEmail: string;
  amount: string;
  totalPayout: string;
  status: string;
}> = {}) {
  return {
    id:          overrides.id          ?? "wd-test-001",
    userId:      overrides.userId      ?? "user-abc",
    username:    overrides.username    ?? "testuser",
    paypalEmail: overrides.paypalEmail ?? "user@example.com",
    amount:      overrides.amount      ?? "5.00",
    totalPayout: overrides.totalPayout ?? "5.00",
    status:      overrides.status      ?? "paying",
  };
}

/** Build a minimal valid-looking PayPal webhook POST body. */
function makeWebhookBody(overrides: {
  event_type?: string;
  sender_item_id?: string;
  sender_batch_id?: string;
} = {}) {
  const resource: Record<string, unknown> = {};
  if (overrides.sender_item_id !== undefined) {
    resource.payout_item = { sender_item_id: overrides.sender_item_id };
  }
  if (overrides.sender_batch_id !== undefined) {
    resource.sender_batch_id = overrides.sender_batch_id;
  }
  return {
    event_type: overrides.event_type ?? "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
    resource,
  };
}

/** Standard PayPal webhook headers (content irrelevant when mocked). */
const VALID_PAYPAL_HEADERS = {
  "paypal-transmission-id":   "tx-id-1",
  "paypal-transmission-time": "2026-06-03T00:00:00Z",
  "paypal-cert-url":          "https://api-m.sandbox.paypal.com/v1/notifications/certs/test",
  "paypal-auth-algo":         "SHA256withRSA",
  "paypal-transmission-sig":  "test-sig",
  "content-type":             "application/json",
};

// ── App setup ─────────────────────────────────────────────────────────────────

let app: Express;

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = TEST_JWT_SECRET;
  process.env.JWT_SECRET        = TEST_JWT_SECRET;
  process.env.DATABASE_URL    ??= "postgres://test:test@127.0.0.1:5432/test";

  const { registerRoutes } = await import("../routes/cashclip");
  app = express();

  // Attach rawBody using the same verify hook as production (app.ts).
  // The verify callback runs synchronously before JSON parsing and receives
  // the raw Buffer, so it never conflicts with the body parser stream.
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as unknown as Record<string, unknown>).rawBody = buf;
      },
    }),
  );

  app.use((req: any, _res: any, next: any) => {
    req.log = {
      info:  () => {},
      warn:  () => {},
      error: () => {},
      debug: () => {},
      trace: () => {},
      fatal: () => {},
      child: () => req.log,
    };
    next();
  });

  registerRoutes(app);
});

beforeEach(() => {
  vi.clearAllMocks();
  // Default: rate limit allows all requests
  mockRecordLoginAttempt.mockResolvedValue({ allowed: true, current: 1 });
  // Default: signature verification passes
  mockVerifyPayPalWebhook.mockResolvedValue({ ok: true });
  // Default: storage returns sensible values
  mockGetWithdrawalById.mockResolvedValue(undefined);
  mockUpdateWithdrawalStatusIfStatus.mockResolvedValue(undefined);
  mockCreditUser.mockResolvedValue({ balance: 500, totalEarned: 1000 });
  mockSendWithdrawalStatusUpdate.mockResolvedValue(undefined);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/paypal/webhook — happy path (success events)", () => {

  it("marks the withdrawal as paid when signature is valid and event is PAYMENT.PAYOUTS-ITEM.SUCCEEDED", async () => {
    const withdrawal = makeWithdrawal({ id: "wd-001", status: "paying" });
    mockGetWithdrawalById.mockResolvedValue(withdrawal);
    mockUpdateWithdrawalStatusIfStatus.mockResolvedValue(withdrawal);

    const body = makeWebhookBody({ event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", sender_item_id: "wd-001" });

    const res = await request(app)
      .post("/api/paypal/webhook")
      .set(VALID_PAYPAL_HEADERS)
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
    expect(mockGetWithdrawalById).toHaveBeenCalledWith("wd-001");
    expect(mockUpdateWithdrawalStatusIfStatus).toHaveBeenCalledWith(
      "wd-001",
      ["paying"],
      "paid",
      expect.stringContaining("PAYMENT.PAYOUTS-ITEM.SUCCEEDED"),
    );
  });

  it("triggers a withdrawal status email after marking paid", async () => {
    const withdrawal = makeWithdrawal({ id: "wd-002", paypalEmail: "pay@example.com", username: "alice", amount: "10.00", totalPayout: "10.00" });
    mockGetWithdrawalById.mockResolvedValue(withdrawal);
    mockUpdateWithdrawalStatusIfStatus.mockResolvedValue(withdrawal);

    const body = makeWebhookBody({ event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", sender_item_id: "wd-002" });

    await request(app)
      .post("/api/paypal/webhook")
      .set(VALID_PAYPAL_HEADERS)
      .send(body);

    // sendWithdrawalStatusUpdate is fire-and-forget (.catch) so just confirm it was invoked
    expect(mockSendWithdrawalStatusUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "paid", toEmail: "pay@example.com" }),
    );
  });

  it("derives the withdrawal ID from sender_batch_id with cashclip_ prefix", async () => {
    const withdrawal = makeWithdrawal({ id: "wd-batch-001", status: "paying" });
    mockGetWithdrawalById.mockResolvedValue(withdrawal);
    mockUpdateWithdrawalStatusIfStatus.mockResolvedValue(withdrawal);

    const body = makeWebhookBody({
      event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
      sender_batch_id: "cashclip_wd-batch-001",
    });

    const res = await request(app)
      .post("/api/paypal/webhook")
      .set(VALID_PAYPAL_HEADERS)
      .send(body);

    expect(res.status).toBe(200);
    expect(mockGetWithdrawalById).toHaveBeenCalledWith("wd-batch-001");
    expect(mockUpdateWithdrawalStatusIfStatus).toHaveBeenCalledWith(
      "wd-batch-001",
      ["paying"],
      "paid",
      expect.any(String),
    );
  });

  it("marks the withdrawal as paid for the batch-level PAYMENT.PAYOUTSBATCH.SUCCESS event", async () => {
    const withdrawal = makeWithdrawal({ id: "wd-batch-success", status: "paying" });
    mockGetWithdrawalById.mockResolvedValue(withdrawal);
    mockUpdateWithdrawalStatusIfStatus.mockResolvedValue(withdrawal);

    const body = makeWebhookBody({
      event_type: "PAYMENT.PAYOUTSBATCH.SUCCESS",
      sender_item_id: "wd-batch-success",
    });

    const res = await request(app)
      .post("/api/paypal/webhook")
      .set(VALID_PAYPAL_HEADERS)
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
    expect(mockGetWithdrawalById).toHaveBeenCalledWith("wd-batch-success");
    expect(mockUpdateWithdrawalStatusIfStatus).toHaveBeenCalledWith(
      "wd-batch-success",
      ["paying"],
      "paid",
      expect.stringContaining("PAYMENT.PAYOUTSBATCH.SUCCESS"),
    );
  });
});

describe("POST /api/paypal/webhook — failure events (rejected + refund)", () => {
  const FAILURE_EVENTS = [
    "PAYMENT.PAYOUTS-ITEM.FAILED",
    "PAYMENT.PAYOUTS-ITEM.DENIED",
    "PAYMENT.PAYOUTS-ITEM.BLOCKED",
    "PAYMENT.PAYOUTS-ITEM.RETURNED",
    "PAYMENT.PAYOUTS-ITEM.UNCLAIMED",
  ] as const;

  for (const eventType of FAILURE_EVENTS) {
    it(`marks withdrawal as rejected and refunds balance for ${eventType}`, async () => {
      const withdrawal = makeWithdrawal({ id: "wd-fail-01", userId: "user-xyz", amount: "7.50", status: "paying" });
      mockGetWithdrawalById.mockResolvedValue(withdrawal);
      // updateWithdrawalStatusIfStatus returns the claimed withdrawal (meaning it succeeded)
      mockUpdateWithdrawalStatusIfStatus.mockResolvedValue(withdrawal);

      const body = makeWebhookBody({ event_type: eventType, sender_item_id: "wd-fail-01" });

      const res = await request(app)
        .post("/api/paypal/webhook")
        .set(VALID_PAYPAL_HEADERS)
        .send(body);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: "ok" });
      expect(mockUpdateWithdrawalStatusIfStatus).toHaveBeenCalledWith(
        "wd-fail-01",
        ["paying"],
        "rejected",
        expect.stringContaining(eventType),
      );
      // Balance must be refunded
      expect(mockCreditUser).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-xyz",
          amount: 7.50,
          type: "withdrawal_refund",
        }),
      );
    });
  }

  it("does NOT credit the user when updateWithdrawalStatusIfStatus returns undefined (already processed)", async () => {
    const withdrawal = makeWithdrawal({ id: "wd-already", status: "paid" });
    mockGetWithdrawalById.mockResolvedValue(withdrawal);
    // Returns undefined → withdrawal was not in "paying" state, so no transition happened
    mockUpdateWithdrawalStatusIfStatus.mockResolvedValue(undefined);

    const body = makeWebhookBody({ event_type: "PAYMENT.PAYOUTS-ITEM.FAILED", sender_item_id: "wd-already" });

    const res = await request(app)
      .post("/api/paypal/webhook")
      .set(VALID_PAYPAL_HEADERS)
      .send(body);

    expect(res.status).toBe(200);
    expect(mockCreditUser).not.toHaveBeenCalled();
  });

  it("fires a rejection status email for a claimed failure", async () => {
    const withdrawal = makeWithdrawal({ id: "wd-fail-email", paypalEmail: "fail@example.com", username: "bob" });
    mockGetWithdrawalById.mockResolvedValue(withdrawal);
    mockUpdateWithdrawalStatusIfStatus.mockResolvedValue(withdrawal);

    const body = makeWebhookBody({ event_type: "PAYMENT.PAYOUTS-ITEM.FAILED", sender_item_id: "wd-fail-email" });

    await request(app)
      .post("/api/paypal/webhook")
      .set(VALID_PAYPAL_HEADERS)
      .send(body);

    expect(mockSendWithdrawalStatusUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "rejected", toEmail: "fail@example.com" }),
    );
  });
});

describe("POST /api/paypal/webhook — unrecognised event types (no-op)", () => {

  it("returns 200 ignored for a completely unrecognised event type without touching storage", async () => {
    const withdrawal = makeWithdrawal({ id: "wd-noop" });
    mockGetWithdrawalById.mockResolvedValue(withdrawal);

    // PAYMENT.PAYOUTSBATCH.PROCESSING is not in SUCCESS_EVENTS or FAILURE_EVENTS
    const body = makeWebhookBody({ event_type: "PAYMENT.PAYOUTSBATCH.PROCESSING", sender_item_id: "wd-noop" });

    const res = await request(app)
      .post("/api/paypal/webhook")
      .set(VALID_PAYPAL_HEADERS)
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ignored");
    expect(mockUpdateWithdrawalStatusIfStatus).not.toHaveBeenCalled();
    expect(mockCreditUser).not.toHaveBeenCalled();
  });

  it("returns 200 ignored for PAYMENT.PAYOUTSBATCH.DENIED without touching storage", async () => {
    const withdrawal = makeWithdrawal({ id: "wd-batch-denied" });
    mockGetWithdrawalById.mockResolvedValue(withdrawal);

    // PAYMENT.PAYOUTSBATCH.DENIED is not in SUCCESS_EVENTS or FAILURE_EVENTS
    const body = makeWebhookBody({ event_type: "PAYMENT.PAYOUTSBATCH.DENIED", sender_item_id: "wd-batch-denied" });

    const res = await request(app)
      .post("/api/paypal/webhook")
      .set(VALID_PAYPAL_HEADERS)
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ignored");
    expect(mockUpdateWithdrawalStatusIfStatus).not.toHaveBeenCalled();
  });
});

describe("POST /api/paypal/webhook — signature verification failures", () => {

  it("returns 400 and does not credit when verifyPayPalWebhook returns ok: false", async () => {
    mockVerifyPayPalWebhook.mockResolvedValue({ ok: false, reason: "FAILURE" });

    const body = makeWebhookBody({ event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", sender_item_id: "wd-sig-fail" });

    const res = await request(app)
      .post("/api/paypal/webhook")
      .set(VALID_PAYPAL_HEADERS)
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(mockGetWithdrawalById).not.toHaveBeenCalled();
    expect(mockUpdateWithdrawalStatusIfStatus).not.toHaveBeenCalled();
    expect(mockCreditUser).not.toHaveBeenCalled();
  });

  it("logs the verification failure reason when signature check fails", async () => {
    mockVerifyPayPalWebhook.mockResolvedValue({ ok: false, reason: "bad-sig" });

    const body = makeWebhookBody({ sender_item_id: "wd-log-fail" });

    await request(app)
      .post("/api/paypal/webhook")
      .set(VALID_PAYPAL_HEADERS)
      .send(body);

    expect(mockLogWebhookVerificationFailure).toHaveBeenCalledWith(
      expect.anything(),
      "paypal",
      "bad-sig",
    );
  });

  it("returns 400 when PayPal transmission headers are absent (no-headers case)", async () => {
    // verifyPayPalWebhook still controls the gate — with missing headers it
    // returns ok: false (the real implementation does, and our mock honors it)
    mockVerifyPayPalWebhook.mockResolvedValue({ ok: false, reason: "Missing required PayPal webhook headers" });

    const body = makeWebhookBody({ sender_item_id: "wd-no-headers" });

    const res = await request(app)
      .post("/api/paypal/webhook")
      .set("content-type", "application/json")
      .send(body);

    expect(res.status).toBe(400);
    expect(mockUpdateWithdrawalStatusIfStatus).not.toHaveBeenCalled();
  });
});

describe("POST /api/paypal/webhook — malformed or incomplete requests", () => {

  it("returns 400 when rawBody is missing (not attached by middleware)", async () => {
    // Build a minimal app using plain express.json() (no verify hook) so that
    // rawBody is never attached to the request, simulating a mis-configured
    // deployment where the verify middleware was omitted.
    const { registerRoutes } = await import("../routes/cashclip");
    const bareApp = express();
    // Intentionally plain — no verify hook, so rawBody stays undefined.
    bareApp.use(express.json());
    bareApp.use((req: any, _res: any, next: any) => {
      req.log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {}, fatal: () => {}, child: function() { return this; } };
      next();
    });
    registerRoutes(bareApp);

    const res = await request(bareApp)
      .post("/api/paypal/webhook")
      .set(VALID_PAYPAL_HEADERS)
      .send({ event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", resource: { payout_item: { sender_item_id: "wd-no-raw" } } });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when event_type is missing from the body", async () => {
    const body = { resource: { payout_item: { sender_item_id: "wd-no-event" } } };

    const res = await request(app)
      .post("/api/paypal/webhook")
      .set(VALID_PAYPAL_HEADERS)
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });
});

describe("POST /api/paypal/webhook — withdrawal lookup misses (no-ops)", () => {

  it("returns 200 ignored when no withdrawal ID can be derived from the event body", async () => {
    // No sender_item_id, no sender_batch_id → cannot derive withdrawal ID
    const body = {
      event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
      resource: {},
    };

    const res = await request(app)
      .post("/api/paypal/webhook")
      .set(VALID_PAYPAL_HEADERS)
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ignored");
    expect(res.body.reason).toMatch(/no withdrawal id/i);
    expect(mockGetWithdrawalById).not.toHaveBeenCalled();
  });

  it("returns 200 ignored when sender_batch_id lacks the cashclip_ prefix", async () => {
    const body = {
      event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
      resource: { sender_batch_id: "other-provider-batch-xyz" },
    };

    const res = await request(app)
      .post("/api/paypal/webhook")
      .set(VALID_PAYPAL_HEADERS)
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ignored");
    expect(mockGetWithdrawalById).not.toHaveBeenCalled();
  });

  it("returns 200 ignored when the withdrawal ID is not found in the database", async () => {
    mockGetWithdrawalById.mockResolvedValue(undefined);

    const body = makeWebhookBody({ event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", sender_item_id: "wd-missing" });

    const res = await request(app)
      .post("/api/paypal/webhook")
      .set(VALID_PAYPAL_HEADERS)
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ignored");
    expect(res.body.reason).toMatch(/withdrawal not found/i);
    expect(mockUpdateWithdrawalStatusIfStatus).not.toHaveBeenCalled();
  });
});

describe("POST /api/paypal/webhook — rate limiting", () => {

  it("returns 429 when the IP rate limit is exceeded", async () => {
    mockRecordLoginAttempt.mockResolvedValue({ allowed: false, current: 31 });

    const body = makeWebhookBody({ sender_item_id: "wd-ratelimit" });

    const res = await request(app)
      .post("/api/paypal/webhook")
      .set(VALID_PAYPAL_HEADERS)
      .send(body);

    expect(res.status).toBe(429);
    expect(mockVerifyPayPalWebhook).not.toHaveBeenCalled();
    expect(mockUpdateWithdrawalStatusIfStatus).not.toHaveBeenCalled();
  });
});
