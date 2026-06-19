/**
 * Storage-level integration test for getAdjustmentLedger's actor join.
 *
 * Task #302 made the acting admin a first-class field on the adjustment ledger
 * (earnings_ledger.actor_user_id) and surfaces "Issued by" in /sc-portal. The
 * route tests cover the actor being passed through and echoed back, but nothing
 * proved that getAdjustmentLedger actually JOINs earnings_ledger.actor_user_id
 * back to the acting user and returns their username — including the null case
 * (a console-token / system adjustment with no actor row).
 *
 * Rather than fake Postgres and re-implement the leftJoin, this runs the REAL
 * DatabaseStorage (creditUser / debitUser / getAdjustmentLedger) against a REAL
 * database in a throwaway, isolated schema (search_path pinned per pooled
 * connection). Only the logger is mocked; the database is genuine.
 *
 * Requires DATABASE_URL (always set in this environment). The schema is created
 * in beforeAll and dropped in afterAll, so it never touches real app tables.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomBytes } from "node:crypto";

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const SCHEMA = `adj_test_${randomBytes(6).toString("hex")}`;

// Minimal shape of the raw pg client we use for DDL/seeding. Derived typing of
// pool.connect() collapses to its callback overload, and `pg` types aren't
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
let storage: import("./storage").DatabaseStorage;

async function createUser(username: string, email: string | null = null): Promise<string> {
  const id = `u_${randomBytes(8).toString("hex")}`;
  await admin.query(
    `INSERT INTO users (id, username, email, balance) VALUES ($1,$2,$3,'100.00')`,
    [id, username, email],
  );
  return id;
}

beforeAll(async () => {
  const dbMod = await import("@workspace/db");
  pool = dbMod.pool;
  // Pin every pooled connection to our throwaway schema so the real storage
  // methods' unqualified queries resolve there, never to the live app tables.
  pool.on("connect", (c) => {
    c.query(`SET search_path TO ${SCHEMA}, pg_catalog`);
  });

  admin = (await pool.connect()) as unknown as SqlClient;
  await admin.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  await admin.query(`SET search_path TO ${SCHEMA}, pg_catalog`);

  await admin.query(`
    CREATE TABLE users (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      username text NOT NULL UNIQUE,
      email text,
      balance numeric(12,2) NOT NULL DEFAULT '0',
      total_earned numeric(12,2) NOT NULL DEFAULT '0'
    );
    CREATE TABLE earnings_ledger (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id varchar NOT NULL,
      amount numeric(12,2) NOT NULL,
      type text NOT NULL,
      description text NOT NULL,
      ref_id text,
      provider text,
      actor_user_id varchar,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  const mod = await import("./storage");
  storage = new mod.DatabaseStorage();
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

describe("getAdjustmentLedger actor join", () => {
  it("returns the acting admin's id and username for a credit adjustment", async () => {
    const adminId = await createUser(`admin_${randomBytes(4).toString("hex")}`);
    const targetId = await createUser(`target_${randomBytes(4).toString("hex")}`, "t@example.com");

    await storage.creditUser({
      userId: targetId,
      amount: 5,
      type: "adjustment",
      description: "manual credit",
      actorUserId: adminId,
    });

    const rows = await storage.getAdjustmentLedger();
    const entry = rows.find((r) => r.userId === targetId);
    expect(entry).toBeDefined();
    expect(entry!.actorUserId).toBe(adminId);
    expect(entry!.actorUsername).toMatch(/^admin_/);
    expect(entry!.username).toMatch(/^target_/);
    expect(entry!.email).toBe("t@example.com");
    expect(entry!.amount).toBe("5.00");
  });

  it("returns the acting admin's username for a debit adjustment", async () => {
    const adminId = await createUser(`admin_${randomBytes(4).toString("hex")}`);
    const targetId = await createUser(`target_${randomBytes(4).toString("hex")}`);

    await storage.debitUser({
      userId: targetId,
      amount: 3,
      type: "adjustment",
      description: "manual debit",
      actorUserId: adminId,
    });

    const rows = await storage.getAdjustmentLedger();
    const entry = rows.find((r) => r.userId === targetId);
    expect(entry).toBeDefined();
    expect(entry!.actorUserId).toBe(adminId);
    expect(entry!.actorUsername).toMatch(/^admin_/);
    expect(entry!.amount).toBe("-3.00");
  });

  it("returns null actorUserId/actorUsername for a system adjustment with no actor", async () => {
    const targetId = await createUser(`target_${randomBytes(4).toString("hex")}`);

    await storage.creditUser({
      userId: targetId,
      amount: 2,
      type: "adjustment",
      description: "console-token adjustment",
      // no actorUserId — e.g. an ADMIN_TOKEN/console-driven change
    });

    const rows = await storage.getAdjustmentLedger();
    const entry = rows.find((r) => r.userId === targetId);
    expect(entry).toBeDefined();
    expect(entry!.actorUserId).toBeNull();
    expect(entry!.actorUsername).toBeNull();
  });

  it("returns null actorUsername when the actor id has no matching user row", async () => {
    const targetId = await createUser(`target_${randomBytes(4).toString("hex")}`);
    const orphanActorId = `u_${randomBytes(8).toString("hex")}`;

    await storage.creditUser({
      userId: targetId,
      amount: 1,
      type: "adjustment",
      description: "orphan actor adjustment",
      actorUserId: orphanActorId,
    });

    const rows = await storage.getAdjustmentLedger();
    const entry = rows.find((r) => r.userId === targetId);
    expect(entry).toBeDefined();
    // The id is preserved on the ledger row, but the leftJoin finds no username.
    expect(entry!.actorUserId).toBe(orphanActorId);
    expect(entry!.actorUsername).toBeNull();
  });

  it("only returns rows of type 'adjustment'", async () => {
    const targetId = await createUser(`target_${randomBytes(4).toString("hex")}`);

    await storage.creditUser({
      userId: targetId,
      amount: 4,
      type: "bonus",
      description: "a non-adjustment earning",
    });

    const rows = await storage.getAdjustmentLedger();
    const entry = rows.find((r) => r.userId === targetId);
    expect(entry).toBeUndefined();
  });
});
