/**
 * Integration tests: Search & Earn monetized URL — GET /api/earn/search/config
 *
 * Verifies that:
 *  1. When SEARCH_PUBLISHER_CODE is set the response includes the Yahoo
 *     OneSearch monetized base URL with all required attribution params
 *     (fr= publisher tag, fr2=, type=).
 *  2. When the env var is absent the response falls back to plain Yahoo search
 *     and configured=false.
 *  3. The base URL never includes the user query — the client appends it.
 *  4. POST /api/earn/search/begin returns a 64-char hex challenge token.
 *  5. POST /api/earn/search/complete rejects a missing token (400) and an
 *     unknown token (403) without crediting any points.
 */

import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

const PUBLISHER_CODE = "test-publisher-abc";
const USER_ID        = "user-search-test-1";

// ── @workspace/db mock ────────────────────────────────────────────────────────
// The config endpoint runs a count() query for today's search tokens.
// Return 3 so tests can verify dailyUsed is plumbed through correctly.

vi.mock("@workspace/db", async () => {
  const actual = await vi.importActual<typeof import("@workspace/db")>("@workspace/db");
  const db = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ todayCount: 3 }]),
      }),
    }),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
    update: vi.fn(),
    transaction: vi.fn(),
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  };
  return { ...actual, db };
});

vi.mock("../storage", async () => {
  const { createStorageMock } = await import("../testHelpers/mockStorage");
  return { storage: createStorageMock({}) };
});

vi.mock("../paypal", () => ({
  sendPayPalPayout: vi.fn(),
  isPayPalConfigured: () => false,
  initPayPal: vi.fn(),
}));

vi.mock("../auth", () => ({
  RESERVED_ADMIN_USERNAMES: new Set<string>(),
  registerAuthRoutes: () => {},
  authMiddleware: (req: any, _res: any, next: any) => {
    req.userId = USER_ID;
    next();
  },
  adminMiddleware: async (_req: any, res: any) => {
    res.status(401).json({ error: "No token" });
  },
}));

vi.mock("../lib/dbRateLimit", () => ({
  recordLoginAttempt:        vi.fn().mockResolvedValue({ allowed: true, current: 1 }),
  checkLoginAttempts:        vi.fn().mockResolvedValue({ allowed: true, current: 1 }),
  clearLoginAttempts:        vi.fn().mockResolvedValue(undefined),
  pruneExpiredLoginAttempts: vi.fn().mockResolvedValue(undefined),
  decrementLoginAttempt:     vi.fn().mockResolvedValue(undefined),
}));

// ── App setup ─────────────────────────────────────────────────────────────────

let app: Express;

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = "test-jwt-secret-search-padded-64chars-aabbccddeeff001122334455";
  process.env.JWT_SECRET        = "test-jwt-secret-search-padded-64chars-aabbccddeeff001122334455";
  process.env.DATABASE_URL    ??= "postgres://test:test@127.0.0.1:5432/test";

  const { registerEarningsRoutes } = await import("../routes/earnings");
  app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {}, fatal: () => {}, child: () => req.log };
    next();
  });
  registerEarningsRoutes(app);
});

