import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Hoisted mocks — must be defined before any dynamic import of the modules
// under test.
// ---------------------------------------------------------------------------
const storageMocks = vi.hoisted(() => ({
  findPendingRewardSession: vi.fn(),
  completeRewardSessionAndCredit: vi.fn(),
  findCompletedRewardSession: vi.fn().mockResolvedValue(null),
  findCompletedSessionByProviderTransactionId: vi.fn().mockResolvedValue(null),
  getRewardSession: vi.fn().mockResolvedValue(undefined),
  createRewardSession: vi.fn().mockResolvedValue(undefined),
  updateUserBalance: vi.fn().mockResolvedValue(undefined),
  createEarningsLedgerEntry: vi.fn().mockResolvedValue(undefined),
  getUser: vi.fn().mockResolvedValue(undefined),
  insertWebhookAudit: vi.fn().mockResolvedValue(undefined),
  countWebhookAuditByIp: vi.fn().mockResolvedValue(0),
  insertWebhookAuditBatch: vi.fn().mockResolvedValue(undefined),
  getWebhookAudits: vi.fn().mockResolvedValue([]),
  getWebhookAuditOffenders: vi.fn().mockResolvedValue([]),
  getWebhookAuditProviders: vi.fn().mockResolvedValue([]),
  getWithdrawals: vi.fn().mockResolvedValue([]),
  getBalance: vi.fn().mockResolvedValue(undefined),
  getTransactions: vi.fn().mockResolvedValue([]),
  getUserByUsername: vi.fn().mockResolvedValue(undefined),
  createWithdrawal: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./storage", () => ({ storage: storageMocks }));

vi.mock("./paypal", () => ({
  sendPayPalPayout: vi.fn(),
  isPayPalConfigured: () => false,
  initPayPal: vi.fn(),
}));

vi.mock("./auth", () => ({
  RESERVED_ADMIN_USERNAMES: new Set<string>(),
  registerAuthRoutes: () => {},
  authMiddleware: (_req: any, _res: any, next: any) => next(),
  adminMiddleware: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("./lib/offerwallProviders", () => ({
  fetchAllOffers: vi.fn().mockResolvedValue([]),
  verifyOfferCompletion: vi.fn().mockResolvedValue({ verified: true, reward: 0 }),
  getOfferwallProviderStatus: vi.fn().mockReturnValue([]),
}));

vi.mock("./lib/surveyProviders", async (importActual) => {
  const real = await importActual<typeof import("./lib/surveyProviders")>();
  return { ...real };
});

vi.mock("./issuedOffers", () => ({
  recordIssuedOffers: vi.fn(),
  getIssuedOffer: vi.fn().mockReturnValue(null),
  generateSessionToken: vi.fn().mockReturnValue("tok"),
}));

const md5 = (s: string) => crypto.createHash("md5").update(s).digest("hex");

const SECRETS = {
  ADGATE_WEBHOOK_SECRET: "adgate-rp-secret",
  OFFERTORO_WEBHOOK_SECRET: "offertoro-rp-secret",
  LOOTABLY_WEBHOOK_SECRET: "lootably-rp-secret",
  ADJOE_WEBHOOK_SECRET: "adjoe-rp-secret",
  TAPJOY_WEBHOOK_SECRET: "tapjoy-rp-secret",
};

beforeAll(() => {
  for (const [k, v] of Object.entries(SECRETS)) {
    process.env[k] = v;
  }
  process.env.JWT_SECRET ??= "test-jwt-secret-padded-to-meet-minimum-64-character-length-requirement";
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
  process.env.WEBHOOK_RATE_LIMIT_RPM ??= "10000";
});

let app: Express;
let RANGES: Record<string, { min: number; max: number }>;

beforeAll(async () => {
  const actual = await vi.importActual<typeof import("./lib/surveyProviders")>("./lib/surveyProviders");
  RANGES = actual.PROVIDER_REWARD_RANGES;

  const { reloadWebhookSecrets } = await import("./lib/webhookAuth");
  reloadWebhookSecrets();

  const { registerOfferwallRoutes } = await import("./offerwalls");

  app = express();
  app.use(express.json());
  registerOfferwallRoutes(app);
});

beforeEach(() => {
  storageMocks.findPendingRewardSession.mockReset();
  storageMocks.completeRewardSessionAndCredit.mockReset();
  storageMocks.findPendingRewardSession.mockResolvedValue(null);
  storageMocks.completeRewardSessionAndCredit.mockResolvedValue({
    reward: 1.00,
    balance: 10.00,
    totalEarned: 10.00,
  });
});

// ---------------------------------------------------------------------------
// Helpers — build valid signatures for each provider
// ---------------------------------------------------------------------------

function adgateBody(
  offer_id: string,
  user_id: string,
  payout: string,
  extra: Record<string, unknown> = {},
) {
  const hash_value = md5(`${offer_id}${user_id}${payout}${SECRETS.ADGATE_WEBHOOK_SECRET}`);
  return { offer_id, user_id, payout, status: "completed", hash_value, ...extra };
}

function offertoroBody(
  offer_id: string,
  user_id: string,
  payout: string,
  extra: Record<string, unknown> = {},
) {
  const ot_sig = md5(`${offer_id}${user_id}${payout}${SECRETS.OFFERTORO_WEBHOOK_SECRET}`);
  return { offer_id, user_id, payout, ot_sig, ...extra };
}

function lootablyBody(
  offer_id: string,
  user_id: string,
  token: string,
  extra: Record<string, unknown> = {},
) {
  return { offer_id, user_id, status: "completed", secret: token, ...extra };
}

function adjoeBody(
  offer_id: string,
  user_id: string,
  token: string,
  extra: Record<string, unknown> = {},
) {
  return { offer_id, user_id, status: "completed", secret: token, ...extra };
}

// ---------------------------------------------------------------------------
// A fake pending session to return from storage
// ---------------------------------------------------------------------------
function makePendingSession(expectedReward = "1.50") {
  return {
    sessionToken: "sess-abc",
    userId: "user-1",
    source: "offerwall",
    provider: "adgate",
    externalId: "adgate_offer-1",
    expectedReward,
    expiresAt: new Date(Date.now() + 60_000),
    status: "pending",
  };
}

// ===========================================================================
// AdGate — reward-present and reward-absent cases
// ===========================================================================
describe("AdGate webhook — reward propagation", () => {
  it("extracts the payout field from the webhook body and uses it as the final reward", async () => {
    storageMocks.findPendingRewardSession.mockResolvedValue(makePendingSession("1.50"));

    const body = adgateBody("offer-1", "user-1", "3.75");
    const res = await request(app)
      .post("/api/offerwalls/webhook/adgate")
      .send(body);

    expect(res.status).toBe(200);
    expect(storageMocks.completeRewardSessionAndCredit).toHaveBeenCalledOnce();
    const call = storageMocks.completeRewardSessionAndCredit.mock.calls[0]![0];
    expect(call.finalReward).toBe(3.75);
  });

  it("falls back to session.expectedReward when no reward field is present in the body", async () => {
    storageMocks.findPendingRewardSession.mockResolvedValue(makePendingSession("2.00"));

    const offer_id = "offer-2";
    const user_id = "user-2";
    const hash_value = md5(`${offer_id}${user_id}${SECRETS.ADGATE_WEBHOOK_SECRET}`);
    const body = { offer_id, user_id, status: "completed", hash_value };

    const res = await request(app)
      .post("/api/offerwalls/webhook/adgate")
      .send(body);

    expect(res.status).toBe(200);
    expect(storageMocks.completeRewardSessionAndCredit).toHaveBeenCalledOnce();
    const call = storageMocks.completeRewardSessionAndCredit.mock.calls[0]![0];
    expect(call.finalReward).toBe(2.00);
  });

  it("clamps a provider-reported reward that exceeds the AdGate max", async () => {
    storageMocks.findPendingRewardSession.mockResolvedValue(makePendingSession("1.00"));

    const body = adgateBody("offer-3", "user-3", "99.99");
    const res = await request(app)
      .post("/api/offerwalls/webhook/adgate")
      .send(body);

    expect(res.status).toBe(200);
    expect(storageMocks.completeRewardSessionAndCredit).toHaveBeenCalledOnce();
    const call = storageMocks.completeRewardSessionAndCredit.mock.calls[0]![0];
    expect(call.finalReward).toBe(RANGES.adgate.max);
  });

  it("extracts reward from the `reward` field (alternate field name)", async () => {
    storageMocks.findPendingRewardSession.mockResolvedValue(makePendingSession("1.50"));

    const offer_id = "offer-4";
    const user_id = "user-4";
    const payout = "";
    const hash_value = md5(`${offer_id}${user_id}${payout}${SECRETS.ADGATE_WEBHOOK_SECRET}`);
    const body = { offer_id, user_id, status: "completed", hash_value, reward: 4.50 };

    const res = await request(app)
      .post("/api/offerwalls/webhook/adgate")
      .send(body);

    expect(res.status).toBe(200);
    const call = storageMocks.completeRewardSessionAndCredit.mock.calls[0]![0];
    expect(call.finalReward).toBe(4.50);
  });

  it("does not credit anything when no pending session is found", async () => {
    storageMocks.findPendingRewardSession.mockResolvedValue(null);

    const body = adgateBody("offer-5", "user-5", "2.00");
    await request(app).post("/api/offerwalls/webhook/adgate").send(body);

    expect(storageMocks.completeRewardSessionAndCredit).not.toHaveBeenCalled();
  });

  it("does not credit when status is not completed", async () => {
    storageMocks.findPendingRewardSession.mockResolvedValue(makePendingSession("1.50"));

    const offer_id = "offer-6";
    const user_id = "user-6";
    const payout = "2.00";
    const hash_value = md5(`${offer_id}${user_id}${payout}${SECRETS.ADGATE_WEBHOOK_SECRET}`);
    const body = { offer_id, user_id, payout, status: "pending", hash_value };

    await request(app).post("/api/offerwalls/webhook/adgate").send(body);

    expect(storageMocks.completeRewardSessionAndCredit).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Lootably — reward-present and reward-absent cases
// ===========================================================================
describe("Lootably webhook — reward propagation", () => {
  it("extracts the payout field and uses it as the final reward", async () => {
    const session = { ...makePendingSession("1.00"), provider: "lootably", externalId: "lootably_loot-1" };
    storageMocks.findPendingRewardSession.mockResolvedValue(session);

    const res = await request(app)
      .post("/api/offerwalls/webhook/lootably")
      .query({ secret: SECRETS.LOOTABLY_WEBHOOK_SECRET })
      .send({ offer_id: "loot-1", user_id: "user-10", status: "completed", payout: 5.50 });

    expect(res.status).toBe(200);
    expect(storageMocks.completeRewardSessionAndCredit).toHaveBeenCalledOnce();
    const call = storageMocks.completeRewardSessionAndCredit.mock.calls[0]![0];
    expect(call.finalReward).toBe(5.50);
  });

  it("falls back to session.expectedReward when no reward field is present", async () => {
    const session = { ...makePendingSession("3.00"), provider: "lootably", externalId: "lootably_loot-2" };
    storageMocks.findPendingRewardSession.mockResolvedValue(session);

    const res = await request(app)
      .post("/api/offerwalls/webhook/lootably")
      .query({ secret: SECRETS.LOOTABLY_WEBHOOK_SECRET })
      .send({ offer_id: "loot-2", user_id: "user-11", status: "completed" });

    expect(res.status).toBe(200);
    expect(storageMocks.completeRewardSessionAndCredit).toHaveBeenCalledOnce();
    const call = storageMocks.completeRewardSessionAndCredit.mock.calls[0]![0];
    expect(call.finalReward).toBe(3.00);
  });

  it("clamps a reward exceeding the Lootably max", async () => {
    const session = { ...makePendingSession("1.00"), provider: "lootably", externalId: "lootably_loot-3" };
    storageMocks.findPendingRewardSession.mockResolvedValue(session);

    const res = await request(app)
      .post("/api/offerwalls/webhook/lootably")
      .query({ secret: SECRETS.LOOTABLY_WEBHOOK_SECRET })
      .send({ offer_id: "loot-3", user_id: "user-12", status: "completed", payout: 500 });

    expect(res.status).toBe(200);
    const call = storageMocks.completeRewardSessionAndCredit.mock.calls[0]![0];
    expect(call.finalReward).toBe(RANGES.lootably.max);
  });

  it("extracts reward from the `reward` field (alternate field name)", async () => {
    const session = { ...makePendingSession("1.00"), provider: "lootably", externalId: "lootably_loot-4" };
    storageMocks.findPendingRewardSession.mockResolvedValue(session);

    const res = await request(app)
      .post("/api/offerwalls/webhook/lootably")
      .query({ secret: SECRETS.LOOTABLY_WEBHOOK_SECRET })
      .send({ offer_id: "loot-4", user_id: "user-13", status: "completed", reward: 7.25 });

    expect(res.status).toBe(200);
    const call = storageMocks.completeRewardSessionAndCredit.mock.calls[0]![0];
    expect(call.finalReward).toBe(7.25);
  });

  it("returns 403 when the secret token is wrong", async () => {
    const res = await request(app)
      .post("/api/offerwalls/webhook/lootably")
      .query({ secret: "wrong-secret" })
      .send({ offer_id: "x", user_id: "y", status: "completed" });

    expect(res.status).toBe(403);
    expect(storageMocks.completeRewardSessionAndCredit).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Adjoe — basic reward propagation
// ===========================================================================
describe("Adjoe webhook — reward propagation", () => {
  it("extracts the amount field and uses it as the final reward", async () => {
    const session = { ...makePendingSession("1.00"), provider: "adjoe", externalId: "adjoe_adj-1" };
    storageMocks.findPendingRewardSession.mockResolvedValue(session);

    const res = await request(app)
      .post("/api/offerwalls/webhook/adjoe")
      .query({ secret: SECRETS.ADJOE_WEBHOOK_SECRET })
      .send({ offer_id: "adj-1", user_id: "user-20", status: "completed", amount: 8.00 });

    expect(res.status).toBe(200);
    expect(storageMocks.completeRewardSessionAndCredit).toHaveBeenCalledOnce();
    const call = storageMocks.completeRewardSessionAndCredit.mock.calls[0]![0];
    expect(call.finalReward).toBe(8.00);
  });

  it("falls back to session.expectedReward when no reward field is present", async () => {
    const session = { ...makePendingSession("4.00"), provider: "adjoe", externalId: "adjoe_adj-2" };
    storageMocks.findPendingRewardSession.mockResolvedValue(session);

    const res = await request(app)
      .post("/api/offerwalls/webhook/adjoe")
      .query({ secret: SECRETS.ADJOE_WEBHOOK_SECRET })
      .send({ offer_id: "adj-2", user_id: "user-21", status: "completed" });

    expect(res.status).toBe(200);
    const call = storageMocks.completeRewardSessionAndCredit.mock.calls[0]![0];
    expect(call.finalReward).toBe(4.00);
  });

  it("clamps a reward exceeding the Adjoe max", async () => {
    const session = { ...makePendingSession("1.00"), provider: "adjoe", externalId: "adjoe_adj-3" };
    storageMocks.findPendingRewardSession.mockResolvedValue(session);

    const res = await request(app)
      .post("/api/offerwalls/webhook/adjoe")
      .query({ secret: SECRETS.ADJOE_WEBHOOK_SECRET })
      .send({ offer_id: "adj-3", user_id: "user-22", status: "completed", payout: 1000 });

    expect(res.status).toBe(200);
    const call = storageMocks.completeRewardSessionAndCredit.mock.calls[0]![0];
    expect(call.finalReward).toBe(RANGES.adjoe.max);
  });
});

// ===========================================================================
// OfferToro — reward-present and reward-absent cases
// ===========================================================================
describe("OfferToro webhook — reward propagation", () => {
  it("extracts the payout field and uses it as the final reward", async () => {
    const session = { ...makePendingSession("1.50"), provider: "offertoro", externalId: "offertoro_ot-1" };
    storageMocks.findPendingRewardSession.mockResolvedValue(session);

    const body = offertoroBody("ot-1", "user-30", "6.00");
    const res = await request(app)
      .post("/api/offerwalls/webhook/offertoro")
      .send(body);

    expect(res.status).toBe(200);
    expect(storageMocks.completeRewardSessionAndCredit).toHaveBeenCalledOnce();
    const call = storageMocks.completeRewardSessionAndCredit.mock.calls[0]![0];
    expect(call.finalReward).toBe(6.00);
  });

  it("falls back to session.expectedReward when no payout field is present", async () => {
    const session = { ...makePendingSession("2.50"), provider: "offertoro", externalId: "offertoro_ot-2" };
    storageMocks.findPendingRewardSession.mockResolvedValue(session);

    const offer_id = "ot-2";
    const user_id = "user-31";
    const payout = "";
    const ot_sig = md5(`${offer_id}${user_id}${payout}${SECRETS.OFFERTORO_WEBHOOK_SECRET}`);
    const body = { offer_id, user_id, ot_sig };

    const res = await request(app)
      .post("/api/offerwalls/webhook/offertoro")
      .send(body);

    expect(res.status).toBe(200);
    expect(storageMocks.completeRewardSessionAndCredit).toHaveBeenCalledOnce();
    const call = storageMocks.completeRewardSessionAndCredit.mock.calls[0]![0];
    expect(call.finalReward).toBe(2.50);
  });
});

// ===========================================================================
// Tapjoy — always falls back to session.expectedReward (currency is virtual)
// ===========================================================================
describe("Tapjoy webhook — always falls back to session.expectedReward", () => {
  it("uses session.expectedReward regardless of the currency query param", async () => {
    const session = { ...makePendingSession("5.00"), provider: "tapjoy", externalId: "tapjoy_tj-1" };
    storageMocks.findPendingRewardSession.mockResolvedValue(session);

    const id = "tj-1";
    const snuid = "user-40";
    const currency = "99999";
    const verifier = md5(`${id}:${snuid}:${currency}:${SECRETS.TAPJOY_WEBHOOK_SECRET}`);

    const res = await request(app)
      .get("/api/offerwalls/webhook/tapjoy")
      .query({ id, snuid, currency, verifier });

    expect(res.status).toBe(200);
    expect(storageMocks.completeRewardSessionAndCredit).toHaveBeenCalledOnce();
    const call = storageMocks.completeRewardSessionAndCredit.mock.calls[0]![0];
    expect(call.finalReward).toBe(5.00);
  });
});
