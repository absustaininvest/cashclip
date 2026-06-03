import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted module mocks — vi.mock() is hoisted before any import, so factories
// run before surveys.ts or storage.ts are evaluated. vi.hoisted() makes the
// fn references available in the factory closures.
// ---------------------------------------------------------------------------
const storageMocks = vi.hoisted(() => ({
  getRewardSession: vi.fn(),
  findCompletedSessionByProviderTransactionId: vi.fn().mockResolvedValue(null),
  completeRewardSessionAndCredit: vi.fn().mockResolvedValue(undefined),
  findCompletedRewardSession: vi.fn().mockResolvedValue(null),
  createRewardSession: vi.fn().mockResolvedValue(undefined),
  findPendingRewardSession: vi.fn().mockResolvedValue(null),
  getUser: vi.fn().mockResolvedValue(undefined),
  getUserProfile: vi.fn().mockResolvedValue(null),
  updateUserBalance: vi.fn().mockResolvedValue(undefined),
  createEarningsLedgerEntry: vi.fn().mockResolvedValue(undefined),
  createWithdrawal: vi.fn().mockResolvedValue(undefined),
  getWithdrawals: vi.fn().mockResolvedValue(undefined),
  getBalance: vi.fn().mockResolvedValue(undefined),
  getTransactions: vi.fn().mockResolvedValue(undefined),
  insertWebhookAudit: vi.fn().mockResolvedValue(undefined),
  countWebhookAuditByIp: vi.fn().mockResolvedValue(0),
}));

const providerMocks = vi.hoisted(() => ({
  verifyProviderCompletion: vi.fn(),
  fetchExternalSurveys: vi.fn().mockResolvedValue([]),
  getProviderStatus: vi.fn().mockReturnValue([]),
  buildCpxWallUrl: vi.fn().mockReturnValue("https://offers.cpx-research.com/"),
  PROVIDER_REWARD_RANGES: {
    pollfish:    { min: 0.30, max: 1.50 },
    cint:        { min: 1.00, max: 5.00 },
    lucid:       { min: 0.80, max: 4.00 },
    cpx:         { min: 0.20, max: 3.00 },
    bitlabs:     { min: 0.20, max: 2.50 },
    internal:    { min: 0.15, max: 0.75 },
    tapjoy:      { min: 0.10, max: 25.00 },
    adgate:      { min: 0.10, max: 20.00 },
    offertoro:   { min: 0.10, max: 20.00 },
    lootably:    { min: 0.10, max: 20.00 },
    adjoe:       { min: 0.10, max: 25.00 },
    adgem:       { min: 0.10, max: 20.00 },
    ayet:        { min: 0.10, max: 20.00 },
    notik:       { min: 0.05, max: 10.00 },
    revlum:      { min: 0.05, max: 15.00 },
    monlix:      { min: 0.05, max: 15.00 },
    paymentwall: { min: 0.10, max: 20.00 },
  } as Record<string, { min: number; max: number }>,
  parseProviderReward: vi.fn(),
}));

vi.mock("./storage", () => ({ storage: storageMocks }));

vi.mock("./lib/surveyProviders", () => providerMocks);

vi.mock("./paypal", () => ({
  sendPayPalPayout: vi.fn(),
  isPayPalConfigured: () => false,
  initPayPal: vi.fn(),
}));

vi.mock("./issuedOffers", () => ({
  recordIssuedOffers: vi.fn().mockResolvedValue(undefined),
  getIssuedOffer: vi.fn().mockResolvedValue(null),
  generateSessionToken: vi.fn().mockReturnValue("mock-session-token"),
}));

vi.mock("./lib/webhookAuth", () => ({
  verifyWebhook: vi.fn().mockReturnValue({ ok: true }),
  logWebhookVerificationFailure: vi.fn(),
}));

