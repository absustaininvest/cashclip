import {
  type User,
  type InsertUser,
  type UpdateUserProfile,
  type Withdrawal,
  type EarningsLedgerEntry,
  type RewardSession,
  type InsertAdEvent,
  type AdEvent,
  type WebhookAuditEntry,
  type InsertWebhookAuditEntry,
  users,
  withdrawals,
  earningsLedger,
  earnTokens,
  rewardSessions,
  adEvents,
  webhookAudit,
  securityAuditLog,
} from "@workspace/db";
import { db } from "@workspace/db";
import { eq, desc, and, sql, gte, lt, inArray, count, sum, between } from "drizzle-orm";

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Either the root db handle or an in-flight transaction. Methods accept this so
// security-sensitive mutations and their audit-log write can be committed
// atomically (fail-closed) inside a single transaction.
type Executor = typeof db | DbTx;

// Each verified rewarded ad credits a fixed 50 points = $0.05 (POINTS_PER_DOLLAR = 1000).
// Ad analytics report this fixed per-ad payout, NOT the raw rewardAmount telemetry
// (which is the AdMob SDK reward-item count, not a dollar value).
const REWARDED_AD_PAYOUT_USD = 0.05;

// Points-to-USD conversion (matches POINTS_PER_DOLLAR in routes/earnings.ts).
const POINTS_PER_DOLLAR = 1000;

export type SecurityAuditEvent =
  | "totp_enabled"
  | "totp_disabled"
  | "backup_codes_regenerated"
  | "password_changed"
  | "password_reset"
  | "admin_password_reset"
  | "admin_factory_reset";

export const SECURITY_AUDIT_EVENTS: readonly SecurityAuditEvent[] = [
  "totp_enabled",
  "totp_disabled",
  "backup_codes_regenerated",
  "password_changed",
  "password_reset",
] as const;

// A security audit row enriched with the actor's username/email for display.
// Never includes secrets, codes, seeds, or passwords — only who-did-what-when.
export interface SecurityAuditEntryView {
  id: string;
  actorUserId: string;
  actorUsername: string | null;
  actorEmail: string | null;
  event: SecurityAuditEvent;
  ip: string | null;
  createdAt: Date;
}

export type LedgerType =
  | "survey"
  | "offerwall"
  | "withdrawal"
  | "withdrawal_refund"
  | "bonus"
  | "adjustment";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getAllUsers(limit?: number, offset?: number): Promise<{ users: User[]; total: number }>;
  createUser(user: InsertUser & { role?: string }): Promise<User>;
  updateUserPassword(id: string, hashedPassword: string): Promise<{ tokenVersion: number }>;
  incrementTokenVersion(id: string): Promise<{ tokenVersion: number }>;
  setTotpBackupCodes(userId: string, hashes: string[]): Promise<void>;
  recordSecurityAudit(args: { actorUserId: string; event: SecurityAuditEvent; targetUserId?: string | null; ip?: string | null }): Promise<void>;
  getSecurityAuditEntries(opts?: {
    actorUserId?: string;
    event?: SecurityAuditEvent;
    limit?: number;
    offset?: number;
  }): Promise<{ entries: SecurityAuditEntryView[]; total: number }>;
  getTotpBackupCodesRemaining(userId: string): Promise<number>;
  consumeTotpBackupCode(userId: string, hash: string): Promise<boolean>;
  factoryResetUser(id: string, hashedPassword: string): Promise<{ tokenVersion: number }>;
  deleteUser(id: string): Promise<void>;
  getUserProfile(userId: string): Promise<User | undefined>;
  updateUserProfile(userId: string, data: UpdateUserProfile): Promise<User>;
  getUserBalance(userId: string): Promise<{ balance: number; totalEarned: number }>;
  creditUser(args: {
    userId: string;
    amount: number;
    type: LedgerType;
    description: string;
    refId?: string;
    provider?: string;
  }): Promise<{ balance: number; totalEarned: number }>;
  debitUser(args: {
    userId: string;
    amount: number;
    type: LedgerType;
    description: string;
    refId?: string;
  }): Promise<{ balance: number; totalEarned: number }>;
  getUserLedger(userId: string, limit?: number): Promise<EarningsLedgerEntry[]>;
  createWithdrawal(data: {
    userId: string;
    username: string;
    amount: string;
    bonusPercent: string;
    bonusAmount: string;
    totalPayout: string;
    paypalEmail: string;
  }): Promise<Withdrawal>;
  createWithdrawalAtomic(args: {
    userId: string;
    username: string;
    amount: number;
    bonusPercent: string;
    bonusAmount: string;
    totalPayout: string;
    paypalEmail: string;
    dailyCapMax: number;
    dayStart: Date;
  }): Promise<
    | { ok: true; withdrawal: Withdrawal; balance: number; withdrawalsTodayCount: number }
    | { ok: false; reason: "DAILY_CAP_EXCEEDED"; withdrawnToday: number; remaining: number }
    | { ok: false; reason: "INSUFFICIENT_BALANCE"; balance: number }
  >;
  getWithdrawals(status?: string): Promise<Withdrawal[]>;
  getWithdrawalById(id: string): Promise<Withdrawal | undefined>;
  getUserWithdrawals(userId: string): Promise<Withdrawal[]>;
  updateWithdrawalStatus(id: string, status: string, adminNote?: string): Promise<Withdrawal | undefined>;
  updateWithdrawalStatusIfStatus(
    id: string,
    fromStatuses: string[],
    toStatus: string,
    adminNote?: string,
    paypalBatchId?: string,
  ): Promise<Withdrawal | undefined>;

  createRewardSession(args: {
    sessionToken: string;
    userId: string;
    source: "survey" | "offerwall";
    provider: string;
    externalId: string;
    expectedReward: number;
    expiresAt: Date;
  }): Promise<RewardSession>;
  getRewardSession(sessionToken: string): Promise<RewardSession | undefined>;
  findCompletedRewardSession(
    userId: string,
    source: "survey" | "offerwall",
    externalId: string,
  ): Promise<RewardSession | undefined>;
  findPendingRewardSession(
    userId: string,
    source: "survey" | "offerwall",
    externalId: string,
  ): Promise<RewardSession | undefined>;
  completeRewardSessionAtomic(sessionToken: string, userId: string): Promise<RewardSession | undefined>;
  findCompletedSessionByProviderTransactionId(
    source: "survey" | "offerwall",
    provider: string,
    providerTransactionId: string,
  ): Promise<RewardSession | undefined>;
  completeRewardSessionAndCredit(args: {
    sessionToken: string;
    userId: string;
    type: LedgerType;
    description: string;
    providerTransactionId?: string;
  }): Promise<{
    session: RewardSession;
    balance: number;
    totalEarned: number;
    reward: number;
  } | { conflict: "duplicate" } | { conflict: "not_claimable" }>;

  insertWebhookAudit(entry: InsertWebhookAuditEntry): Promise<WebhookAuditEntry>;
  countWebhookAuditByIp(ip: string, since: Date): Promise<number>;
  getWebhookAudits(opts?: {
    provider?: string;
    ip?: string;
    since?: Date;
    limit?: number;
  }): Promise<WebhookAuditEntry[]>;
  getWebhookAuditOffenders(opts?: {
    since?: Date;
    limit?: number;
  }): Promise<Array<{ ip: string; provider: string; count: number; lastSeenAt: Date }>>;
  getWebhookAuditProviders(): Promise<string[]>;
  pruneWebhookAudit(before: Date): Promise<number>;
  pruneSecurityAudit(before: Date): Promise<number>;
}

