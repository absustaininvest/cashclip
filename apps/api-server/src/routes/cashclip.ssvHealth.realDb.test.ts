/**
 * Real-DB integration tests for GET /api/admin/admob/ssv-health —
 * platform breakdown correctness.
 *
 * Why real-DB: the endpoint runs GROUP BY + GTE window queries on
 * earn_tokens.platform. A mock only proves normalization logic; only a real
 * Postgres run can catch a wrong WHERE boundary or a missing column in the
 * production schema.
 *
 * Pattern (mirrors earnings.moneyFlow.realDb.test.ts):
 *   - A throwaway schema is created in beforeAll and dropped in afterAll.
 *   - DATABASE_URL is patched with search_path before @workspace/db is
 *     imported, so the real pool routes all queries to the throwaway schema.
 *   - Only @workspace/db is kept real; side-effect-heavy modules are mocked
 *     to keep the suite fast and self-contained.
 *
 * Requires DATABASE_URL (always set in this environment). The suite is named
 * *.realDb.test.ts so it runs via `pnpm run test:db` (not the default run
 * which excludes live-DB tests).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { randomBytes } from "node:crypto";

const ADMIN_ID   = "admin-ssv-health-realdb";
const JWT_SECRET = "test-jwt-secret-for-ssv-health-realdb-tests-padded-to-64chars-ok";
const SCHEMA     = `ssv_health_test_${randomBytes(6).toString("hex")}`;

// ---------------------------------------------------------------------------
// Mocks — keep @workspace/db real; silence side-effect-heavy modules
// ---------------------------------------------------------------------------

const mockGetUser = vi.fn();

vi.mock("../storage", () => ({
  storage: {
    getUser: (...a: unknown[]) => mockGetUser(a[0] as string),
    getUserByUsername: vi.fn(),
    creditUser: vi.fn(),
    debitUser: vi.fn(),
    getAdjustmentLedger: vi.fn().mockResolvedValue([]),
    createSupportTicket: vi.fn(),
    listSupportTickets: vi.fn().mockResolvedValue([]),
    getSupportTicket: vi.fn(),
    updateSupportTicketStatus: vi.fn(),
    createSupportReply: vi.fn(),
    listSupportReplies: vi.fn().mockResolvedValue([]),
    listSentReplies: vi.fn().mockResolvedValue([]),
    getWithdrawalRequests: vi.fn().mockResolvedValue([]),
    getUserWithdrawals: vi.fn().mockResolvedValue([]),
    createWithdrawalRequest: vi.fn(),
    updateWithdrawalStatus: vi.fn(),
    listUsers: vi.fn().mockResolvedValue([]),
    deleteUser: vi.fn(),
    banUser: vi.fn(),
    unbanUser: vi.fn(),
    updateUserProfile: vi.fn(),
    getUserByEmail: vi.fn(),
    createPasswordResetToken: vi.fn(),
    getPasswordResetToken: vi.fn(),
    deletePasswordResetToken: vi.fn(),
    updateUserPassword: vi.fn(),
    getEarningsTokensByUser: vi.fn().mockResolvedValue([]),
    updateUserLastSeen: vi.fn(),
    touchUserLastSeen: vi.fn().mockResolvedValue(undefined),
    getOnlineUserCount: vi.fn().mockResolvedValue(0),
    SECURITY_AUDIT_EVENTS: [],
    createSecurityAuditEvent: vi.fn(),
    listSecurityAuditEvents: vi.fn().mockResolvedValue([]),
  },
  SECURITY_AUDIT_EVENTS: [],
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
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

vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: vi.fn().mockResolvedValue({}) })) },
}));

vi.mock("../lib/email", () => ({
  sendWithdrawalRequestedAdmin: vi.fn(),
  sendWithdrawalRequestedUser: vi.fn(),
  sendWithdrawalVelocityAdmin: vi.fn(),
  sendWithdrawalStatusUpdate: vi.fn(),
  sendSupportTicket: vi.fn(),
  sendPasswordChangedNotice: vi.fn(),
  sendAdminCreditReceipt: vi.fn(),
  sendSupportReply: vi.fn(),
  sendReferralBonusEarned: vi.fn(),
  sendPayPalAmbiguousAlert: vi.fn(),
  sendBroadcastEmail: vi.fn(),
}));

// Silence the 30s spin-challenge sweep that fires at module load.
vi.mock("../lib/spinChallengeSweep", () => ({
  runSpinChallengeSweep: vi.fn(async () => 0),
}));

// evaluateSsvAlerts is called inside the ssv-health handler; mock it to avoid
// email side-effects while still exercising every other path in the handler.
vi.mock("../lib/admobAlerts", () => ({
  evaluateSsvAlerts: vi.fn(),
  evaluateAdmobAlerts: vi.fn(),
  getRecentAdmobAlerts: vi.fn().mockReturnValue([]),
  getRecentSsvAlerts: vi.fn().mockReturnValue([]),
  getAdmobAlertConfig: vi.fn().mockReturnValue({ emailRecipient: null, emailEnabled: false }),
  isAdmobMirrorExpectedActive: vi.fn().mockReturnValue(false),
  getSsvMissingUserIdStats: vi.fn().mockReturnValue({ count: 0, lastSeenAt: null }),
}));

vi.mock("../lib/admobReporting", () => ({
  getAdMobConfigState: vi.fn().mockReturnValue({ configured: false }),
  syncAdMobSnapshots: vi.fn(),
}));

vi.mock("../surveys",  () => ({ registerSurveyRoutes: vi.fn() }));
vi.mock("../offerwalls",() => ({ registerOfferwallRoutes: vi.fn() }));
vi.mock("./earnings",  () => ({ registerEarningsRoutes: vi.fn() }));
vi.mock("./ventures",  () => ({ default: express.Router() }));

// ---------------------------------------------------------------------------
// Minimal pg-client interface (pg types aren't a direct dep of api-server)
// ---------------------------------------------------------------------------
interface SqlClient {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  release(): void;
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------
let app: Express;
let pool: Awaited<typeof import("@workspace/db")>["pool"];
let admin: SqlClient;
let adminToken: string;

const MS_1H = 60 * 60 * 1000;
const MS_1D = 24 * MS_1H;

/** Insert a token that looks like an SSV-verified rewarded_ad event. */
async function insertSsvToken(platform: string | null, earnedAt: Date): Promise<void> {
  await admin.query(
    `INSERT INTO earn_tokens
       (user_id, points, action_type, description, earned_at, platform)
     VALUES ($1, 10, 'rewarded_ad', 'SSV verified callback', $2, $3)`,
    [ADMIN_ID, earnedAt, platform],
  );
}