vi.mock("./lib/webhookRateLimit", () => ({
  webhookRateLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("./lib/demographicUrl", () => ({
  buildDemographicEntryUrl: vi.fn().mockResolvedValue("https://survey.example.com"),
}));

vi.mock("./lib/clientIp", () => ({
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));

vi.mock("./auth", () => ({
  RESERVED_ADMIN_USERNAMES: new Set<string>(),
  registerAuthRoutes: () => {},
  authMiddleware: (req: any, _res: any, next: any) => {
    req.userId = "test-user-id";
    next();
  },
  adminMiddleware: (req: any, _res: any, next: any) => {
    req.userId = "test-admin-id";
    req.userRole = "admin";
    next();
  },
}));

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

let app: Express;

beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
  process.env.JWT_ACCESS_SECRET ??= "test-jwt-secret-padded-to-meet-minimum-64-character-length-requirement";

  const { registerSurveyRoutes } = await import("./surveys");
  app = express();
  app.use(express.json());
  registerSurveyRoutes(app);
});

beforeEach(() => {
  vi.clearAllMocks();
  storageMocks.findCompletedSessionByProviderTransactionId.mockResolvedValue(null);
  storageMocks.completeRewardSessionAndCredit.mockResolvedValue(undefined);
  storageMocks.findCompletedRewardSession.mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// Helper: build a realistic pending reward session object
// ---------------------------------------------------------------------------
function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    sessionToken: "test-session-token",
    userId: "test-user-id",
    source: "survey",
    status: "pending",
    provider: "cpx",
    externalId: "cpx_survey-123",
    expectedReward: "0.50",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// PROVIDER_REWARD_RANGES (mirrored from surveys.ts for assertion clarity):
//   cpx:      { min: 0.20, max: 3.00 }
//   pollfish: { min: 0.30, max: 1.50 }
//   bitlabs:  { min: 0.20, max: 2.50 }
//   default:  { min: 0.10, max: 5.00 }
// ---------------------------------------------------------------------------

describe("surveys /complete — reward clamping: over-max", () => {
  it("clamps a provider reward above the CPX max (3.00) down to 3.00", async () => {
    storageMocks.getRewardSession.mockResolvedValue(makeSession());
    providerMocks.verifyProviderCompletion.mockResolvedValue({
      verified: true,
      reward: 50.00,
    });

    const res = await request(app)
      .post("/api/surveys/complete")
      .set("Content-Type", "application/json")
      .send({ sessionToken: "test-session-token", transactionId: "txn-over-max" });

    expect(res.status).toBe(200);
    expect(providerMocks.verifyProviderCompletion).toHaveBeenCalledOnce();

    expect(storageMocks.completeRewardSessionAndCredit).toHaveBeenCalledOnce();
    const callArg = storageMocks.completeRewardSessionAndCredit.mock.calls[0]![0];
    expect(callArg.finalReward).toBe(3.00);
  });

  it("clamps a Pollfish reward above its max (1.50) down to 1.50", async () => {
    storageMocks.getRewardSession.mockResolvedValue(
      makeSession({ provider: "pollfish", externalId: "pollfish_s1" })
    );
    providerMocks.verifyProviderCompletion.mockResolvedValue({
      verified: true,
      reward: 99.99,
    });

    const res = await request(app)
      .post("/api/surveys/complete")
      .set("Content-Type", "application/json")
      .send({ sessionToken: "test-session-token", transactionId: "txn-pollfish-over" });

    expect(res.status).toBe(200);
    const callArg = storageMocks.completeRewardSessionAndCredit.mock.calls[0]![0];
    expect(callArg.finalReward).toBe(1.50);
  });

  it("clamps a BitLabs reward above its max (2.50) down to 2.50", async () => {
    storageMocks.getRewardSession.mockResolvedValue(
      makeSession({ provider: "bitlabs", externalId: "bitlabs_s1" })
    );
    providerMocks.verifyProviderCompletion.mockResolvedValue({
      verified: true,
      reward: 1000.00,
    });

    const res = await request(app)
      .post("/api/surveys/complete")
      .set("Content-Type", "application/json")
      .send({ sessionToken: "test-session-token", transactionId: "txn-bitlabs-over" });

    expect(res.status).toBe(200);
    const callArg = storageMocks.completeRewardSessionAndCredit.mock.calls[0]![0];
    expect(callArg.finalReward).toBe(2.50);
  });

  it("the credited amount is the clamped max, not the raw provider figure", async () => {
    storageMocks.getRewardSession.mockResolvedValue(makeSession());
    const rawProviderReward = 500.00;
    providerMocks.verifyProviderCompletion.mockResolvedValue({
      verified: true,
      reward: rawProviderReward,
    });

    await request(app)
      .post("/api/surveys/complete")
      .set("Content-Type", "application/json")
      .send({ sessionToken: "test-session-token", transactionId: "txn-not-raw" });

    const callArg = storageMocks.completeRewardSessionAndCredit.mock.calls[0]![0];
    expect(callArg.finalReward).not.toBe(rawProviderReward);
    expect(callArg.finalReward).toBe(3.00);
  });
});

describe("surveys /complete — reward clamping: under-min", () => {
  it("floors a CPX reward below the min (0.20) up to 0.20", async () => {
    storageMocks.getRewardSession.mockResolvedValue(makeSession());
    providerMocks.verifyProviderCompletion.mockResolvedValue({
      verified: true,
      reward: 0.01,
    });

    const res = await request(app)
      .post("/api/surveys/complete")
      .set("Content-Type", "application/json")
      .send({ sessionToken: "test-session-token", transactionId: "txn-under-min" });

    expect(res.status).toBe(200);
    const callArg = storageMocks.completeRewardSessionAndCredit.mock.calls[0]![0];
    expect(callArg.finalReward).toBe(0.20);
  });

  it("floors a Pollfish reward below its min (0.30) up to 0.30", async () => {
    storageMocks.getRewardSession.mockResolvedValue(
      makeSession({ provider: "pollfish", externalId: "pollfish_s1" })
    );
    providerMocks.verifyProviderCompletion.mockResolvedValue({
      verified: true,
      reward: 0.001,
    });

    const res = await request(app)
      .post("/api/surveys/complete")
      .set("Content-Type", "application/json")
      .send({ sessionToken: "test-session-token", transactionId: "txn-pollfish-under" });

    expect(res.status).toBe(200);
    const callArg = storageMocks.completeRewardSessionAndCredit.mock.calls[0]![0];
    expect(callArg.finalReward).toBe(0.30);
  });

  it("the credited amount is the clamped min, not the raw provider figure", async () => {
    storageMocks.getRewardSession.mockResolvedValue(makeSession());
    const rawProviderReward = 0.001;
    providerMocks.verifyProviderCompletion.mockResolvedValue({
      verified: true,
      reward: rawProviderReward,
    });

    await request(app)
      .post("/api/surveys/complete")
      .set("Content-Type", "application/json")
      .send({ sessionToken: "test-session-token", transactionId: "txn-not-raw-min" });

    const callArg = storageMocks.completeRewardSessionAndCredit.mock.calls[0]![0];
    expect(callArg.finalReward).not.toBe(rawProviderReward);
    expect(callArg.finalReward).toBe(0.20);
  });
});

describe("surveys /complete — reward clamping: within-range pass-through", () => {
  it("passes through a reward within CPX bounds unchanged", async () => {
    storageMocks.getRewardSession.mockResolvedValue(makeSession());
    providerMocks.verifyProviderCompletion.mockResolvedValue({
      verified: true,
      reward: 1.25,
    });

    const res = await request(app)
      .post("/api/surveys/complete")
      .set("Content-Type", "application/json")
      .send({ sessionToken: "test-session-token", transactionId: "txn-in-range" });

    expect(res.status).toBe(200);
    const callArg = storageMocks.completeRewardSessionAndCredit.mock.calls[0]![0];
    expect(callArg.finalReward).toBe(1.25);
  });
});

describe("surveys /complete — reward clamping: zero-reward fallback", () => {
  it("falls back to session.expectedReward when provider returns reward=0, then clamps", async () => {
    storageMocks.getRewardSession.mockResolvedValue(
      makeSession({ expectedReward: "0.75", provider: "cpx" })
    );
    providerMocks.verifyProviderCompletion.mockResolvedValue({
      verified: true,
      reward: 0,
    });

    const res = await request(app)
      .post("/api/surveys/complete")
      .set("Content-Type", "application/json")
      .send({ sessionToken: "test-session-token", transactionId: "txn-zero-reward" });

    expect(res.status).toBe(200);
    const callArg = storageMocks.completeRewardSessionAndCredit.mock.calls[0]![0];
    expect(callArg.finalReward).toBe(0.75);
  });

  it("clamps the expectedReward fallback when it too exceeds the max", async () => {
    storageMocks.getRewardSession.mockResolvedValue(
      makeSession({ expectedReward: "999.00", provider: "cpx" })
    );
    providerMocks.verifyProviderCompletion.mockResolvedValue({
      verified: true,
      reward: 0,
    });

    const res = await request(app)
      .post("/api/surveys/complete")
      .set("Content-Type", "application/json")
      .send({ sessionToken: "test-session-token", transactionId: "txn-expected-over" });

    expect(res.status).toBe(200);
    const callArg = storageMocks.completeRewardSessionAndCredit.mock.calls[0]![0];
    expect(callArg.finalReward).toBe(3.00);
  });

  it("clamps the expectedReward fallback when it is below the min", async () => {
    storageMocks.getRewardSession.mockResolvedValue(
      makeSession({ expectedReward: "0.05", provider: "cpx" })
    );
    providerMocks.verifyProviderCompletion.mockResolvedValue({
      verified: true,
      reward: 0,
    });

    const res = await request(app)
      .post("/api/surveys/complete")
      .set("Content-Type", "application/json")
      .send({ sessionToken: "test-session-token", transactionId: "txn-expected-under" });

    expect(res.status).toBe(200);
    const callArg = storageMocks.completeRewardSessionAndCredit.mock.calls[0]![0];
    expect(callArg.finalReward).toBe(0.20);
  });
});

describe("surveys /complete — reward clamping: unknown provider default bounds", () => {
  it("applies default bounds (min 0.10, max 5.00) for an unknown provider key", async () => {
    storageMocks.getRewardSession.mockResolvedValue(
      makeSession({ provider: "unknown_future_provider", externalId: "unknown_future_provider_s1" })
    );
    providerMocks.verifyProviderCompletion.mockResolvedValue({
      verified: true,
      reward: 9999.00,
    });

    const res = await request(app)
      .post("/api/surveys/complete")
      .set("Content-Type", "application/json")
      .send({ sessionToken: "test-session-token", transactionId: "txn-default-max" });

    expect(res.status).toBe(200);
    const callArg = storageMocks.completeRewardSessionAndCredit.mock.calls[0]![0];
    expect(callArg.finalReward).toBe(5.00);
  });

  it("applies default min (0.10) for an unknown provider with a tiny reward", async () => {
    storageMocks.getRewardSession.mockResolvedValue(
      makeSession({ provider: "unknown_future_provider", externalId: "unknown_future_provider_s1" })
    );
    providerMocks.verifyProviderCompletion.mockResolvedValue({
      verified: true,
      reward: 0.001,
    });

    const res = await request(app)
      .post("/api/surveys/complete")
      .set("Content-Type", "application/json")
      .send({ sessionToken: "test-session-token", transactionId: "txn-default-min" });

    expect(res.status).toBe(200);
    const callArg = storageMocks.completeRewardSessionAndCredit.mock.calls[0]![0];
    expect(callArg.finalReward).toBe(0.10);
  });
});

describe("surveys /complete — completeRewardSessionAndCredit receives clamped value", () => {
  it("never passes the raw provider reward to the DB credit call when it exceeds max", async () => {
    const rawProviderReward = 1_000_000;
    storageMocks.getRewardSession.mockResolvedValue(makeSession({ provider: "cpx" }));
    providerMocks.verifyProviderCompletion.mockResolvedValue({
      verified: true,
      reward: rawProviderReward,
    });

    await request(app)
      .post("/api/surveys/complete")
      .set("Content-Type", "application/json")
      .send({ sessionToken: "test-session-token", transactionId: "txn-db-guard" });

    expect(storageMocks.completeRewardSessionAndCredit).toHaveBeenCalledOnce();
    const { finalReward } = storageMocks.completeRewardSessionAndCredit.mock.calls[0]![0];
    expect(finalReward).toBeLessThanOrEqual(3.00);
    expect(finalReward).not.toBe(rawProviderReward);
  });

  it("never passes the raw provider reward to the DB credit call when it is below min", async () => {
    const rawProviderReward = 0.0001;
    storageMocks.getRewardSession.mockResolvedValue(makeSession({ provider: "cpx" }));
    providerMocks.verifyProviderCompletion.mockResolvedValue({
      verified: true,
      reward: rawProviderReward,
    });

    await request(app)
      .post("/api/surveys/complete")
      .set("Content-Type", "application/json")
      .send({ sessionToken: "test-session-token", transactionId: "txn-db-guard-min" });

    expect(storageMocks.completeRewardSessionAndCredit).toHaveBeenCalledOnce();
    const { finalReward } = storageMocks.completeRewardSessionAndCredit.mock.calls[0]![0];
    expect(finalReward).toBeGreaterThanOrEqual(0.20);
    expect(finalReward).not.toBe(rawProviderReward);
  });

  it("passes the correct sessionToken and userId alongside the clamped reward", async () => {
    storageMocks.getRewardSession.mockResolvedValue(makeSession());
    providerMocks.verifyProviderCompletion.mockResolvedValue({
      verified: true,
      reward: 50.00,
    });

    await request(app)
      .post("/api/surveys/complete")
      .set("Content-Type", "application/json")
      .send({ sessionToken: "test-session-token", transactionId: "txn-full-shape" });

    const callArg = storageMocks.completeRewardSessionAndCredit.mock.calls[0]![0];
    expect(callArg.sessionToken).toBe("test-session-token");
    expect(callArg.userId).toBe("test-user-id");
    expect(callArg.finalReward).toBe(3.00);
  });
});
