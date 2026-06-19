/**
 * DB-backed integration test for the support-reply duplicate guard.
 *
 * The handler tests in cashclip.inboxReply.test.ts mock lib/dedupe with an
 * in-memory stand-in, and dedupe.test.ts unit-tests reserveDedupeSlot /
 * releaseDedupeSlot in isolation. What neither proves is the two TOGETHER: the
 * real POST /api/admin/inbox/reply handler driving the REAL lib/dedupe SQL
 * against an actual Postgres dedupe_slots table. That combination is what would
 * catch a SQL/schema regression in the ON CONFLICT window-reset or the
 * GREATEST(0, count - 1) release logic — a mock can never surface those.
 *
 * So this suite runs the genuine handler with the genuine lib/dedupe against a
 * throwaway, isolated schema (search_path pinned per pooled connection), the
 * same real-DB pattern as routes/earnings.moneyFlow.test.ts and
 * lib/dedupe.test.ts. Only the mailer (lib/email.sendSupportReply), storage,
 * and the logger are mocked; dedupe + its SQL stay real.
 *
 * Asserts, end to end through the real table:
 *   1. A second identical POST within the window is rejected (409) by the real
 *      dedupe_slots row — exactly one email + one persist across both requests.
 *   2. A failed send releases its slot (GREATEST decrement) so a real retry of
 *      the same reply goes through instead of being blocked as a duplicate.
 *   3. Once the stored window has expired, the next identical POST is treated as
 *      a fresh send (the ON CONFLICT expiry-reset branch), not a duplicate.
 *
 * Requires DATABASE_URL (always set in this environment). The schema is created
 * in beforeAll and dropped in afterAll, so it never touches real app tables.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { randomBytes } from "node:crypto";

const ADMIN_ID = "admin-1";
const JWT_SECRET = "test-jwt-secret-for-inbox-dedupe-db-tests-padded-to-64-chars-aabbccdd";
const SCHEMA = `inbox_dedupe_test_${randomBytes(6).toString("hex")}`;

const mockGetUser = vi.fn();
const mockCreateSupportReply = vi.fn();
const mockGetSupportRepliesByThread = vi.fn();
const mockSendSupportReply = vi.fn();

// storage is mocked: adminMiddleware resolves the acting admin via getUser, and
// createSupportReply is the history write we don't care to exercise here.
vi.mock("../storage", () => ({
  storage: {
    getUser: (...args: unknown[]) => mockGetUser(...args),
    getUserByUsername: vi.fn(),
    createSupportReply: (...args: unknown[]) => mockCreateSupportReply(...args),
    getSupportRepliesByThread: (...args: unknown[]) => mockGetSupportRepliesByThread(...args),
  },
}));

// The login throttle is unrelated to the dedupe guard; keep it inert so it
// never touches the DB during admin auth.
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
  sendSupportReply: (...args: unknown[]) => mockSendSupportReply(...args),
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Minimal shape of the raw pg client we use for DDL/seeding. The derived typing
// of pool.connect() collapses to its callback overload, and `pg` types aren't
// directly resolvable from this package, so we model just what we touch.
interface SqlResult {
  rows: Array<Record<string, any>>;
}
interface SqlClient {
  query(text: string, params?: unknown[]): Promise<SqlResult>;
  release(): void;
}

let app: Express;
let adminToken: string;
let pool: typeof import("@workspace/db").pool;
let admin: SqlClient;

async function slotCount(): Promise<number> {
  const r = await admin.query(`SELECT count(*)::int AS n FROM dedupe_slots`);
  return r.rows[0].n as number;
}

async function onlySlot(): Promise<{ count: number; expires_at: Date }> {
  const r = await admin.query(`SELECT count, expires_at FROM dedupe_slots`);
  expect(r.rows.length).toBe(1);
  return { count: Number(r.rows[0].count), expires_at: r.rows[0].expires_at as Date };
}

beforeAll(async () => {
  process.env["JWT_ACCESS_SECRET"] = JWT_SECRET;
  // Keep the console-token fallback out of the picture so the Bearer path is
  // the only way in.
  delete process.env["ADMIN_TOKEN"];

  const dbMod = await import("@workspace/db");
  pool = dbMod.pool;
  // Pin every pooled connection to our throwaway schema so the real handler's
  // (and lib/dedupe's) unqualified dedupe_slots queries resolve there, never to
  // the live table.
  pool.on("connect", (c) => {
    c.query(`SET search_path TO ${SCHEMA}, pg_catalog`);
  });

  admin = (await pool.connect()) as unknown as SqlClient;
  await admin.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  await admin.query(`SET search_path TO ${SCHEMA}, pg_catalog`);

  // Mirror lib/db/src/schema/dedupeSlots.ts.
  await admin.query(`
    CREATE TABLE dedupe_slots (
      key text PRIMARY KEY,
      count integer NOT NULL DEFAULT 1,
      first_seen timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  adminToken = jwt.sign({ userId: ADMIN_ID, role: "admin", tokenVersion: 0 }, JWT_SECRET, {
    expiresIn: "1h",
  });

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
  await admin.query(`TRUNCATE dedupe_slots`);
  mockGetUser.mockResolvedValue({ id: ADMIN_ID, role: "admin", tokenVersion: 0 });
  mockSendSupportReply.mockResolvedValue(undefined);
  mockCreateSupportReply.mockResolvedValue({ id: "reply-1" });
});

function asAdmin(req: request.Test): request.Test {
  return req.set("Authorization", `Bearer ${adminToken}`);
}

const reply = {
  to: "user@example.com",
  subject: "Re: your message",
  body: "Here is the answer.",
  inReplyTo: "<orig-1@mail>",
};

describe("POST /api/admin/inbox/reply — duplicate guard against the REAL dedupe_slots table", () => {
  it("concurrent identical POSTs: exactly one 200 + one 409, one email, one persist", async () => {
    // Fire both requests at the exact same instant. The real INSERT ... ON CONFLICT
    // is atomic at the Postgres level, so exactly one reservation wins count=1
    // (duplicate=false → 200) and the other loses count=2 (duplicate=true → 409).
    const [a, b] = await Promise.all([
      asAdmin(request(app).post("/api/admin/inbox/reply").send(reply)),
      asAdmin(request(app).post("/api/admin/inbox/reply").send(reply)),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);

    const winner = a.status === 200 ? a : b;
    const loser = a.status === 409 ? a : b;
    expect(winner.body.ok).toBe(true);
    expect(loser.body.duplicate).toBe(true);

    // The real table must have exactly one slot row at count 2 (one winner + one
    // duplicate bump) — never two separate rows, never count 3+.
    expect(await slotCount()).toBe(1);
    expect((await onlySlot()).count).toBe(2);

    // Only one email was sent and only one reply was persisted to history.
    expect(mockSendSupportReply).toHaveBeenCalledTimes(1);
    expect(mockCreateSupportReply).toHaveBeenCalledTimes(1);
  });

  it("rejects a second identical POST within the window via the real table (one email, one persist)", async () => {
    const first = await asAdmin(request(app).post("/api/admin/inbox/reply").send(reply));
    expect(first.status).toBe(200);
    expect(first.body.ok).toBe(true);

    // The real reserveDedupeSlot SQL wrote exactly one slot at count 1.
    expect(await slotCount()).toBe(1);
    expect((await onlySlot()).count).toBe(1);

    const second = await asAdmin(request(app).post("/api/admin/inbox/reply").send(reply));
    expect(second.status).toBe(409);
    expect(second.body.duplicate).toBe(true);

    // The real ON CONFLICT branch incremented the same slot to 2 (a duplicate),
    // and the duplicate was fully suppressed — exactly one email + one persist.
    expect((await onlySlot()).count).toBe(2);
    expect(mockSendSupportReply).toHaveBeenCalledTimes(1);
    expect(mockCreateSupportReply).toHaveBeenCalledTimes(1);
  });

  it("releases the real slot on a failed send so a genuine retry goes through", async () => {
    // First attempt: SMTP fails. The handler releases the reserved slot via the
    // real GREATEST(0, count - 1) UPDATE so the operator is not locked out.
    mockSendSupportReply.mockRejectedValueOnce(new Error("smtp timeout"));
    const failed = await asAdmin(request(app).post("/api/admin/inbox/reply").send(reply));
    expect(failed.status).toBe(500);
    expect(mockCreateSupportReply).not.toHaveBeenCalled();

    // The slot row still exists but its occupancy was decremented back to 0 by
    // the real release SQL (the window itself has NOT expired).
    expect((await onlySlot()).count).toBe(0);

    // Retry of the SAME reply now succeeds — the real reserve increments 0 -> 1,
    // which is not a duplicate, so it is not blocked.
    const retry = await asAdmin(request(app).post("/api/admin/inbox/reply").send(reply));
    expect(retry.status).toBe(200);
    expect(retry.body.ok).toBe(true);
    expect((await onlySlot()).count).toBe(1);

    expect(mockSendSupportReply).toHaveBeenCalledTimes(2);
    expect(mockCreateSupportReply).toHaveBeenCalledTimes(1);
  });

  it("treats an identical POST as a fresh send once the stored window has expired", async () => {
    const first = await asAdmin(request(app).post("/api/admin/inbox/reply").send(reply));
    expect(first.status).toBe(200);
    expect((await onlySlot()).count).toBe(1);

    // Force the stored window into the past — the handler hardcodes a 30s window,
    // so expiring the row in SQL exercises the real ON CONFLICT expiry-reset
    // branch without waiting out the clock.
    await admin.query(`UPDATE dedupe_slots SET expires_at = NOW() - INTERVAL '1 second'`);

    // The same reply now sends again: the real reserve resets the expired slot
    // to count 1 (duplicate=false), so the second email goes out.
    const second = await asAdmin(request(app).post("/api/admin/inbox/reply").send(reply));
    expect(second.status).toBe(200);
    expect(second.body.ok).toBe(true);

    // Reset, not increment: a 6th-attempt bug would show count > 1 here.
    expect((await onlySlot()).count).toBe(1);
    expect(mockSendSupportReply).toHaveBeenCalledTimes(2);
    expect(mockCreateSupportReply).toHaveBeenCalledTimes(2);
  });
});
