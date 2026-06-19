/**
 * Real-Postgres tests for storage.listSupportReplies — the query behind the
 * global "Sent Replies" audit log (GET /api/admin/inbox/replies/all).
 *
 * The correctness here lives in SQL: a leftJoin to users for the sender's
 * username/email, newest-first ordering, a separate total count that ignores
 * limit/offset, offset/limit pagination, a case-insensitive recipient substring
 * (ILIKE) filter, an exact adminUserId filter, and limit clamping to 1..200. A
 * faked DB would have to re-implement all of that and could get it subtly wrong,
 * so this suite runs the REAL storage method against a REAL database in a
 * throwaway, isolated schema (search_path pinned per pooled connection) created
 * in beforeAll and dropped in afterAll. It never touches the live app tables.
 *
 * Requires DATABASE_URL (always set in this environment).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomBytes } from "node:crypto";

const SCHEMA = `replies_test_${randomBytes(6).toString("hex")}`;

vi.mock("./lib/logger", () => ({
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

let pool: typeof import("@workspace/db").pool;
let admin: SqlClient;
let storage: typeof import("./storage").storage;

// Two admins so the adminUserId filter has something to discriminate.
const ADMIN_A = "admin-a";
const ADMIN_B = "admin-b";

async function seedReply(args: {
  id: string;
  adminUserId: string;
  recipient: string;
  subject?: string;
  body?: string;
  inReplyTo?: string | null;
  createdAt: string;
}): Promise<void> {
  await admin.query(
    `INSERT INTO support_replies
       (id, admin_user_id, recipient, subject, body, in_reply_to, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      args.id,
      args.adminUserId,
      args.recipient,
      args.subject ?? "Re: your message",
      args.body ?? "body",
      args.inReplyTo ?? null,
      args.createdAt,
    ],
  );
}

beforeAll(async () => {
  process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";

  const dbMod = await import("@workspace/db");
  pool = dbMod.pool;
  // Pin every pooled connection to our throwaway schema so the real storage
  // method's unqualified queries (support_replies, users) resolve there, never
  // to the live app tables in `public`.
  pool.on("connect", (c) => {
    c.query(`SET search_path TO ${SCHEMA}, pg_catalog`);
  });

  admin = (await pool.connect()) as unknown as SqlClient;
  await admin.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  await admin.query(`SET search_path TO ${SCHEMA}, pg_catalog`);

  await admin.query(`
    CREATE TABLE users (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      username varchar,
      email varchar
    );
    CREATE TABLE support_replies (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      admin_user_id varchar NOT NULL,
      recipient text NOT NULL,
      subject text NOT NULL,
      body text NOT NULL,
      in_reply_to text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  await admin.query(
    `INSERT INTO users (id, username, email) VALUES
       ($1, 'operator-a', 'a@absustaininvest.com'),
       ($2, 'operator-b', 'b@absustaininvest.com')`,
    [ADMIN_A, ADMIN_B],
  );

  ({ storage } = await import("./storage"));
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

async function clearReplies(): Promise<void> {
  await admin.query(`TRUNCATE support_replies`);
}

describe("listSupportReplies — ordering, count, and the user join", () => {
  it("returns newest-first with the correct total and joins the sending admin", async () => {
    await clearReplies();
    await seedReply({
      id: "r1",
      adminUserId: ADMIN_A,
      recipient: "one@example.com",
      createdAt: "2026-06-01T00:00:00Z",
    });
    await seedReply({
      id: "r2",
      adminUserId: ADMIN_B,
      recipient: "two@example.com",
      createdAt: "2026-06-03T00:00:00Z",
    });
    await seedReply({
      id: "r3",
      adminUserId: ADMIN_A,
      recipient: "three@example.com",
      createdAt: "2026-06-02T00:00:00Z",
    });

    const { replies, total } = await storage.listSupportReplies();

    expect(total).toBe(3);
    expect(replies.map((r) => r.id)).toEqual(["r2", "r3", "r1"]);
    // The leftJoin surfaces the sending admin's username/email.
    const r2 = replies.find((r) => r.id === "r2")!;
    expect(r2.adminUsername).toBe("operator-b");
    expect(r2.adminEmail).toBe("b@absustaininvest.com");
  });

  it("leaves username/email null when the admin row is missing (leftJoin)", async () => {
    await clearReplies();
    await seedReply({
      id: "orphan",
      adminUserId: "admin-gone",
      recipient: "x@example.com",
      createdAt: "2026-06-01T00:00:00Z",
    });

    const { replies } = await storage.listSupportReplies();
    expect(replies).toHaveLength(1);
    expect(replies[0].adminUsername).toBeNull();
    expect(replies[0].adminEmail).toBeNull();
  });
});

describe("listSupportReplies — pagination", () => {
  it("limit + offset return the right newest-first window while total stays full", async () => {
    await clearReplies();
    // 5 replies, increasing timestamps r0..r4 (r4 newest).
    for (let i = 0; i < 5; i++) {
      await seedReply({
        id: `p${i}`,
        adminUserId: ADMIN_A,
        recipient: `p${i}@example.com`,
        createdAt: `2026-06-0${i + 1}T00:00:00Z`,
      });
    }

    const page1 = await storage.listSupportReplies({ limit: 2, offset: 0 });
    expect(page1.total).toBe(5);
    expect(page1.replies.map((r) => r.id)).toEqual(["p4", "p3"]);

    const page2 = await storage.listSupportReplies({ limit: 2, offset: 2 });
    expect(page2.total).toBe(5);
    expect(page2.replies.map((r) => r.id)).toEqual(["p2", "p1"]);

    const page3 = await storage.listSupportReplies({ limit: 2, offset: 4 });
    expect(page3.total).toBe(5);
    expect(page3.replies.map((r) => r.id)).toEqual(["p0"]);
  });
});

describe("listSupportReplies — filters", () => {
  beforeAll(async () => {
    await clearReplies();
    await seedReply({
      id: "f1",
      adminUserId: ADMIN_A,
      recipient: "jane.doe@gmail.com",
      createdAt: "2026-06-01T00:00:00Z",
    });
    await seedReply({
      id: "f2",
      adminUserId: ADMIN_B,
      recipient: "JANE.SMITH@yahoo.com",
      createdAt: "2026-06-02T00:00:00Z",
    });
    await seedReply({
      id: "f3",
      adminUserId: ADMIN_A,
      recipient: "bob@example.com",
      createdAt: "2026-06-03T00:00:00Z",
    });
  });

  it("recipient filter matches a case-insensitive substring", async () => {
    const { replies, total } = await storage.listSupportReplies({ recipient: "jane" });
    expect(total).toBe(2);
    // Newest first: f2 (Jane Smith) before f1 (jane doe).
    expect(replies.map((r) => r.id)).toEqual(["f2", "f1"]);
  });

  it("recipient filter narrows to a single match", async () => {
    const { replies, total } = await storage.listSupportReplies({ recipient: "yahoo.com" });
    expect(total).toBe(1);
    expect(replies[0].id).toBe("f2");
  });

  it("adminUserId filter returns only that admin's replies", async () => {
    const { replies, total } = await storage.listSupportReplies({ adminUserId: ADMIN_A });
    expect(total).toBe(2);
    expect(replies.map((r) => r.id)).toEqual(["f3", "f1"]);
  });

  it("recipient and adminUserId filters combine (AND)", async () => {
    const { replies, total } = await storage.listSupportReplies({
      recipient: "jane",
      adminUserId: ADMIN_A,
    });
    expect(total).toBe(1);
    expect(replies[0].id).toBe("f1");
  });

  it("an unmatched filter returns an empty page and zero total", async () => {
    const { replies, total } = await storage.listSupportReplies({ recipient: "no-such-user" });
    expect(total).toBe(0);
    expect(replies).toEqual([]);
  });
});

describe("listSupportReplies — limit clamping (1..200)", () => {
  beforeAll(async () => {
    await clearReplies();
    // 205 rows so the upper clamp (200) is observable; created_at staggered so
    // ordering is deterministic.
    await admin.query(
      `INSERT INTO support_replies (id, admin_user_id, recipient, subject, body, created_at)
       SELECT 'c' || g, $1, 'bulk@example.com', 's', 'b',
              TIMESTAMPTZ '2026-01-01T00:00:00Z' + (g || ' seconds')::interval
       FROM generate_series(1, 205) AS g`,
      [ADMIN_A],
    );
  });

  it("clamps a limit above 200 down to at most 200 while total reflects all rows", async () => {
    const { replies, total } = await storage.listSupportReplies({ limit: 1000 });
    expect(total).toBe(205);
    expect(replies).toHaveLength(200);
  });

  it("clamps a limit below 1 up to 1", async () => {
    const { replies } = await storage.listSupportReplies({ limit: 0 });
    expect(replies).toHaveLength(1);
  });
});