afterEach(() => {
  delete process.env.SEARCH_PUBLISHER_CODE;
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function getConfig() {
  return request(app).get("/api/earn/search/config");
}

function beginSearch() {
  return request(app).post("/api/earn/search/begin").send({});
}

function completeSearch(challengeToken?: string) {
  return request(app)
    .post("/api/earn/search/complete")
    .send(challengeToken !== undefined ? { challengeToken } : {});
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/earn/search/config", () => {

  describe("with SEARCH_PUBLISHER_CODE configured", () => {
    beforeAll(() => { process.env.SEARCH_PUBLISHER_CODE = PUBLISHER_CODE; });

    it("returns 200", async () => {
      const res = await getConfig();
      expect(res.status).toBe(200);
    });

    it("configured=true when publisher code is set", async () => {
      process.env.SEARCH_PUBLISHER_CODE = PUBLISHER_CODE;
      const res = await getConfig();
      expect(res.body.configured).toBe(true);
    });

    it("searchBaseUrl contains the fr= publisher attribution param", async () => {
      process.env.SEARCH_PUBLISHER_CODE = PUBLISHER_CODE;
      const res = await getConfig();
      const url = new URL(res.body.searchBaseUrl);
      expect(url.searchParams.get("fr")).toBe(PUBLISHER_CODE);
    });

    it("searchBaseUrl contains the fr2= secondary attribution param", async () => {
      process.env.SEARCH_PUBLISHER_CODE = PUBLISHER_CODE;
      const res = await getConfig();
      const url = new URL(res.body.searchBaseUrl);
      expect(url.searchParams.get("fr2")).toBeTruthy();
    });

    it("searchBaseUrl contains the type= partner tag", async () => {
      process.env.SEARCH_PUBLISHER_CODE = PUBLISHER_CODE;
      const res = await getConfig();
      const url = new URL(res.body.searchBaseUrl);
      expect(url.searchParams.get("type")).toBe("cashclip-search");
    });

    it("searchBaseUrl does NOT include a p= query param (client appends it)", async () => {
      process.env.SEARCH_PUBLISHER_CODE = PUBLISHER_CODE;
      const res = await getConfig();
      const url = new URL(res.body.searchBaseUrl);
      expect(url.searchParams.has("p")).toBe(false);
    });

    it("searchBaseUrl points to search.yahoo.com", async () => {
      process.env.SEARCH_PUBLISHER_CODE = PUBLISHER_CODE;
      const res = await getConfig();
      const url = new URL(res.body.searchBaseUrl);
      expect(url.hostname).toBe("search.yahoo.com");
    });

    it("dailyUsed and dailyCap are present in the response", async () => {
      process.env.SEARCH_PUBLISHER_CODE = PUBLISHER_CODE;
      const res = await getConfig();
      expect(typeof res.body.dailyUsed).toBe("number");
      expect(typeof res.body.dailyCap).toBe("number");
    });

    it("dailyUsed reflects the value returned by the DB count", async () => {
      process.env.SEARCH_PUBLISHER_CODE = PUBLISHER_CODE;
      const res = await getConfig();
      expect(res.body.dailyUsed).toBe(3);
    });
  });

  describe("without SEARCH_PUBLISHER_CODE (fallback)", () => {
    it("configured=false when publisher code is absent", async () => {
      delete process.env.SEARCH_PUBLISHER_CODE;
      const res = await getConfig();
      expect(res.body.configured).toBe(false);
    });

    it("searchBaseUrl falls back to plain Yahoo search (no fr= param)", async () => {
      delete process.env.SEARCH_PUBLISHER_CODE;
      const res = await getConfig();
      const url = new URL(res.body.searchBaseUrl);
      expect(url.searchParams.has("fr")).toBe(false);
    });

    it("fallback searchBaseUrl still points to search.yahoo.com", async () => {
      delete process.env.SEARCH_PUBLISHER_CODE;
      const res = await getConfig();
      const url = new URL(res.body.searchBaseUrl);
      expect(url.hostname).toBe("search.yahoo.com");
    });
  });
});

describe("POST /api/earn/search/begin", () => {
  it("returns 201 with a challengeToken", async () => {
    const res = await beginSearch();
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("challengeToken");
  });

  it("challengeToken is a 64-char hex string", async () => {
    const res = await beginSearch();
    expect(res.body.challengeToken).toMatch(/^[a-f0-9]{64}$/);
  });

  it("each call returns a distinct token", async () => {
    const [a, b] = await Promise.all([beginSearch(), beginSearch()]);
    expect(a.body.challengeToken).not.toBe(b.body.challengeToken);
  });
});

describe("POST /api/earn/search/complete", () => {
  it("returns 400 when challengeToken is missing from body", async () => {
    const res = await completeSearch();
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/challengeToken/i);
  });

  it("returns 403 for an unknown challenge token", async () => {
    const res = await completeSearch("a".repeat(64));
    expect(res.status).toBe(403);
  });

  it("returns 403 for a syntactically valid but unissued token", async () => {
    const res = await completeSearch("f".repeat(64));
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/invalid|expired/i);
  });
});
