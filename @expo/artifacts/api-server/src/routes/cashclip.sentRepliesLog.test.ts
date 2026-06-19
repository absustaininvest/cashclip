/**
 * Route tests for the global "Sent Replies" audit log:
 *   GET /api/admin/inbox/replies/all
 *
 * This is the standalone, paginated log of every support reply ever sent from
 * the /sc-portal Inbox (across all threads), newest first, with optional
 * recipient (substring) and adminUserId (exact) filters. The route's own job is
 * to: gate on admin auth, parse + sanitise the query (clamp limit to 1..200,
 * floor offset at 0, trim filters and drop blanks), delegate to
 * storage.listSupportReplies, and echo back { replies, total, limit, offset }.
 *
 * The REAL adminMiddleware from ../auth is exercised so the auth gate is genuine
 * (a tokenless request 401s; a non-admin Bearer 403s). storage is mocked so the
 * suite needs no DB — the SQL behaviour of listSupportReplies (ordering,
 * pagination, filtering, clamping) is covered separately against a real Postgres
 * in storage.listSupportReplies.test.ts. Here we assert the route passes the
 * sanitised arguments through and returns the storage result verbatim.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

const ADMIN_ID = "admin-1";
const USER_ID = "user-1";
const JWT_SECRET = "test-jwt-secret-for-sent-replies-log-tests-padded-to-64-chars-aabbccdd";

const mockGetUser = vi.fn();
const mockListSupportReplies = vi.fn();

vi.mock("../storage", () => ({
  storage: {
    getUser: (...args: unknown[]) => mockGetUser(...args),
    getUserByUsername: vi.fn(),
    listSupportReplies: (...args: unknown[]) => mockListSupportReplies(...args),
  },
}));

vi.mock("../lib/dbRateLimit", () => ({
  recordLoginAttempt: vi.fn().mockResolvedValue({ count: 1, allowed: true }),
  checkLoginAttempts: vi.fn().mockResolvedValue({ count: 0, allowed: true }),
  clearLoginAttempts: vi.fn().mockResolvedValue(undefined),
  decrementLoginAttempt: vi.fn().mockResolvedValue(undefined),
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
  sendAdminCreditReceipt: vi.fn(),
  sendSupportReply: vi.fn(),
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

let app: Express;
let adminToken: string;
let userToken: string;

const ROUTE = "/api/admin/inbox/replies/all";

beforeAll(async () => {
  process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";
  process.env["JWT_ACCESS_SECRET"] = JWT_SECRET;
  // Keep the console-token fallback out of the picture so the Bearer path is the
  // only way in; a tokenless request must then 401.
  delete process.env["ADMIN_TOKEN"];

  adminToken = jwt.sign({ userId: ADMIN_ID, role: "admin", tokenVersion: 0 }, JWT_SECRET, {
    expiresIn: "1h",
  });
  userToken = jwt.sign({ userId: USER_ID, role: "user", tokenVersion: 0 }, JWT_SECRET, {
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
  mockGetUser.mockImplementation(async (id: string) => {
    if (id === ADMIN_ID) return { id: ADMIN_ID, role: "admin", tokenVersion: 0 };
    if (id === USER_ID) return { id: USER_ID, role: "user", tokenVersion: 0 };
    return undefined;
  });
  mockListSupportReplies.mockResolvedValue({ replies: [], total: 0 });
});

function asAdmin(req: request.Test): request.Test {
  return req.set("Authorization", `Bearer ${adminToken}`);
}

describe("GET /api/admin/inbox/replies/all — admin auth enforcement", () => {
  it("rejects an unauthenticated request with 401 and never queries storage", async () => {
    const res = await request(app).get(ROUTE);
    expect(res.status).toBe(401);
    expect(mockListSupportReplies).not.toHaveBeenCalled();
  });

  it("rejects a non-admin Bearer token with 403 and never queries storage", async () => {
    const res = await request(app).get(ROUTE).set("Authorization", `Bearer ${userToken}`);
    expect(res.status).toBe(403);
    expect(mockListSupportReplies).not.toHaveBeenCalled();
  });

  it("allows an admin Bearer token", async () => {
    const res = await asAdmin(request(app).get(ROUTE));
    expect(res.status).toBe(200);
    expect(mockListSupportReplies).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/admin/inbox/replies/all — defaults and response shape", () => {
  it("uses limit 50 / offset 0 and no filters by default, echoing storage verbatim", async () => {
    const rows = [
      {
        id: "r2",
        adminUserId: ADMIN_ID,
        adminUsername: "operator",
        adminEmail: "op@absustaininvest.com",
        recipient: "newer@example.com",
        subject: "Re: newer",
        body: "newer body",
        inReplyTo: "<n@mail>",
        createdAt: new Date("2026-06-03T00:00:00Z").toISOString(),
      },
      {
        id: "r1",
        adminUserId: ADMIN_ID,
        adminUsername: "operator",
        adminEmail: "op@absustaininvest.com",
        recipient: "older@example.com",
        subject: "Re: older",
        body: "older body",
        inReplyTo: "<o@mail>",
        createdAt: new Date("2026-06-01T00:00:00Z").toISOString(),
      },
    ];
    mockListSupportReplies.mockResolvedValue({ replies: rows, total: 2 });

    const res = await asAdmin(request(app).get(ROUTE));

    expect(res.status).toBe(200);
    // Newest-first ordering is preserved as storage returns it.
    expect(res.body).toEqual({ replies: rows, total: 2, limit: 50, offset: 0 });
    expect(mockListSupportReplies).toHaveBeenCalledWith({
      limit: 50,
      offset: 0,
      recipient: undefined,
      adminUserId: undefined,
    });
  });
});

describe("GET /api/admin/inbox/replies/all — filters", () => {
  it("passes a trimmed recipient substring filter through to storage", async () => {
    await asAdmin(request(app).get(ROUTE).query({ recipient: "  jane@  " }));
    expect(mockListSupportReplies).toHaveBeenCalledWith(
      expect.objectContaining({ recipient: "jane@", adminUserId: undefined }),
    );
  });

  it("passes a trimmed adminUserId filter through to storage", async () => {
    await asAdmin(request(app).get(ROUTE).query({ adminUserId: "  admin-9  " }));
    expect(mockListSupportReplies).toHaveBeenCalledWith(
      expect.objectContaining({ adminUserId: "admin-9", recipient: undefined }),
    );
  });

  it("passes both filters together when supplied", async () => {
    await asAdmin(
      request(app).get(ROUTE).query({ recipient: "jane@example.com", adminUserId: "admin-9" }),
    );
    expect(mockListSupportReplies).toHaveBeenCalledWith(
      expect.objectContaining({ recipient: "jane@example.com", adminUserId: "admin-9" }),
    );
  });

  it("treats a blank/whitespace filter as absent (undefined, not empty string)", async () => {
    await asAdmin(request(app).get(ROUTE).query({ recipient: "   ", adminUserId: "" }));
    expect(mockListSupportReplies).toHaveBeenCalledWith(
      expect.objectContaining({ recipient: undefined, adminUserId: undefined }),
    );
  });
});

describe("GET /api/admin/inbox/replies/all — pagination + limit clamping", () => {
  it("forwards an explicit in-range limit and offset", async () => {
    const res = await asAdmin(request(app).get(ROUTE).query({ limit: 25, offset: 75 }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ limit: 25, offset: 75 });
    expect(mockListSupportReplies).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 25, offset: 75 }),
    );
  });

  it("clamps a limit above 200 down to 200", async () => {
    const res = await asAdmin(request(app).get(ROUTE).query({ limit: 9999 }));
    expect(res.body.limit).toBe(200);
    expect(mockListSupportReplies).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 200 }),
    );
  });

  it("treats limit 0 as the 50 default (falsy parseInt result falls back, not to 1)", async () => {
    const res = await asAdmin(request(app).get(ROUTE).query({ limit: 0 }));
    expect(res.body.limit).toBe(50);
    expect(mockListSupportReplies).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50 }),
    );
  });

  it("clamps a negative limit up to 1", async () => {
    const res = await asAdmin(request(app).get(ROUTE).query({ limit: -50 }));
    expect(res.body.limit).toBe(1);
    expect(mockListSupportReplies).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 1 }),
    );
  });

  it("falls back to limit 50 when the value is non-numeric", async () => {
    const res = await asAdmin(request(app).get(ROUTE).query({ limit: "abc" }));
    expect(res.body.limit).toBe(50);
    expect(mockListSupportReplies).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50 }),
    );
  });

  it("floors a negative offset at 0", async () => {
    const res = await asAdmin(request(app).get(ROUTE).query({ offset: -10 }));
    expect(res.body.offset).toBe(0);
    expect(mockListSupportReplies).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 0 }),
    );
  });
});

describe("GET /api/admin/inbox/replies/all — error handling", () => {
  it("returns 500 when storage throws", async () => {
    mockListSupportReplies.mockRejectedValue(new Error("db down"));
    const res = await asAdmin(request(app).get(ROUTE));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to load sent replies");
  });
});
