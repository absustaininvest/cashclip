import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

/**
 * Reward propagation tests for offerwall (and survey) webhook handlers.
 *
 * Verifies two orthogonal behaviours:
 *
 *   1. parseProviderReward — the shared utility that extracts a numeric USD
 *      reward from a raw webhook field.  Tests cover every edge-case so the
 *      helper is safe to rely on across all providers.
 *
 *   2. Webhook reward propagation — end-to-end through the route handler and
 *      into storage.completeRewardSessionAndCredit.  Two representative pairs
 *      are covered:
 *        • CPX (survey)    — reward-absent: webhook deliberately carries no
 *          amount; handler falls back to session.expectedReward.
 *        • BitLabs (survey) — reward-present: `val` in the callback is parsed,
 *          clamped and forwarded; reward-absent falls back correctly.
 *        • AdGate (offerwall) — reward-present: `payout` is parsed and
 *          forwarded; reward-absent falls back correctly.
 *
 * All external dependencies are mocked — tests run without a real DB.
 */

const mockFindPendingRewardSession = vi.hoisted(() => vi.fn());
const mockCompleteRewardSessionAndCredit = vi.hoisted(() => vi.fn());

vi.mock("./storage", () => ({
  storage: {
    findPendingRewardSession: mockFindPendingRewardSession,
    completeRewardSessionAndCredit: mockCompleteRewardSessionAndCredit,
    getUser: vi.fn().mockResolvedValue(undefined),
    getUserByUsername: vi.fn().mockResolvedValue(undefined),
    getRewardSession: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("./lib/webhookAuth", () => ({
  verifyWebhook: vi.fn().mockReturnValue({ ok: true }),
  logWebhookVerificationFailure: vi.fn(),
}));

vi.mock("./lib/webhookRateLimit", () => ({
  webhookRateLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("./auth", () => ({
  RESERVED_ADMIN_USERNAMES: new Set<string>(),
  registerAuthRoutes: () => {},
  authMiddleware: (_req: any, _res: any, next: any) => next(),
  adminMiddleware: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("./issuedOffers", () => ({
  recordIssuedOffers: vi.fn(),
  getIssuedOffer: vi.fn().mockReturnValue(undefined),
  generateSessionToken: vi.fn().mockReturnValue("mock-session-token"),
}));

vi.mock("./lib/offerwallProviders", () => ({
  fetchAllOffers: vi.fn().mockResolvedValue([]),
  verifyOfferCompletion: vi.fn().mockResolvedValue({ verified: false }),
  getOfferwallProviderStatus: vi.fn().mockReturnValue([]),
}));

vi.mock("./lib/demographicUrl", () => ({
  buildDemographicEntryUrl: vi.fn().mockImplementation((url: string) => url),
}));

vi.mock("./lib/clientIp", () => ({
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));

vi.mock("./lib/surveyProviders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/surveyProviders")>();
  return {
    ...actual,
    fetchExternalSurveys: vi.fn().mockResolvedValue([]),
    verifyProviderCompletion: vi.fn().mockResolvedValue({ verified: false, reward: 0 }),
    getProviderStatus: vi.fn().mockReturnValue([]),
    buildCpxWallUrl: vi.fn().mockReturnValue("https://cpx.example.com"),
  };
});

let app: Express;

function makeSession(overrides: {
  source?: "survey" | "offerwall";
  provider?: string;
  externalId?: string;
  expectedReward?: string;
  userId?: string;
}) {
  return {
    sessionToken: "sess-abc123",
    userId: overrides.userId ?? "u-1",
    source: overrides.source ?? "survey",
    provider: overrides.provider ?? "cpx",
    externalId: overrides.externalId ?? "cpx_survey1",
    expectedReward: overrides.expectedReward ?? "0.50",
    status: "pending",
    expiresAt: new Date(Date.now() + 3_600_000),
    createdAt: new Date(),
  };
}

beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
  process.env.JWT_ACCESS_SECRET ??= "test-jwt-secret-padded-to-64-chars-minimum-aabbccddeeff00112233";
  process.env.CPX_WEBHOOK_SECRET ??= "cpx-test-secret";
  process.env.BITLABS_WEBHOOK_SECRET ??= "bitlabs-test-secret";
  process.env.ADGATE_WEBHOOK_SECRET ??= "adgate-test-secret";
  process.env.OFFERTORO_WEBHOOK_SECRET ??= "offertoro-test-secret";
  process.env.TAPJOY_WEBHOOK_SECRET ??= "tapjoy-test-secret";
  process.env.LOOTABLY_WEBHOOK_SECRET ??= "lootably-test-secret";
  process.env.ADJOE_WEBHOOK_SECRET ??= "adjoe-test-secret";
  process.env.WEBHOOK_RATE_LIMIT_RPM ??= "10000";

  const { registerSurveyRoutes } = await import("./surveys");
  const { registerOfferwallRoutes } = await import("./offerwalls");

  app = express();
  app.use(express.json());
  registerSurveyRoutes(app);
  registerOfferwallRoutes(app);
});

beforeEach(() => {
  vi.clearAllMocks();
  mockCompleteRewardSessionAndCredit.mockResolvedValue({
    session: {},
    balance: 1000,
    totalEarned: 1000,
    reward: 0.50,
  });
});

// ---------------------------------------------------------------------------
// parseProviderReward unit tests
// ---------------------------------------------------------------------------

describe("parseProviderReward", () => {
  let parseProviderReward: typeof import("./lib/surveyProviders").parseProviderReward;

  beforeAll(async () => {
    const mod = await import("./lib/surveyProviders");
    parseProviderReward = mod.parseProviderReward;
  });

  it("returns a positive number as-is", () => {
    expect(parseProviderReward(1.50)).toBe(1.50);
  });

  it("parses a positive numeric string", () => {
    expect(parseProviderReward("2.00")).toBe(2.00);
  });

  it("returns undefined for zero", () => {
    expect(parseProviderReward(0)).toBeUndefined();
  });

  it("returns undefined for negative numbers", () => {
    expect(parseProviderReward(-5)).toBeUndefined();
  });

  it("returns undefined for NaN strings", () => {
    expect(parseProviderReward("not-a-number")).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(parseProviderReward(undefined)).toBeUndefined();
  });

  it("returns undefined for null", () => {
    expect(parseProviderReward(null)).toBeUndefined();
  });

  it("returns undefined for Infinity", () => {
    expect(parseProviderReward(Infinity)).toBeUndefined();
  });

  it("returns undefined for an empty string", () => {
    expect(parseProviderReward("")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// CPX survey webhook — reward-absent
// ---------------------------------------------------------------------------
// CPX's `amount_local` is unsigned and attacker-controlled so the handler
// deliberately ignores it and falls back to session.expectedReward.

describe("CPX survey webhook — reward propagation", () => {
  it("credits using session.expectedReward when no amount is in the query (reward-absent)", async () => {
    mockFindPendingRewardSession.mockResolvedValue(makeSession({
      source: "survey",
      provider: "cpx",
      externalId: "cpx_survey1",
      expectedReward: "0.75",
      userId: "u-1",
    }));

    const res = await request(app)
      .get("/api/surveys/webhook/cpx")
      .query({ status: "1", trans_id: "tx-1", survey_id: "survey1", ext_user_id: "u-1" });

    expect(res.status).toBe(200);
    expect(mockCompleteRewardSessionAndCredit).toHaveBeenCalledOnce();
    const { finalReward } = mockCompleteRewardSessionAndCredit.mock.calls[0]![0];
    // Falls back to session.expectedReward=0.75; within cpx range [0.20, 3.00]
    expect(finalReward).toBeCloseTo(0.75, 5);
  });

  it("still returns 200 even when the session is not found (no-op)", async () => {
    mockFindPendingRewardSession.mockResolvedValue(undefined);

    const res = await request(app)
      .get("/api/surveys/webhook/cpx")
      .query({ status: "1", trans_id: "tx-2", survey_id: "survey2", ext_user_id: "u-1" });

    expect(res.status).toBe(200);
    expect(mockCompleteRewardSessionAndCredit).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// BitLabs survey webhook — reward-present and reward-absent
// ---------------------------------------------------------------------------
// BitLabs sends `val` as the USD payout in its callback. When present it is
// parsed and clamped; when absent the session expectedReward is used.

describe("BitLabs survey webhook — reward propagation", () => {
  it("uses the val field from the callback when present (reward-present)", async () => {
    mockFindPendingRewardSession.mockResolvedValue(makeSession({
      source: "survey",
      provider: "bitlabs",
      externalId: "bitlabs_s42",
      expectedReward: "0.30",
      userId: "u-1",
    }));

    const res = await request(app)
      .get("/api/surveys/webhook/bitlabs")
      .query({ survey_id: "s42", user_id: "u-1", val: "1.50" });

    expect(res.status).toBe(200);
    expect(mockCompleteRewardSessionAndCredit).toHaveBeenCalledOnce();
    const { finalReward } = mockCompleteRewardSessionAndCredit.mock.calls[0]![0];
    // val=1.50 is within bitlabs range [0.20, 2.50]
    expect(finalReward).toBeCloseTo(1.50, 5);
  });

  it("clamps an above-max val to the provider ceiling", async () => {
    mockFindPendingRewardSession.mockResolvedValue(makeSession({
      source: "survey",
      provider: "bitlabs",
      externalId: "bitlabs_s43",
      expectedReward: "0.30",
      userId: "u-1",
    }));

    const res = await request(app)
      .get("/api/surveys/webhook/bitlabs")
      .query({ survey_id: "s43", user_id: "u-1", val: "99.99" });

    expect(res.status).toBe(200);
    const { finalReward } = mockCompleteRewardSessionAndCredit.mock.calls[0]![0];
    // Clamped to max of bitlabs range = 2.50
    expect(finalReward).toBeCloseTo(2.50, 5);
  });

  it("falls back to session.expectedReward when val is absent (reward-absent)", async () => {
    mockFindPendingRewardSession.mockResolvedValue(makeSession({
      source: "survey",
      provider: "bitlabs",
      externalId: "bitlabs_s44",
      expectedReward: "0.80",
      userId: "u-1",
    }));

    const res = await request(app)
      .get("/api/surveys/webhook/bitlabs")
      .query({ survey_id: "s44", user_id: "u-1" });

    expect(res.status).toBe(200);
    const { finalReward } = mockCompleteRewardSessionAndCredit.mock.calls[0]![0];
    // No val → falls back to 0.80; within bitlabs range [0.20, 2.50]
    expect(finalReward).toBeCloseTo(0.80, 5);
  });
});

// ---------------------------------------------------------------------------
// AdGate offerwall webhook — reward-present and reward-absent
// ---------------------------------------------------------------------------

describe("AdGate offerwall webhook — reward propagation", () => {
  it("uses the payout field from the body when present (reward-present)", async () => {
    mockFindPendingRewardSession.mockResolvedValue(makeSession({
      source: "offerwall",
      provider: "adgate",
      externalId: "adgate_offer99",
      expectedReward: "0.50",
      userId: "u-2",
    }));

    const res = await request(app)
      .post("/api/offerwalls/webhook/adgate")
      .send({ offer_id: "offer99", user_id: "u-2", payout: 5.00, status: "completed" });

    expect(res.status).toBe(200);
    expect(mockCompleteRewardSessionAndCredit).toHaveBeenCalledOnce();
    const { finalReward } = mockCompleteRewardSessionAndCredit.mock.calls[0]![0];
    // payout=5.00 is within adgate range [0.10, 20.00]
    expect(finalReward).toBeCloseTo(5.00, 5);
  });

  it("parses a string payout value correctly", async () => {
    mockFindPendingRewardSession.mockResolvedValue(makeSession({
      source: "offerwall",
      provider: "adgate",
      externalId: "adgate_offer100",
      expectedReward: "0.50",
      userId: "u-2",
    }));

    const res = await request(app)
      .post("/api/offerwalls/webhook/adgate")
      .send({ offer_id: "offer100", user_id: "u-2", payout: "3.50", status: "completed" });

    expect(res.status).toBe(200);
    const { finalReward } = mockCompleteRewardSessionAndCredit.mock.calls[0]![0];
    expect(finalReward).toBeCloseTo(3.50, 5);
  });

  it("falls back to session.expectedReward when payout is absent (reward-absent)", async () => {
    mockFindPendingRewardSession.mockResolvedValue(makeSession({
      source: "offerwall",
      provider: "adgate",
      externalId: "adgate_offer101",
      expectedReward: "1.20",
      userId: "u-2",
    }));

    const res = await request(app)
      .post("/api/offerwalls/webhook/adgate")
      .send({ offer_id: "offer101", user_id: "u-2", status: "completed" });

    expect(res.status).toBe(200);
    const { finalReward } = mockCompleteRewardSessionAndCredit.mock.calls[0]![0];
    // No payout → falls back to 1.20; within adgate range [0.10, 20.00]
    expect(finalReward).toBeCloseTo(1.20, 5);
  });

  it("clamps an above-max payout to the provider ceiling", async () => {
    mockFindPendingRewardSession.mockResolvedValue(makeSession({
      source: "offerwall",
      provider: "adgate",
      externalId: "adgate_offer102",
      expectedReward: "0.50",
      userId: "u-2",
    }));

    const res = await request(app)
      .post("/api/offerwalls/webhook/adgate")
      .send({ offer_id: "offer102", user_id: "u-2", payout: 999, status: "completed" });

    expect(res.status).toBe(200);
    const { finalReward } = mockCompleteRewardSessionAndCredit.mock.calls[0]![0];
    // Clamped to adgate max = 20.00
    expect(finalReward).toBeCloseTo(20.00, 5);
  });

  it("ignores the webhook body and returns 200 when status is not 'completed'", async () => {
    const res = await request(app)
      .post("/api/offerwalls/webhook/adgate")
      .send({ offer_id: "offer103", user_id: "u-2", payout: 5.00, status: "pending" });

    expect(res.status).toBe(200);
    expect(mockCompleteRewardSessionAndCredit).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// OfferToro offerwall webhook — reward-present and reward-absent
// ---------------------------------------------------------------------------
// OfferToro sends `payout` like AdGate but has NO status gate — any
// authenticated callback with offer_id and user_id triggers crediting.

describe("OfferToro offerwall webhook — reward propagation", () => {
  it("uses the payout field from the body when present (reward-present)", async () => {
    mockFindPendingRewardSession.mockResolvedValue(makeSession({
      source: "offerwall",
      provider: "offertoro",
      externalId: "offertoro_ot77",
      expectedReward: "0.40",
      userId: "u-3",
    }));

    const res = await request(app)
      .post("/api/offerwalls/webhook/offertoro")
      .send({ offer_id: "ot77", user_id: "u-3", payout: 3.00 });

    expect(res.status).toBe(200);
    expect(mockCompleteRewardSessionAndCredit).toHaveBeenCalledOnce();
    const { finalReward } = mockCompleteRewardSessionAndCredit.mock.calls[0]![0];
    // payout=3.00 is within offertoro range [0.10, 20.00]
    expect(finalReward).toBeCloseTo(3.00, 5);
  });

  it("falls back to session.expectedReward when payout is absent (reward-absent)", async () => {
    mockFindPendingRewardSession.mockResolvedValue(makeSession({
      source: "offerwall",
      provider: "offertoro",
      externalId: "offertoro_ot78",
      expectedReward: "0.65",
      userId: "u-3",
    }));

    const res = await request(app)
      .post("/api/offerwalls/webhook/offertoro")
      .send({ offer_id: "ot78", user_id: "u-3" });

    expect(res.status).toBe(200);
    expect(mockCompleteRewardSessionAndCredit).toHaveBeenCalledOnce();
    const { finalReward } = mockCompleteRewardSessionAndCredit.mock.calls[0]![0];
    // No payout → falls back to 0.65; within offertoro range [0.10, 20.00]
    expect(finalReward).toBeCloseTo(0.65, 5);
  });

  it("credits without a status field — no status gate unlike AdGate", async () => {
    mockFindPendingRewardSession.mockResolvedValue(makeSession({
      source: "offerwall",
      provider: "offertoro",
      externalId: "offertoro_ot79",
      expectedReward: "0.50",
      userId: "u-3",
    }));

    // No `status` key at all — OfferToro handler does not require one
    const res = await request(app)
      .post("/api/offerwalls/webhook/offertoro")
      .send({ offer_id: "ot79", user_id: "u-3", payout: 1.00 });

    expect(res.status).toBe(200);
    expect(mockCompleteRewardSessionAndCredit).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Tapjoy offerwall webhook — currency field is ignored, always uses session
// ---------------------------------------------------------------------------
// Tapjoy sends `currency` as virtual points (not USD). The handler explicitly
// passes null as the payload so parseProviderReward returns undefined and
// creditOfferViaWebhook always falls back to session.expectedReward.

describe("Tapjoy offerwall webhook — currency field ignored, uses session.expectedReward", () => {
  it("ignores the currency field and credits using session.expectedReward", async () => {
    mockFindPendingRewardSession.mockResolvedValue(makeSession({
      source: "offerwall",
      provider: "tapjoy",
      externalId: "tapjoy_tj55",
      expectedReward: "1.00",
      userId: "u-4",
    }));

    // currency=5000 is virtual points — must NOT be used as a USD reward
    const res = await request(app)
      .get("/api/offerwalls/webhook/tapjoy")
      .query({ id: "tj55", snuid: "u-4", currency: "5000" });

    expect(res.status).toBe(200);
    expect(mockCompleteRewardSessionAndCredit).toHaveBeenCalledOnce();
    const { finalReward } = mockCompleteRewardSessionAndCredit.mock.calls[0]![0];
    // currency is ignored; falls back to session.expectedReward=1.00
    expect(finalReward).toBeCloseTo(1.00, 5);
    // Confirm it did NOT use the raw currency value
    expect(finalReward).not.toBeCloseTo(5000, 0);
  });

  it("credits using session.expectedReward even when no currency field is present", async () => {
    mockFindPendingRewardSession.mockResolvedValue(makeSession({
      source: "offerwall",
      provider: "tapjoy",
      externalId: "tapjoy_tj56",
      expectedReward: "0.75",
      userId: "u-4",
    }));

    const res = await request(app)
      .get("/api/offerwalls/webhook/tapjoy")
      .query({ id: "tj56", snuid: "u-4" });

    expect(res.status).toBe(200);
    expect(mockCompleteRewardSessionAndCredit).toHaveBeenCalledOnce();
    const { finalReward } = mockCompleteRewardSessionAndCredit.mock.calls[0]![0];
    // No currency field; falls back to session.expectedReward=0.75
    expect(finalReward).toBeCloseTo(0.75, 5);
  });

  it("credits on any authenticated callback — no status gate", async () => {
    mockFindPendingRewardSession.mockResolvedValue(makeSession({
      source: "offerwall",
      provider: "tapjoy",
      externalId: "tapjoy_tj57",
      expectedReward: "0.50",
      userId: "u-4",
    }));

    const res = await request(app)
      .get("/api/offerwalls/webhook/tapjoy")
      .query({ id: "tj57", snuid: "u-4" });

    expect(res.status).toBe(200);
    // creditOfferViaWebhook was called — no status check required
    expect(mockCompleteRewardSessionAndCredit).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Lootably offerwall webhook — reward-present, reward-absent, status-gate
// ---------------------------------------------------------------------------
// Lootably sends `payout` in the body and requires status === "completed"
// before crediting (same gate pattern as AdGate). Range: [0.10, 20.00].

describe("Lootably offerwall webhook — reward propagation", () => {
  it("uses the payout field from the body when present (reward-present)", async () => {
    mockFindPendingRewardSession.mockResolvedValue(makeSession({
      source: "offerwall",
      provider: "lootably",
      externalId: "lootably_lb10",
      expectedReward: "0.40",
      userId: "u-5",
    }));

    const res = await request(app)
      .post("/api/offerwalls/webhook/lootably")
      .send({ offer_id: "lb10", user_id: "u-5", payout: 4.00, status: "completed" });

    expect(res.status).toBe(200);
    expect(mockCompleteRewardSessionAndCredit).toHaveBeenCalledOnce();
    const { finalReward } = mockCompleteRewardSessionAndCredit.mock.calls[0]![0];
    // payout=4.00 is within lootably range [0.10, 20.00]
    expect(finalReward).toBeCloseTo(4.00, 5);
  });

  it("falls back to session.expectedReward when payout is absent (reward-absent)", async () => {
    mockFindPendingRewardSession.mockResolvedValue(makeSession({
      source: "offerwall",
      provider: "lootably",
      externalId: "lootably_lb11",
      expectedReward: "0.90",
      userId: "u-5",
    }));

    const res = await request(app)
      .post("/api/offerwalls/webhook/lootably")
      .send({ offer_id: "lb11", user_id: "u-5", status: "completed" });

    expect(res.status).toBe(200);
    expect(mockCompleteRewardSessionAndCredit).toHaveBeenCalledOnce();
    const { finalReward } = mockCompleteRewardSessionAndCredit.mock.calls[0]![0];
    // No payout → falls back to 0.90; within lootably range [0.10, 20.00]
    expect(finalReward).toBeCloseTo(0.90, 5);
  });

  it("clamps an above-max payout to the provider ceiling", async () => {
    mockFindPendingRewardSession.mockResolvedValue(makeSession({
      source: "offerwall",
      provider: "lootably",
      externalId: "lootably_lb12",
      expectedReward: "0.50",
      userId: "u-5",
    }));

    const res = await request(app)
      .post("/api/offerwalls/webhook/lootably")
      .send({ offer_id: "lb12", user_id: "u-5", payout: 999, status: "completed" });

    expect(res.status).toBe(200);
    const { finalReward } = mockCompleteRewardSessionAndCredit.mock.calls[0]![0];
    // Clamped to lootably max = 20.00
    expect(finalReward).toBeCloseTo(20.00, 5);
  });

  it("ignores the webhook and returns 200 when status is not 'completed' (status-gate)", async () => {
    const res = await request(app)
      .post("/api/offerwalls/webhook/lootably")
      .send({ offer_id: "lb13", user_id: "u-5", payout: 4.00, status: "pending" });

    expect(res.status).toBe(200);
    expect(mockCompleteRewardSessionAndCredit).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Adjoe offerwall webhook — reward-present, reward-absent, status-gate
// ---------------------------------------------------------------------------
// Adjoe sends `payout` in the body and requires status === "completed" before
// crediting (same gate pattern as AdGate). Range: [0.10, 25.00].

describe("Adjoe offerwall webhook — reward propagation", () => {
  it("uses the payout field from the body when present (reward-present)", async () => {
    mockFindPendingRewardSession.mockResolvedValue(makeSession({
      source: "offerwall",
      provider: "adjoe",
      externalId: "adjoe_aj20",
      expectedReward: "0.60",
      userId: "u-6",
    }));

    const res = await request(app)
      .post("/api/offerwalls/webhook/adjoe")
      .send({ offer_id: "aj20", user_id: "u-6", payout: 7.50, status: "completed" });

    expect(res.status).toBe(200);
    expect(mockCompleteRewardSessionAndCredit).toHaveBeenCalledOnce();
    const { finalReward } = mockCompleteRewardSessionAndCredit.mock.calls[0]![0];
    // payout=7.50 is within adjoe range [0.10, 25.00]
    expect(finalReward).toBeCloseTo(7.50, 5);
  });

  it("falls back to session.expectedReward when payout is absent (reward-absent)", async () => {
    mockFindPendingRewardSession.mockResolvedValue(makeSession({
      source: "offerwall",
      provider: "adjoe",
      externalId: "adjoe_aj21",
      expectedReward: "1.10",
      userId: "u-6",
    }));

    const res = await request(app)
      .post("/api/offerwalls/webhook/adjoe")
      .send({ offer_id: "aj21", user_id: "u-6", status: "completed" });

    expect(res.status).toBe(200);
    expect(mockCompleteRewardSessionAndCredit).toHaveBeenCalledOnce();
    const { finalReward } = mockCompleteRewardSessionAndCredit.mock.calls[0]![0];
    // No payout → falls back to 1.10; within adjoe range [0.10, 25.00]
    expect(finalReward).toBeCloseTo(1.10, 5);
  });

  it("clamps an above-max payout to the provider ceiling", async () => {
    mockFindPendingRewardSession.mockResolvedValue(makeSession({
      source: "offerwall",
      provider: "adjoe",
      externalId: "adjoe_aj22",
      expectedReward: "0.50",
      userId: "u-6",
    }));

    const res = await request(app)
      .post("/api/offerwalls/webhook/adjoe")
      .send({ offer_id: "aj22", user_id: "u-6", payout: 999, status: "completed" });

    expect(res.status).toBe(200);
    const { finalReward } = mockCompleteRewardSessionAndCredit.mock.calls[0]![0];
    // Clamped to adjoe max = 25.00
    expect(finalReward).toBeCloseTo(25.00, 5);
  });

  it("ignores the webhook and returns 200 when status is not 'completed' (status-gate)", async () => {
    const res = await request(app)
      .post("/api/offerwalls/webhook/adjoe")
      .send({ offer_id: "aj23", user_id: "u-6", payout: 7.50, status: "failed" });

    expect(res.status).toBe(200);
    expect(mockCompleteRewardSessionAndCredit).not.toHaveBeenCalled();
  });
});
