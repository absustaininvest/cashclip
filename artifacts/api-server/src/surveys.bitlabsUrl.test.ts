import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted mocks — infrastructure only; surveyProviders is NOT mocked so the
// real fetchBitlabsSurveys / sanitizeSurveyUrl logic runs and we catch any
// URL regression.
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

vi.mock("./storage", () => ({ storage: storageMocks }));

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
// Constants and helpers
// ---------------------------------------------------------------------------

const TEST_BITLABS_API_KEY = "test-bitlabs-api-key-abc123";
const TEST_USER_ID = "test-user-id";

function makeBitlabsSurvey(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "survey-001",
    title: "Test Survey",
    description: "A test survey for unit testing.",
    value: 0.75,
    loi: 8,
    category: { name: "Finance" },
    link: "https://app.bitlabs.ai/survey?uid=test-user-id&survey=survey-001",
    ...overrides,
  };
}

function stubBitlabsEnv(): void {
  vi.stubEnv("BITLABS_API_KEY", TEST_BITLABS_API_KEY);
}

function stubBitlabsFetch(surveys: unknown[]): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { surveys } }),
    })
  );
}

// ---------------------------------------------------------------------------
// App setup — real surveyProviders, real route handler
// ---------------------------------------------------------------------------

let app: Express;

beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
  process.env.JWT_ACCESS_SECRET ??=
    "test-jwt-secret-padded-to-meet-minimum-64-character-length-requirement";

  const { registerSurveyRoutes } = await import("./surveys");
  app = express();
  app.use(express.json());
  registerSurveyRoutes(app);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helper — extract BitLabs surveys from the route response
// ---------------------------------------------------------------------------

async function getBitlabsSurveys(): Promise<Array<{ surveyUrl: string; provider: string }>> {
  const res = await request(app).get("/api/surveys/available");
  expect(res.status).toBe(200);
  return (res.body.surveys as any[] | undefined)?.filter((s: any) => s.provider === "bitlabs") ?? [];
}

// ---------------------------------------------------------------------------
// Tests — BitLabs survey URL validity and sanitization
// ---------------------------------------------------------------------------

describe("GET /api/surveys/available — BitLabs surveyUrl", () => {
  it("returns BitLabs surveys when BITLABS_API_KEY is configured", async () => {
    stubBitlabsEnv();
    stubBitlabsFetch([makeBitlabsSurvey()]);

    const surveys = await getBitlabsSurveys();
    expect(surveys.length).toBeGreaterThan(0);
  });

  it("every returned BitLabs survey has a non-empty surveyUrl", async () => {
    stubBitlabsEnv();
    stubBitlabsFetch([makeBitlabsSurvey(), makeBitlabsSurvey({ id: "survey-002", link: "https://app.bitlabs.ai/survey?uid=test-user-id&survey=survey-002" })]);

    const surveys = await getBitlabsSurveys();
    expect(surveys.length).toBeGreaterThan(0);
    for (const s of surveys) {
      expect(s.surveyUrl).toBeTruthy();
    }
  });

  it("every returned BitLabs surveyUrl is a valid URL", async () => {
    stubBitlabsEnv();
    stubBitlabsFetch([makeBitlabsSurvey(), makeBitlabsSurvey({ id: "survey-002", link: "https://app.bitlabs.ai/survey?uid=test-user-id&survey=survey-002" })]);

    const surveys = await getBitlabsSurveys();
    expect(surveys.length).toBeGreaterThan(0);
    for (const s of surveys) {
      expect(() => new URL(s.surveyUrl)).not.toThrow();
    }
  });

  it("surveyUrl does not contain the API key when key appears as a query param", async () => {
    stubBitlabsEnv();
    const linkWithKey = `https://app.bitlabs.ai/survey?api_key=${TEST_BITLABS_API_KEY}&uid=test-user-id&survey=survey-001`;
    stubBitlabsFetch([makeBitlabsSurvey({ link: linkWithKey })]);

    const surveys = await getBitlabsSurveys();
    expect(surveys.length).toBeGreaterThan(0);
    for (const s of surveys) {
      expect(s.surveyUrl).not.toContain(TEST_BITLABS_API_KEY);
    }
  });

  it("surveyUrl does not contain the API key when key appears as a path segment", async () => {
    stubBitlabsEnv();
    const linkWithKey = `https://app.bitlabs.ai/survey/${TEST_BITLABS_API_KEY}/take?uid=test-user-id`;
    stubBitlabsFetch([makeBitlabsSurvey({ link: linkWithKey })]);

    const surveys = await getBitlabsSurveys();
    expect(surveys.length).toBeGreaterThan(0);
    for (const s of surveys) {
      expect(s.surveyUrl).not.toContain(TEST_BITLABS_API_KEY);
    }
  });

  it("prefers the link field over click_url when both are present", async () => {
    stubBitlabsEnv();
    const survey = makeBitlabsSurvey({
      link: "https://app.bitlabs.ai/link-field?uid=test-user-id",
      click_url: "https://app.bitlabs.ai/click-url-field?uid=test-user-id",
    });
    stubBitlabsFetch([survey]);

    const surveys = await getBitlabsSurveys();
    expect(surveys.length).toBeGreaterThan(0);
    expect(surveys[0].surveyUrl).toContain("link-field");
    expect(surveys[0].surveyUrl).not.toContain("click-url-field");
  });

  it("falls back to click_url when link is absent", async () => {
    stubBitlabsEnv();
    const survey = makeBitlabsSurvey({ link: undefined, click_url: "https://app.bitlabs.ai/click-url-only?uid=test-user-id" });
    stubBitlabsFetch([survey]);

    const surveys = await getBitlabsSurveys();
    expect(surveys.length).toBeGreaterThan(0);
    expect(surveys[0].surveyUrl).toContain("click-url-only");
  });

  it("returns no BitLabs surveys when the API responds with an empty list", async () => {
    stubBitlabsEnv();
    stubBitlabsFetch([]);

    const surveys = await getBitlabsSurveys();
    expect(surveys).toHaveLength(0);
  });

  it("returns no BitLabs surveys when BITLABS_API_KEY is not configured", async () => {
    vi.stubEnv("BITLABS_API_KEY", "");

    const surveys = await getBitlabsSurveys();
    expect(surveys).toHaveLength(0);
  });

  it("returns no BitLabs surveys when the BitLabs API returns HTTP 5xx", async () => {
    stubBitlabsEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500 })
    );

    const surveys = await getBitlabsSurveys();
    expect(surveys).toHaveLength(0);
  });

  it("returns no BitLabs surveys when the BitLabs API throws a network error", async () => {
    stubBitlabsEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network unavailable"))
    );

    const surveys = await getBitlabsSurveys();
    expect(surveys).toHaveLength(0);
  });

  it("accepts the alternative top-level surveys response shape", async () => {
    stubBitlabsEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ surveys: [makeBitlabsSurvey()] }),
      })
    );

    const surveys = await getBitlabsSurveys();
    expect(surveys.length).toBeGreaterThan(0);
    expect(() => new URL(surveys[0].surveyUrl)).not.toThrow();
  });
});