/** Insert a fallback (non-SSV) rewarded_ad token. */
async function insertFallbackToken(platform: string | null, earnedAt: Date): Promise<void> {
  await admin.query(
    `INSERT INTO earn_tokens
       (user_id, points, action_type, description, earned_at, platform)
     VALUES ($1, 10, 'rewarded_ad', 'fallback rewarded_ad completion', $2, $3)`,
    [ADMIN_ID, earnedAt, platform],
  );
}

// ---------------------------------------------------------------------------
// Suite setup
// ---------------------------------------------------------------------------

beforeAll(async () => {
  process.env["JWT_ACCESS_SECRET"] = JWT_SECRET;
  delete process.env["ADMIN_TOKEN"];

  // Inject search_path into DATABASE_URL before @workspace/db is imported so
  // the real pool routes all queries to the throwaway schema.
  const baseUrl = process.env["DATABASE_URL"] ?? "";
  const sep = baseUrl.includes("?") ? "&" : "?";
  process.env["DATABASE_URL"] =
    `${baseUrl}${sep}options=-c%20search_path%3D${SCHEMA}%2Cpg_catalog`;

  adminToken = jwt.sign(
    { userId: ADMIN_ID, role: "admin", tokenVersion: 0 },
    JWT_SECRET,
    { expiresIn: "1h" },
  );

  // Import the REAL @workspace/db (pool now uses the patched DATABASE_URL).
  const dbMod = await import("@workspace/db");
  pool = dbMod.pool;

  admin = (await pool.connect()) as unknown as SqlClient;
  await admin.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  await admin.query(`SET search_path TO ${SCHEMA}, pg_catalog`);

  // Minimal earn_tokens table — columns the ssv-health handler queries.
  // Includes `platform text` which is the column under test.
  await admin.query(`
    CREATE TABLE earn_tokens (
      id                     varchar      PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id                varchar      NOT NULL,
      points                 integer      NOT NULL,
      action_type            text         NOT NULL,
      description            text         NOT NULL DEFAULT '',
      earned_at              timestamptz  NOT NULL DEFAULT now(),
      claimable_at           timestamptz  NOT NULL DEFAULT now(),
      claimed_at             timestamptz,
      status                 text         NOT NULL DEFAULT 'pending',
      transaction_id         varchar      UNIQUE,
      usd_per_point_snapshot numeric(12,8),
      platform               text
    )
  `);

  // Mount the cashclip routes; @workspace/db is real so the ssv-health DB
  // queries run against the throwaway schema.
  const { registerRoutes } = await import("./cashclip");
  app = express();
  app.use(express.json());
  await registerRoutes(app);
}, 30_000);

