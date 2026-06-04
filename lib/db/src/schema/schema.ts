import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, numeric, integer, boolean, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const users = pgTable("users", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  email: text("email"),
  password: text("password").notNull(),
  role: text("role").notNull().default("user"),
  balance: numeric("balance", { precision: 12, scale: 2 }).notNull().default("0"),
  totalEarned: numeric("total_earned", { precision: 12, scale: 2 }).notNull().default("0"),
  referredBy: text("referred_by"),
  // Set the first time this (referred) user completes a qualifying $3+ cash-out.
  // Acts as the idempotency guard so the referrer is credited at most once.
  referralCreditedAt: timestamp("referral_credited_at"),
  emailVerified: boolean("email_verified").notNull().default(false),
  emailVerificationToken: text("email_verification_token"),
  emailVerificationExpiresAt: timestamp("email_verification_expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  // Survey demographic profile (used for provider entry link targeting)
  dateOfBirth: text("date_of_birth"),
  gender: text("gender"),
  zipCode: text("zip_code"),
  country: text("country").default("US"),
  employmentStatus: text("employment_status"),
  householdIncome: text("household_income"),
  educationLevel: text("education_level"),
  ethnicity: text("ethnicity"),
  profileComplete: boolean("profile_complete").notNull().default(false),
  // Server-authoritative daily check-in streak. `checkinStreak` is the number of
  // consecutive UTC days the user has checked in (resets to 1 on a new check-in
  // after a missed day); `lastCheckinAt` is when the streak was last advanced and
  // is used to decide whether the next check-in continues or resets the streak.
  checkinStreak: integer("checkin_streak").notNull().default(0),
  lastCheckinAt: timestamp("last_checkin_at", { withTimezone: true }),
  tokenVersion: integer("token_version").notNull().default(0),
  isPublisher: boolean("is_publisher").notNull().default(false),
  publisherGrantedAt: timestamp("publisher_granted_at"),
  adCredits: numeric("ad_credits", { precision: 12, scale: 2 }).notNull().default("0"),
  totpSecret: text("totp_secret"),
  totpEnabled: boolean("totp_enabled").notNull().default(false),
  totpBackupCodes: text("totp_backup_codes").array(),
},
(t) => ({
  balanceNonNegative: check("users_balance_non_negative", sql`${t.balance} >= 0`),
  adCreditsNonNegative: check("users_ad_credits_non_negative", sql`${t.adCredits} >= 0`),
}));

export const withdrawals = pgTable("withdrawals", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  username: text("username").notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  bonusPercent: numeric("bonus_percent", { precision: 5, scale: 2 }).notNull().default("0"),
  bonusAmount: numeric("bonus_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  totalPayout: numeric("total_payout", { precision: 10, scale: 2 }).notNull(),
  paypalEmail: text("paypal_email").notNull(),
  status: text("status").notNull().default("pending"),
  adminNote: text("admin_note"),
  paypalBatchId: text("paypal_batch_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  processedAt: timestamp("processed_at"),
});

export const earningsLedger = pgTable(
  "earnings_ledger",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull().references(() => users.id),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    type: text("type").notNull(),
    description: text("description").notNull(),
    refId: text("ref_id"),
    provider: text("provider"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index("ledger_user_idx").on(t.userId, t.createdAt),
  })
);

export const rewardSessions = pgTable(
  "reward_sessions",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    sessionToken: text("session_token").notNull().unique(),
    userId: varchar("user_id").notNull().references(() => users.id),
    source: text("source").notNull(),
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    expectedReward: numeric("expected_reward", { precision: 8, scale: 2 }).notNull(),
    status: text("status").notNull().default("pending"),
    providerTransactionId: text("provider_transaction_id"),
    completedAt: timestamp("completed_at"),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index("reward_sessions_user_idx").on(t.userId, t.status),
    completedUnique: uniqueIndex("reward_sessions_completed_unique")
      .on(t.userId, t.source, t.externalId)
      .where(sql`status = 'completed'`),
    txnUnique: uniqueIndex("reward_sessions_txn_unique")
      .on(t.source, t.provider, t.providerTransactionId)
      .where(sql`provider_transaction_id IS NOT NULL`),
  })
);

export const leads = pgTable(
  "leads",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    email: text("email").notNull(),
    name: text("name"),
    type: text("type").notNull().default("general"),
    message: text("message"),
    source: text("source").notNull().default("website"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    emailIdx: index("leads_email_idx").on(t.email),
    typeIdx: index("leads_type_idx").on(t.type),
  })
);

