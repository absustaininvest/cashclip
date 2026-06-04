/**
 * Integration tests for the /sc-portal support Inbox reply + history routes:
 *   - POST /api/admin/inbox/reply    → sends a reply and persists it to history
 *   - GET  /api/admin/inbox/replies  → returns a thread's saved reply history
 *
 * These routes back the durable support-reply audit trail. The key contracts:
 *   1. A successful send writes a support_replies row via createSupportReply.
 *   2. A persistence failure must NOT fail the request — the email already went
 *      out, so the admin must still see ok:true (we only log the persist error).
 *   3. The history route is admin-gated and filters by the original Message-ID
 *      (inReplyTo), delegating to getSupportRepliesByThread.
 *
 * The REAL adminMiddleware from ../auth is used so the auth gate is genuinely
 * exercised: handler-logic tests present a real admin Bearer JWT (signed with
 * the test JWT_ACCESS_SECRET, with storage.getUser returning an admin), while
 * the auth-enforcement tests send no token and expect 401. storage, the mailer,
 * and the DB-backed dedupe counter are mocked so the suite needs no DB or SMTP.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

const ADMIN_ID = "admin-1";
const JWT_SECRET = "test-jwt-secret-for-inbox-reply-tests-padded-to-64-chars-min-aabbccdd";

const mockGetUser = vi.fn();
const mockCreateSupportReply = vi.fn();
const mockGetSupportRepliesByThread = vi.fn();
const mockSendSupportReply = vi.fn();
const mockRecordLoginAttempt = vi.fn();
const mockDecrementLoginAttempt = vi.fn();

vi.mock("../storage", () => ({
  storage: {
    getUser: (...args: unknown[]) => mockGetUser(...args),
    getUserByUsername: vi.fn(),
    createSupportReply: (...args: unknown[]) => mockCreateSupportReply(...args),
    getSupportRepliesByThread: (...args: unknown[]) => mockGetSupportRepliesByThread(...args),
  },
}));

vi.mock("../lib/dbRateLimit", () => ({
  recordLoginAttempt: (...args: unknown[]) => mockRecordLoginAttempt(...args),
  checkLoginAttempts: vi.fn().mockResolvedValue({ count: 0, allowed: true }),
  clearLoginAttempts: vi.fn().mockResolvedValue(undefined),
  decrementLoginAttempt: (...args: unknown[]) => mockDecrementLoginAttempt(...args),
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
  sendSupportReply: (...args: unknown[]) => mockSendSupportReply(...args),
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

let app: Express;
let adminToken: string;

beforeAll(async () => {
  process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";
  process.env["JWT_ACCESS_SECRET"] = JWT_SECRET;
  // Keep the console-token fallback out of the picture so the Bearer path is
  // the only way in; a tokenless request must then 401.
  delete process.env["ADMIN_TOKEN"];

  adminToken = jwt.sign({ userId: ADMIN_ID, role: "admin", tokenVersion: 0 }, JWT_SECRET, {
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
  mockGetUser.mockResolvedValue({ id: ADMIN_ID, role: "admin", tokenVersion: 0 });
  // Defaults: not a duplicate, send + persist succeed.
  mockRecordLoginAttempt.mockResolvedValue({ count: 1, allowed: true });
  mockDecrementLoginAttempt.mockResolvedValue(undefined);
  mockSendSupportReply.mockResolvedValue(undefined);
  mockCreateSupportReply.mockResolvedValue({
    id: "reply-1",
    adminUserId: ADMIN_ID,
    recipient: "user@example.com",
    subject: "Re: your message",
    body: "Here is the answer.",
    inReplyTo: "<orig-1@mail>",
    createdAt: new Date("2026-06-04T00:00:00Z"),
  });
  mockGetSupportRepliesByThread.mockResolvedValue([]);
});

function asAdmin(req: request.Test): request.Test {
  return req.set("Authorization", `Bearer ${adminToken}`);
}

describe("POST /api/admin/inbox/reply — send + persist", () => {
  it("sends the email and persists the reply with the expected fields", async () => {
    const res = await asAdmin(
      request(app).post("/api/admin/inbox/reply").send({
        to: "user@example.com",
        subject: "Re: your message",
        body: "Here is the answer.",
        inReplyTo: "<orig-1@mail>",
      }),
    );

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.reply).toMatchObject({ id: "reply-1" });

    expect(mockSendSupportReply).toHaveBeenCalledTimes(1);
    expect(mockSendSupportReply).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "user@example.com",
        subject: "Re: your message",
        body: "Here is the answer.",
        inReplyTo: "<orig-1@mail>",
      }),
    );

    expect(mockCreateSupportReply).toHaveBeenCalledTimes(1);
    expect(mockCreateSupportReply).toHaveBeenCalledWith(
      expect.objectContaining({
        adminUserId: ADMIN_ID,
        recipient: "user@example.com",
        subject: "Re: your message",
        body: "Here is the answer.",
        inReplyTo: "<orig-1@mail>",
      }),
    );
  });

  it("defaults a blank subject and stores inReplyTo as null when absent", async () => {
    mockCreateSupportReply.mockResolvedValue({ id: "reply-2" });
    const res = await asAdmin(
      request(app).post("/api/admin/inbox/reply").send({
        to: "user@example.com",
        body: "No subject here.",
      }),
    );

    expect(res.status).toBe(200);
    expect(mockSendSupportReply).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "Re: your message" }),
    );
    expect(mockCreateSupportReply).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "Re: your message", inReplyTo: null }),
    );
  });

  it("still returns ok:true when persistence throws (email already went out)", async () => {
    mockCreateSupportReply.mockRejectedValue(new Error("db write failed"));

    const res = await asAdmin(
      request(app).post("/api/admin/inbox/reply").send({
        to: "user@example.com",
        subject: "Re: your message",
        body: "Here is the answer.",
        inReplyTo: "<orig-1@mail>",
      }),
    );

    // The send succeeded, so the request must not fail.
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // reply is null because the persist failed.
    expect(res.body.reply).toBeNull();
    expect(mockSendSupportReply).toHaveBeenCalledTimes(1);
    expect(mockCreateSupportReply).toHaveBeenCalledTimes(1);
  });

  it("does NOT persist when the email send fails (returns 500)", async () => {
    mockSendSupportReply.mockRejectedValue(new Error("smtp down"));

    const res = await asAdmin(
      request(app).post("/api/admin/inbox/reply").send({
        to: "user@example.com",
        subject: "Re: your message",
        body: "Here is the answer.",
      }),
    );

    expect(res.status).toBe(500);
    // No history row should be written for a reply that never sent.
    expect(mockCreateSupportReply).not.toHaveBeenCalled();
    // The reserved dedupe slot is released for a genuine retry.
    expect(mockDecrementLoginAttempt).toHaveBeenCalledTimes(1);
  });

  it("rejects a missing recipient with 400 and never sends or persists", async () => {
    const res = await asAdmin(
      request(app).post("/api/admin/inbox/reply").send({ body: "Hello" }),
    );
    expect(res.status).toBe(400);
    expect(mockSendSupportReply).not.toHaveBeenCalled();
    expect(mockCreateSupportReply).not.toHaveBeenCalled();
  });

  it("rejects an empty body with 400 and never sends or persists", async () => {
    const res = await asAdmin(
      request(app).post("/api/admin/inbox/reply").send({ to: "user@example.com", body: "   " }),
    );
    expect(res.status).toBe(400);
    expect(mockSendSupportReply).not.toHaveBeenCalled();
    expect(mockCreateSupportReply).not.toHaveBeenCalled();
  });

  it("suppresses a duplicate reply (409) without sending or persisting again", async () => {
    mockRecordLoginAttempt.mockResolvedValue({ count: 2, allowed: false });
    const res = await asAdmin(
      request(app).post("/api/admin/inbox/reply").send({
        to: "user@example.com",
        subject: "Re: your message",
        body: "Here is the answer.",
        inReplyTo: "<orig-1@mail>",
      }),
    );

    expect(res.status).toBe(409);
    expect(res.body.duplicate).toBe(true);
    expect(mockSendSupportReply).not.toHaveBeenCalled();
    expect(mockCreateSupportReply).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/inbox/reply — dedupe guard (duplicate replies blocked)", () => {
  // A stateful stand-in for the DB-backed login_attempts counter so two REAL
  // requests drive the actual dedupe branch end to end, instead of us
  // hard-coding the returned count. recordLoginAttempt increments per key and
  // reports allowed = count <= max; decrementLoginAttempt releases a reserved
  // slot as GREATEST(0, count - 1) — mirroring lib/dbRateLimit.ts. This is what
  // lets the suite prove "exactly one email across two identical POSTs" and
  // "the slot is freed for a genuine retry" with the same key the handler uses.
  let counters: Map<string, number>;

  beforeEach(() => {
    counters = new Map<string, number>();
    mockRecordLoginAttempt.mockImplementation(
      async (key: string, max: number, _windowMs: number) => {
        const next = (counters.get(key) ?? 0) + 1;
        counters.set(key, next);
        return { count: next, allowed: next <= max };
      },
    );
    mockDecrementLoginAttempt.mockImplementation(async (key: string) => {
      const current = counters.get(key) ?? 0;
      counters.set(key, Math.max(0, current - 1));
    });
  });

  const reply = {
    to: "user@example.com",
    subject: "Re: your message",
    body: "Here is the answer.",
    inReplyTo: "<orig-1@mail>",
  };

  it("two rapid identical POSTs send exactly one email; the second is 409 duplicate and never calls the mailer", async () => {
    const first = await asAdmin(request(app).post("/api/admin/inbox/reply").send(reply));
    expect(first.status).toBe(200);
    expect(first.body.ok).toBe(true);

    const second = await asAdmin(request(app).post("/api/admin/inbox/reply").send(reply));
    expect(second.status).toBe(409);
    expect(second.body.duplicate).toBe(true);

    // Across BOTH requests: the customer gets exactly one email and exactly one
    // history row — the duplicate is fully suppressed, not just status-flagged.
    expect(mockSendSupportReply).toHaveBeenCalledTimes(1);
    expect(mockCreateSupportReply).toHaveBeenCalledTimes(1);
  });

  it("allows a genuine retry after a failed send (the dedupe slot is released on throw)", async () => {
    // First attempt: SMTP fails. The request 500s and the handler releases the
    // reserved dedupe slot so the operator is not locked out of retrying.
    mockSendSupportReply.mockRejectedValueOnce(new Error("smtp timeout"));
    const failed = await asAdmin(request(app).post("/api/admin/inbox/reply").send(reply));
    expect(failed.status).toBe(500);
    expect(mockDecrementLoginAttempt).toHaveBeenCalledTimes(1);
    expect(mockCreateSupportReply).not.toHaveBeenCalled();

    // Retry of the SAME reply now succeeds — it is NOT blocked as a duplicate,
    // because the slot was freed when the first send threw.
    const retry = await asAdmin(request(app).post("/api/admin/inbox/reply").send(reply));
    expect(retry.status).toBe(200);
    expect(retry.body.ok).toBe(true);

    // One failed + one successful send; exactly one history row (only the send
    // that actually delivered is persisted).
    expect(mockSendSupportReply).toHaveBeenCalledTimes(2);
    expect(mockCreateSupportReply).toHaveBeenCalledTimes(1);
  });

  it("does not block a different reply (different body) sent within the window", async () => {
    const first = await asAdmin(request(app).post("/api/admin/inbox/reply").send(reply));
    expect(first.status).toBe(200);

    const different = await asAdmin(
      request(app)
        .post("/api/admin/inbox/reply")
        .send({ ...reply, body: "A completely different answer." }),
    );
    expect(different.status).toBe(200);
    expect(different.body.ok).toBe(true);

    // Two distinct replies → two sends and two history rows, no 409. The guard
    // keys on body, so a real follow-up message is never mistaken for a dupe.
    expect(mockSendSupportReply).toHaveBeenCalledTimes(2);
    expect(mockCreateSupportReply).toHaveBeenCalledTimes(2);
  });

  it("does not block the same body sent to a different recipient within the window", async () => {
    const first = await asAdmin(request(app).post("/api/admin/inbox/reply").send(reply));
    expect(first.status).toBe(200);

    const otherRecipient = await asAdmin(
      request(app)
        .post("/api/admin/inbox/reply")
        .send({ ...reply, to: "someone-else@example.com" }),
    );
    expect(otherRecipient.status).toBe(200);
    expect(otherRecipient.body.ok).toBe(true);

    // The recipient is part of the dedupe key, so the same canned answer can go
    // out to two different customers back to back.
    expect(mockSendSupportReply).toHaveBeenCalledTimes(2);
    expect(mockCreateSupportReply).toHaveBeenCalledTimes(2);
  });
});

describe("GET /api/admin/inbox/replies — thread history", () => {
  it("returns the thread's replies filtered by inReplyTo", async () => {
    const rows = [
      {
        id: "r1",
        adminUserId: ADMIN_ID,
        adminUsername: "operator",
        adminEmail: "op@absustaininvest.com",
        recipient: "user@example.com",
        subject: "Re: question",
        body: "older",
        inReplyTo: "<orig-1@mail>",
        createdAt: new Date("2026-06-01T00:00:00Z"),
      },
      {
        id: "r2",
        adminUserId: ADMIN_ID,
        adminUsername: "operator",
        adminEmail: "op@absustaininvest.com",
        recipient: "user@example.com",
        subject: "Re: question",
        body: "newer",
        inReplyTo: "<orig-1@mail>",
        createdAt: new Date("2026-06-03T00:00:00Z"),
      },
    ];
    mockGetSupportRepliesByThread.mockResolvedValue(rows);

    const res = await asAdmin(
      request(app).get("/api/admin/inbox/replies").query({ inReplyTo: "<orig-1@mail>" }),
    );

    expect(res.status).toBe(200);
    expect(mockGetSupportRepliesByThread).toHaveBeenCalledTimes(1);
    expect(mockGetSupportRepliesByThread).toHaveBeenCalledWith("<orig-1@mail>");
    expect(res.body.replies).toHaveLength(2);
    expect(res.body.replies.map((r: { id: string }) => r.id)).toEqual(["r1", "r2"]);
  });

  it("returns an empty list and skips the query when inReplyTo is missing", async () => {
    const res = await asAdmin(request(app).get("/api/admin/inbox/replies"));

    expect(res.status).toBe(200);
    expect(res.body.replies).toEqual([]);
    expect(mockGetSupportRepliesByThread).not.toHaveBeenCalled();
  });
});

describe("admin auth enforcement", () => {
  it("rejects an unauthenticated POST /api/admin/inbox/reply with 401", async () => {
    const res = await request(app)
      .post("/api/admin/inbox/reply")
      .send({ to: "user@example.com", body: "Hi" });
    expect(res.status).toBe(401);
    expect(mockSendSupportReply).not.toHaveBeenCalled();
    expect(mockCreateSupportReply).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated GET /api/admin/inbox/replies with 401", async () => {
    const res = await request(app)
      .get("/api/admin/inbox/replies")
      .query({ inReplyTo: "<orig-1@mail>" });
    expect(res.status).toBe(401);
    expect(mockGetSupportRepliesByThread).not.toHaveBeenCalled();
  });
});