afterAll(async () => {
  try {
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
      admin.release();
    }
  } finally {
    if (pool) await pool.end();
  }
});

beforeEach(async () => {
  vi.clearAllMocks();
  mockGetUser.mockImplementation(async (id: string) => {
    if (id === ADMIN_ID) return { id, role: "admin", tokenVersion: 0 };
    return null;
  });
  // Start each test with a clean earn_tokens table.
  await admin.query(`DELETE FROM earn_tokens`);
});

function asAdmin(req: request.Test): request.Test {
  return req.set("Authorization", `Bearer ${adminToken}`);
}

// ---------------------------------------------------------------------------
// Access-control
// ---------------------------------------------------------------------------

describe("GET /api/admin/admob/ssv-health — access control", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(app).get("/api/admin/admob/ssv-health");
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Platform breakdown — verified against real SQL
// ---------------------------------------------------------------------------

describe("GET /api/admin/admob/ssv-health — platform breakdown (real DB)", () => {
  it("counts ios and android tokens correctly in the 24h window", async () => {
    const t = new Date(Date.now() - 2 * MS_1H); // 2h ago — inside 24h
    await insertSsvToken("ios",     t);
    await insertSsvToken("ios",     t);
    await insertSsvToken("android", t);

    const res = await asAdmin(request(app).get("/api/admin/admob/ssv-health"));
    expect(res.status).toBe(200);

    const b = res.body.platformBreakdown24h as { platform: string; count: number }[];
    expect(b.find(r => r.platform === "ios")).toEqual({ platform: "ios", count: 2 });
    expect(b.find(r => r.platform === "android")).toEqual({ platform: "android", count: 1 });
  });

  it("tokens between 24h and 7d appear in 7d window but NOT in 24h window", async () => {
    const mid = new Date(Date.now() - 3 * MS_1D); // 3 days ago — inside 7d, outside 24h
    await insertSsvToken("ios",     mid);
    await insertSsvToken("android", mid);
    await insertSsvToken("android", mid);

    const res = await asAdmin(request(app).get("/api/admin/admob/ssv-health"));
    expect(res.status).toBe(200);

    // 7d window includes the 3-day-old tokens
    const b7 = res.body.platformBreakdown7d as { platform: string; count: number }[];
    expect(b7.find(r => r.platform === "ios")).toEqual({ platform: "ios", count: 1 });
    expect(b7.find(r => r.platform === "android")).toEqual({ platform: "android", count: 2 });

    // 24h window must NOT include the 3-day-old tokens
    const b24 = res.body.platformBreakdown24h as { platform: string; count: number }[];
    expect(b24.find(r => r.platform === "ios")).toBeUndefined();
    expect(b24.find(r => r.platform === "android")).toBeUndefined();
  });

  it("tokens within 24h appear in both 24h and 7d windows", async () => {
    const t = new Date(Date.now() - 6 * MS_1H); // 6h ago — inside both windows
    await insertSsvToken("android", t);
    await insertSsvToken("android", t);

    const res = await asAdmin(request(app).get("/api/admin/admob/ssv-health"));
    expect(res.status).toBe(200);

    const android24 = (res.body.platformBreakdown24h as { platform: string; count: number }[])
      .find(r => r.platform === "android");
    const android7d = (res.body.platformBreakdown7d as { platform: string; count: number }[])
      .find(r => r.platform === "android");

    expect(android24).toEqual({ platform: "android", count: 2 });
    expect(android7d).toEqual({ platform: "android", count: 2 });
  });

  it("excludes tokens older than 7 days from both windows", async () => {
    const old = new Date(Date.now() - 10 * MS_1D); // 10 days ago — outside 7d
    await insertSsvToken("ios",     old);
    await insertSsvToken("android", old);

    const res = await asAdmin(request(app).get("/api/admin/admob/ssv-health"));
    expect(res.status).toBe(200);

    expect(res.body.platformBreakdown24h).toEqual([]);
    expect(res.body.platformBreakdown7d).toEqual([]);
  });

  it("normalises null platform to 'unknown' in both windows", async () => {
    const recent = new Date(Date.now() - 1 * MS_1H); // inside 24h
    const mid    = new Date(Date.now() - 2 * MS_1D); // inside 7d only
    await insertSsvToken(null, recent);
    await insertSsvToken(null, mid);

    const res = await asAdmin(request(app).get("/api/admin/admob/ssv-health"));
    expect(res.status).toBe(200);

    const u24 = (res.body.platformBreakdown24h as { platform: string; count: number }[])
      .find(r => r.platform === "unknown");
    const u7d = (res.body.platformBreakdown7d as { platform: string; count: number }[])
      .find(r => r.platform === "unknown");

    // 24h window: only the 1-hour-old null token
    expect(u24).toEqual({ platform: "unknown", count: 1 });
    // 7d window: both null tokens
    expect(u7d).toEqual({ platform: "unknown", count: 2 });
  });

  it("collapses unrecognised non-null platforms to 'unknown'", async () => {
    const t = new Date(Date.now() - 30 * 60 * 1000); // 30 min ago
    await insertSsvToken("web",   t);
    await insertSsvToken("tv",    t);
    await insertSsvToken("other", t);

    const res = await asAdmin(request(app).get("/api/admin/admob/ssv-health"));
    expect(res.status).toBe(200);

    const b = res.body.platformBreakdown24h as { platform: string; count: number }[];
    // All three non-standard platforms collapse into a single 'unknown' bucket
    expect(b.find(r => r.platform === "unknown")).toEqual({ platform: "unknown", count: 3 });
    // No raw platform name survives outside ios/android/unknown
    const leftover = b.filter(r => !["ios", "android", "unknown"].includes(r.platform));
    expect(leftover).toHaveLength(0);
  });

  it("merges null and unrecognised platforms into a single 'unknown' bucket", async () => {
    const t = new Date(Date.now() - 1 * MS_1H);
    await insertSsvToken(null,    t); // null → unknown
    await insertSsvToken("web",   t); // unrecognised → unknown
    await insertSsvToken("ios",   t); // known — stays as ios

    const res = await asAdmin(request(app).get("/api/admin/admob/ssv-health"));
    expect(res.status).toBe(200);

    const b = res.body.platformBreakdown24h as { platform: string; count: number }[];
    expect(b.find(r => r.platform === "unknown")).toEqual({ platform: "unknown", count: 2 });
    expect(b.find(r => r.platform === "ios")).toEqual({ platform: "ios", count: 1 });
  });

  it("only counts SSV-verified tokens (description LIKE '%SSV verified%') in the breakdown", async () => {
    const t = new Date(Date.now() - 1 * MS_1H);
    await insertSsvToken("ios",       t); // SSV — counted in breakdown
    await insertFallbackToken("android", t); // fallback — NOT counted in breakdown

    const res = await asAdmin(request(app).get("/api/admin/admob/ssv-health"));
    expect(res.status).toBe(200);

    const b = res.body.platformBreakdown24h as { platform: string; count: number }[];
    // Only the SSV token appears in the platform breakdown
    expect(b.find(r => r.platform === "ios")).toEqual({ platform: "ios", count: 1 });
    expect(b.find(r => r.platform === "android")).toBeUndefined();

    // The totals reflect all rewarded_ad tokens (SSV + fallback)
    expect(res.body.ssvToday).toBe(1);
    expect(res.body.totalToday).toBe(2);
    expect(res.body.fallbackToday).toBe(1);
  });

  it("returns the expected top-level response shape with no tokens", async () => {
    const res = await asAdmin(request(app).get("/api/admin/admob/ssv-health"));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ssvToday:             0,
      fallbackToday:        0,
      totalToday:           0,
      lastSsvAt:            null,
      staleAlert:           false,
      platformBreakdown24h: [],
      platformBreakdown7d:  [],
      fetchedAt:            expect.any(String),
    });
  });
});