export const campaigns = pgTable(
  "campaigns",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull().references(() => users.id),
    title: text("title").notNull(),
    description: text("description").notNull(),
    targetUrl: text("target_url").notNull(),
    rewardPerVisit: numeric("reward_per_visit", { precision: 8, scale: 2 }).notNull().default("0.01"),
    totalBudget: numeric("total_budget", { precision: 12, scale: 2 }).notNull().default("0"),
    spent: numeric("spent", { precision: 12, scale: 2 }).notNull().default("0"),
    clicks: integer("clicks").notNull().default(0),
    status: text("status").notNull().default("pending"),
    adminNote: text("admin_note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index("campaigns_user_idx").on(t.userId, t.status),
    statusIdx: index("campaigns_status_idx").on(t.status, t.createdAt),
    // Defense-in-depth: DB-level guard so no code path can spend more than the
    // purchased budget or create a campaign with negative spend.
    spentNonNegative: check("campaigns_spent_non_negative", sql`${t.spent} >= 0`),
    spentWithinBudget: check("campaigns_spent_within_budget", sql`${t.spent} <= ${t.totalBudget}`),
  })
);

export const campaignClicks = pgTable(
  "campaign_clicks",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    campaignId: varchar("campaign_id").notNull().references(() => campaigns.id),
    visitorUserId: varchar("visitor_user_id").notNull().references(() => users.id),
    rewardGranted: numeric("reward_granted", { precision: 8, scale: 2 }).notNull(),
    // SHA-256 of the per-install device ID the mobile client mints in
    // AsyncStorage and sends as X-Device-Id. Used to refuse settlement when
    // too many distinct user accounts have already claimed from the same
    // physical install in the last 24h (Sybil farm signal).
    visitorDeviceHash: varchar("visitor_device_hash", { length: 64 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    campaignIdx: index("campaign_clicks_campaign_idx").on(t.campaignId, t.createdAt),
    visitorIdx: index("campaign_clicks_visitor_idx").on(t.visitorUserId, t.campaignId),
    uniqueVisit: uniqueIndex("campaign_clicks_unique_visit").on(t.campaignId, t.visitorUserId),
    deviceRecentIdx: index("campaign_clicks_device_recent_idx").on(t.visitorDeviceHash, t.createdAt),
  })
);

/**
 * One row per /begin call. Replaces the prior stateless JWT visit token
 * with a stateful, server-observable attempt record.
 *
 *  - `redirectedAt` is set only when the server actually serves the
 *    302 from the /api/earn/sponsored/r/:token redirect endpoint, so
 *    /visit can require trusted proof of a real HTTP fetch rather than
 *    a client-claimed elapsed time.
 *  - `settledAt` flips when the attempt is consumed by /visit, making
 *    each row single-use (replay-safe).
 *  - `expiresAt` bounds the attempt lifetime.
 */
export const campaignVisitAttempts = pgTable(
  "campaign_visit_attempts",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    token: varchar("token", { length: 64 }).notNull(),
    campaignId: varchar("campaign_id").notNull().references(() => campaigns.id),
    userId: varchar("user_id").notNull().references(() => users.id),
    rewardSnapshot: numeric("reward_snapshot", { precision: 8, scale: 2 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    redirectedAt: timestamp("redirected_at"),
    redirectIpHash: varchar("redirect_ip_hash", { length: 64 }),
    redirectUaHash: varchar("redirect_ua_hash", { length: 64 }),
    // Stamped only when the interstitial page's JS beacon fires from a real
    // browser context. A scripted curl GET of /r/:token sets redirectedAt but
    // never sets witnessedAt — /visit refuses to settle without both, which
    // raises the per-account attack cost from "one HTTP call" to "run a JS
    // engine that fires the beacon AND matches the redirect IP/UA".
    witnessedAt: timestamp("witnessed_at"),
    // Single-use nonce set by /r, verified and cleared by /c. Also issued as
    // an HttpOnly cookie so clients without cookie support fail at /c.
    witnessNonce: varchar("witness_nonce", { length: 64 }),
    settledAt: timestamp("settled_at"),
    expiresAt: timestamp("expires_at").notNull(),
    // SHA-256 of the X-Device-Id captured at /begin time. Stored here so
    // /visit can verify consistency (reject mismatches) and use this
    // server-bound value for the per-device Sybil cap instead of trusting
    // the header value submitted at settle time.
    deviceHash: varchar("device_hash", { length: 64 }),
  },
  (t) => ({
    uniqueToken: uniqueIndex("campaign_visit_attempts_token_unique").on(t.token),
    userCampaignIdx: index("campaign_visit_attempts_user_campaign_idx").on(t.userId, t.campaignId),
    expiresIdx: index("campaign_visit_attempts_expires_idx").on(t.expiresAt),
  })
);

export type CampaignVisitAttempt = typeof campaignVisitAttempts.$inferSelect;

export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull().references(() => users.id),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index("pwd_reset_user_idx").on(t.userId, t.createdAt),
    expiresIdx: index("pwd_reset_expires_idx").on(t.expiresAt),
  })
);

