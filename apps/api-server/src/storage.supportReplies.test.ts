/**
 * Unit tests for the support-reply persistence layer on DatabaseStorage:
 *   - createSupportReply           → inserts a row into the support_replies table
 *   - getSupportRepliesByThread    → reads a thread's prior replies, oldest-first
 *
 * These prove the storage contract the /sc-portal Inbox relies on: a sent reply
 * is durably saved with the right fields, and the history lookup filters by the
 * original message's Message-ID (in_reply_to) and returns the joined admin
 * attribution mapped into a SupportReplyView.
 *
 * @workspace/db is mocked with an in-memory capture so the suite runs without a
 * real database. The captured insert payload is the exact object handed to
 * Drizzle, so asserting on its shape is equivalent to asserting on what lands in
 * the table. The select chain is fully stubbed and returns a configurable row
 * set, so getSupportRepliesByThread's mapping/ordering is exercised directly.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

interface CapturedInsert {
  table: unknown;
  values: Record<string, unknown>;
}

interface CapturedSelect {
  columns: unknown;
  from?: unknown;
  join?: unknown;
  where?: unknown;
  orderBy?: unknown;
}

let inserts: CapturedInsert[];
let selects: CapturedSelect[];
// Rows the mocked select chain resolves to (raw DB rows, pre-mapping).
let selectRows: Record<string, unknown>[];

vi.mock("@workspace/db", () => {
  return {
    db: {
      insert: (table: unknown) => ({
        values: (values: Record<string, unknown>) => ({
          returning: async () => {
            inserts.push({ table, values });
            // Mimic Drizzle .returning(): echo back the row with DB-filled
            // defaults (id + createdAt) so createSupportReply can destructure.
            return [
              {
                id: "generated-id",
                createdAt: new Date("2026-06-04T00:00:00Z"),
                inReplyTo: null,
                ...values,
              },
            ];
          },
        }),
      }),
      select: (columns: unknown) => {
        const captured: CapturedSelect = { columns };
        selects.push(captured);
        const builder = {
          from: (t: unknown) => {
            captured.from = t;
            return builder;
          },
          leftJoin: (t: unknown, on: unknown) => {
            captured.join = { t, on };
            return builder;
          },
          where: (cond: unknown) => {
            captured.where = cond;
            return builder;
          },
          orderBy: async (col: unknown) => {
            captured.orderBy = col;
            return selectRows;
          },
        };
        return builder;
      },
    },
    // Table identity markers with column sentinels. storage.ts imports the
    // real drizzle helpers (eq/orderBy) from "drizzle-orm", so the where/order
    // expressions are built from these column objects; we expose distinct
    // sentinels so the test can assert which column ordering uses.
    supportReplies: SUPPORT_REPLIES,
    users: USERS,
  };
});

// Hoisted so the mock factory (also hoisted) can reference them.
const SUPPORT_REPLIES = {
  id: { col: "support_replies.id" },
  adminUserId: { col: "support_replies.admin_user_id" },
  recipient: { col: "support_replies.recipient" },
  subject: { col: "support_replies.subject" },
  body: { col: "support_replies.body" },
  inReplyTo: { col: "support_replies.in_reply_to" },
  createdAt: { col: "support_replies.created_at" },
} as const;
const USERS = {
  id: { col: "users.id" },
  username: { col: "users.username" },
  email: { col: "users.email" },
} as const;

let DatabaseStorage: typeof import("./storage").DatabaseStorage;

beforeEach(async () => {
  inserts = [];
  selects = [];
  selectRows = [];
  vi.resetModules();
  const mod = await import("./storage");
  DatabaseStorage = mod.DatabaseStorage;
});

describe("DatabaseStorage.createSupportReply", () => {
  it("inserts a row into the support_replies table with the sent fields", async () => {
    const store = new DatabaseStorage();
    await store.createSupportReply({
      adminUserId: "admin-1",
      recipient: "user@example.com",
      subject: "Re: your message",
      body: "Hello, here is your answer.",
      inReplyTo: "<orig-123@mail>",
    });

    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.table).toBe(SUPPORT_REPLIES);
    expect(inserts[0]!.values).toMatchObject({
      adminUserId: "admin-1",
      recipient: "user@example.com",
      subject: "Re: your message",
      body: "Hello, here is your answer.",
      inReplyTo: "<orig-123@mail>",
    });
  });

  it("round-trips the inserted row back from .returning()", async () => {
    const store = new DatabaseStorage();
    const saved = await store.createSupportReply({
      adminUserId: "admin-7",
      recipient: "someone@example.com",
      subject: "Re: refund",
      body: "Processed.",
      inReplyTo: null,
    });

    expect(saved).toMatchObject({
      id: "generated-id",
      adminUserId: "admin-7",
      recipient: "someone@example.com",
      subject: "Re: refund",
      body: "Processed.",
      inReplyTo: null,
    });
    expect(saved.createdAt).toBeInstanceOf(Date);
  });
});

describe("DatabaseStorage.getSupportRepliesByThread", () => {
  it("returns an empty list without touching the DB when inReplyTo is empty", async () => {
    const store = new DatabaseStorage();
    const result = await store.getSupportRepliesByThread("");

    expect(result).toEqual([]);
    // Short-circuits before issuing any query.
    expect(selects).toHaveLength(0);
  });

  it("filters by the original Message-ID and maps rows into SupportReplyView", async () => {
    selectRows = [
      {
        id: "r1",
        adminUserId: "admin-1",
        adminUsername: "operator",
        adminEmail: "op@absustaininvest.com",
        recipient: "user@example.com",
        subject: "Re: question",
        body: "first reply",
        inReplyTo: "<orig-123@mail>",
        createdAt: new Date("2026-06-01T10:00:00Z"),
      },
    ];

    const store = new DatabaseStorage();
    const result = await store.getSupportRepliesByThread("<orig-123@mail>");

    // A single query was issued, filtered (where) and joined to users for
    // admin attribution.
    expect(selects).toHaveLength(1);
    expect(selects[0]!.where).toBeDefined();
    expect(selects[0]!.join).toBeDefined();

    expect(result).toEqual([
      {
        id: "r1",
        adminUserId: "admin-1",
        adminUsername: "operator",
        adminEmail: "op@absustaininvest.com",
        recipient: "user@example.com",
        subject: "Re: question",
        body: "first reply",
        inReplyTo: "<orig-123@mail>",
        createdAt: new Date("2026-06-01T10:00:00Z"),
      },
    ]);
  });

  it("orders the query oldest-first by createdAt", async () => {
    selectRows = [];
    const store = new DatabaseStorage();
    await store.getSupportRepliesByThread("<orig-xyz@mail>");

    // Ordering is by the createdAt column directly — ascending (oldest-first),
    // i.e. the raw column, not wrapped in a desc() expression.
    expect(selects[0]!.orderBy).toBe(SUPPORT_REPLIES.createdAt);
  });

  it("normalises missing admin attribution and inReplyTo to null", async () => {
    selectRows = [
      {
        id: "r2",
        adminUserId: "admin-2",
        adminUsername: undefined,
        adminEmail: undefined,
        recipient: "user2@example.com",
        subject: "Re: hi",
        body: "second reply",
        inReplyTo: undefined,
        createdAt: new Date("2026-06-02T10:00:00Z"),
      },
    ];

    const store = new DatabaseStorage();
    const result = await store.getSupportRepliesByThread("<orig-456@mail>");

    expect(result[0]).toMatchObject({
      adminUsername: null,
      adminEmail: null,
      inReplyTo: null,
    });
  });

  it("preserves the DB row order (oldest-first) across multiple replies", async () => {
    selectRows = [
      {
        id: "r1",
        adminUserId: "admin-1",
        adminUsername: "a",
        adminEmail: "a@x.com",
        recipient: "u@example.com",
        subject: "Re: t",
        body: "older",
        inReplyTo: "<t@mail>",
        createdAt: new Date("2026-06-01T00:00:00Z"),
      },
      {
        id: "r2",
        adminUserId: "admin-1",
        adminUsername: "a",
        adminEmail: "a@x.com",
        recipient: "u@example.com",
        subject: "Re: t",
        body: "newer",
        inReplyTo: "<t@mail>",
        createdAt: new Date("2026-06-03T00:00:00Z"),
      },
    ];

    const store = new DatabaseStorage();
    const result = await store.getSupportRepliesByThread("<t@mail>");

    expect(result.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(result.map((r) => r.body)).toEqual(["older", "newer"]);
  });
});
