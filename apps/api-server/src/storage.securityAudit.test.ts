/**
 * Unit tests for DatabaseStorage.recordSecurityAudit — the single chokepoint
 * through which every security-sensitive account change is persisted to the
 * security_audit_log table.
 *
 * These tests prove the contract that the higher-level flow tests rely on:
 *   1. A row is actually inserted into the security_audit_log table.
 *   2. Admin-initiated events carry actor_user_id (the acting admin) AND
 *      target_user_id (the affected user); self-service events leave
 *      target_user_id null.
 *   3. The persisted row only ever contains who-did-what-when metadata —
 *      never a password, code, secret, TOTP seed, or hash.
 *
 * @workspace/db is mocked with an in-memory capture so the test runs without a
 * real database. The captured insert payload is the exact object handed to
 * Drizzle, so asserting on its shape is equivalent to asserting on what lands
 * in the table.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

interface CapturedInsert {
  table: unknown;
  values: Record<string, unknown>;
}

let inserts: CapturedInsert[];

vi.mock("@workspace/db", async () => {
  const drizzle = await import("drizzle-orm");
  return {
    db: {
      insert: (table: unknown) => ({
        values: async (values: Record<string, unknown>) => {
          inserts.push({ table, values });
        },
      }),
    },
    // Table identity markers — recordSecurityAudit inserts into this one.
    users: "users_table",
    withdrawals: "withdrawals_table",
    earningsLedger: "ledger_table",
    rewardSessions: "reward_sessions_table",
    adEvents: "ad_events_table",
    webhookAudit: "webhook_audit_table",
    securityAuditLog: "security_audit_log_table",
    // Re-export real drizzle helpers used by storage.ts.
    sql: drizzle.sql,
    and: drizzle.and,
    eq: drizzle.eq,
    gte: drizzle.gte,
    desc: drizzle.desc,
    lt: drizzle.lt,
    inArray: drizzle.inArray,
    count: drizzle.count,
    sum: drizzle.sum,
    between: drizzle.between,
  };
});

let DatabaseStorage: typeof import("./storage").DatabaseStorage;

beforeEach(async () => {
  inserts = [];
  vi.resetModules();
  const mod = await import("./storage");
  DatabaseStorage = mod.DatabaseStorage;
});

// The only keys that may ever be written to the audit log.
const ALLOWED_KEYS = ["actorUserId", "targetUserId", "event", "ip"].sort();
const SENSITIVE_KEY_RE = /password|passwd|code|secret|seed|hash|token|otp/i;

describe("DatabaseStorage.recordSecurityAudit", () => {
  it("inserts a row into the security_audit_log table", async () => {
    const store = new DatabaseStorage();
    await store.recordSecurityAudit({ actorUserId: "admin-1", event: "password_changed" });

    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.table).toBe("security_audit_log_table");
  });

  it("persists actor and target for an admin-initiated event", async () => {
    const store = new DatabaseStorage();
    await store.recordSecurityAudit({
      actorUserId: "admin-1",
      targetUserId: "victim-9",
      event: "admin_factory_reset",
      ip: "203.0.113.7",
    });

    expect(inserts[0]!.values).toMatchObject({
      actorUserId: "admin-1",
      targetUserId: "victim-9",
      event: "admin_factory_reset",
      ip: "203.0.113.7",
    });
  });

  it("leaves target_user_id null for a self-service event", async () => {
    const store = new DatabaseStorage();
    await store.recordSecurityAudit({ actorUserId: "user-1", event: "totp_enabled" });

    expect(inserts[0]!.values["targetUserId"]).toBeNull();
    expect(inserts[0]!.values["actorUserId"]).toBe("user-1");
  });

  it("normalises a missing ip to null", async () => {
    const store = new DatabaseStorage();
    await store.recordSecurityAudit({ actorUserId: "user-1", event: "password_reset" });

    expect(inserts[0]!.values["ip"]).toBeNull();
  });

  it("never writes secrets/codes/passwords — only who-did-what-when metadata", async () => {
    const store = new DatabaseStorage();
    await store.recordSecurityAudit({
      actorUserId: "admin-1",
      targetUserId: "victim-9",
      event: "admin_password_reset",
      ip: "203.0.113.7",
    });

    const values = inserts[0]!.values;
    // The persisted row must contain exactly the allow-listed keys.
    expect(Object.keys(values).sort()).toEqual(ALLOWED_KEYS);
    // None of the keys may name a credential-bearing field.
    for (const key of Object.keys(values)) {
      expect(key).not.toMatch(SENSITIVE_KEY_RE);
    }
  });
});