export const adEvents = pgTable(
  "ad_events",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id").references(() => users.id),
    event: text("event").notNull(),
    adUnitType: text("ad_unit_type").notNull(),
    rewardAmount: numeric("reward_amount", { precision: 8, scale: 2 }),
    rewardType: text("reward_type"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    durationMs: numeric("duration_ms", { precision: 10, scale: 0 }),
    platform: text("platform"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index("ad_events_user_idx").on(t.userId, t.createdAt),
    eventIdx: index("ad_events_event_idx").on(t.event, t.createdAt),
  })
);

export const webhookAudit = pgTable(
  "webhook_audit",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    provider: text("provider").notNull(),
    reason: text("reason").notNull(),
    ip: text("ip").notNull(),
    forwardedFor: text("forwarded_for"),
    userAgent: text("user_agent"),
    method: text("method").notNull(),
    path: text("path").notNull(),
    hasSignatureHeader: boolean("has_signature_header").notNull().default(false),
    secretConfigured: boolean("secret_configured").notNull().default(false),
    statusCode: integer("status_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    createdAtIdx: index("webhook_audit_created_at_idx").on(t.createdAt),
    providerIdx: index("webhook_audit_provider_idx").on(t.provider, t.createdAt),
    ipIdx: index("webhook_audit_ip_idx").on(t.ip, t.createdAt),
  })
);


export type WebhookAuditEntry = typeof webhookAudit.$inferSelect;
export type InsertWebhookAuditEntry = typeof webhookAudit.$inferInsert;

// Durable, attributable trail of security-sensitive admin account changes
// (2FA enable/disable, backup-code regeneration, password changes/resets).
// Complements the best-effort logger.info + email notifications, which can be
// lost (ephemeral logs) or silently fail (email). NEVER stores secrets, TOTP
// seeds, backup codes, or passwords — only who-did-what-when metadata.
export const securityAuditLog = pgTable(
  "security_audit_log",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    actorUserId: varchar("actor_user_id").notNull().references(() => users.id),
    // The user affected by the action, when different from the actor (e.g. an
    // admin resetting/factory-resetting another account). Null for self-service
    // events where the actor is also the subject.
    targetUserId: varchar("target_user_id").references(() => users.id),
    event: text("event").notNull(),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    actorIdx: index("security_audit_actor_idx").on(t.actorUserId, t.createdAt),
    targetIdx: index("security_audit_target_idx").on(t.targetUserId, t.createdAt),
    eventIdx: index("security_audit_event_idx").on(t.event, t.createdAt),
    createdAtIdx: index("security_audit_created_at_idx").on(t.createdAt),
  })
);

export type SecurityAuditEntry = typeof securityAuditLog.$inferSelect;
export type InsertSecurityAuditEntry = typeof securityAuditLog.$inferInsert;

export const insertAdEventSchema = createInsertSchema(adEvents).omit({ id: true, createdAt: true });
export type InsertAdEvent = z.infer<typeof insertAdEventSchema>;
export type AdEvent = typeof adEvents.$inferSelect;

export const insertLeadSchema = createInsertSchema(leads, {
  email: (schema) => schema.email(),
}).omit({ id: true, createdAt: true });
export type InsertLead = z.infer<typeof insertLeadSchema>;
export type Lead = typeof leads.$inferSelect;

export type Campaign = typeof campaigns.$inferSelect;
export type CampaignClick = typeof campaignClicks.$inferSelect;

export const insertCampaignSchema = createInsertSchema(campaigns).omit({ id: true, createdAt: true, updatedAt: true, spent: true, clicks: true, status: true, adminNote: true });

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
  email: true,
  referredBy: true,
}).partial({ email: true, referredBy: true });

export const updateUserProfileSchema = z.object({
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  gender: z.enum(["male", "female", "non_binary", "prefer_not_to_say"]).optional(),
  zipCode: z.string().max(10).optional(),
  country: z.string().length(2).optional(),
  employmentStatus: z.enum(["employed", "self_employed", "unemployed", "student", "retired", "homemaker", "prefer_not_to_say"]).optional(),
  householdIncome: z.enum(["under_25k", "25k_50k", "50k_75k", "75k_100k", "100k_150k", "over_150k", "prefer_not_to_say"]).optional(),
  educationLevel: z.enum(["less_than_high_school", "high_school", "some_college", "associates", "bachelors", "masters", "doctorate", "prefer_not_to_say"]).optional(),
  ethnicity: z.enum(["hispanic_latino", "white", "black_african_american", "asian", "native_american", "pacific_islander", "mixed", "other", "prefer_not_to_say"]).optional(),
});

