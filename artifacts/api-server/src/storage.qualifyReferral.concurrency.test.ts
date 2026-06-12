/**
 * Real-database concurrency tests for storage.qualifyReferral.
 *
 * The existing backfill tests drive `qualifyReferral` sequentially. They prove
 * idempotency when called one-at-a-time (the `referralCreditedAt` stamp skips
 * already-credited users), but they do NOT prove the `FOR UPDATE` lock actually
 * holds when two calls race for the SAME referred user. This suite closes that
 * gap.
 *
 * What is covered:
 *   1. Two concurrent `qualifyReferral` calls for the same referred user →
 *      referrer is credited exactly once (one ledger row, balance += bonus once).
 *   2. Self-referral: the gate still closes (referralCreditedAt stamped) but no
 *      payout is issued to the referring row.
 *   3. Unknown referral code: same as self-referral — gate closes, no payout.
 *   4. Sequential calls remain idempotent: a second call after a successful first
 *      is a no-op.
 *
 * Runs the REAL storage layer against a REAL Postgres instance, isolated in a
 * throwaway schema (search_path pinned per pooled connection). Only the logger
 * is mocked (noise suppression); everything else is genuine.
 *
 * Requires DATABASE_URL (always set in this environment).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { REFERRAL_BONUS_USD } from "./withdrawalTiers";

const SCHEMA = `qualify_ref_test_${randomBytes(6).toString("hex")}`;

vi.mock("./lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

interface SqlResult {
  rows: Array<Record<string, unknown>>;
}
interface SqlClient {
  query(text: string, params?: unknown[]): Promise<SqlResult>;
  release(): void;
}

let pool: typeof import("@workspace/db").pool;
let admin: SqlClient;
let storageMod: typeof import("./storage");

const BONUS = REFERRAL_BONUS_USD;

async function seedUser(opts: {
  username: string;
  referredBy?: string | null;
}): Promise<string> {
  const id = `u_${randomBytes(8).toString("hex")}`;
  await admin.query(
    `INSERT INTO users (id, username, password, referred_by)
     VALUES ($1, $2, 'x', $3)`,
    [id, opts.username, opts.referredBy ?? null],
  );
  return id;
}

async function userRow(
  id: string,
): Promise<{ balance: string; total_earned: string; referral_credited_at: Date | null }> {
  const r = await admin.query(
    `SELECT balance, total_earned, referral_credited_at FROM users WHERE id = $1`,
    [id],
  );
  return r.rows[0] as { balance: string; total_earned: string; referral_credited_at: Date | null };
}

async function referralLedgerRows(
  userId: string,
): Promise<Array<{ amount: string; type: string; ref_id: string | null }>> {
  const r = await admin.query(
    `SELECT amount, type, ref_id FROM earnings_ledger
     WHERE user_id = $1 AND type = 'referral'
     ORDER BY created_at`,
    [userId],
  );
  return r.rows as Array<{ amount: string; type: string; ref_id: string | null }>;
}

beforeAll(async () => {
  const dbMod = await import("@workspace/db");
  pool = dbMod.pool;

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
      password text NOT NULL,
      role text NOT NULL DEFAULT 'user',
      balance numeric(12,2) NOT NULL DEFAULT '0',
      total_earned numeric(12,2) NOT NULL DEFAULT '0',
      referred_by text,
      referral_credited_at timestamp,
      email_verified boolean NOT NULL DEFAULT false,
      email_verification_token text,
      email_verification_expires_at timestamp,
      created_at timestamp NOT NULL DEFAULT now(),
      date_of_birth text,
      gender text,
      zip_code text,
      country text DEFAULT 'US',
      employment_status text,
      household_income text,
      education_level text,
      ethnicity text,
      profile_complete boolean NOT NULL DEFAULT false,
      checkin_streak integer NOT NULL DEFAULT 0,
      last_checkin_at timestamptz,
      token_version integer NOT NULL DEFAULT 0,
      is_publisher boolean NOT NULL DEFAULT false,
      publisher_granted_at timestamp,
      ad_credits numeric(12,2) NOT NULL DEFAULT '0',
      totp_secret text,
      totp_enabled boolean NOT NULL DEFAULT false,
      totp_backup_codes text[]
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
      created_at timestamp NOT NULL DEFAULT now()
    );
  `);

  storageMod = await import("./storage");
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
  await admin.query(`TRUNCATE users, earnings_ledger`);
});

describe("storage.qualifyReferral — concurrency and edge cases (real DB)", () => {
  it("two concurrent calls for the same referred user credit the referrer exactly once", async () => {
    const referrerId = await seedUser({ username: "carol" });
    const referredId = await seedUser({ username: "alice", referredBy: "carol" });

    const [r1, r2] = await Promise.all([
      storageMod.storage.qualifyReferral({ referredUserId: referredId, bonusUsd: BONUS }),
      storageMod.storage.qualifyReferral({ referredUserId: referredId, bonusUsd: BONUS }),
    ]);

    // Exactly one of the two calls succeeds; the other is a no-op (idempotent).
    const creditedCount = [r1, r2].filter((r) => r.credited).length;
    expect(creditedCount).toBe(1);

    const row = await userRow(referrerId);
    expect(parseFloat(row.balance)).toBeCloseTo(BONUS, 2);
    expect(parseFloat(row.total_earned)).toBeCloseTo(BONUS, 2);

    const ledger = await referralLedgerRows(referrerId);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].ref_id).toBe(referredId);
    expect(parseFloat(ledger[0].amount)).toBeCloseTo(BONUS, 2);

    const aliceRow = await userRow(referredId);
    expect(aliceRow.referral_credited_at).not.toBeNull();
  });

  it("three concurrent calls for the same referred user still credit the referrer exactly once", async () => {
    const referrerId = await seedUser({ username: "dave" });
    const referredId = await seedUser({ username: "bob", referredBy: "dave" });

    const results = await Promise.all([
      storageMod.storage.qualifyReferral({ referredUserId: referredId, bonusUsd: BONUS }),
      storageMod.storage.qualifyReferral({ referredUserId: referredId, bonusUsd: BONUS }),
      storageMod.storage.qualifyReferral({ referredUserId: referredId, bonusUsd: BONUS }),
    ]);

    const creditedCount = results.filter((r) => r.credited).length;
    expect(creditedCount).toBe(1);

    const row = await userRow(referrerId);
    expect(parseFloat(row.balance)).toBeCloseTo(BONUS, 2);

    const ledger = await referralLedgerRows(referrerId);
    expect(ledger).toHaveLength(1);
  });

  it("self-referral: gate closes (referralCreditedAt stamped) but no payout issued", async () => {
    const selfId = await seedUser({ username: "eve", referredBy: "eve" });

    const result = await storageMod.storage.qualifyReferral({
      referredUserId: selfId,
      bonusUsd: BONUS,
    });

    expect(result.credited).toBe(false);

    const row = await userRow(selfId);
    // No payout — balance and total_earned stay at zero.
    expect(parseFloat(row.balance)).toBe(0);
    expect(parseFloat(row.total_earned)).toBe(0);
    // Gate is closed — stamp is set so she cannot be re-evaluated.
    expect(row.referral_credited_at).not.toBeNull();

    // No ledger row issued.
    const ledger = await referralLedgerRows(selfId);
    expect(ledger).toHaveLength(0);
  });

  it("unknown referral code: gate closes (referralCreditedAt stamped) but no payout issued", async () => {
    const referredId = await seedUser({ username: "frank", referredBy: "nobody_exists" });

    const result = await storageMod.storage.qualifyReferral({
      referredUserId: referredId,
      bonusUsd: BONUS,
    });

    expect(result.credited).toBe(false);

    const row = await userRow(referredId);
    expect(parseFloat(row.balance)).toBe(0);
    expect(row.referral_credited_at).not.toBeNull();

    const ledger = await referralLedgerRows(referredId);
    expect(ledger).toHaveLength(0);
  });

  it("sequential calls are idempotent: second call after a successful first is a no-op", async () => {
    const referrerId = await seedUser({ username: "grace" });
    const referredId = await seedUser({ username: "heidi", referredBy: "grace" });

    const first = await storageMod.storage.qualifyReferral({
      referredUserId: referredId,
      bonusUsd: BONUS,
    });
    expect(first.credited).toBe(true);
    expect(first.referrerId).toBe(referrerId);

    const second = await storageMod.storage.qualifyReferral({
      referredUserId: referredId,
      bonusUsd: BONUS,
    });
    expect(second.credited).toBe(false);

    const row = await userRow(referrerId);
    expect(parseFloat(row.balance)).toBeCloseTo(BONUS, 2);

    const ledger = await referralLedgerRows(referrerId);
    expect(ledger).toHaveLength(1);
  });

  it("no-referrer user: gate closes but nothing is paid out", async () => {
    const referredId = await seedUser({ username: "ivan", referredBy: null });

    const result = await storageMod.storage.qualifyReferral({
      referredUserId: referredId,
      bonusUsd: BONUS,
    });

    // referred.referredBy is NULL, so qualifyReferral returns false without
    // stamping — just returns early. Balance stays 0, no ledger row.
    expect(result.credited).toBe(false);

    const row = await userRow(referredId);
    expect(parseFloat(row.balance)).toBe(0);
    expect(row.referral_credited_at).toBeNull();

    const ledger = await referralLedgerRows(referredId);
    expect(ledger).toHaveLength(0);
  });

  it("two concurrent calls for different referred users each credit their own referrer once", async () => {
    const carolId = await seedUser({ username: "carol2" });
    const daveId = await seedUser({ username: "dave2" });
    const aliceId = await seedUser({ username: "alice2", referredBy: "carol2" });
    const bobId = await seedUser({ username: "bob2", referredBy: "dave2" });

    const [r1, r2] = await Promise.all([
      storageMod.storage.qualifyReferral({ referredUserId: aliceId, bonusUsd: BONUS }),
      storageMod.storage.qualifyReferral({ referredUserId: bobId, bonusUsd: BONUS }),
    ]);

    expect(r1.credited).toBe(true);
    expect(r2.credited).toBe(true);

    const carolRow = await userRow(carolId);
    const daveRow = await userRow(daveId);
    expect(parseFloat(carolRow.balance)).toBeCloseTo(BONUS, 2);
    expect(parseFloat(daveRow.balance)).toBeCloseTo(BONUS, 2);

    expect(await referralLedgerRows(carolId)).toHaveLength(1);
    expect(await referralLedgerRows(daveId)).toHaveLength(1);
  });
});
