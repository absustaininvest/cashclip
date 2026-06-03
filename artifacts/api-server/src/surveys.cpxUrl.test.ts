import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Hoisted mocks — infrastructure only; surveyProviders is NOT mocked so the
// real buildCpxWallUrl / cpxWallCard logic runs and we catch any URL regression.
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

const TEST_CPX_API_KEY = "test-cpx-api-key";
const TEST_CPX_APP_ID = "test-cpx-app-id";
const TEST_USER_ID = "test-user-id";

function md5hex(input: string): string {
  return crypto.createHash("md5").update(input).digest("hex");
}

function stubCpxEnv(): void {
  vi.stubEnv("CPX_API_KEY", TEST_CPX_API_KEY);
  vi.stubEnv("CPX_APP_ID", TEST_CPX_APP_ID);
}

function stubCpxFetchEmpty(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ surveys: [] }),
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
// Helpers for extracting the CPX wall card from the route response
// ---------------------------------------------------------------------------

async function getCpxSurvey(): Promise<{ surveyUrl: string; provider: string } | undefined> {
  const res = await request(app).get("/api/surveys/available");
  expect(res.status).toBe(200);
  return (res.body.surveys as any[] | undefined)?.find((s: any) => s.provider === "cpx");
}

// ---------------------------------------------------------------------------
// Tests — CPX wall URL origin, required params, hash correctness
// ---------------------------------------------------------------------------

describe("GET /api/surveys/available — CPX wall card surveyUrl", () => {
  it("returns a CPX wall card when CPX is configured and the live-survey API returns no results", async () => {
    stubCpxEnv();
    stubCpxFetchEmpty();

    const cpx = await getCpxSurvey();
    expect(cpx).toBeDefined();
  });

  it("surveyUrl starts with the correct CPX offers origin", async () => {
    stubCpxEnv();
    stubCpxFetchEmpty();

    const cpx = await getCpxSurvey();
    expect(cpx!.surveyUrl).toMatch(/^https:\/\/offers\.cpx-research\.com\/index\.php/);
  });

  it("surveyUrl contains the correct app_id", async () => {
    stubCpxEnv();
    stubCpxFetchEmpty();

    const cpx = await getCpxSurvey();
    const url = new URL(cpx!.surveyUrl);
    expect(url.searchParams.get("app_id")).toBe(TEST_CPX_APP_ID);
  });

  it("surveyUrl contains the correct ext_user_id", async () => {
    stubCpxEnv();
    stubCpxFetchEmpty();

    const cpx = await getCpxSurvey();
    const url = new URL(cpx!.surveyUrl);
    expect(url.searchParams.get("ext_user_id")).toBe(TEST_USER_ID);
  });

  it("surveyUrl contains a 32-character hex secure_hash", async () => {
    stubCpxEnv();
    stubCpxFetchEmpty();

    const cpx = await getCpxSurvey();
    const url = new URL(cpx!.surveyUrl);
    expect(url.searchParams.get("secure_hash")).toMatch(/^[0-9a-f]{32}$/);
  });

  it("secure_hash equals MD5(userId-apiKey)", async () => {
    stubCpxEnv();
    stubCpxFetchEmpty();

    const cpx = await getCpxSurvey();
    const url = new URL(cpx!.surveyUrl);
    const secureHash = url.searchParams.get("secure_hash");
    expect(secureHash).toBe(md5hex(`${TEST_USER_ID}-${TEST_CPX_API_KEY}`));
  });

  it("falls back to the wall card with a valid surveyUrl when the CPX API returns HTTP 5xx", async () => {
    stubCpxEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500 })
    );

    const cpx = await getCpxSurvey();
    expect(cpx).toBeDefined();
    expect(cpx!.surveyUrl).toMatch(/^https:\/\/offers\.cpx-research\.com\/index\.php/);
    const url = new URL(cpx!.surveyUrl);
    expect(url.searchParams.get("app_id")).toBe(TEST_CPX_APP_ID);
    expect(url.searchParams.get("ext_user_id")).toBe(TEST_USER_ID);
  });

  it("falls back to the wall card with a valid surveyUrl when the CPX API throws a network error", async () => {
    stubCpxEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network unavailable"))
    );

    const cpx = await getCpxSurvey();
    expect(cpx).toBeDefined();
    expect(cpx!.surveyUrl).toMatch(/^https:\/\/offers\.cpx-research\.com\/index\.php/);
    const url = new URL(cpx!.surveyUrl);
    expect(url.searchParams.get("app_id")).toBe(TEST_CPX_APP_ID);
    expect(url.searchParams.get("ext_user_id")).toBe(TEST_USER_ID);
  });

  it("returns no CPX card when CPX_APP_ID is not configured", async () => {
    vi.stubEnv("CPX_API_KEY", TEST_CPX_API_KEY);
    vi.stubEnv("CPX_APP_ID", "");

    const res = await request(app).get("/api/surveys/available");
    expect(res.status).toBe(200);
    const cpx = (res.body.surveys as any[] | undefined)?.find((s: any) => s.provider === "cpx");
    expect(cpx).toBeUndefined();
  });

  it("returns no CPX card when CPX_API_KEY is not configured", async () => {
    vi.stubEnv("CPX_API_KEY", "");
    vi.stubEnv("CPX_APP_ID", TEST_CPX_APP_ID);

    const res = await request(app).get("/api/surveys/available");
    expect(res.status).toBe(200);
    const cpx = (res.body.surveys as any[] | undefined)?.find((s: any) => s.provider === "cpx");
    expect(cpx).toBeUndefined();
  });
});