export type UpdateUserProfile = z.infer<typeof updateUserProfileSchema>;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Withdrawal = typeof withdrawals.$inferSelect;
export type EarningsLedgerEntry = typeof earningsLedger.$inferSelect;
export type RewardSession = typeof rewardSessions.$inferSelect;

// ── EARN TOKENS ───────────────────────────────────────────────────────────────
// Server-issued pending earn tokens. Each action (ad watch, check-in, spin,
// mission, game) creates a token here. Tokens are claimable after 3 hours.
// The 3-hour window is enforced server-side at claim time — the client can
// never self-report or forge points.
/**
 * Server-issued per-install tokens for sponsored-visit anti-fraud controls.
 *
 * The server generates a random 32-byte opaque token at device registration
 * time and returns it to the authenticated client. Only the SHA-256 hash is
 * stored here; the raw token lives in the client's secure storage. This means:
 *  - The token cannot be minted by the client (it is server-generated).
 *  - It is rate-limited per user at issuance time.
 *  - The deviceHash embedded here is the Sybil key used in campaign_clicks;
 *    /begin and /visit resolve it from this table rather than trusting
 *    a caller-supplied header at settle time.
 */
export const deviceInstalls = pgTable(
  "device_installs",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    deviceHash: varchar("device_hash", { length: 64 }).notNull(),
    userId: varchar("user_id").notNull().references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    tokenHashUnique: uniqueIndex("device_installs_token_hash_unique").on(t.tokenHash),
    userIdx: index("device_installs_user_idx").on(t.userId, t.createdAt),
    deviceHashIdx: index("device_installs_device_hash_idx").on(t.deviceHash),
  }),
);

export type DeviceInstall = typeof deviceInstalls.$inferSelect;

export const earnTokens = pgTable("earn_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  points: integer("points").notNull(),
  actionType: text("action_type").notNull(),
  description: text("description").notNull().default(""),
  earnedAt: timestamp("earned_at", { withTimezone: true }).notNull().defaultNow(),
  claimableAt: timestamp("claimable_at", { withTimezone: true }).notNull(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  status: text("status").notNull().default("pending"),
  // Populated only for AdMob SSV tokens — used to prevent replay attacks.
  // PostgreSQL UNIQUE allows multiple NULLs, so non-SSV tokens are unaffected.
  transactionId: varchar("transaction_id"),
  // Cash value (USD) per point locked in at the moment this token was earned.
  // Each point converts at its own snapshot so a later rate change can never
  // retroactively devalue points already earned. NULL = legacy token issued
  // before variable rates existed; treated as the legacy floor (0.001 $/pt)
  // at conversion time.
  usdPerPointSnapshot: numeric("usd_per_point_snapshot", { precision: 12, scale: 8 }),
}, (t) => ({
  userIdx: index("earn_tokens_user_idx").on(t.userId),
  userStatusIdx: index("earn_tokens_user_status_idx").on(t.userId, t.status),
  claimableIdx: index("earn_tokens_claimable_idx").on(t.status, t.claimableAt),
  txnIdx: uniqueIndex("earn_tokens_txn_id_idx").on(t.transactionId),
}));

export type EarnToken = typeof earnTokens.$inferSelect;

// ── CONVERSION RATES ──────────────────────────────────────────────────────────
// Append-only history of the server-authoritative cash value per point. The
// rate floats with ad ARPU but is clamped to a published floor it never drops
// below. Scoped by region so a per-geo rate can be rolled out later without a
// schema change — for now only "GLOBAL" rows are written. The "current" rate
// for a region is simply its most recent row by createdAt.
export const conversionRates = pgTable("conversion_rates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  region: text("region").notNull().default("GLOBAL"),
  // Cash value (USD) of one point. High precision so sub-cent rates are exact.
  usdPerPoint: numeric("usd_per_point", { precision: 12, scale: 8 }).notNull(),
  // The published floor this rate was clamped against.
  floorUsdPerPoint: numeric("floor_usd_per_point", { precision: 12, scale: 8 }).notNull(),
  // How the rate was derived: "seed" (initial), "arpu" (revenue-driven),
  // "floor" (ARPU fell below floor, clamped up).
  method: text("method").notNull().default("seed"),
  // Inputs that produced this rate — kept for auditability / debugging.
  windowDays: integer("window_days"),
  revenueUsd: numeric("revenue_usd", { precision: 14, scale: 4 }),
  pointsIssued: numeric("points_issued", { precision: 18, scale: 0 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  regionCreatedIdx: index("conversion_rates_region_created_idx").on(t.region, t.createdAt),
}));

export type ConversionRate = typeof conversionRates.$inferSelect;
export type InsertConversionRate = typeof conversionRates.$inferInsert;