function n(value: string | number | null | undefined): number {
  if (value == null) return 0;
  return typeof value === "number" ? value : parseFloat(value);
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return user;
  }

  async getAllUsers(limit = 50, offset = 0, search?: string): Promise<{ users: User[]; total: number }> {
    const { ilike, or } = await import("drizzle-orm");
    const where = search
      ? or(ilike(users.username, `%${search}%`), ilike(users.email, `%${search}%`))
      : undefined;
    const [rows, [countRow]] = await Promise.all([
      db.select().from(users).where(where).orderBy(desc(users.createdAt)).limit(limit).offset(offset),
      db.select({ total: count() }).from(users).where(where),
    ]);
    return { users: rows, total: Number(countRow?.total ?? 0) };
  }

  async getUserByVerificationToken(token: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.emailVerificationToken, token)).limit(1);
    return user;
  }

  async setEmailVerificationToken(userId: string, token: string, expiresAt: Date): Promise<void> {
    await db.update(users).set({ emailVerificationToken: token, emailVerificationExpiresAt: expiresAt }).where(eq(users.id, userId));
  }

  async markEmailVerified(userId: string): Promise<void> {
    await db.update(users).set({ emailVerified: true, emailVerificationToken: null, emailVerificationExpiresAt: null }).where(eq(users.id, userId));
  }

  async updateUserPassword(id: string, hashedPassword: string, executor: Executor = db): Promise<{ tokenVersion: number }> {
    const [updated] = await executor
      .update(users)
      .set({ password: hashedPassword, tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(eq(users.id, id))
      .returning({ tokenVersion: users.tokenVersion });
    if (!updated) {
      throw new Error(`updateUserPassword: no row updated for user ${id}`);
    }
    return { tokenVersion: updated.tokenVersion };
  }

  async incrementTokenVersion(id: string): Promise<{ tokenVersion: number }> {
    const [updated] = await db
      .update(users)
      .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(eq(users.id, id))
      .returning({ tokenVersion: users.tokenVersion });
    if (!updated) {
      throw new Error(`incrementTokenVersion: no row updated for user ${id}`);
    }
    return { tokenVersion: updated.tokenVersion };
  }

  async setTotpBackupCodes(userId: string, hashes: string[], executor: Executor = db): Promise<void> {
    await executor.update(users).set({ totpBackupCodes: hashes }).where(eq(users.id, userId));
  }

  async recordSecurityAudit(args: { actorUserId: string; event: SecurityAuditEvent; targetUserId?: string | null; ip?: string | null }, executor: Executor = db): Promise<void> {
    await executor.insert(securityAuditLog).values({
      actorUserId: args.actorUserId,
      targetUserId: args.targetUserId ?? null,
      event: args.event,
      ip: args.ip ?? null,
    });
  }

  async getSecurityAuditEntries(opts: {
    actorUserId?: string;
    event?: SecurityAuditEvent;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ entries: SecurityAuditEntryView[]; total: number }> {
    const conditions = [];
    if (opts.actorUserId) conditions.push(eq(securityAuditLog.actorUserId, opts.actorUserId));
    if (opts.event) conditions.push(eq(securityAuditLog.event, opts.event));
    const where = conditions.length ? and(...conditions) : undefined;
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);

    const [rows, [totalRow]] = await Promise.all([
      db
        .select({
          id: securityAuditLog.id,
          actorUserId: securityAuditLog.actorUserId,
          actorUsername: users.username,
          actorEmail: users.email,
          event: securityAuditLog.event,
          ip: securityAuditLog.ip,
          createdAt: securityAuditLog.createdAt,
        })
        .from(securityAuditLog)
        .leftJoin(users, eq(securityAuditLog.actorUserId, users.id))
        .where(where)
        .orderBy(desc(securityAuditLog.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: count() })
        .from(securityAuditLog)
        .where(where),
    ]);

    return {
      entries: rows.map((r: (typeof rows)[number]) => ({
        id: r.id,
        actorUserId: r.actorUserId,
        actorUsername: r.actorUsername ?? null,
        actorEmail: r.actorEmail ?? null,
        event: r.event as SecurityAuditEvent,
        ip: r.ip ?? null,
        createdAt: r.createdAt,
      })),
      total: Number(totalRow?.total ?? 0),
    };
  }

  async getTotpBackupCodesRemaining(userId: string): Promise<number> {
    const [row] = await db
      .select({ codes: users.totpBackupCodes })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row?.codes?.length ?? 0;
  }

  // Atomically consume a single backup code. Returns true if the code matched
  // and was removed; the row lock prevents the same code being used twice by
  // concurrent requests across replicas.
  async consumeTotpBackupCode(userId: string, hash: string): Promise<boolean> {
    return await db.transaction(async (tx: DbTx) => {
      const [row] = await tx
        .select({ codes: users.totpBackupCodes })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
        .for("update");
      const codes = row?.codes ?? [];
      if (!codes.includes(hash)) return false;
      const remaining = codes.filter((c) => c !== hash);
      await tx.update(users).set({ totpBackupCodes: remaining }).where(eq(users.id, userId));
      return true;
    });
  }

  async factoryResetUser(id: string, hashedPassword: string, executor: Executor = db): Promise<{ tokenVersion: number }> {
    const [updated] = await executor
      .update(users)
      .set({
        password: hashedPassword,
        totpSecret: null,
        totpEnabled: false,
        totpBackupCodes: null,
        tokenVersion: sql`${users.tokenVersion} + 1`,
      })
      .where(eq(users.id, id))
      .returning({ tokenVersion: users.tokenVersion });
    if (!updated) {
      throw new Error(`factoryResetUser: no row updated for user ${id}`);
    }
    return { tokenVersion: updated.tokenVersion };
  }

  async deleteUser(id: string): Promise<void> {
    await db.delete(adEvents).where(eq(adEvents.userId, id));
    await db.delete(rewardSessions).where(eq(rewardSessions.userId, id));
    await db.delete(earningsLedger).where(eq(earningsLedger.userId, id));
    await db.delete(withdrawals).where(eq(withdrawals.userId, id));
    await db.delete(users).where(eq(users.id, id));
  }

  async getUserProfile(userId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    return user;
  }

  async updateUserProfile(userId: string, data: UpdateUserProfile): Promise<User> {
    const fields: Partial<typeof users.$inferInsert> = { ...data };
    const requiredFields = ["dateOfBirth", "gender", "zipCode", "employmentStatus", "householdIncome", "educationLevel"];
    const current = await this.getUserProfile(userId);
    const merged = { ...current, ...fields };
    const isComplete = requiredFields.every((f) => !!(merged as Record<string, unknown>)[f]);
    fields.profileComplete = isComplete;
    const [updated] = await db.update(users).set(fields).where(eq(users.id, userId)).returning();
    if (!updated) throw new Error("User not found");
    return updated;
  }

  async updateUserRole(id: string, role: string): Promise<void> {
    await db.update(users).set({ role }).where(eq(users.id, id));
  }

  async createUser(insertUser: InsertUser & { role?: string }): Promise<User> {
    const [user] = await db
      .insert(users)
      .values({
        username: insertUser.username,
        password: insertUser.password,
        role: insertUser.role || "user",
        email: insertUser.email,
        referredBy: insertUser.referredBy,
      })
      .returning();
    return user;
  }

  async getUserBalance(userId: string): Promise<{ balance: number; totalEarned: number }> {
    const [user] = await db
      .select({ balance: users.balance, totalEarned: users.totalEarned })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) return { balance: 0, totalEarned: 0 };
    return { balance: n(user.balance), totalEarned: n(user.totalEarned) };
  }

  async creditUser({
    userId,
    amount,
    type,
    description,
    refId,
    provider,
  }: {
    userId: string;
    amount: number;
    type: LedgerType;
    description: string;
    refId?: string;
    provider?: string;
  }): Promise<{ balance: number; totalEarned: number }> {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Credit amount must be a positive number");
    }
    const amountStr = amount.toFixed(2);

    return await db.transaction(async (tx: DbTx) => {
      const isEarning = type === "survey" || type === "offerwall" || type === "bonus";
      const updateSet = isEarning
        ? {
            balance: sql`${users.balance} + ${amountStr}`,
            totalEarned: sql`${users.totalEarned} + ${amountStr}`,
          }
        : {
            balance: sql`${users.balance} + ${amountStr}`,
          };
      const [updated] = await tx
        .update(users)
        .set(updateSet)
        .where(eq(users.id, userId))
        .returning({ balance: users.balance, totalEarned: users.totalEarned });

      if (!updated) throw new Error("User not found");

      await tx.insert(earningsLedger).values({
        userId,
        amount: amountStr,
        type,
        description,
        refId: refId ?? null,
        provider: provider ?? null,
      });

      return { balance: n(updated.balance), totalEarned: n(updated.totalEarned) };
    });
  }

  async debitUser({
    userId,
    amount,
    type,
    description,
    refId,
  }: {
    userId: string;
    amount: number;
    type: LedgerType;
    description: string;
    refId?: string;
  }): Promise<{ balance: number; totalEarned: number }> {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Debit amount must be a positive number");
    }
    const amountStr = amount.toFixed(2);

    return await db.transaction(async (tx: DbTx) => {
      const [updated] = await tx
        .update(users)
        .set({
          balance: sql`${users.balance} - ${amountStr}`,
        })
        .where(and(eq(users.id, userId), gte(users.balance, amountStr)))
        .returning({ balance: users.balance, totalEarned: users.totalEarned });

      if (!updated) {
        throw new Error("INSUFFICIENT_BALANCE");
      }

      await tx.insert(earningsLedger).values({
        userId,
        amount: `-${amountStr}`,
        type,
        description,
        refId: refId ?? null,
      });

      return { balance: n(updated.balance), totalEarned: n(updated.totalEarned) };
    });
  }

  async getUserLedger(userId: string, limit: number = 100): Promise<EarningsLedgerEntry[]> {
    return db
      .select()
      .from(earningsLedger)
      .where(eq(earningsLedger.userId, userId))
      .orderBy(desc(earningsLedger.createdAt))
      .limit(limit);
  }

  async createWithdrawal(data: {
    userId: string;
    username: string;
    amount: string;
    bonusPercent: string;
    bonusAmount: string;
    totalPayout: string;
    paypalEmail: string;
  }): Promise<Withdrawal> {
    const [withdrawal] = await db
      .insert(withdrawals)
      .values(data)
      .returning();
    return withdrawal;
  }

  async createWithdrawalAtomic(args: {
    userId: string;
    username: string;
    amount: number;
    bonusPercent: string;
    bonusAmount: string;
    totalPayout: string;
    paypalEmail: string;
    dailyCapMax: number;
    dayStart: Date;
  }): Promise<
    | { ok: true; withdrawal: Withdrawal; balance: number; withdrawalsTodayCount: number }
    | { ok: false; reason: "DAILY_CAP_EXCEEDED"; withdrawnToday: number; remaining: number }
    | { ok: false; reason: "INSUFFICIENT_BALANCE"; balance: number }
  > {
    const { userId, username, amount, bonusPercent, bonusAmount, totalPayout, paypalEmail, dailyCapMax, dayStart } = args;
    const amountStr = amount.toFixed(2);

    return await db.transaction(async (tx: DbTx) => {
      // Acquire a row-level lock on the user row for the duration of this
      // transaction. Concurrent withdrawal requests for the same user will
      // block here until the first one commits or rolls back, which
      // eliminates the race condition on the daily-cap check.
      await tx.execute(sql`SELECT id FROM ${users} WHERE id = ${userId} FOR UPDATE`);

      // Sum today's withdrawals inside the same locked transaction so the
      // read is consistent with the insert that follows.
      const [todaySumRow] = await tx
        .select({
          total: sql<string>`COALESCE(SUM(${withdrawals.amount}::numeric), 0)`,
          count: sql<number>`COUNT(*)`,
        })
        .from(withdrawals)
        .where(and(eq(withdrawals.userId, userId), gte(withdrawals.createdAt, dayStart)));

      const withdrawnToday = parseFloat(todaySumRow?.total ?? "0");
      const priorWithdrawalsToday = Number(todaySumRow?.count ?? 0);
      if (withdrawnToday + amount > dailyCapMax + 1e-9) {
        const remaining = Math.max(0, dailyCapMax - withdrawnToday);
        return { ok: false as const, reason: "DAILY_CAP_EXCEEDED" as const, withdrawnToday, remaining };
      }

      // Debit the balance, guarded by a sufficient-balance predicate.
      const [updated] = await tx
        .update(users)
        .set({ balance: sql`${users.balance} - ${amountStr}` })
        .where(and(eq(users.id, userId), gte(users.balance, amountStr)))
        .returning({ balance: users.balance });

      if (!updated) {
        const [current] = await tx
          .select({ balance: users.balance })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        return { ok: false as const, reason: "INSUFFICIENT_BALANCE" as const, balance: n(current?.balance) };
      }

      await tx.insert(earningsLedger).values({
        userId,
        amount: `-${amountStr}`,
        type: "withdrawal" as const,
        description: `Withdrawal request $${amountStr}`,
      });

      const [withdrawal] = await tx
        .insert(withdrawals)
        .values({ userId, username, amount: amountStr, bonusPercent, bonusAmount, totalPayout, paypalEmail })
        .returning();

      return { ok: true as const, withdrawal, balance: n(updated.balance), withdrawalsTodayCount: priorWithdrawalsToday + 1 };
    });
  }

  async getWithdrawals(status?: string): Promise<Withdrawal[]> {
    if (status) {
      return db.select().from(withdrawals).where(eq(withdrawals.status, status)).orderBy(desc(withdrawals.createdAt));
    }
    return db.select().from(withdrawals).orderBy(desc(withdrawals.createdAt));
  }

  async getWithdrawalById(id: string): Promise<Withdrawal | undefined> {
    const [w] = await db.select().from(withdrawals).where(eq(withdrawals.id, id)).limit(1);
    return w;
  }

  async getUserWithdrawals(userId: string): Promise<Withdrawal[]> {
    return db.select().from(withdrawals).where(eq(withdrawals.userId, userId)).orderBy(desc(withdrawals.createdAt));
  }

  async updateWithdrawalStatus(id: string, status: string, adminNote?: string): Promise<Withdrawal | undefined> {
    const [updated] = await db
      .update(withdrawals)
      .set({
        status,
        adminNote: adminNote || null,
        processedAt: new Date(),
      })
      .where(eq(withdrawals.id, id))
      .returning();
    return updated;
  }

  async updateWithdrawalStatusIfStatus(
    id: string,
    fromStatuses: string[],
    toStatus: string,
    adminNote?: string,
    paypalBatchId?: string,
  ): Promise<Withdrawal | undefined> {
    const setClause: Record<string, unknown> = {
      status: toStatus,
      adminNote: adminNote ?? sql`${withdrawals.adminNote}`,
      processedAt: new Date(),
    };
    if (paypalBatchId !== undefined) {
      setClause.paypalBatchId = paypalBatchId;
    }
    const [updated] = await db
      .update(withdrawals)
      .set(setClause)
      .where(and(eq(withdrawals.id, id), inArray(withdrawals.status, fromStatuses)))
      .returning();
    return updated;
  }

  async createRewardSession(args: {
    sessionToken: string;
    userId: string;
    source: "survey" | "offerwall";
    provider: string;
    externalId: string;
    expectedReward: number;
    expiresAt: Date;
  }): Promise<RewardSession> {
    const [s] = await db
      .insert(rewardSessions)
      .values({
        sessionToken: args.sessionToken,
        userId: args.userId,
        source: args.source,
        provider: args.provider,
        externalId: args.externalId,
        expectedReward: args.expectedReward.toFixed(2),
        expiresAt: args.expiresAt,
        status: "pending",
      })
      .returning();
    return s;
  }

  async getRewardSession(sessionToken: string): Promise<RewardSession | undefined> {
    const [s] = await db
      .select()
      .from(rewardSessions)
      .where(eq(rewardSessions.sessionToken, sessionToken))
      .limit(1);
    return s;
  }

  async findCompletedRewardSession(
    userId: string,
    source: "survey" | "offerwall",
    externalId: string,
  ): Promise<RewardSession | undefined> {
    const [s] = await db
      .select()
      .from(rewardSessions)
      .where(
        and(
          eq(rewardSessions.userId, userId),
          eq(rewardSessions.source, source),
          eq(rewardSessions.externalId, externalId),
          eq(rewardSessions.status, "completed"),
        ),
      )
      .limit(1);
    return s;
  }

  async findPendingRewardSession(
    userId: string,
    source: "survey" | "offerwall",
    externalId: string,
  ): Promise<RewardSession | undefined> {
    const now = new Date();
    const [s] = await db
      .select()
      .from(rewardSessions)
      .where(
        and(
          eq(rewardSessions.userId, userId),
          eq(rewardSessions.source, source),
          eq(rewardSessions.externalId, externalId),
          eq(rewardSessions.status, "pending"),
          gte(rewardSessions.expiresAt, now),
        ),
      )
      .limit(1);
    return s;
  }

  async completeRewardSessionAtomic(sessionToken: string, userId: string): Promise<RewardSession | undefined> {
    const now = new Date();
    const [updated] = await db
      .update(rewardSessions)
      .set({ status: "completed", completedAt: now })
      .where(
        and(
          eq(rewardSessions.sessionToken, sessionToken),
          eq(rewardSessions.userId, userId),
          eq(rewardSessions.status, "pending"),
          gte(rewardSessions.expiresAt, now)
        )
      )
      .returning();
    return updated;
  }

  async findCompletedSessionByProviderTransactionId(
    source: "survey" | "offerwall",
    provider: string,
    providerTransactionId: string,
  ): Promise<RewardSession | undefined> {
    const [s] = await db
      .select()
      .from(rewardSessions)
      .where(
        and(
          eq(rewardSessions.source, source),
          eq(rewardSessions.provider, provider),
          eq(rewardSessions.providerTransactionId, providerTransactionId),
          eq(rewardSessions.status, "completed"),
        ),
      )
      .limit(1);
    return s;
  }

  async completeRewardSessionAndCredit(args: {
    sessionToken: string;
    userId: string;
    type: LedgerType;
    description: string;
    providerTransactionId?: string;
    finalReward?: number;
  }): Promise<{
    session: RewardSession;
    balance: number;
    totalEarned: number;
    reward: number;
  } | { conflict: "duplicate" } | { conflict: "not_claimable" }> {
    const { sessionToken, userId, type, description, providerTransactionId, finalReward } = args;
    try {
      return await db.transaction(async (tx: DbTx) => {
        const now = new Date();

        // Row-level lock: serialize concurrent claims on the same session token.
        // Prevents a race where two simultaneous requests for the same session
        // both see status='pending' before either commits.
        await tx.execute(
          sql`SELECT id FROM reward_sessions WHERE session_token = ${sessionToken} AND user_id = ${userId} FOR UPDATE`,
        );

        const updateSet: Record<string, unknown> = { status: "completed", completedAt: now };
        if (providerTransactionId) {
          updateSet.providerTransactionId = providerTransactionId;
        }
        const [finalized] = await tx
          .update(rewardSessions)
          .set(updateSet)
          .where(
            and(
              eq(rewardSessions.sessionToken, sessionToken),
              eq(rewardSessions.userId, userId),
              eq(rewardSessions.status, "pending"),
              gte(rewardSessions.expiresAt, now),
            ),
          )
          .returning();

        if (!finalized) {
          return { conflict: "not_claimable" as const };
        }

        const storedReward = parseFloat(parseFloat(finalized.expectedReward).toFixed(2));
        const reward =
          typeof finalReward === "number" && Number.isFinite(finalReward) && finalReward > 0
            ? parseFloat(finalReward.toFixed(2))
            : storedReward;
        if (!Number.isFinite(reward) || reward <= 0) {
          throw new Error("Invalid expected reward on session");
        }
        const amountStr = reward.toFixed(2);
        const isEarning = type === "survey" || type === "offerwall" || type === "bonus";
        const balanceUpdateSet = isEarning
          ? {
              balance: sql`${users.balance} + ${amountStr}`,
              totalEarned: sql`${users.totalEarned} + ${amountStr}`,
            }
          : {
              balance: sql`${users.balance} + ${amountStr}`,
            };
        const [updated] = await tx
          .update(users)
          .set(balanceUpdateSet)
          .where(eq(users.id, userId))
          .returning({ balance: users.balance, totalEarned: users.totalEarned });
        if (!updated) throw new Error("User not found");

        await tx.insert(earningsLedger).values({
          userId,
          amount: amountStr,
          type,
          description,
          refId: finalized.externalId,
          provider: finalized.provider,
        });

        return {
          session: finalized,
          balance: n(updated.balance),
          totalEarned: n(updated.totalEarned),
          reward,
        };
      });
    } catch (err: unknown) {
      const code = (err as { code?: string } | null)?.code;
      if (code === "23505") {
        return { conflict: "duplicate" as const };
      }
      throw err;
    }
  }

  async insertAdEvent(event: InsertAdEvent): Promise<AdEvent> {
    const [row] = await db.insert(adEvents).values(event).returning();
    return row;
  }

  async getAdAnalyticsSummary(from?: Date, to?: Date): Promise<{
    totalImpressions: number;
    totalCompletions: number;
    totalRewardsEarned: number;
    totalFailures: number;
    completionRate: number;
    avgRewardAmount: number;
    uniqueUsers: number;
  }> {
    const conditions = [];
    if (from) conditions.push(gte(adEvents.createdAt, from));
    if (to) conditions.push(sql`${adEvents.createdAt} <= ${to}`);

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [impressions] = await db
      .select({ value: count() })
      .from(adEvents)
      .where(whereClause ? and(eq(adEvents.event, "impression"), whereClause) : eq(adEvents.event, "impression"));

    const [completions] = await db
      .select({ value: count() })
      .from(adEvents)
      .where(whereClause ? and(eq(adEvents.event, "completion"), whereClause) : eq(adEvents.event, "completion"));

    const [rewards] = await db
      .select({
        cnt: count(),
      })
      .from(adEvents)
      .where(whereClause ? and(eq(adEvents.event, "reward_earned"), whereClause) : eq(adEvents.event, "reward_earned"));

    const [failures] = await db
      .select({ value: count() })
      .from(adEvents)
      .where(whereClause ? and(eq(adEvents.event, "load_failed"), whereClause) : eq(adEvents.event, "load_failed"));

    const [uniqueUsersResult] = await db
      .select({ value: sql<number>`count(distinct ${adEvents.userId})` })
      .from(adEvents)
      .where(whereClause ?? undefined);

    const totalImpressions = Number(impressions?.value ?? 0);
    const totalCompletions = Number(completions?.value ?? 0);
    const rewardCount = Number(rewards?.cnt ?? 0);
    const totalRewards = parseFloat((rewardCount * REWARDED_AD_PAYOUT_USD).toFixed(2));
    const totalFailures = Number(failures?.value ?? 0);
    const uniqueUsers = Number(uniqueUsersResult?.value ?? 0);

    return {
      totalImpressions,
      totalCompletions,
      totalRewardsEarned: totalRewards,
      totalFailures,
      completionRate: totalImpressions > 0 ? parseFloat(((totalCompletions / totalImpressions) * 100).toFixed(1)) : 0,
      avgRewardAmount: rewardCount > 0 ? REWARDED_AD_PAYOUT_USD : 0,
      uniqueUsers,
    };
  }

  async getAdRevenuePerUser(from?: Date, to?: Date, limit: number = 50): Promise<
    Array<{
      userId: string;
      username: string;
      impressions: number;
      completions: number;
      rewards: number;
      totalRevenue: number;
    }>
  > {
    const conditions = [];
    if (from) conditions.push(gte(adEvents.createdAt, from));
    if (to) conditions.push(sql`${adEvents.createdAt} <= ${to}`);

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await db
      .select({
        userId: adEvents.userId,
        username: users.username,
        impressions: sql<number>`count(*) filter (where ${adEvents.event} = 'impression')`,
        completions: sql<number>`count(*) filter (where ${adEvents.event} = 'completion')`,
        rewards: sql<number>`count(*) filter (where ${adEvents.event} = 'reward_earned')`,
      })
      .from(adEvents)
      .innerJoin(users, eq(adEvents.userId, users.id))
      .where(whereClause ?? undefined)
      .groupBy(adEvents.userId, users.username)
      .orderBy(sql`count(*) filter (where ${adEvents.event} = 'reward_earned') desc`)
      .limit(limit);

    return rows.map((r: (typeof rows)[number]) => ({
      userId: r.userId!,
      username: r.username,
      impressions: Number(r.impressions),
      completions: Number(r.completions),
      rewards: Number(r.rewards),
      totalRevenue: parseFloat((Number(r.rewards) * REWARDED_AD_PAYOUT_USD).toFixed(2)),
    }));
  }

  // Total payout per user across ALL earning sources (surveys, offerwalls, games,
  // rewarded-ad claims, bonuses). Every credit writes a positive earnings_ledger
  // row; withdrawals/debits are negative, so filtering amount > 0 isolates payout.
  async getCombinedPayoutPerUser(
    from?: Date,
    to?: Date,
    limit: number = 50,
  ): Promise<
    Array<{ userId: string; username: string; totalPayout: number; txCount: number }>
  > {
    const conditions = [sql`cast(${earningsLedger.amount} as numeric) > 0`];
    if (from) conditions.push(gte(earningsLedger.createdAt, from));
    if (to) conditions.push(sql`${earningsLedger.createdAt} <= ${to}`);

    const rows = await db
      .select({
        userId: earningsLedger.userId,
        username: users.username,
        totalPayout: sql<string>`coalesce(sum(cast(${earningsLedger.amount} as numeric)), 0)`,
        txCount: count(),
      })
      .from(earningsLedger)
      .innerJoin(users, eq(earningsLedger.userId, users.id))
      .where(and(...conditions))
      .groupBy(earningsLedger.userId, users.username)
      .orderBy(sql`coalesce(sum(cast(${earningsLedger.amount} as numeric)), 0) desc`)
      .limit(limit);

    return rows.map((r: (typeof rows)[number]) => ({
      userId: r.userId!,
      username: r.username,
      totalPayout: n(r.totalPayout),
      txCount: Number(r.txCount),
    }));
  }

  // Pending (claimable-soon) USD per user, summed from unclaimed earn_tokens.
  async getPendingByUserIds(userIds: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (userIds.length === 0) return result;
    const rows = await db
      .select({
        userId: earnTokens.userId,
        points: sql<string>`coalesce(sum(${earnTokens.points}), 0)`,
      })
      .from(earnTokens)
      .where(and(eq(earnTokens.status, "pending"), inArray(earnTokens.userId, userIds)))
      .groupBy(earnTokens.userId);
    for (const r of rows) {
      result.set(r.userId, parseFloat((Number(r.points) / POINTS_PER_DOLLAR).toFixed(2)));
    }
    return result;
  }

  async getAdEventTimeline(from?: Date, to?: Date): Promise<
    Array<{
      date: string;
      impressions: number;
      completions: number;
      rewards: number;
      failures: number;
      revenue: number;
    }>
  > {
    const conditions = [];
    if (from) conditions.push(gte(adEvents.createdAt, from));
    if (to) conditions.push(sql`${adEvents.createdAt} <= ${to}`);

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await db
      .select({
        date: sql<string>`date(${adEvents.createdAt})`,
        impressions: sql<number>`count(*) filter (where ${adEvents.event} = 'impression')`,
        completions: sql<number>`count(*) filter (where ${adEvents.event} = 'completion')`,
        rewards: sql<number>`count(*) filter (where ${adEvents.event} = 'reward_earned')`,
        failures: sql<number>`count(*) filter (where ${adEvents.event} = 'load_failed')`,
      })
      .from(adEvents)
      .where(whereClause ?? undefined)
      .groupBy(sql`date(${adEvents.createdAt})`)
      .orderBy(sql`date(${adEvents.createdAt}) desc`)
      .limit(90);

    return rows.map((r: (typeof rows)[number]) => ({
      date: String(r.date),
      impressions: Number(r.impressions),
      completions: Number(r.completions),
      rewards: Number(r.rewards),
      failures: Number(r.failures),
      revenue: parseFloat((Number(r.rewards) * REWARDED_AD_PAYOUT_USD).toFixed(2)),
    }));
  }

  async getFillRateStats(windowMinutes: number = 60): Promise<{
    windowMinutes: number;
    windowStart: Date;
    windowEnd: Date;
    totalAttempts: number;
    impressions: number;
    failures: number;
    fillRate: number;
    failureRate: number;
  }> {
    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - windowMinutes * 60 * 1000);

    const [impressions] = await db
      .select({ value: count() })
      .from(adEvents)
      .where(
        and(
          eq(adEvents.event, "impression"),
          gte(adEvents.createdAt, windowStart),
          sql`${adEvents.createdAt} <= ${windowEnd}`,
        ),
      );

    const [failures] = await db
      .select({ value: count() })
      .from(adEvents)
      .where(
        and(
          eq(adEvents.event, "load_failed"),
          gte(adEvents.createdAt, windowStart),
          sql`${adEvents.createdAt} <= ${windowEnd}`,
        ),
      );

    const impressionCount = Number(impressions?.value ?? 0);
    const failureCount = Number(failures?.value ?? 0);
    const totalAttempts = impressionCount + failureCount;

    return {
      windowMinutes,
      windowStart,
      windowEnd,
      totalAttempts,
      impressions: impressionCount,
      failures: failureCount,
      fillRate: totalAttempts > 0 ? parseFloat(((impressionCount / totalAttempts) * 100).toFixed(1)) : 100,
      failureRate: totalAttempts > 0 ? parseFloat(((failureCount / totalAttempts) * 100).toFixed(1)) : 0,
    };
  }

  async getFillRateTimeline(windowMinutes: number = 60, bucketCount: number = 12): Promise<
    Array<{
      bucketStart: Date;
      bucketEnd: Date;
      impressions: number;
      failures: number;
      totalAttempts: number;
      fillRate: number;
      failureRate: number;
    }>
  > {
    const now = new Date();
    const totalMs = windowMinutes * 60 * 1000;
    const bucketMs = Math.floor(totalMs / bucketCount);
    const windowStart = new Date(now.getTime() - totalMs);

    const rows = await db
      .select({
        event: adEvents.event,
        createdAt: adEvents.createdAt,
      })
      .from(adEvents)
      .where(
        and(
          sql`${adEvents.event} IN ('impression', 'load_failed')`,
          gte(adEvents.createdAt, windowStart),
        ),
      );

    const buckets: Array<{
      bucketStart: Date;
      bucketEnd: Date;
      impressions: number;
      failures: number;
      totalAttempts: number;
      fillRate: number;
      failureRate: number;
    }> = [];

    for (let i = 0; i < bucketCount; i++) {
      const bucketStart = new Date(windowStart.getTime() + i * bucketMs);
      const bucketEnd = new Date(bucketStart.getTime() + bucketMs);
      let impressions = 0;
      let failures = 0;
      for (const row of rows) {
        const t = row.createdAt.getTime();
        if (t >= bucketStart.getTime() && t < bucketEnd.getTime()) {
          if (row.event === "impression") impressions++;
          else if (row.event === "load_failed") failures++;
        }
      }
      const totalAttempts = impressions + failures;
      buckets.push({
        bucketStart,
        bucketEnd,
        impressions,
        failures,
        totalAttempts,
        fillRate: totalAttempts > 0 ? parseFloat(((impressions / totalAttempts) * 100).toFixed(1)) : 100,
        failureRate: totalAttempts > 0 ? parseFloat(((failures / totalAttempts) * 100).toFixed(1)) : 0,
      });
    }

    return buckets;
  }

  async checkFillRateAlerts(opts: {
    windowMinutes?: number;
    failureThresholdPercent?: number;
    minAttempts?: number;
  } = {}): Promise<{
    alert: boolean;
    severity: "ok" | "warning" | "critical";
    message: string;
    stats: {
      windowMinutes: number;
      windowStart: Date;
      windowEnd: Date;
      totalAttempts: number;
      impressions: number;
      failures: number;
      fillRate: number;
      failureRate: number;
    };
    thresholds: {
      failureThresholdPercent: number;
      criticalThresholdPercent: number;
      minAttempts: number;
    };
  }> {
    const windowMinutes = opts.windowMinutes ?? 60;
    const failureThresholdPercent = opts.failureThresholdPercent ?? 30;
    const criticalThresholdPercent = failureThresholdPercent * 1.5;
    const minAttempts = opts.minAttempts ?? 10;

    const stats = await this.getFillRateStats(windowMinutes);

    let alert = false;
    let severity: "ok" | "warning" | "critical" = "ok";
    let message = `Fill rate is healthy at ${stats.fillRate}% over the last ${windowMinutes} minutes.`;

    if (stats.totalAttempts >= minAttempts) {
      if (stats.failureRate >= criticalThresholdPercent) {
        alert = true;
        severity = "critical";
        message = `CRITICAL: Ad failure rate is ${stats.failureRate}% (${stats.failures}/${stats.totalAttempts} attempts) over the last ${windowMinutes} minutes. This exceeds the critical threshold of ${criticalThresholdPercent}%.`;
      } else if (stats.failureRate >= failureThresholdPercent) {
        alert = true;
        severity = "warning";
        message = `WARNING: Ad failure rate is ${stats.failureRate}% (${stats.failures}/${stats.totalAttempts} attempts) over the last ${windowMinutes} minutes. This exceeds the warning threshold of ${failureThresholdPercent}%.`;
      }
    } else if (stats.totalAttempts > 0 && stats.failureRate >= failureThresholdPercent) {
      message = `Fill rate is ${stats.fillRate}% but sample size is small (${stats.totalAttempts} attempts, minimum ${minAttempts} required for alerting).`;
    }

    return {
      alert,
      severity,
      message,
      stats,
      thresholds: {
        failureThresholdPercent,
        criticalThresholdPercent,
        minAttempts,
      },
    };
  }

  async getUserAdStats(userId: string): Promise<{
    totalImpressions: number;
    totalCompletions: number;
    totalRewardsEarned: number;
    totalFailures: number;
    completionRate: number;
  }> {
    const [impressions] = await db
      .select({ value: count() })
      .from(adEvents)
      .where(and(eq(adEvents.userId, userId), eq(adEvents.event, "impression")));

    const [completions] = await db
      .select({ value: count() })
      .from(adEvents)
      .where(and(eq(adEvents.userId, userId), eq(adEvents.event, "completion")));

    const [rewards] = await db
      .select({ total: sql<string>`coalesce(sum(least(cast(${adEvents.rewardAmount} as numeric), 1.0)), 0)` })
      .from(adEvents)
      .where(and(eq(adEvents.userId, userId), eq(adEvents.event, "reward_earned")));

    const [failures] = await db
      .select({ value: count() })
      .from(adEvents)
      .where(and(eq(adEvents.userId, userId), eq(adEvents.event, "load_failed")));

    const totalImpressions = Number(impressions?.value ?? 0);
    const totalCompletions = Number(completions?.value ?? 0);

    return {
      totalImpressions,
      totalCompletions,
      totalRewardsEarned: n(rewards?.total),
      totalFailures: Number(failures?.value ?? 0),
      completionRate: totalImpressions > 0 ? parseFloat(((totalCompletions / totalImpressions) * 100).toFixed(1)) : 0,
    };
  }

  async insertWebhookAudit(entry: InsertWebhookAuditEntry): Promise<WebhookAuditEntry> {
    const [row] = await db.insert(webhookAudit).values(entry).returning();
    return row;
  }

  async countWebhookAuditByIp(ip: string, since: Date): Promise<number> {
    const [row] = await db
      .select({ cnt: count() })
      .from(webhookAudit)
      .where(and(eq(webhookAudit.ip, ip), gte(webhookAudit.createdAt, since)));
    return Number(row?.cnt ?? 0);
  }

  async getWebhookAudits(opts: {
    provider?: string;
    ip?: string;
    since?: Date;
    limit?: number;
  } = {}): Promise<WebhookAuditEntry[]> {
    const conditions = [];
    if (opts.provider) conditions.push(eq(webhookAudit.provider, opts.provider));
    if (opts.ip) conditions.push(eq(webhookAudit.ip, opts.ip));
    if (opts.since) conditions.push(gte(webhookAudit.createdAt, opts.since));
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 10000);
    const where = conditions.length ? and(...conditions) : undefined;
    return await db
      .select()
      .from(webhookAudit)
      .where(where)
      .orderBy(desc(webhookAudit.createdAt))
      .limit(limit);
  }

  async getWebhookAuditOffenders(opts: {
    since?: Date;
    limit?: number;
  } = {}): Promise<Array<{ ip: string; provider: string; count: number; lastSeenAt: Date }>> {
    const conditions = [];
    if (opts.since) conditions.push(gte(webhookAudit.createdAt, opts.since));
    const limit = Math.min(Math.max(opts.limit ?? 10, 1), 100);
    const where = conditions.length ? and(...conditions) : undefined;
    const rows = await db
      .select({
        ip: webhookAudit.ip,
        provider: webhookAudit.provider,
        count: count(),
        lastSeenAt: sql<Date>`max(${webhookAudit.createdAt})`,
      })
      .from(webhookAudit)
      .where(where)
      .groupBy(webhookAudit.ip, webhookAudit.provider)
      .orderBy(desc(count()))
      .limit(limit);
    return rows.map((r: (typeof rows)[number]) => ({
      ip: r.ip,
      provider: r.provider,
      count: Number(r.count),
      lastSeenAt: r.lastSeenAt instanceof Date ? r.lastSeenAt : new Date(r.lastSeenAt as unknown as string),
    }));
  }

  async pruneWebhookAudit(before: Date): Promise<number> {
    const rows = await db
      .delete(webhookAudit)
      .where(lt(webhookAudit.createdAt, before))
      .returning({ id: webhookAudit.id });
    return rows.length;
  }

  async getWebhookAuditProviders(): Promise<string[]> {
    const rows = await db
      .selectDistinct({ provider: webhookAudit.provider })
      .from(webhookAudit);
    return rows.map((r: (typeof rows)[number]) => r.provider).sort();
  }

  async pruneSecurityAudit(before: Date): Promise<number> {
    const rows = await db
      .delete(securityAuditLog)
      .where(lt(securityAuditLog.createdAt, before))
      .returning({ id: securityAuditLog.id });
    return rows.length;
  }
}

export const storage = new DatabaseStorage();
