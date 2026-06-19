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
  type UserNotification,
  users,
  withdrawals,
  earningsLedger,
  earnTokens,
  rewardSessions,
  unsettledCompletions,
  adEvents,
  admobReportSnapshots,
  type AdmobReportSnapshot,
  webhookAudit,
  securityAuditLog,
  supportReplies,
  type SupportReply,
  type InsertSupportReply,
  publisherAuditLog,
  campaigns,
  userNotifications,
} from "@workspace/db";
import { db } from "@workspace/db";
import { eq, ne, desc, and, or, sql, gte, lt, inArray, count, sum, between, ilike, isNotNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

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

export interface SupportReplyView {
  id: string;
  adminUserId: string;
  adminUsername: string | null;
  adminEmail: string | null;
  recipient: string;
  subject: string;
  body: string;
  inReplyTo: string | null;
  createdAt: Date;
}

export interface PublisherAuditEntryView {
  id: string;
  actorUserId: string;
  actorUsername: string | null;
  targetUserId: string | null;
  targetUsername: string | null;
  campaignId: string | null;
  campaignTitle: string | null;
  action: string;
  detail: Record<string, unknown> | null;
  createdAt: Date;
}

export type LedgerType =
  | "survey"
  | "offerwall"
  | "withdrawal"
  | "withdrawal_refund"
  | "bonus"
  | "referral"
  | "adjustment";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getAllUsers(limit?: number, offset?: number): Promise<{ users: User[]; total: number }>;
  getAdjustmentLedger(limit?: number): Promise<Array<{ id: string; userId: string; username: string; email: string | null; amount: string; description: string | null; actorUserId: string | null; actorUsername: string | null; createdAt: Date }>>;
  createUser(user: InsertUser & { role?: string }): Promise<User>;
  updateUserPassword(id: string, hashedPassword: string): Promise<{ tokenVersion: number }>;
  incrementTokenVersion(id: string, expectedVersion?: number): Promise<{ tokenVersion: number } | null>;
  touchUserLastSeen(id: string): Promise<void>;
  countOnlineUsers(withinMs: number): Promise<number>;
  getAdminOverviewStats(): Promise<{
    totalUsers: number;
    activeToday: number;
    pendingPayouts: { count: number; amount: number };
  }>;
  setTotpBackupCodes(userId: string, hashes: string[]): Promise<void>;
  setPaypalEmail(userId: string, email: string): Promise<{ ok: boolean; conflict: boolean }>;
  recordSecurityAudit(args: { actorUserId: string; event: SecurityAuditEvent; targetUserId?: string | null; ip?: string | null }): Promise<void>;
  getSecurityAuditEntries(opts?: {
    actorUserId?: string;
    event?: SecurityAuditEvent;
    limit?: number;
    offset?: number;
  }): Promise<{ entries: SecurityAuditEntryView[]; total: number }>;
  createSupportReply(entry: InsertSupportReply): Promise<SupportReply>;
  getSupportRepliesByThread(inReplyTo: string): Promise<SupportReplyView[]>;
  getSupportRepliesByIssue(issueType: string, lang: string, limit: number): Promise<SupportReply[]>;
  listSupportReplies(opts?: {
    recipient?: string;
    adminUserId?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ replies: SupportReplyView[]; total: number }>;
  logPublisherAudit(entry: {
    actorUserId: string;
    targetUserId?: string | null;
    campaignId?: string | null;
    action: string;
    detail?: Record<string, unknown> | null;
  }): Promise<void>;
  getPublisherAuditLog(opts?: {
    limit?: number;
    offset?: number;
  }): Promise<{ entries: PublisherAuditEntryView[]; total: number }>;
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
  qualifyReferral(args: {
    referredUserId: string;
    bonusUsd: number;
  }): Promise<{ credited: boolean; referrerId?: string; referrerUsername?: string; referrerEmail?: string | null }>;
  insertUserNotification(args: {
    userId: string;
    title: string;
    message: string;
    type: string;
  }): Promise<void>;
  getUserNotifications(userId: string, limit?: number): Promise<UserNotification[]>;
  markUserNotificationRead(id: string, userId: string): Promise<void>;
  markAllUserNotificationsRead(userId: string): Promise<void>;
  getReferralBackfillCandidates(minWithdrawalUsd: number): Promise<
    { id: string; username: string; referredBy: string }[]
  >;
  getReferralStats(username: string): Promise<{
    totalReferrals: number;
    qualifiedReferrals: number;
    pendingReferrals: number;
    referrals: { username: string; joinedAt: Date; qualified: boolean; qualifiedAt: Date | null }[];
  }>;
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
    maxPerDay: number;
    dailyFloatMax: number;
    dayStart: Date;
  }): Promise<
    | { ok: true; withdrawal: Withdrawal; balance: number; withdrawalsTodayCount: number }
    | { ok: false; reason: "DAILY_CAP_EXCEEDED"; withdrawnToday: number; remaining: number }
    | { ok: false; reason: "DAILY_COUNT_EXCEEDED"; withdrawalsTodayCount: number; maxPerDay: number }
    | { ok: false; reason: "FLOAT_EXCEEDED"; floatMax: number; paidOutToday: number; remaining: number }
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
  hasCreditedCompletion(
    source: "survey" | "offerwall",
    userId: string,
    externalId: string,
    providerTransactionId?: string | null,
  ): Promise<boolean>;
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

  recordUnsettledCompletion(args: {
    source: "survey" | "offerwall";
    provider: string;
    userId: string;
    externalId: string;
    providerTransactionId?: string | null;
    rewardValue?: number | null;
    reason: string;
  }): Promise<void>;

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

  async incrementTokenVersion(
    id: string,
    expectedVersion?: number,
  ): Promise<{ tokenVersion: number } | null> {
    const whereClause =
      expectedVersion !== undefined
        ? and(eq(users.id, id), eq(users.tokenVersion, expectedVersion))
        : eq(users.id, id);
    const [updated] = await db
      .update(users)
      .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(whereClause)
      .returning({ tokenVersion: users.tokenVersion });
    // Returns null when a CAS expectedVersion was supplied and another
    // concurrent refresh already rotated the version past it.
    return updated ?? null;
  }

  // Mark a user as recently active. Guarded by a SQL WHERE so it only writes
  // when the stored value is stale (>50s old), which keeps writes bounded even
  // across replicas (the in-process throttle in the auth middleware is just an
  // optimization on top of this). Best-effort: callers swallow errors so a DB
  // blip never breaks an authenticated request.
  async touchUserLastSeen(id: string): Promise<void> {
    await db
      .update(users)
      .set({ lastSeenAt: sql`now()` })
      .where(
        and(
          eq(users.id, id),
          or(
            sql`${users.lastSeenAt} IS NULL`,
            sql`${users.lastSeenAt} < now() - interval '50 seconds'`,
          ),
        ),
      );
  }

  // Count distinct users whose last authenticated request was within the given
  // window (used for the "users online (last 5 min)" indicator).
  async countOnlineUsers(withinMs: number): Promise<number> {
    const since = new Date(Date.now() - withinMs);
    const [row] = await db
      .select({ total: count() })
      .from(users)
      .where(gte(users.lastSeenAt, since));
    return Number(row?.total ?? 0);
  }

  // Real overview numbers for the admin dashboard: total registered users,
  // users active since local-server midnight today, and the count + summed
  // dollar amount of withdrawals still awaiting payout. All derived from the
  // DB — never fabricated.
  async getAdminOverviewStats(): Promise<{
    totalUsers: number;
    activeToday: number;
    pendingPayouts: { count: number; amount: number };
  }> {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const [[totalRow], [activeRow], [payoutRow]] = await Promise.all([
      db.select({ total: count() }).from(users),
      db.select({ total: count() }).from(users).where(gte(users.lastSeenAt, startOfToday)),
      db
        .select({
          cnt: count(),
          // total_payout = base amount + any approved bonus, i.e. the real cash
          // that will actually leave on payout (not just the requested base).
          amount: sql<string>`coalesce(sum(${withdrawals.totalPayout}::numeric), 0)`,
        })
        .from(withdrawals)
        .where(eq(withdrawals.status, "pending")),
    ]);
    return {
      totalUsers: Number(totalRow?.total ?? 0),
      activeToday: Number(activeRow?.total ?? 0),
      pendingPayouts: {
        count: Number(payoutRow?.cnt ?? 0),
        amount: Number(payoutRow?.amount ?? 0),
      },
    };
  }

  async setTotpBackupCodes(userId: string, hashes: string[], executor: Executor = db): Promise<void> {
    await executor.update(users).set({ totpBackupCodes: hashes }).where(eq(users.id, userId));
  }

  async setPaypalEmail(userId: string, email: string): Promise<{ ok: boolean; conflict: boolean }> {
    const { isNull, and } = await import("drizzle-orm");
    try {
      const result = await db
        .update(users)
        .set({ paypalEmail: email, paypalEmailSetAt: new Date() })
        .where(and(eq(users.id, userId), isNull(users.paypalEmail)));
      const affected = (result as any).rowCount ?? (result as any).rowsAffected ?? 0;
      return { ok: affected > 0, conflict: false };
    } catch (err: any) {
      if (err?.code === "23505") {
        return { ok: false, conflict: true };
      }
      throw err;
    }
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

  // Persist a support reply sent from the /sc-portal Inbox so the team has a
  // durable, browsable audit trail that survives restarts (logs are ephemeral).
  async createSupportReply(entry: InsertSupportReply): Promise<SupportReply> {
    const [row] = await db.insert(supportReplies).values(entry).returning();
    return row;
  }

  // Prior replies for a selected thread, looked up by the original message's
  // Message-ID. Oldest first so the conversation reads top-to-bottom. Joins the
  // sending admin so the UI can attribute each reply.
  async getSupportRepliesByIssue(
    issueType: string,
    lang: string,
    limit: number,
  ): Promise<SupportReply[]> {
    const rows = await db
      .select()
      .from(supportReplies)
      .where(
        and(
          eq(supportReplies.issueType, issueType),
          eq(supportReplies.lang, lang),
        ),
      )
      .orderBy(desc(supportReplies.createdAt))
      .limit(limit);
    return rows;
  }

  async getSupportRepliesByThread(
    inReplyTo: string,
  ): Promise<SupportReplyView[]> {
    if (!inReplyTo) return [];
    const rows = await db
      .select({
        id: supportReplies.id,
        adminUserId: supportReplies.adminUserId,
        adminUsername: users.username,
        adminEmail: users.email,
        recipient: supportReplies.recipient,
        subject: supportReplies.subject,
        body: supportReplies.body,
        inReplyTo: supportReplies.inReplyTo,
        createdAt: supportReplies.createdAt,
      })
      .from(supportReplies)
      .leftJoin(users, eq(supportReplies.adminUserId, users.id))
      .where(eq(supportReplies.inReplyTo, inReplyTo))
      .orderBy(supportReplies.createdAt);

    return rows.map((r: (typeof rows)[number]) => ({
      id: r.id,
      adminUserId: r.adminUserId,
      adminUsername: r.adminUsername ?? null,
      adminEmail: r.adminEmail ?? null,
      recipient: r.recipient,
      subject: r.subject,
      body: r.body,
      inReplyTo: r.inReplyTo ?? null,
      createdAt: r.createdAt,
    }));
  }

  // Global, paginated log of every support reply the team has ever sent, across
  // all threads. Newest first so operators see the most recent activity. Optional
  // filters narrow by recipient (substring, case-insensitive) or sending admin.
  async listSupportReplies(opts: {
    recipient?: string;
    adminUserId?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ replies: SupportReplyView[]; total: number }> {
    const conditions = [];
    if (opts.recipient) {
      conditions.push(ilike(supportReplies.recipient, `%${opts.recipient}%`));
    }
    if (opts.adminUserId) {
      conditions.push(eq(supportReplies.adminUserId, opts.adminUserId));
    }
    const where = conditions.length ? and(...conditions) : undefined;
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);

    const [rows, [totalRow]] = await Promise.all([
      db
        .select({
          id: supportReplies.id,
          adminUserId: supportReplies.adminUserId,
          adminUsername: users.username,
          adminEmail: users.email,
          recipient: supportReplies.recipient,
          subject: supportReplies.subject,
          body: supportReplies.body,
          inReplyTo: supportReplies.inReplyTo,
          createdAt: supportReplies.createdAt,
        })
        .from(supportReplies)
        .leftJoin(users, eq(supportReplies.adminUserId, users.id))
        .where(where)
        .orderBy(desc(supportReplies.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: count() })
        .from(supportReplies)
        .where(where),
    ]);

    return {
      replies: rows.map((r: (typeof rows)[number]) => ({
        id: r.id,
        adminUserId: r.adminUserId,
        adminUsername: r.adminUsername ?? null,
        adminEmail: r.adminEmail ?? null,
        recipient: r.recipient,
        subject: r.subject,
        body: r.body,
        inReplyTo: r.inReplyTo ?? null,
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
    actorUserId,
  }: {
    userId: string;
    amount: number;
    type: LedgerType;
    description: string;
    refId?: string;
    provider?: string;
    actorUserId?: string;
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
        actorUserId: actorUserId ?? null,
      });

      return { balance: n(updated.balance), totalEarned: n(updated.totalEarned) };
    });
  }

  // Qualify a referral: the first time a REFERRED user completes a $3+ cash-out,
  // credit their referrer exactly once. Idempotent and race-safe — the referred
  // user's row is locked FOR UPDATE and `referralCreditedAt` is the guard, so a
  // concurrent (or repeat) withdrawal can never double-credit. The referrer is
  // resolved from the referred user's `referredBy` (which stores the referrer's
  // normalized username, i.e. their shareable referral code). We always stamp
  // `referralCreditedAt` once the gate fires — even if the referrer is missing
  // or it would be a self-referral — so the user isn't re-scanned on every
  // future withdrawal.
  async qualifyReferral(args: {
    referredUserId: string;
    bonusUsd: number;
  }): Promise<{ credited: boolean; referrerId?: string; referrerUsername?: string; referrerEmail?: string | null }> {
    const { referredUserId, bonusUsd } = args;
    const bonusStr = bonusUsd.toFixed(2);

    return await db.transaction(async (tx: DbTx) => {
      await tx.execute(sql`SELECT id FROM ${users} WHERE id = ${referredUserId} FOR UPDATE`);

      const [referred] = await tx
        .select({
          id: users.id,
          username: users.username,
          referredBy: users.referredBy,
          referralCreditedAt: users.referralCreditedAt,
        })
        .from(users)
        .where(eq(users.id, referredUserId))
        .limit(1);

      // Already credited (idempotent) or no referrer on record — nothing to do.
      if (!referred || referred.referralCreditedAt || !referred.referredBy) {
        return { credited: false as const };
      }

      // Stamp first so this user is never re-evaluated, regardless of outcome.
      await tx
        .update(users)
        .set({ referralCreditedAt: new Date() })
        .where(eq(users.id, referredUserId));

      const [referrer] = await tx
        .select({ id: users.id, username: users.username, email: users.email })
        .from(users)
        .where(eq(users.username, referred.referredBy))
        .limit(1);

      // Unknown code or self-referral: gate is closed, but no payout.
      if (!referrer || referrer.id === referredUserId) {
        return { credited: false as const };
      }

      await tx
        .update(users)
        .set({
          balance: sql`${users.balance} + ${bonusStr}`,
          totalEarned: sql`${users.totalEarned} + ${bonusStr}`,
        })
        .where(eq(users.id, referrer.id));

      await tx.insert(earningsLedger).values({
        userId: referrer.id,
        amount: bonusStr,
        type: "referral" as const,
        description: `Referral bonus — ${referred.username} cashed out`,
        refId: referredUserId,
      });

      return {
        credited: true as const,
        referrerId: referrer.id,
        referrerUsername: referrer.username,
        referrerEmail: referrer.email,
      };
    });
  }

  async insertUserNotification(args: {
    userId: string;
    title: string;
    message: string;
    type: string;
  }): Promise<void> {
    await db.insert(userNotifications).values(args);
  }

  async getUserNotifications(userId: string, limit = 50): Promise<UserNotification[]> {
    return db
      .select()
      .from(userNotifications)
      .where(eq(userNotifications.userId, userId))
      .orderBy(desc(userNotifications.createdAt))
      .limit(limit);
  }

  async markUserNotificationRead(id: string, userId: string): Promise<void> {
    await db
      .update(userNotifications)
      .set({ read: true })
      .where(and(eq(userNotifications.id, id), eq(userNotifications.userId, userId)));
  }

  async markAllUserNotificationsRead(userId: string): Promise<void> {
    await db
      .update(userNotifications)
      .set({ read: true })
      .where(eq(userNotifications.userId, userId));
  }

  // One-time backfill helper: find referred users who completed a qualifying
  // (>= minWithdrawalUsd) cash-out BEFORE referral enforcement shipped, so they
  // never triggered `qualifyReferral`. These are users with `referredBy` set,
  // `referralCreditedAt` still NULL, and at least one withdrawal at or above the
  // qualifying amount.
  //
  // NOTE: The forward rule now fires on payout *success* (PayPal webhook
  // SUCCEEDED or admin "paid" confirmation), not on withdrawal request creation.
  // This backfill intentionally does NOT filter by withdrawal status — it
  // captures historical pre-enforcement requests where we can no longer
  // determine success with certainty, so it errs on the side of crediting.
  // The returned ids are fed through the same idempotent `qualifyReferral`
  // path, so re-running is safe.
  async getReferralBackfillCandidates(
    minWithdrawalUsd: number,
  ): Promise<{ id: string; username: string; referredBy: string }[]> {
    const minStr = minWithdrawalUsd.toFixed(2);
    const rows = await db
      .selectDistinct({
        id: users.id,
        username: users.username,
        referredBy: users.referredBy,
      })
      .from(users)
      .innerJoin(withdrawals, eq(withdrawals.userId, users.id))
      .where(
        and(
          sql`${users.referredBy} IS NOT NULL`,
          sql`${users.referralCreditedAt} IS NULL`,
          gte(withdrawals.amount, minStr),
        ),
      );
    return rows.filter(
      (r): r is { id: string; username: string; referredBy: string } =>
        typeof r.referredBy === "string" && r.referredBy.length > 0,
    );
  }

  // Referral stats for a referrer, keyed by their username (== their referral
  // code). A referred friend is "qualified" once they've completed a $3+ cash-out
  // (referralCreditedAt set); otherwise they are "pending".
  async getReferralStats(username: string): Promise<{
    totalReferrals: number;
    qualifiedReferrals: number;
    pendingReferrals: number;
    referrals: { username: string; joinedAt: Date; qualified: boolean; qualifiedAt: Date | null }[];
  }> {
    const rows = await db
      .select({
        username: users.username,
        joinedAt: users.createdAt,
        qualifiedAt: users.referralCreditedAt,
      })
      .from(users)
      .where(eq(users.referredBy, username))
      .orderBy(desc(users.createdAt));

    const referrals = rows.map((r) => ({
      username: r.username,
      joinedAt: r.joinedAt,
      qualified: !!r.qualifiedAt,
      qualifiedAt: r.qualifiedAt ?? null,
    }));
    const qualifiedReferrals = referrals.filter((r) => r.qualified).length;
    return {
      totalReferrals: referrals.length,
      qualifiedReferrals,
      pendingReferrals: referrals.length - qualifiedReferrals,
      referrals,
    };
  }

  async debitUser({
    userId,
    amount,
    type,
    description,
    refId,
    actorUserId,
  }: {
    userId: string;
    amount: number;
    type: LedgerType;
    description: string;
    refId?: string;
    actorUserId?: string;
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
        actorUserId: actorUserId ?? null,
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

  async getAdjustmentLedger(limit: number = 100, actor?: string): Promise<Array<{ id: string; userId: string; username: string; email: string | null; amount: string; description: string | null; actorUserId: string | null; actorUsername: string | null; createdAt: Date }>> {
    const actorAlias = alias(users, "actor");
    const conditions = [eq(earningsLedger.type, "adjustment")];
    const actorFilter = actor?.trim();
    if (actorFilter) {
      conditions.push(
        or(
          eq(earningsLedger.actorUserId, actorFilter),
          eq(actorAlias.username, actorFilter),
        )!,
      );
    }
    return db
      .select({
        id: earningsLedger.id,
        userId: earningsLedger.userId,
        username: users.username,
        email: users.email,
        amount: earningsLedger.amount,
        description: earningsLedger.description,
        actorUserId: earningsLedger.actorUserId,
        actorUsername: actorAlias.username,
        createdAt: earningsLedger.createdAt,
      })
      .from(earningsLedger)
      .innerJoin(users, eq(earningsLedger.userId, users.id))
      .leftJoin(actorAlias, eq(earningsLedger.actorUserId, actorAlias.id))
      .where(and(...conditions))
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
    maxPerDay: number;
    dailyFloatMax: number;
    dayStart: Date;
  }): Promise<
    | { ok: true; withdrawal: Withdrawal; balance: number; withdrawalsTodayCount: number }
    | { ok: false; reason: "DAILY_CAP_EXCEEDED"; withdrawnToday: number; remaining: number }
    | { ok: false; reason: "DAILY_COUNT_EXCEEDED"; withdrawalsTodayCount: number; maxPerDay: number }
    | { ok: false; reason: "FLOAT_EXCEEDED"; floatMax: number; paidOutToday: number; remaining: number }
    | { ok: false; reason: "INSUFFICIENT_BALANCE"; balance: number }
  > {
    const { userId, username, amount, bonusPercent, bonusAmount, totalPayout, paypalEmail, dailyCapMax, maxPerDay, dailyFloatMax, dayStart } = args;
    const amountStr = amount.toFixed(2);

    return await db.transaction(async (tx: DbTx) => {
      // Serialize all withdrawal creations globally for the duration of this
      // transaction with a transaction-scoped advisory lock. This is required so
      // the per-day FLOAT (total outflow across ALL users) check below is
      // race-free: a row lock on one user would not stop a concurrent
      // withdrawal by a different user from blowing past the float ceiling.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(742241)`);

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

      // Per-user count limit (e.g. max 2 withdrawals/day).
      if (priorWithdrawalsToday >= maxPerDay) {
        return {
          ok: false as const,
          reason: "DAILY_COUNT_EXCEEDED" as const,
          withdrawalsTodayCount: priorWithdrawalsToday,
          maxPerDay,
        };
      }

      if (withdrawnToday + amount > dailyCapMax + 1e-9) {
        const remaining = Math.max(0, dailyCapMax - withdrawnToday);
        return { ok: false as const, reason: "DAILY_CAP_EXCEEDED" as const, withdrawnToday, remaining };
      }

      // Float discipline: total outflow committed across ALL users today must
      // not exceed the revenue float. Rejected (refunded) withdrawals don't
      // count because that money was returned to the user, never paid out.
      const [floatRow] = await tx
        .select({ total: sql<string>`COALESCE(SUM(${withdrawals.amount}::numeric), 0)` })
        .from(withdrawals)
        .where(and(gte(withdrawals.createdAt, dayStart), ne(withdrawals.status, "rejected")));

      const paidOutToday = parseFloat(floatRow?.total ?? "0");
      if (paidOutToday + amount > dailyFloatMax + 1e-9) {
        const remaining = Math.max(0, dailyFloatMax - paidOutToday);
        return { ok: false as const, reason: "FLOAT_EXCEEDED" as const, floatMax: dailyFloatMax, paidOutToday, remaining };
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

  // Find-and-update an existing pending session for (userId, source, externalId),
  // refreshing its expectedReward to the current listed price and resetting the
  // TTL. If no valid pending session exists, insert a fresh one using
  // newSessionToken. Returning the session either way means the caller always
  // works with the single canonical token for this item, preventing the
  // reward-inflation attack where multiple sessions for the same item accumulate
  // at different cached price points and the attacker picks the highest one.
  async upsertPendingRewardSession(args: {
    newSessionToken: string;
    userId: string;
    source: "survey" | "offerwall";
    provider: string;
    externalId: string;
    expectedReward: number;
    expiresAt: Date;
  }): Promise<RewardSession> {
    return await db.transaction(async (tx: DbTx) => {
      const now = new Date();
      const rewardStr = args.expectedReward.toFixed(2);

      // Lock any existing pending non-expired session for this (user, source,
      // externalId) tuple so concurrent start calls serialize here and don't
      // each insert their own session.
      const [existing] = await tx
        .select()
        .from(rewardSessions)
        .where(
          and(
            eq(rewardSessions.userId, args.userId),
            eq(rewardSessions.source, args.source),
            eq(rewardSessions.externalId, args.externalId),
            eq(rewardSessions.status, "pending"),
            gte(rewardSessions.expiresAt, now),
          ),
        )
        .limit(1)
        .for("update");

      if (existing) {
        // Refresh the reward to the current listed price and extend the TTL.
        // This prevents the attacker from holding a stale high-value session
        // while the provider has since lowered the payout.
        const [updated] = await tx
          .update(rewardSessions)
          .set({ expectedReward: rewardStr, expiresAt: args.expiresAt })
          .where(eq(rewardSessions.sessionToken, existing.sessionToken))
          .returning();

        // Move any other pending sessions for this item to 'expired' so they
        // are no longer claimable and no longer match the pendingUnique index.
        // Leaving status='pending' but just setting expiresAt=now would still
        // hold the unique index slot and block future inserts.
        await tx
          .update(rewardSessions)
          .set({ status: "expired", expiresAt: now })
          .where(
            and(
              eq(rewardSessions.userId, args.userId),
              eq(rewardSessions.source, args.source),
              eq(rewardSessions.externalId, args.externalId),
              eq(rewardSessions.status, "pending"),
              ne(rewardSessions.sessionToken, existing.sessionToken),
            ),
          );

        return updated;
      }

      // Move any orphaned pending sessions for this item to 'expired' before
      // inserting the canonical new one. Status must change so the pendingUnique
      // index slot is freed — expiresAt-only would leave them status='pending'.
      await tx
        .update(rewardSessions)
        .set({ status: "expired", expiresAt: now })
        .where(
          and(
            eq(rewardSessions.userId, args.userId),
            eq(rewardSessions.source, args.source),
            eq(rewardSessions.externalId, args.externalId),
            eq(rewardSessions.status, "pending"),
          ),
        );

      try {
        const [inserted] = await tx
          .insert(rewardSessions)
          .values({
            sessionToken: args.newSessionToken,
            userId: args.userId,
            source: args.source,
            provider: args.provider,
            externalId: args.externalId,
            expectedReward: rewardStr,
            expiresAt: args.expiresAt,
            status: "pending",
          })
          .returning();
        return inserted;
      } catch (insertErr: unknown) {
        // A concurrent /start on the same item may have raced past our SELECT
        // and inserted first, violating pendingUnique. Re-read the winner and
        // update it to the current price so the caller gets the canonical token.
        const code = (insertErr as { code?: string } | null)?.code;
        if (code === "23505") {
          const [winner] = await tx
            .select()
            .from(rewardSessions)
            .where(
              and(
                eq(rewardSessions.userId, args.userId),
                eq(rewardSessions.source, args.source),
                eq(rewardSessions.externalId, args.externalId),
                eq(rewardSessions.status, "pending"),
                gte(rewardSessions.expiresAt, now),
              ),
            )
            .limit(1);
          if (winner) {
            const [refreshed] = await tx
              .update(rewardSessions)
              .set({ expectedReward: rewardStr, expiresAt: args.expiresAt })
              .where(eq(rewardSessions.sessionToken, winner.sessionToken))
              .returning();
            return refreshed;
          }
        }
        throw insertErr;
      }
    });
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

  // Returns true if this completion was already credited (a completed reward
  // session exists for the same user+externalId, or the same provider
  // transaction id). Used to suppress false-positive "unsettled" records on
  // webhook retries/resends of an already-paid completion. Best-effort: on a
  // query error it returns false so a genuine lost completion is still caught.
  async hasCreditedCompletion(
    source: "survey" | "offerwall",
    userId: string,
    externalId: string,
    providerTransactionId?: string | null,
  ): Promise<boolean> {
    try {
      const [byExternal] = await db
        .select({ id: rewardSessions.id })
        .from(rewardSessions)
        .where(
          and(
            eq(rewardSessions.source, source),
            eq(rewardSessions.userId, userId),
            eq(rewardSessions.externalId, externalId),
            eq(rewardSessions.status, "completed"),
          ),
        )
        .limit(1);
      if (byExternal) return true;
      if (providerTransactionId) {
        const [byTxn] = await db
          .select({ id: rewardSessions.id })
          .from(rewardSessions)
          .where(
            and(
              eq(rewardSessions.source, source),
              eq(rewardSessions.providerTransactionId, providerTransactionId),
              eq(rewardSessions.status, "completed"),
            ),
          )
          .limit(1);
        if (byTxn) return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  async recordUnsettledCompletion(args: {
    source: "survey" | "offerwall";
    provider: string;
    userId: string;
    externalId: string;
    providerTransactionId?: string | null;
    rewardValue?: number | null;
    reason: string;
  }): Promise<void> {
    try {
      const reward =
        args.rewardValue != null && Number.isFinite(args.rewardValue)
          ? args.rewardValue.toFixed(2)
          : null;
      await db.insert(unsettledCompletions).values({
        source: args.source,
        provider: args.provider,
        userId: args.userId,
        externalId: args.externalId,
        providerTransactionId: args.providerTransactionId ?? null,
        rewardValue: reward,
        reason: args.reason,
      });
    } catch {
      // Best-effort reconciliation record — never throw from the webhook path.
    }
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

  /**
   * Idempotently upsert daily per-format AdMob snapshots. Re-running for the
   * same (date, format) updates the existing row (refreshing syncedAt) instead
   * of duplicating it. Returns the number of rows written.
   */
  async upsertAdmobSnapshots(
    rows: Array<{
      date: string;
      adFormat: string;
      earnings: number;
      impressions: number;
      clicks: number;
      ecpm: number;
      currency?: string;
    }>,
  ): Promise<number> {
    if (rows.length === 0) return 0;
    const now = new Date();
    const values = rows.map((r) => ({
      date: r.date,
      adFormat: (r.adFormat || "UNKNOWN").toUpperCase(),
      earnings: String(r.earnings ?? 0),
      impressions: String(Math.round(r.impressions ?? 0)),
      clicks: String(Math.round(r.clicks ?? 0)),
      ecpm: String(r.ecpm ?? 0),
      currency: r.currency || "USD",
      syncedAt: now,
    }));
    await db
      .insert(admobReportSnapshots)
      .values(values)
      .onConflictDoUpdate({
        target: [admobReportSnapshots.date, admobReportSnapshots.adFormat],
        set: {
          earnings: sql`excluded.earnings`,
          impressions: sql`excluded.impressions`,
          clicks: sql`excluded.clicks`,
          ecpm: sql`excluded.ecpm`,
          currency: sql`excluded.currency`,
          syncedAt: sql`excluded.synced_at`,
        },
      });
    return values.length;
  }

  /** Most recent syncedAt across all snapshots, or null if none stored yet. */
  async getAdmobLastSyncedAt(): Promise<Date | null> {
    const [row] = await db
      .select({ last: sql<string | null>`max(${admobReportSnapshots.syncedAt})` })
      .from(admobReportSnapshots);
    return row?.last ? new Date(row.last) : null;
  }

  /**
   * Query the SSV credit-health counters needed by the scheduled SSV alert job.
   * Returns the same values the admin `/api/admin/admob/ssv-health` route computes
   * so the job can call `evaluateSsvAlerts` without hitting the HTTP layer.
   *
   * `staleAlert` is true when videos were watched today but no SSV credit has
   * arrived in the past 6 hours — the fingerprint of an SSV crediting outage.
   */
  async getSsvHealthStats(): Promise<{
    ssvToday: number;
    fallbackToday: number;
    totalToday: number;
    lastSsvAt: string | null;
    staleAlert: boolean;
  }> {
    const SSV_STALE_MS = 6 * 60 * 60 * 1000;
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setUTCHours(0, 0, 0, 0);

    const [ssvRow, totalRow, lastRow] = await Promise.all([
      db
        .select({ n: sql<string>`count(*)` })
        .from(earnTokens)
        .where(
          and(
            eq(earnTokens.actionType, "rewarded_ad"),
            sql`${earnTokens.description} like '%SSV verified%'`,
            gte(earnTokens.earnedAt, todayStart),
          ),
        ),
      db
        .select({ n: sql<string>`count(*)` })
        .from(earnTokens)
        .where(
          and(
            eq(earnTokens.actionType, "rewarded_ad"),
            gte(earnTokens.earnedAt, todayStart),
          ),
        ),
      db
        .select({ lastAt: sql<Date | null>`max(${earnTokens.earnedAt})` })
        .from(earnTokens)
        .where(
          and(
            eq(earnTokens.actionType, "rewarded_ad"),
            sql`${earnTokens.description} like '%SSV verified%'`,
          ),
        ),
    ]);

    const ssvToday = Number(ssvRow[0]?.n ?? 0);
    const totalToday = Number(totalRow[0]?.n ?? 0);
    const fallbackToday = totalToday - ssvToday;
    const lastSsvAt = lastRow[0]?.lastAt ? new Date(lastRow[0].lastAt).toISOString() : null;
    const lastSsvMs = lastSsvAt ? new Date(lastSsvAt).getTime() : 0;
    const staleAlert = totalToday > 0 && now.getTime() - lastSsvMs > SSV_STALE_MS;

    return { ssvToday, fallbackToday, totalToday, lastSsvAt, staleAlert };
  }

  /**
   * Read AdMob earnings from the persisted store for the last `days` UTC days
   * (inclusive of today). Returns roll-up totals, a per-format breakdown, the
   * daily series, currency, and the last-synced timestamp. Never fabricates —
   * absent data simply sums to zero. The "TOTAL" pseudo-format is excluded from
   * the per-format breakdown to avoid double-counting.
   */
  async getAdmobSnapshotSummary(days: number): Promise<{
    range: { startDate: string; endDate: string; days: number };
    currency: string;
    totals: { earnings: number; impressions: number; clicks: number; ecpm: number };
    byFormat: Array<{ adFormat: string; earnings: number; impressions: number; clicks: number; ecpm: number }>;
    daily: Array<{ date: string; earnings: number; impressions: number }>;
    lastSyncedAt: string | null;
    rowCount: number;
  }> {
    const safeDays = Math.min(Math.max(Math.floor(days) || 30, 1), 365);
    const end = new Date();
    const start = new Date(end.getTime() - (safeDays - 1) * 24 * 60 * 60 * 1000);
    const ymd = (d: Date) =>
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    const startDate = ymd(start);
    const endDate = ymd(end);

    const rows = (await db
      .select()
      .from(admobReportSnapshots)
      .where(
        and(
          gte(admobReportSnapshots.date, startDate),
          sql`${admobReportSnapshots.date} <= ${endDate}`,
          ne(admobReportSnapshots.adFormat, "TOTAL"),
        ),
      )) as AdmobReportSnapshot[];

    const currency = rows[0]?.currency || "USD";
    let lastSynced: Date | null = null;
    const fmtMap = new Map<string, { earnings: number; impressions: number; clicks: number }>();
    const dayMap = new Map<string, { earnings: number; impressions: number }>();
    let totEarnings = 0;
    let totImpr = 0;
    let totClicks = 0;

    for (const r of rows) {
      const earnings = Number(r.earnings) || 0;
      const impressions = Number(r.impressions) || 0;
      const clicks = Number(r.clicks) || 0;
      totEarnings += earnings;
      totImpr += impressions;
      totClicks += clicks;

      const f = fmtMap.get(r.adFormat) || { earnings: 0, impressions: 0, clicks: 0 };
      f.earnings += earnings;
      f.impressions += impressions;
      f.clicks += clicks;
      fmtMap.set(r.adFormat, f);

      const d = dayMap.get(r.date) || { earnings: 0, impressions: 0 };
      d.earnings += earnings;
      d.impressions += impressions;
      dayMap.set(r.date, d);

      const sAt = r.syncedAt ? new Date(r.syncedAt) : null;
      if (sAt && (!lastSynced || sAt > lastSynced)) lastSynced = sAt;
    }

    const byFormat = Array.from(fmtMap.entries())
      .map(([adFormat, v]) => ({
        adFormat,
        earnings: Number(v.earnings.toFixed(2)),
        impressions: v.impressions,
        clicks: v.clicks,
        ecpm: v.impressions > 0 ? Number(((v.earnings / v.impressions) * 1000).toFixed(2)) : 0,
      }))
      .sort((a, b) => b.earnings - a.earnings);

    const daily = Array.from(dayMap.entries())
      .map(([date, v]) => ({ date, earnings: Number(v.earnings.toFixed(2)), impressions: v.impressions }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));

    return {
      range: { startDate, endDate, days: safeDays },
      currency,
      totals: {
        earnings: Number(totEarnings.toFixed(2)),
        impressions: totImpr,
        clicks: totClicks,
        ecpm: totImpr > 0 ? Number(((totEarnings / totImpr) * 1000).toFixed(2)) : 0,
      },
      byFormat,
      daily,
      lastSyncedAt: lastSynced ? lastSynced.toISOString() : null,
      rowCount: rows.length,
    };
  }

  /**
   * Reconcile official AdMob earnings (persisted snapshots) against the app's
   * own client-reported per-impression revenue (summed ad_events.revenue_micros)
   * for the same window. Returns both totals plus the absolute and percentage
   * difference. Divide-by-zero guarded: when official is 0 the percentage is null.
   */
  async getAdmobReconciliation(days: number): Promise<{
    officialEarnings: number;
    appReportedEarnings: number;
    differenceAbs: number;
    differencePct: number | null;
    currency: string;
  }> {
    const summary = await this.getAdmobSnapshotSummary(days);
    const officialEarnings = summary.totals.earnings;

    const safeDays = summary.range.days;
    const from = new Date(Date.now() - (safeDays - 1) * 24 * 60 * 60 * 1000);
    from.setUTCHours(0, 0, 0, 0);
    const [appRow] = await db
      .select({ micros: sql<string | null>`coalesce(sum(${adEvents.revenueMicros}), 0)` })
      .from(adEvents)
      .where(gte(adEvents.createdAt, from));
    const appReportedEarnings = Number(((Number(appRow?.micros ?? 0) || 0) / 1_000_000).toFixed(2));

    const differenceAbs = Number((officialEarnings - appReportedEarnings).toFixed(2));
    const differencePct =
      officialEarnings > 0 ? Number(((differenceAbs / officialEarnings) * 100).toFixed(2)) : null;

    return {
      officialEarnings,
      appReportedEarnings,
      differenceAbs,
      differencePct,
      currency: summary.currency,
    };
  }

  /**
   * Returns a per-platform breakdown of ad events and app-reported revenue
   * micros from `ad_events` for the given trailing day window. Consistent with
   * `getAdmobReconciliation` (same table, same row scope) so the splits add up
   * to the same total used in the reconciliation card. Platform values are
   * whatever the client sets — typically "ios" or "android"; rows without a
   * platform are grouped as "unknown".
   */
  async getAdmobPlatformSummary(days: number): Promise<{
    byPlatform: Array<{ platform: string; impressions: number; revenueMicros: number }>;
  }> {
    const safeDays = Math.min(Math.max(Math.floor(days) || 30, 1), 365);
    const from = new Date(Date.now() - (safeDays - 1) * 24 * 60 * 60 * 1000);
    from.setUTCHours(0, 0, 0, 0);

    // Count impression events only (not rewards, failures, etc.) so the
    // per-platform denominator matches the impression metric shown elsewhere.
    // Revenue micros are summed from the same impression rows so the split
    // stays consistent with the reconciliation total.
    const rows = await db
      .select({
        platform: sql<string>`coalesce(${adEvents.platform}, 'unknown')`,
        impressions: sql<string>`count(*)::bigint`,
        revenueMicros: sql<string>`coalesce(sum(${adEvents.revenueMicros}), 0)`,
      })
      .from(adEvents)
      .where(and(gte(adEvents.createdAt, from), eq(adEvents.event, "impression")))
      .groupBy(sql`coalesce(${adEvents.platform}, 'unknown')`);

    return {
      byPlatform: rows.map((r) => ({
        platform: r.platform,
        impressions: Number(r.impressions),
        revenueMicros: Number(r.revenueMicros),
      })),
    };
  }

  async getAdAnalyticsSummary(from?: Date, to?: Date): Promise<{
    totalImpressions: number;
    totalCompletions: number;
    totalRewardsEarned: number;
    totalFailures: number;
    noFillCount: number;
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

    const [noFillResult] = await db
      .select({ value: count() })
      .from(adEvents)
      .where(
        whereClause
          ? and(eq(adEvents.event, "load_failed"), eq(adEvents.errorCode, "NO_FILL"), whereClause)
          : and(eq(adEvents.event, "load_failed"), eq(adEvents.errorCode, "NO_FILL")),
      );

    const [uniqueUsersResult] = await db
      .select({ value: sql<number>`count(distinct ${adEvents.userId})` })
      .from(adEvents)
      .where(whereClause ?? undefined);

    const totalImpressions = Number(impressions?.value ?? 0);
    const totalCompletions = Number(completions?.value ?? 0);
    const rewardCount = Number(rewards?.cnt ?? 0);
    const totalRewards = parseFloat((rewardCount * REWARDED_AD_PAYOUT_USD).toFixed(2));
    const totalFailures = Number(failures?.value ?? 0);
    const noFillCount = Number(noFillResult?.value ?? 0);
    const uniqueUsers = Number(uniqueUsersResult?.value ?? 0);

    return {
      totalImpressions,
      totalCompletions,
      totalRewardsEarned: totalRewards,
      totalFailures,
      noFillCount,
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
      noFills: number;
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
        noFills: sql<number>`count(*) filter (where ${adEvents.event} = 'load_failed' and ${adEvents.errorCode} = 'NO_FILL')`,
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
      noFills: Number(r.noFills),
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
    noFillCount: number;
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

    const [noFill] = await db
      .select({ value: count() })
      .from(adEvents)
      .where(
        and(
          eq(adEvents.event, "load_failed"),
          eq(adEvents.errorCode, "NO_FILL"),
          gte(adEvents.createdAt, windowStart),
          sql`${adEvents.createdAt} <= ${windowEnd}`,
        ),
      );

    const impressionCount = Number(impressions?.value ?? 0);
    const failureCount = Number(failures?.value ?? 0);
    const noFillCount = Number(noFill?.value ?? 0);
    const totalAttempts = impressionCount + failureCount;

    return {
      windowMinutes,
      windowStart,
      windowEnd,
      totalAttempts,
      impressions: impressionCount,
      failures: failureCount,
      noFillCount,
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
    noFillThresholdPercent?: number;
    minAttempts?: number;
  } = {}): Promise<{
    alert: boolean;
    severity: "ok" | "warning" | "critical";
    message: string;
    noFillAlert: {
      alert: boolean;
      severity: "ok" | "warning" | "critical";
      message: string;
      noFillRate: number;
      noFillCount: number;
      threshold: number;
    };
    stats: {
      windowMinutes: number;
      windowStart: Date;
      windowEnd: Date;
      totalAttempts: number;
      impressions: number;
      failures: number;
      noFillCount: number;
      fillRate: number;
      failureRate: number;
    };
    thresholds: {
      failureThresholdPercent: number;
      criticalThresholdPercent: number;
      noFillThresholdPercent: number;
      noFillCriticalThresholdPercent: number;
      minAttempts: number;
    };
  }> {
    const windowMinutes = opts.windowMinutes ?? 60;
    const failureThresholdPercent = opts.failureThresholdPercent ?? 30;
    const criticalThresholdPercent = failureThresholdPercent * 1.5;
    const noFillThresholdPercent = opts.noFillThresholdPercent ?? 30;
    const noFillCriticalThresholdPercent = noFillThresholdPercent * 1.5;
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

    const noFillRate = stats.totalAttempts > 0
      ? parseFloat(((stats.noFillCount / stats.totalAttempts) * 100).toFixed(1))
      : 0;

    let noFillAlertActive = false;
    let noFillSeverity: "ok" | "warning" | "critical" = "ok";
    let noFillMessage = `No-fill rate is ${noFillRate}% over the last ${windowMinutes} minutes.`;

    if (stats.totalAttempts >= minAttempts) {
      if (noFillRate >= noFillCriticalThresholdPercent) {
        noFillAlertActive = true;
        noFillSeverity = "critical";
        noFillMessage = `CRITICAL: No-fill rate is ${noFillRate}% (${stats.noFillCount}/${stats.totalAttempts} attempts) over the last ${windowMinutes} minutes. Ad inventory is severely thin.`;
      } else if (noFillRate >= noFillThresholdPercent) {
        noFillAlertActive = true;
        noFillSeverity = "warning";
        noFillMessage = `WARNING: No-fill rate is ${noFillRate}% (${stats.noFillCount}/${stats.totalAttempts} attempts) over the last ${windowMinutes} minutes. Ad inventory may be running low.`;
      }
    } else if (stats.totalAttempts > 0 && noFillRate >= noFillThresholdPercent) {
      noFillMessage = `No-fill rate is ${noFillRate}% but sample size is small (${stats.totalAttempts} attempts, minimum ${minAttempts} required for alerting).`;
    }

    return {
      alert,
      severity,
      message,
      noFillAlert: {
        alert: noFillAlertActive,
        severity: noFillSeverity,
        message: noFillMessage,
        noFillRate,
        noFillCount: stats.noFillCount,
        threshold: noFillThresholdPercent,
      },
      stats,
      thresholds: {
        failureThresholdPercent,
        criticalThresholdPercent,
        noFillThresholdPercent,
        noFillCriticalThresholdPercent,
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

  async logPublisherAudit(entry: {
    actorUserId: string;
    targetUserId?: string | null;
    campaignId?: string | null;
    action: string;
    detail?: Record<string, unknown> | null;
  }): Promise<void> {
    await db.insert(publisherAuditLog).values({
      actorUserId: entry.actorUserId,
      targetUserId: entry.targetUserId ?? null,
      campaignId: entry.campaignId ?? null,
      action: entry.action,
      detail: entry.detail ?? null,
    });
  }

  async getPublisherAuditLog(opts: {
    limit?: number;
    offset?: number;
  } = {}): Promise<{ entries: PublisherAuditEntryView[]; total: number }> {
    const limit = Math.min(opts.limit ?? 100, 500);
    const offset = opts.offset ?? 0;
    const actorAlias = alias(users, "actor");
    const targetAlias = alias(users, "target_user");
    const [entries, totalRows] = await Promise.all([
      db
        .select({
          id: publisherAuditLog.id,
          actorUserId: publisherAuditLog.actorUserId,
          actorUsername: actorAlias.username,
          targetUserId: publisherAuditLog.targetUserId,
          targetUsername: targetAlias.username,
          campaignId: publisherAuditLog.campaignId,
          campaignTitle: campaigns.title,
          action: publisherAuditLog.action,
          detail: publisherAuditLog.detail,
          createdAt: publisherAuditLog.createdAt,
        })
        .from(publisherAuditLog)
        .innerJoin(actorAlias, eq(publisherAuditLog.actorUserId, actorAlias.id))
        .leftJoin(targetAlias, eq(publisherAuditLog.targetUserId, targetAlias.id))
        .leftJoin(campaigns, eq(publisherAuditLog.campaignId, campaigns.id))
        .orderBy(desc(publisherAuditLog.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: count() })
        .from(publisherAuditLog),
    ]);
    return {
      entries: entries as PublisherAuditEntryView[],
      total: Number(totalRows[0]?.total ?? 0),
    };
  }
}

export const storage = new DatabaseStorage();
