import type { Express, Request, Response } from "express";
import { createVerify } from "node:crypto";
import { authMiddleware, adminMiddleware, type AuthRequest } from "../auth";
import { db, earnTokens, users, earningsLedger } from "@workspace/db";
import { eq, and, lte, gte, lt, sql, count, inArray } from "drizzle-orm";
import { logger } from "../lib/logger";
import { runSpinChallengeSweep } from "../lib/spinChallengeSweep";
import { issueSpinChallenge, consumeSpinChallenge, SpinChallengeStoreError } from "../lib/spinChallengeStore";
import { rateLimit } from "express-rate-limit";
import {
  DEFAULT_REGION,
  getCurrentRate,
  snapshotRateString,
  tokenUsd,
  tokenUsdSumSql,
  LEGACY_USD_PER_POINT,
  DISPLAY_POINTS_PER_DOLLAR,
} from "../lib/pointsEconomy";
import {
  getSetting,
  setSetting,
  DISPLAY_POINTS_PER_DOLLAR_KEY,
} from "../lib/runtimeSettings";
import { withAdvisoryLock } from "../lib/advisoryLock";
import { recordSsvMissingUserId } from "../lib/admobAlerts";

// ── CONVERSION & LIMITS ───────────────────────────────────────────────────────
// Point→cash value is now server-authoritative and floats with ad ARPU; see
// lib/pointsEconomy.ts. Each token snapshots its rate at earn time so a later
// rate change never devalues points already earned.
const PENDING_WINDOW_MS       = 3 * 60 * 60 * 1000;  // 3-hour lock
const SPIN_COOLDOWN_MS        = 2 * 60 * 60 * 1000;  // server-side 2h spin gate
const DAILY_CLAIM_CAP_USD     = 5;                   // $5.00/day hard ceiling
const TOKEN_EXPIRY_DAYS       = 30;                  // unclaimed tokens expire

// ── ADMOB SSV CONSTANTS ───────────────────────────────────────────────────────
const SSV_TIMESTAMP_TOLERANCE = 5 * 60 * 1000;                          // ±5 min
const GOOGLE_KEY_URL          = "https://www.gstatic.com/admob/reward/verifier-keys.json";
const SSV_KEY_CACHE_TTL       = 24 * 60 * 60 * 1000;                   // 24h re-fetch

// Spin wheel reward pool — server picks randomly, client cannot influence
const SPIN_POOL = [50, 50, 80, 80, 100, 100, 150, 150, 200, 300, 400, 500];
const GAME_POOL = [25, 25, 50, 50, 50, 75, 75, 100];

function pickRandom(pool: number[]): number {
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── DAILY CHECK-IN STREAK LADDER ──────────────────────────────────────────────
// Server-authoritative streak rewards. The flat 150-pt check-in is replaced by a
// bounded ladder: longer consecutive streaks pay more, capped at the final rung
// so the daily cost stays bounded. A milestone bonus is added on every Nth day.
// These are the single source of truth — the client renders the same numbers via
// GET /api/earnings/checkin-status so the on-screen ladder reflects real awards.
//
// Cost at the published floor ($0.0002/pt), a full 7-day cycle:
//   base 100+120+140+160+180+200+240 = 1140 pts = $0.228 (avg $0.0326/day)
//   + milestone 200 pts on day 7      =  200 pts = $0.040 (avg $0.0057/day)
// ≈ $0.038/user/day for a perfect streak — a modest, streak-weighted shift from
// the old flat 150 ($0.030/day): day 1 now pays LESS (100) and only long streaks
// exceed the old flat rate, keeping payout economics conservative.
const CHECKIN_REWARD_LADDER = [100, 120, 140, 160, 180, 200, 240];
const CHECKIN_MILESTONE_DAY = 7;    // bonus paid every Nth consecutive day
const CHECKIN_MILESTONE_BONUS = 200; // extra pts added on a milestone day

// UTC calendar-day key (YYYY-MM-DD). The daily cap and streak both key off UTC
// days so the check-in window and streak math always agree.
function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ── WEEKLY PERIOD KEYS ────────────────────────────────────────────────────────
// Weekly missions reset on calendar-year week buckets (7-day windows counted
// from Jan 1 UTC), matching the client's getCurrentWeekStartMs so server
// verification and the on-screen weekly cards agree on where "this week" starts.
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
function weekStartUtc(now: Date): Date {
  const jan1 = Date.UTC(now.getUTCFullYear(), 0, 1);
  const weekIndex = Math.max(1, Math.ceil((now.getTime() - jan1) / ONE_WEEK_MS));
  return new Date(jan1 + (weekIndex - 1) * ONE_WEEK_MS);
}
function weekKey(now: Date): string {
  const jan1 = Date.UTC(now.getUTCFullYear(), 0, 1);
  const weekIndex = Math.max(1, Math.ceil((now.getTime() - jan1) / ONE_WEEK_MS));
  return `${now.getUTCFullYear()}-W${weekIndex}`;
}

// Given the previous check-in time + stored streak, returns the streak value
// THIS check-in should produce. Continues the streak only when the last check-in
// was the immediately preceding UTC day; otherwise restarts at 1.
function nextCheckinStreak(lastCheckinAt: Date | null, storedStreak: number, now: Date): number {
  if (!lastCheckinAt) return 1;
  const todayKey = utcDayKey(now);
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayKey = utcDayKey(yesterday);
  const lastKey = utcDayKey(lastCheckinAt);
  if (lastKey === todayKey) return Math.max(1, storedStreak); // shouldn't happen (daily cap), be safe
  if (lastKey === yesterdayKey) return Math.max(1, storedStreak) + 1;
  return 1; // a day (or more) was missed — streak resets
}

// Reward (base ladder rung + optional milestone bonus) for a given streak day.
function checkinReward(streak: number): { points: number; base: number; milestone: boolean; milestoneBonus: number } {
  const idx = Math.min(Math.max(streak, 1), CHECKIN_REWARD_LADDER.length) - 1;
  const base = CHECKIN_REWARD_LADDER[idx];
  const milestone = streak > 0 && streak % CHECKIN_MILESTONE_DAY === 0;
  const milestoneBonus = milestone ? CHECKIN_MILESTONE_BONUS : 0;
  return { points: base + milestoneBonus, base, milestone, milestoneBonus };
}

// ── PHASE 3 REWARD REBALANCE (Jun 2026) ──────────────────────────────────────
// Phase 2 lowered the published FLOOR to 5,000 pts = $1 ($0.0002/pt) but left
// these point AMOUNTS unchanged, so at the floor each action paid ~1/5 of its
// pre-Phase-2 value. This pass re-tunes the amounts to the new floor on the
// owner's CONSERVATIVE setting: keep cash value at/near current ("cheapest,
// safest for payout economics"), nudging only the headline daily action.
//
// Cash value per action at the FLOOR (points × $0.0002), with daily cap:
//   checkin        150 = $0.030  ×1   → $0.030/day  (daily retention anchor)
//   rewarded_ad     50 = $0.010  ×30  → $0.300/day  (held; AdMob SSV only)
//   spin       avg 180 = $0.036  ×12  → $0.432/day  (held; pool unchanged)
//   mission_daily  100 = $0.020  ×10  → $0.200/day  (held; server-blocked)
//   mission_weekly 500 = $0.100  ×4   → $0.400/day  (held; server-blocked)
//   game        avg 56 = $0.011  ×10  → $0.110/day  (held; server-blocked)
//   video            5 = $0.001  ×50  → $0.050/day  (held; server-blocked)
// Total live-reachable guaranteed cost (checkin + rewarded_ad + spin) ≈
// $0.76/user/day at the floor and ≈ $3.8 at the ceiling ($0.001/pt) — both sit
// under the DAILY_CLAIM_CAP_USD ($5) backstop, so per-action caps are left as
// is; they remain economically sound across the whole [floor, ceiling] band.
// Note: rewarded_ad's per-ad payout slightly exceeds its eCPM-derived 55% share
// under the proxy AD_REVENUE_PER_REWARD_USD; revisit once real per-impression
// ad revenue replaces the proxy (separate task) rather than cutting it blind now.

// Points per action — fully server-authoritative, client cannot override
interface ActionConfig {
  points: number | null; // null = server-random from pool
  dailyCap: number;
}

const ACTION_CONFIG: Record<string, ActionConfig> = {
  // checkin's `points` is a legacy fallback only — the actual award is
  // streak-scaled server-side (see checkinReward / CHECKIN_REWARD_LADDER).
  checkin:        { points: 150,  dailyCap: 1  },
  rewarded_ad:    { points: 50,   dailyCap: 30 },
  spin:           { points: null, dailyCap: 12 },
  mission_daily:  { points: 100,  dailyCap: 10 },
  mission_weekly: { points: 500,  dailyCap: 4  },
  game:           { points: null, dailyCap: 10 },
  video:          { points: 5,    dailyCap: 50 },
  // ad_view — small reward credited via /api/earnings/record when a client-side
  // ad completes (AdMob or in-app fallback). 5 pts, 50/day cap limits abuse.
  ad_view:        { points: 5,    dailyCap: 50 },
};

// Actions that may ONLY be credited by trusted server-to-server callbacks
// (e.g. AdMob SSV, provider webhooks, server-side mission completion records).
// Clients submitting these via POST /api/earnings/record are rejected with 403.
//
// rewarded_ad  — only via GET /api/admob/ssv (ECDSA-SHA256 verified by Google)
// mission_daily/mission_weekly — only via POST /api/missions/claim, which
//   recomputes mission completion from trusted server records (issued checkin /
//   rewarded_ad / spin earn tokens, credited referrals) and issues an earn token
//   at most once per mission per period. Accepting them through /record would
//   trust an unverifiable client claim, so they stay blocked here.
// game/video — no server-verifiable proof exists for these action types.
//   Neither action type is currently issued by any mobile app code path.
const SERVER_ONLY_ACTIONS = new Set([
  "rewarded_ad",
  "mission_daily",
  "mission_weekly",
  "game",
  "video",
  // spin — must be initiated via POST /api/earn/spin/begin (server-issued
  // challenge token required at /api/earn/spin/complete). This closes the
  // direct-minting bypass; the spin wheel calls the begin/complete flow.
  "spin",
]);

// ── DAILY / WEEKLY MISSIONS (server-verified) ─────────────────────────────────
// Mission completion is derived from TRUSTED server records only — never from a
// client claim — so a tampered/rooted device can't mint mission points. Each
// mission's progress is recomputed at claim time from durable signals (issued
// checkin / rewarded_ad / spin earn tokens, credited referrals). Missions with
// no server-verifiable signal (browsing videos, sharing a code) have verify=null:
// they can't be credited server-side (and were never credited server-side
// before — /record already rejected them).
//
// Reward per claimed mission is the Phase-3 server-authoritative amount from
// ACTION_CONFIG (mission_daily = 100 pts, mission_weekly = 500 pts). Idempotency
// is enforced by a per-mission, per-period transactionId on the earn token
// (UNIQUE earn_tokens_txn_id_idx), so claiming the same mission twice in a period
// credits exactly once — mirroring the survey_profile one-time bonus pattern.
type MissionTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
interface MissionVerifyCtx { tx: MissionTx; userId: string; periodStart: Date; }
interface MissionSpec {
  period: "daily" | "weekly";
  target: number;
  actionType: "mission_daily" | "mission_weekly";
  // Verified progress from trusted records, or null if not server-verifiable.
  verify: ((ctx: MissionVerifyCtx) => Promise<number>) | null;
}

async function countActionTokensSince(
  tx: MissionTx,
  userId: string,
  actionType: string,
  since: Date,
): Promise<number> {
  const [row] = await tx
    .select({ c: count() })
    .from(earnTokens)
    .where(and(
      eq(earnTokens.userId, userId),
      eq(earnTokens.actionType, actionType),
      gte(earnTokens.earnedAt, since),
    ));
  return Number(row?.c ?? 0);
}

// Friends referred by this user who became CREDITED (cashed out the qualifying
// amount) within the current week — the same trusted signal that pays the
// referral bonus, never a client guess.
async function verifyWeeklyReferrals(ctx: MissionVerifyCtx): Promise<number> {
  const [me] = await ctx.tx
    .select({ username: users.username })
    .from(users)
    .where(eq(users.id, ctx.userId));
  if (!me?.username) return 0;
  const [row] = await ctx.tx
    .select({ c: count() })
    .from(users)
    .where(and(
      eq(users.referredBy, me.username),
      gte(users.referralCreditedAt, ctx.periodStart),
    ));
  return Number(row?.c ?? 0);
}

// Distinct UTC days this week on which the user earned a (server-issued) check-in
// token — the streak signal is the durable token record, not a local counter.
async function verifyWeeklyStreak(ctx: MissionVerifyCtx): Promise<number> {
  const [row] = await ctx.tx
    .select({ days: sql<string>`COUNT(DISTINCT ((${earnTokens.earnedAt} AT TIME ZONE 'UTC')::date))` })
    .from(earnTokens)
    .where(and(
      eq(earnTokens.userId, ctx.userId),
      eq(earnTokens.actionType, "checkin"),
      gte(earnTokens.earnedAt, ctx.periodStart),
    ));
  return Number(row?.days ?? 0);
}

const MISSION_CONFIG: Record<string, MissionSpec> = {
  daily_checkin:    { period: "daily",  target: 1,  actionType: "mission_daily",  verify: (c) => countActionTokensSince(c.tx, c.userId, "checkin", c.periodStart) },
  watch_ads:        { period: "daily",  target: 5,  actionType: "mission_daily",  verify: (c) => countActionTokensSince(c.tx, c.userId, "rewarded_ad", c.periodStart) },
  daily_spin:       { period: "daily",  target: 1,  actionType: "mission_daily",  verify: (c) => countActionTokensSince(c.tx, c.userId, "spin", c.periodStart) },
  watch_videos:     { period: "daily",  target: 10, actionType: "mission_daily",  verify: null },
  refer_friends:    { period: "daily",  target: 1,  actionType: "mission_daily",  verify: null },
  weekly_ads:       { period: "weekly", target: 50, actionType: "mission_weekly", verify: (c) => countActionTokensSince(c.tx, c.userId, "rewarded_ad", c.periodStart) },
  weekly_videos:    { period: "weekly", target: 50, actionType: "mission_weekly", verify: null },
  weekly_referrals: { period: "weekly", target: 3,  actionType: "mission_weekly", verify: verifyWeeklyReferrals },
  weekly_streak:    { period: "weekly", target: 7,  actionType: "mission_weekly", verify: verifyWeeklyStreak },
};

// ── SPIN CHALLENGE STORE ──────────────────────────────────────────────────────
// Server-issued single-use challenge tokens for the spin wheel.
// /begin issues a token; /complete requires it before crediting the earn token.
// This ensures the client called /begin (server-observed) before earning points.
// Tokens live in the shared `spin_challenges` DB table (see lib/spinChallengeStore)
// so a token issued by one autoscaled replica can be validated/consumed by any
// other — the begin/complete pair no longer has to land on the same replica.
const SPIN_CHALLENGE_TTL_MS  = 60_000;  // challenge valid for 60 s
const SPIN_CHALLENGE_MIN_MS  = 3_000;   // must wait ≥3 s between begin→complete
// Mini-game and ad-fallback begin/complete endpoints are DISABLED (return 410).
// The shared challenge store is used only by the spin wheel. The constants
// that controlled game/ad challenge timing (GAME_CHALLENGE_MIN_MS,
// GAME_CHALLENGE_TTL_MS, GAME_COOLDOWN_MS, AD_CHALLENGE_MIN_MS,
// AD_FALLBACK_COOLDOWN_MS, AD_FALLBACK_POINTS, AD_CHALLENGE_TTL_MS) are
// intentionally removed — throttling does not constitute proof.
setInterval(() => {
  runSpinChallengeSweep();
}, 30_000);

// ── ADMOB SSV KEY CACHE ───────────────────────────────────────────────────────
interface GooglePublicKey { keyId: number; pem: string; base64: string; }

let ssvKeyCache: Map<number, string> = new Map();
let ssvKeyCacheTime = 0;

async function fetchGooglePublicKey(keyId: number): Promise<string | null> {
  const now = Date.now();
  if (ssvKeyCache.size === 0 || now - ssvKeyCacheTime > SSV_KEY_CACHE_TTL) {
    try {
      const res = await fetch(GOOGLE_KEY_URL, { signal: AbortSignal.timeout(5_000) });
      if (!res.ok) {
        logger.warn({ status: res.status }, "AdMob SSV: Google key fetch failed");
        return null;
      }
      const data: { keys: GooglePublicKey[] } = await res.json() as { keys: GooglePublicKey[] };
      ssvKeyCache = new Map(data.keys.map(k => [k.keyId, k.pem]));
      ssvKeyCacheTime = now;
      logger.info({ keyCount: ssvKeyCache.size }, "AdMob SSV: Google public keys refreshed");
    } catch (err) {
      logger.warn({ err }, "AdMob SSV: key fetch error");
      return null;
    }
  }
  return ssvKeyCache.get(keyId) ?? null;
}

// Verifies Google's ECDSA-SHA256 signature.
// Google signs all query params up to (not including) &signature=...
async function verifySSVSignature(
  rawQuery: string,
  signatureB64: string,
  keyId: number,
): Promise<boolean> {
  const pem = await fetchGooglePublicKey(keyId);
  if (!pem) return false;

  const sigMarker = "&signature=";
  const msgEnd = rawQuery.lastIndexOf(sigMarker);
  if (msgEnd === -1) return false;
  const message = rawQuery.slice(0, msgEnd);

  try {
    const verifier = createVerify("SHA256");
    verifier.update(message, "utf8");
    // Google sends standard base64; replace URL-safe chars just in case
    const sig = signatureB64.replace(/-/g, "+").replace(/_/g, "/");
    return verifier.verify(pem, sig, "base64");
  } catch (err) {
    logger.warn({ err }, "AdMob SSV: ECDSA verification threw");
    return false;
  }
}

// Test seam: registerEarningsRoutes assigns the auto-convert sweep here so the
// end-to-end earn→convert flow can be triggered deterministically in tests. In
// production the sweep runs only on the timer registered at the bottom of
// registerEarningsRoutes; this reference never changes its behaviour.
export let runAutoConvertForTests: (() => Promise<void>) | null = null;

// ── ROUTE REGISTRATION ────────────────────────────────────────────────────────
export function registerEarningsRoutes(app: Express): void {

  // 60 record requests per minute per user (UX burst tolerance)
  const earnLimit = rateLimit({
    windowMs: 60_000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => (req as AuthRequest).userId ?? "anon",
    message: { error: "Too many requests — slow down" },
  });

  // 5 claim requests per hour per user (prevents claim-hammering)
  const claimLimit = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => (req as AuthRequest).userId ?? "anon",
    message: { error: "Too many claim requests — try again later" },
  });

  // 30 mission-claim requests per hour per user — enough to claim every daily +
  // weekly mission (and retry) without allowing claim-hammering.
  const missionLimit = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => (req as AuthRequest).userId ?? "anon",
    message: { error: "Too many mission claims — try again later" },
  });

  // ── POST /api/earnings/record ───────────────────────────────────────────────
  // Records a single earn action.
  // Server sets the point amount — the client sends only the action type.
  // Enforced: daily caps per action type, 2h server-side spin cooldown.
  app.post(
    "/api/earnings/record",
    authMiddleware,
    earnLimit,
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const { actionType, description } = req.body as { actionType?: unknown; description?: unknown };

        if (!actionType || typeof actionType !== "string" || !(actionType in ACTION_CONFIG)) {
          res.status(400).json({ error: "Invalid action type" }); return;
        }

        // Server-only actions (e.g. rewarded_ad) must be credited exclusively
        // via trusted server-to-server callbacks (AdMob SSV, provider webhooks).
        // Accepting them from authenticated clients would bypass the ECDSA/HMAC
        // proof those callbacks perform, allowing fraudulent balance minting.
        if (SERVER_ONLY_ACTIONS.has(actionType)) {
          res.status(403).json({
            error: `${actionType} rewards are issued automatically by the ad network — no manual claim needed`,
          }); return;
        }

        const config = ACTION_CONFIG[actionType];
        const desc = typeof description === "string" ? description.slice(0, 120) : actionType;

        // ── Serialize per-user earn operations via row-level lock ────────────
        // All checks (daily cap, spin cooldown) and the insert are performed
        // inside a single transaction that locks the user row first. This
        // prevents concurrent requests from observing pre-insert state and
        // racing past the caps.
        type RecordResult =
          | { ok: true; tokenId: string; points: number; claimableAt: string; dailyUsed: number; dailyCap: number; checkinStreak?: number; milestoneBonus?: number }
          | { ok: false; status: number; error: string; cap?: number; used?: number; nextAvailableAt?: string };

        const result: RecordResult = await db.transaction(async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
          // Acquire row-level lock — serialises concurrent earn requests for this user
          await tx.execute(sql`SELECT id FROM users WHERE id = ${req.userId!} FOR UPDATE`);

          const now      = new Date();
          const dayStart = new Date(now);
          dayStart.setUTCHours(0, 0, 0, 0);

          // ── Daily cap check ───────────────────────────────────────────────
          const [{ todayCount }] = await tx
            .select({ todayCount: count() })
            .from(earnTokens)
            .where(and(
              eq(earnTokens.userId, req.userId!),
              eq(earnTokens.actionType, actionType),
              gte(earnTokens.earnedAt, dayStart),
            ));

          if (Number(todayCount) >= config.dailyCap) {
            return { ok: false, status: 429, error: `Daily limit reached for ${actionType}`, cap: config.dailyCap, used: Number(todayCount) };
          }

          // ── Server-side 2h spin cooldown (DB-enforced) ───────────────────
          // The client-side timer is UI-only convenience — this is the real gate.
          if (actionType === "spin") {
            const cooldownSince = new Date(now.getTime() - SPIN_COOLDOWN_MS);
            const [recentSpin]  = await tx
              .select({ earnedAt: earnTokens.earnedAt })
              .from(earnTokens)
              .where(and(
                eq(earnTokens.userId, req.userId!),
                eq(earnTokens.actionType, "spin"),
                gte(earnTokens.earnedAt, cooldownSince),
              ))
              .limit(1);

            if (recentSpin) {
              const nextAt = new Date(recentSpin.earnedAt.getTime() + SPIN_COOLDOWN_MS);
              return { ok: false, status: 429, error: "Spin cooldown active", nextAvailableAt: nextAt.toISOString() };
            }
          }

          // ── Points are always server-determined ───────────────────────────
          let pts: number;
          let tokenDesc = desc;
          let newStreak: number | undefined;
          let milestoneBonus: number | undefined;
          if (actionType === "checkin") {
            // Streak is server-authoritative: advance it under the same row lock
            // the daily cap is checked under, so concurrent check-ins can't both
            // advance it. The daily cap (1/day) means reaching here is a genuinely
            // new check-in for this UTC day.
            const [u] = await tx
              .select({ checkinStreak: users.checkinStreak, lastCheckinAt: users.lastCheckinAt })
              .from(users)
              .where(eq(users.id, req.userId!));
            newStreak = nextCheckinStreak(u?.lastCheckinAt ?? null, u?.checkinStreak ?? 0, now);
            const reward = checkinReward(newStreak);
            pts = reward.points;
            milestoneBonus = reward.milestoneBonus;
            tokenDesc = reward.milestone
              ? `Day ${newStreak} check-in + ${CHECKIN_MILESTONE_DAY}-day streak bonus`
              : `Day ${newStreak} check-in`;
            await tx
              .update(users)
              .set({ checkinStreak: newStreak, lastCheckinAt: now })
              .where(eq(users.id, req.userId!));
          } else if (config.points !== null) pts = config.points;
          else if (actionType === "spin")    pts = pickRandom(SPIN_POOL);
          else                               pts = pickRandom(GAME_POOL);

          const claimableAt = new Date(now.getTime() + PENDING_WINDOW_MS);
          const snapshot = await snapshotRateString();

          const [token] = await tx.insert(earnTokens).values({
            userId:      req.userId!,
            points:      pts,
            actionType,
            description: tokenDesc,
            earnedAt:    now,
            claimableAt,
            status:      "pending",
            usdPerPointSnapshot: snapshot,
          }).returning();

          return { ok: true, tokenId: token.id, points: pts, claimableAt: claimableAt.toISOString(), dailyUsed: Number(todayCount) + 1, dailyCap: config.dailyCap, checkinStreak: newStreak, milestoneBonus };
        });

        if (!result.ok) {
          const { status, error, ...rest } = result;
          res.status(status).json({ error, ...rest }); return;
        }

        logger.info({ userId: req.userId, actionType, pts: result.points, checkinStreak: result.checkinStreak }, "earn token issued");

        res.status(201).json({
          tokenId:     result.tokenId,
          points:      result.points,
          claimableAt: result.claimableAt,
          dailyUsed:   result.dailyUsed,
          dailyCap:    result.dailyCap,
          ...(result.checkinStreak !== undefined ? { checkinStreak: result.checkinStreak } : {}),
          ...(result.milestoneBonus ? { milestoneBonus: result.milestoneBonus } : {}),
        });
      } catch (err) {
        logger.error({ err }, "earnings/record error");
        res.status(500).json({ error: "Failed to record earn action" });
      }
    },
  );

  // ── POST /api/earn/spin/begin ────────────────────────────────────────────────
  // Issues a server-side spin challenge token. The client must present this
  // token to /api/earn/spin/complete before an earn token is issued.
  // This enforces a server-observed "begin" step — /complete is rejected
  // without a valid, unexpired, same-user challenge.
  app.post(
    "/api/earn/spin/begin",
    authMiddleware,
    earnLimit,
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const { randomBytes } = await import("node:crypto");
        const challengeToken = randomBytes(32).toString("hex");
        const pts = pickRandom(SPIN_POOL);
        await issueSpinChallenge(challengeToken, req.userId!, SPIN_CHALLENGE_TTL_MS, pts);
        logger.info({ userId: req.userId, points: pts }, "spin challenge issued");
        res.status(201).json({ challengeToken, points: pts });
      } catch (err) {
        // A brief DB blip while issuing the challenge surfaces as a friendly,
        // retryable 503 (consistent with the sponsored-visit fail-closed policy)
        // rather than a bare 500, so the spin wheel self-heals on retry.
        if (err instanceof SpinChallengeStoreError) {
          logger.error({ err, userId: req.userId }, "earn/spin/begin store unavailable — failing retryable");
          res.status(503).json({
            error: "Spin is temporarily unavailable. Please try again in a moment.",
            retryable: true,
          });
          return;
        }
        logger.error({ err }, "earn/spin/begin error");
        res.status(500).json({ error: "Failed to begin spin" });
      }
    },
  );

  // ── POST /api/earn/spin/complete ─────────────────────────────────────────────
  // Validates the server-issued spin challenge and issues an earn token.
  // Enforced: challenge must exist, belong to this user, not be expired,
  // and have been issued at least SPIN_CHALLENGE_MIN_MS ago (anti-instant-replay).
  // Then applies the standard 2h server-side cooldown + daily cap.
  app.post(
    "/api/earn/spin/complete",
    authMiddleware,
    earnLimit,
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const { challengeToken } = req.body as { challengeToken?: unknown };
        if (!challengeToken || typeof challengeToken !== "string") {
          res.status(400).json({ error: "challengeToken is required" }); return;
        }

        // Validate + atomically consume the challenge from the shared DB store.
        // Single-use is enforced at the DB level so the begin/complete pair can
        // land on different autoscaled replicas and concurrent /complete calls
        // for the same token can't both succeed.
        const consumed = await consumeSpinChallenge(
          challengeToken,
          req.userId!,
          SPIN_CHALLENGE_MIN_MS,
        );
        if (consumed.status === "not_found") {
          res.status(403).json({ error: "Invalid or expired spin challenge" }); return;
        }
        if (consumed.status === "wrong_user") {
          res.status(403).json({ error: "Spin challenge does not belong to this user" }); return;
        }
        if (consumed.status === "expired") {
          res.status(403).json({ error: "Spin challenge expired — please spin again" }); return;
        }
        if (consumed.status === "too_early") {
          res.status(425).json({
            error: "Spin completed too quickly",
            retryAfterMs: consumed.retryAfterMs,
          }); return;
        }

        const config = ACTION_CONFIG.spin;

        // ── Serialize per-user spin operations via row-level lock ────────────
        // Daily cap, 2h cooldown check, and insert are all performed inside a
        // single transaction that locks the user row first. This prevents
        // concurrent /complete requests (each with their own valid challenge
        // token) from observing pre-insert state and racing past the limits.
        type SpinResult =
          | { ok: true; tokenId: string; points: number; claimableAt: string; dailyUsed: number; dailyCap: number }
          | { ok: false; status: number; error: string; cap?: number; nextAvailableAt?: string };

        const result: SpinResult = await db.transaction(async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
          // Acquire row-level lock — serialises concurrent spin completions for this user
          await tx.execute(sql`SELECT id FROM users WHERE id = ${req.userId!} FOR UPDATE`);

          const now      = new Date();
          const dayStart = new Date(now);
          dayStart.setUTCHours(0, 0, 0, 0);

          // Daily cap
          const [{ todayCount }] = await tx
            .select({ todayCount: count() })
            .from(earnTokens)
            .where(and(
              eq(earnTokens.userId, req.userId!),
              eq(earnTokens.actionType, "spin"),
              gte(earnTokens.earnedAt, dayStart),
            ));
          if (Number(todayCount) >= config.dailyCap) {
            return { ok: false, status: 429, error: "Daily spin limit reached", cap: config.dailyCap };
          }

          // 2h cooldown
          const cooldownSince = new Date(now.getTime() - SPIN_COOLDOWN_MS);
          const [recentSpin] = await tx
            .select({ earnedAt: earnTokens.earnedAt })
            .from(earnTokens)
            .where(and(
              eq(earnTokens.userId, req.userId!),
              eq(earnTokens.actionType, "spin"),
              gte(earnTokens.earnedAt, cooldownSince),
            ))
            .limit(1);
          if (recentSpin) {
            const nextAt = new Date(recentSpin.earnedAt.getTime() + SPIN_COOLDOWN_MS);
            return { ok: false, status: 429, error: "Spin cooldown active", nextAvailableAt: nextAt.toISOString() };
          }

          // Use the predetermined points stored at begin-time so the visual
          // wheel segment and the server reward are always in sync. Fall back
          // to pickRandom only for legacy challenges issued without points
          // (e.g. the brief transition window after a deploy).
          const pts = consumed.status === "ok" && consumed.points != null
            ? consumed.points
            : pickRandom(SPIN_POOL);
          const claimableAt = new Date(now.getTime() + PENDING_WINDOW_MS);
          const snapshot = await snapshotRateString();
          const [token] = await tx.insert(earnTokens).values({
            userId:      req.userId!,
            points:      pts,
            actionType:  "spin",
            description: "Spin wheel",
            earnedAt:    now,
            claimableAt,
            status:      "pending",
            usdPerPointSnapshot: snapshot,
          }).returning();

          return { ok: true, tokenId: token.id, points: pts, claimableAt: claimableAt.toISOString(), dailyUsed: Number(todayCount) + 1, dailyCap: config.dailyCap };
        });

        if (!result.ok) {
          const { status, error, ...rest } = result;
          res.status(status).json({ error, ...rest }); return;
        }

        logger.info({ userId: req.userId, pts: result.points }, "spin earn token issued via challenge");
        res.status(201).json({
          tokenId:     result.tokenId,
          points:      result.points,
          claimableAt: result.claimableAt,
          dailyUsed:   result.dailyUsed,
          dailyCap:    result.dailyCap,
        });
      } catch (err) {
        // A brief DB blip while validating/consuming the challenge surfaces as a
        // friendly, retryable 503 rather than a bare 500. The challenge token is
        // left intact when the consume query throws, so a retry can succeed.
        if (err instanceof SpinChallengeStoreError) {
          logger.error({ err, userId: req.userId }, "earn/spin/complete store unavailable — failing retryable");
          res.status(503).json({
            error: "Spin is temporarily unavailable. Please try again in a moment.",
            retryable: true,
          });
          return;
        }
        logger.error({ err }, "earn/spin/complete error");
        res.status(500).json({ error: "Failed to complete spin" });
      }
    },
  );

  // ── POST /api/earn/game/{begin,complete} — DISABLED (410 Gone) ───────────────
  // SECURITY (Task #698, Vuln #1): the begin→complete ceremony only ever proved
  // that the client waited GAME_CHALLENGE_MIN_MS between two calls while holding
  // its own challenge token. Elapsed time on a same-user token is NOT proof that
  // a real game was played or won — a script can call begin, sleep, then complete
  // to mint balance-bearing earn tokens at will, and a farm of accounts scales it.
  // The threat model explicitly rejects "replayable browser choreography" /
  // client-timed begin/complete as proof for money-like rewards, and there is no
  // server-verifiable gameplay-result signal to bind these calls to. The credit
  // path is therefore removed rather than re-hardened (no trustworthy signal
  // exists to harden against). The client (cashclip/lib/earn-client.ts) already
  // treats 410 as "no server reward" and shows the win animation without crediting.
  const gameRewardGone = (_req: AuthRequest, res: Response): void => {
    res.status(410).json({
      ok: false,
      error: "Game rewards are no longer available.",
    });
  };
  app.post("/api/earn/game/begin", authMiddleware, gameRewardGone);
  app.post("/api/earn/game/complete", authMiddleware, gameRewardGone);

  // ── POST /api/earn/ad/{begin,complete} — DISABLED (410 Gone) ─────────────────
  // SECURITY (Task #698, Vuln #1): this in-app "rewarded-ad fallback" used the
  // same client-timed begin→complete ceremony and credited a balance-bearing
  // earn token after only AD_CHALLENGE_MIN_MS elapsed — with no attested
  // ad-impression signal proving an ad was ever shown. It was trivially
  // scriptable (begin → sleep → complete) and farmable across accounts.
  // Real rewarded-ad rewards are credited exclusively server-side via Google
  // AdMob Server-Side Verification (ECDSA-SHA256 verified at GET /api/admob/ssv),
  // which is a trusted provider callback. This unverifiable fallback is removed.
  // The client (cashclip/lib/earn-client.ts) already treats 410 as "no server
  // reward" and skips the earn-token step gracefully.
  const adRewardGone = (_req: AuthRequest, res: Response): void => {
    res.status(410).json({
      ok: false,
      error: "This reward is no longer available.",
    });
  };
  app.post("/api/earn/ad/begin", authMiddleware, adRewardGone);
  app.post("/api/earn/ad/complete", authMiddleware, adRewardGone);

  // ── POST /api/earnings/claim ────────────────────────────────────────────────
  // Claims all earn tokens past their 3-hour window.
  // Enforced inside one atomic transaction with a row-level lock:
  //   - 30-day token expiry sweep
  //   - Daily USD claim cap ($5.00)
  //   - Balance credit + ledger entry
  app.post(
    "/api/earnings/claim",
    authMiddleware,
    claimLimit,
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const now            = new Date();
        const dayStart       = new Date(now);
        dayStart.setUTCHours(0, 0, 0, 0);
        const expiryThreshold = new Date(now.getTime() - TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

        const result = await db.transaction(async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
          // Row-level lock — prevents concurrent double-claim
          await tx.execute(sql`SELECT id FROM users WHERE id = ${req.userId!} FOR UPDATE`);

          // ── Expire stale tokens (30-day TTL) ──────────────────────────────
          const expired = await tx
            .update(earnTokens)
            .set({ status: "expired" })
            .where(and(
              eq(earnTokens.userId, req.userId!),
              eq(earnTokens.status, "pending"),
              lt(earnTokens.earnedAt, expiryThreshold),
            ))
            .returning({ id: earnTokens.id });

          if (expired.length > 0) {
            logger.info({ userId: req.userId, expiredCount: expired.length }, "earn tokens expired");
          }

          // ── Daily cap check (USD) ──────────────────────────────────────────
          // Each token's value = points × its own snapshot rate (legacy floor
          // for pre-variable-rate / NULL tokens), so the cap and credit are
          // summed in dollars server-side — never from client-supplied values.
          const [{ claimedUsd }] = await tx
            .select({ claimedUsd: tokenUsdSumSql() })
            .from(earnTokens)
            .where(and(
              eq(earnTokens.userId, req.userId!),
              eq(earnTokens.status, "claimed"),
              gte(earnTokens.claimedAt, dayStart),
            ));

          const alreadyUsd      = parseFloat(claimedUsd ?? "0");
          const remainingCapUsd = DAILY_CLAIM_CAP_USD - alreadyUsd;

          if (remainingCapUsd <= 0) {
            return { ok: false as const, reason: "DAILY_CAP" as const };
          }

          // ── Fetch claimable tokens ─────────────────────────────────────────
          const ready = await tx
            .select()
            .from(earnTokens)
            .where(and(
              eq(earnTokens.userId, req.userId!),
              eq(earnTokens.status, "pending"),
              lte(earnTokens.claimableAt, now),
            ));

          if (ready.length === 0) {
            return { ok: true as const, claimed: 0, creditedUsd: 0, creditedPts: 0, newBalance: 0 };
          }

          // ── Apply daily cap — take tokens until the USD ceiling ────────────
          let totalPts = 0;
          let totalUsd = 0;
          const tokenIds: string[] = [];
          for (const t of ready) {
            const value = tokenUsd(t.points, t.usdPerPointSnapshot);
            if (totalUsd + value > remainingCapUsd + 1e-9) break;
            totalUsd += value;
            totalPts += t.points;
            tokenIds.push(t.id);
          }

          if (totalPts === 0) {
            return { ok: false as const, reason: "DAILY_CAP" as const };
          }

          const creditUsd = parseFloat(totalUsd.toFixed(4));
          const creditStr = creditUsd.toFixed(4);

          // ── Mark claimed — only the capped subset, not all claimable ─────────
          await tx
            .update(earnTokens)
            .set({ status: "claimed", claimedAt: now })
            .where(inArray(earnTokens.id, tokenIds));

          // ── Credit real balance ────────────────────────────────────────────
          const [updated] = await tx
            .update(users)
            .set({
              balance:     sql`${users.balance} + ${creditStr}`,
              totalEarned: sql`${users.totalEarned} + ${creditStr}`,
            })
            .where(eq(users.id, req.userId!))
            .returning({ balance: users.balance, totalEarned: users.totalEarned });

          // ── Ledger entry ───────────────────────────────────────────────────
          await tx.insert(earningsLedger).values({
            userId:      req.userId!,
            amount:      creditStr,
            type:        "bonus",
            description: `Claimed ${tokenIds.length} earn token(s) · ${totalPts} pts`,
          });

          logger.info(
            { userId: req.userId, tokensClaimed: tokenIds.length, totalPts, creditUsd },
            "earn tokens claimed",
          );

          return {
            ok:          true as const,
            claimed:     tokenIds.length,
            creditedUsd: creditUsd,
            creditedPts: totalPts,
            newBalance:  parseFloat(updated.balance),
            skippedCap:  tokenIds.length < ready.length,
          };
        });

        if (!result.ok) {
          res.status(429).json({ error: "Daily earning cap reached ($5.00). Resets at midnight UTC." });
          return;
        }

        res.json(result);
      } catch (err) {
        logger.error({ err }, "earnings/claim error");
        res.status(500).json({ error: "Failed to claim earnings" });
      }
    },
  );

  // ── GET /api/earnings/pending ───────────────────────────────────────────────
  // Returns the user's pending and claimable token lists for UI display.
  // Only non-expired tokens are returned.
  app.get(
    "/api/earnings/pending",
    authMiddleware,
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const now    = new Date();
        const tokens = await db
          .select()
          .from(earnTokens)
          .where(and(
            eq(earnTokens.userId, req.userId!),
            eq(earnTokens.status, "pending"),
          ));

        type EarnTokenRow = (typeof tokens)[number];
        const pending   = tokens.filter((t: EarnTokenRow) => t.claimableAt > now);
        const claimable = tokens.filter((t: EarnTokenRow) => t.claimableAt <= now);

        // Current rate that NEWLY earned points lock in at (display only).
        const rate = await getCurrentRate(DEFAULT_REGION);
        const round4 = (n: number) => parseFloat(n.toFixed(4));
        const sumUsd = (arr: EarnTokenRow[]) =>
          round4(arr.reduce((s, t) => s + tokenUsd(t.points, t.usdPerPointSnapshot), 0));

        res.json({
          pending: pending.map((t: EarnTokenRow) => ({
            id:          t.id,
            points:      t.points,
            actionType:  t.actionType,
            description: t.description,
            earnedAt:    t.earnedAt,
            claimableAt: t.claimableAt,
            estimatedUsd: round4(tokenUsd(t.points, t.usdPerPointSnapshot)),
          })),
          claimable: claimable.map((t: EarnTokenRow) => ({
            id:          t.id,
            points:      t.points,
            actionType:  t.actionType,
            description: t.description,
            claimableAt: t.claimableAt,
            estimatedUsd: round4(tokenUsd(t.points, t.usdPerPointSnapshot)),
          })),
          pendingPoints:   pending.reduce((s: number, t: EarnTokenRow) => s + t.points, 0),
          claimablePoints: claimable.reduce((s: number, t: EarnTokenRow) => s + t.points, 0),
          pendingUsd:      sumUsd(pending),
          claimableUsd:    sumUsd(claimable),
          usdPerPoint:      rate.usdPerPoint,
          floorUsdPerPoint: rate.floorUsdPerPoint,
          pointsPerDollar:  rate.usdPerPoint > 0 ? Math.round(1 / rate.usdPerPoint) : null,
        });
      } catch (err) {
        logger.error({ err }, "earnings/pending error");
        res.status(500).json({ error: "Failed to fetch pending earnings" });
      }
    },
  );

  // ── GET /api/earnings/checkin-status ────────────────────────────────────────
  // Server-authoritative daily check-in state for the Earn screen. Returns the
  // user's live streak, whether they've already checked in today (UTC), the full
  // reward ladder + milestone config (so the on-screen day circles show the REAL
  // awards), and the points the next check-in will grant.
  app.get(
    "/api/earnings/checkin-status",
    authMiddleware,
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const now = new Date();
        const [u] = await db
          .select({ checkinStreak: users.checkinStreak, lastCheckinAt: users.lastCheckinAt })
          .from(users)
          .where(eq(users.id, req.userId!));

        const storedStreak = u?.checkinStreak ?? 0;
        const lastCheckinAt = u?.lastCheckinAt ?? null;

        const todayKey = utcDayKey(now);
        const yesterdayKey = utcDayKey(new Date(now.getTime() - 24 * 60 * 60 * 1000));
        const lastKey = lastCheckinAt ? utcDayKey(lastCheckinAt) : null;

        const checkedInToday = lastKey === todayKey;
        // Effective current streak for display: alive if checked in today or
        // yesterday, otherwise the streak has lapsed and reads as 0.
        const effectiveStreak =
          checkedInToday || lastKey === yesterdayKey ? Math.max(0, storedStreak) : 0;

        // What the NEXT check-in produces (today's, if not yet done; otherwise
        // tomorrow's projected reward continuing the streak).
        const projectedStreak = checkedInToday ? storedStreak + 1 : effectiveStreak + 1;
        const next = checkinReward(projectedStreak);

        res.json({
          checkinStreak:   effectiveStreak,
          checkedInToday,
          ladder:          CHECKIN_REWARD_LADDER,
          milestoneEvery:  CHECKIN_MILESTONE_DAY,
          milestoneBonus:  CHECKIN_MILESTONE_BONUS,
          nextReward:      next.points,
          nextRewardBase:  next.base,
          nextIsMilestone: next.milestone,
        });
      } catch (err) {
        logger.error({ err }, "earnings/checkin-status error");
        res.status(500).json({ error: "Failed to load check-in status" });
      }
    },
  );

  // ── POST /api/missions/claim ────────────────────────────────────────────────
  // Server-verified daily/weekly mission claim. Mission completion is recomputed
  // from trusted server records (issued earn tokens, credited referrals) — never
  // trusted from the client — and an earn token is issued at most once per mission
  // per period (idempotent via a per-mission/period transactionId). Missions with
  // no server-verifiable signal return 422 and never credit.
  app.post(
    "/api/missions/claim",
    authMiddleware,
    missionLimit,
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const { missionId } = req.body as { missionId?: unknown };
        if (typeof missionId !== "string" || !(missionId in MISSION_CONFIG)) {
          res.status(400).json({ error: "Unknown mission" });
          return;
        }
        const spec = MISSION_CONFIG[missionId];
        if (!spec.verify) {
          res.status(422).json({
            error: "This mission isn't server-verifiable, so it can't be claimed for points.",
            verifiable: false,
          });
          return;
        }
        const config = ACTION_CONFIG[spec.actionType];

        type MissionResult =
          | { ok: true; alreadyClaimed: boolean; tokenId: string; points: number; actionType: string; claimableAt: string }
          | { ok: false; status: number; body: Record<string, unknown> };

        const result: MissionResult = await db.transaction(async (tx: MissionTx) => {
          // Serialize concurrent claims for this user so the idempotency check and
          // insert can't race into a duplicate token.
          await tx.execute(sql`SELECT id FROM users WHERE id = ${req.userId!} FOR UPDATE`);

          const now = new Date();
          const dayStart = new Date(now);
          dayStart.setUTCHours(0, 0, 0, 0);
          const periodStart = spec.period === "weekly" ? weekStartUtc(now) : dayStart;
          const periodKey = spec.period === "weekly" ? weekKey(now) : utcDayKey(now);
          const claimKey = `mission:${missionId}:${req.userId!}:${periodKey}`;

          // Idempotency: already claimed this mission this period?
          const [existing] = await tx
            .select({ id: earnTokens.id, points: earnTokens.points, claimableAt: earnTokens.claimableAt })
            .from(earnTokens)
            .where(eq(earnTokens.transactionId, claimKey))
            .limit(1);
          if (existing) {
            return {
              ok: true,
              alreadyClaimed: true,
              tokenId: existing.id,
              points: existing.points,
              actionType: spec.actionType,
              claimableAt: existing.claimableAt.toISOString(),
            };
          }

          // Verify genuine completion from trusted records.
          const progress = await spec.verify!({ tx, userId: req.userId!, periodStart });
          if (progress < spec.target) {
            return {
              ok: false,
              status: 409,
              body: { error: "Mission not completed yet", progress, target: spec.target },
            };
          }

          // Daily cap on the mission action type (defence in depth).
          const todayCount = await countActionTokensSince(tx, req.userId!, spec.actionType, dayStart);
          if (todayCount >= config.dailyCap) {
            return {
              ok: false,
              status: 429,
              body: { error: `Daily limit reached for ${spec.actionType}`, cap: config.dailyCap, used: todayCount },
            };
          }

          const claimableAt = new Date(now.getTime() + PENDING_WINDOW_MS);
          const snapshot = await snapshotRateString();
          const [token] = await tx
            .insert(earnTokens)
            .values({
              userId:              req.userId!,
              points:              config.points!,
              actionType:          spec.actionType,
              description:         `Mission: ${missionId}`,
              earnedAt:            now,
              claimableAt,
              status:              "pending",
              transactionId:       claimKey,
              usdPerPointSnapshot: snapshot,
            })
            .returning();

          return {
            ok: true,
            alreadyClaimed: false,
            tokenId: token.id,
            points: config.points!,
            actionType: spec.actionType,
            claimableAt: claimableAt.toISOString(),
          };
        });

        if (!result.ok) {
          res.status(result.status).json(result.body);
          return;
        }
        if (!result.alreadyClaimed) {
          logger.info({ userId: req.userId, missionId, points: result.points }, "mission claim earn token issued");
        }
        res.status(result.alreadyClaimed ? 200 : 201).json({
          tokenId:        result.tokenId,
          points:         result.points,
          actionType:     result.actionType,
          claimableAt:    result.claimableAt,
          alreadyClaimed: result.alreadyClaimed,
        });
      } catch (err) {
        logger.error({ err }, "missions/claim error");
        res.status(500).json({ error: "Failed to claim mission" });
      }
    },
  );

  // ── GET /api/economy/rate ───────────────────────────────────────────────────
  // The current server-authoritative points→cash conversion rate (read-only).
  // `displayPointsPerDollar` is the cosmetic UI multiplier (e.g. 10 000 pts = $1)
  // served from the `app_settings` DB row (written by PUT /api/admin/economy/display-rate)
  // with the code constant as a safe fallback. Real cash (usdPerPoint) is unaffected.
  app.get(
    "/api/economy/rate",
    authMiddleware,
    async (_req: AuthRequest, res: Response): Promise<void> => {
      try {
        const rate = await getCurrentRate(DEFAULT_REGION);
        const rawSetting = getSetting(DISPLAY_POINTS_PER_DOLLAR_KEY);
        const parsedSetting = rawSetting != null ? parseInt(rawSetting, 10) : NaN;
        const displayPointsPerDollar =
          Number.isInteger(parsedSetting) && parsedSetting > 0
            ? parsedSetting
            : DISPLAY_POINTS_PER_DOLLAR;
        res.json({
          usdPerPoint:            rate.usdPerPoint,
          floorUsdPerPoint:       rate.floorUsdPerPoint,
          legacyUsdPerPoint:      LEGACY_USD_PER_POINT,
          pointsPerDollar:        rate.usdPerPoint > 0 ? Math.round(1 / rate.usdPerPoint) : null,
          displayPointsPerDollar,
          method:                 rate.method,
          region:                 rate.region,
          updatedAt:              rate.computedAt,
        });
      } catch (err) {
        logger.error({ err }, "economy/rate error");
        res.status(500).json({ error: "Failed to load conversion rate" });
      }
    },
  );

  // ── PUT /api/admin/economy/display-rate ────────────────────────────────────
  // Admin-only: update the cosmetic on-screen display multiplier (how many
  // points equal $1 in the UI). Persisted in app_settings and served by
  // GET /api/economy/rate — clients pick it up on the next hydrate without an
  // app build or API redeploy. Real cash (usdPerPoint) is completely unaffected.
  //
  // Validation: must be a positive integer between 100 and 1,000,000.
  // Rationale: 100 = floor that keeps display numbers legible; 1,000,000 = hard
  // cap preventing absurdly inflated numbers that could mislead users.
  app.put(
    "/api/admin/economy/display-rate",
    adminMiddleware,
    async (req: AuthRequest, res: Response): Promise<void> => {
      const body = (req.body ?? {}) as { displayPointsPerDollar?: unknown };
      const raw = body.displayPointsPerDollar;

      if (raw === undefined || raw === null) {
        res.status(400).json({ error: "displayPointsPerDollar is required" });
        return;
      }
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 100 || value > 1_000_000) {
        res.status(400).json({
          error: "displayPointsPerDollar must be a whole number between 100 and 1,000,000",
        });
        return;
      }

      try {
        await setSetting(DISPLAY_POINTS_PER_DOLLAR_KEY, String(value));
        logger.info(
          { value, actorUserId: req.userId },
          "display_points_per_dollar updated",
        );
        res.json({ ok: true, displayPointsPerDollar: value });
      } catch (err) {
        logger.error({ err }, "failed to update display_points_per_dollar");
        res.status(500).json({ error: "Failed to save setting" });
      }
    },
  );

  // ── GET /api/admob/ssv ──────────────────────────────────────────────────────
  // AdMob Server-Side Verification callback — Google's servers call this URL
  // after every rewarded ad is successfully watched.
  // MUST return 200 regardless of outcome to stop Google from retrying.
  //
  // Security checks (in order):
  //   1. Required parameters present
  //   2. Timestamp freshness (±5 minutes)
  //   3. ECDSA-SHA256 signature verified against Google's public key
  //   4. User ID resolves to a real CashClip account
  //   5. Transaction ID deduplication (prevents replay attacks)
  //   6. Daily rewarded_ad cap enforced
  //   7. Earn token issued with 3-hour pending window
  app.get("/api/admob/ssv", async (req: Request, res: Response): Promise<void> => {
    const ctx = { path: "admob/ssv" };
    try {
      const q = req.query as Record<string, string | undefined>;
      const { user_id, reward_item, reward_amount, timestamp, transaction_id, signature, key_id } = q;

      // ── 1. Required parameters (signature envelope) ─────────────────────
      // user_id is intentionally checked separately (after signature) so we can
      // distinguish a regression where Google's callback drops user_id from random
      // junk that lacks the whole envelope.
      if (!timestamp || !signature || !key_id) {
        logger.warn({ ...ctx, query: q }, "AdMob SSV: missing required params");
        res.status(200).send("OK"); return;
      }

      // ── 2. Timestamp freshness ──────────────────────────────────────────
      const tsMs = parseInt(timestamp, 10);
      if (isNaN(tsMs) || Math.abs(Date.now() - tsMs) > SSV_TIMESTAMP_TOLERANCE) {
        logger.warn({ ...ctx, tsMs, delta: Math.abs(Date.now() - tsMs) }, "AdMob SSV: stale timestamp");
        res.status(200).send("OK"); return;
      }

      // ── 3. ECDSA-SHA256 signature verification ──────────────────────────
      const rawQuery = req.url.split("?")[1] ?? "";
      const sigValid = await verifySSVSignature(rawQuery, signature, parseInt(key_id, 10));

      if (!sigValid) {
        logger.warn({ ...ctx, keyId: key_id }, "AdMob SSV: invalid signature — rejected");
        res.status(200).send("OK"); return;
      }

      // ── 3a. user_id presence (post-signature) ───────────────────────────
      // This check intentionally runs AFTER signature+timestamp pass so its
      // counter only increments for genuine Google callbacks — noise from bots or
      // scanners that lack a valid envelope never reaches this path.  A non-zero
      // count here means the AdMob rewarded-ad unit lost its user_id configuration
      // on the client, which would silently block all SSV rewards.
      if (!user_id) {
        recordSsvMissingUserId();
        res.status(200).send("OK"); return;
      }

      // ── 4. User existence check ─────────────────────────────────────────
      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, user_id))
        .limit(1);

      if (!user) {
        logger.warn({ ...ctx, userId: user_id }, "AdMob SSV: unknown user");
        res.status(200).send("OK"); return;
      }

      // ── 5–7. Atomic cap enforcement ──────────────────────────────────────
      // Replay prevention, daily cap check, and token insert are wrapped in a
      // single transaction with a FOR UPDATE lock on the user row. This
      // serialises concurrent SSV callbacks for the same account so that two
      // valid callbacks racing near the cap boundary cannot both observe a
      // sub-cap count and both insert a new token (bypassing the daily limit).
      const snapshot = await snapshotRateString();
      const issued = await db.transaction(async (tx) => {
        // Lock the user row for the duration of this transaction so any other
        // concurrent SSV callback for the same user must wait.
        await tx.execute(sql`SELECT id FROM ${users} WHERE id = ${user_id} FOR UPDATE`);

        // Replay prevention: unique index on transaction_id already prevents
        // a duplicate insert, but we check first to return early and skip the
        // (now redundant) cap query.
        if (transaction_id) {
          const [dup] = await tx
            .select({ id: earnTokens.id })
            .from(earnTokens)
            .where(eq(earnTokens.transactionId, transaction_id))
            .limit(1);

          if (dup) {
            logger.warn({ ...ctx, transactionId: transaction_id }, "AdMob SSV: duplicate — skipped");
            return false;
          }
        }

        // Daily cap check — runs inside the lock so the count is stable.
        const now      = new Date();
        const dayStart = new Date(now);
        dayStart.setUTCHours(0, 0, 0, 0);

        const [{ todayCount }] = await tx
          .select({ todayCount: count() })
          .from(earnTokens)
          .where(and(
            eq(earnTokens.userId, user_id),
            eq(earnTokens.actionType, "rewarded_ad"),
            gte(earnTokens.earnedAt, dayStart),
          ));

        if (Number(todayCount) >= ACTION_CONFIG.rewarded_ad.dailyCap) {
          logger.info({ ...ctx, userId: user_id }, "AdMob SSV: daily ad cap reached");
          return false;
        }

        // Issue earn token.
        const claimableAt = new Date(now.getTime() + PENDING_WINDOW_MS);
        await tx.insert(earnTokens).values({
          userId:        user_id,
          points:        ACTION_CONFIG.rewarded_ad.points!,
          actionType:    "rewarded_ad",
          description:   `Rewarded ad · SSV verified · ${reward_item ?? "reward"}`,
          earnedAt:      now,
          claimableAt,
          status:        "pending",
          transactionId: transaction_id ?? null,
          usdPerPointSnapshot: snapshot,
        });

        return true;
      });

      if (issued) {
        logger.info(
          { userId: user_id, rewardItem: reward_item, rewardAmount: reward_amount, transactionId: transaction_id },
          "AdMob SSV: earn token issued",
        );
      }

      res.status(200).send("OK");
    } catch (err) {
      logger.error({ err }, "AdMob SSV: unhandled error");
      res.status(200).send("OK"); // Always 200 — stop Google retries
    }
  });

  // ── AUTO-CONVERSION JOB ───────────────────────────────────────────────────────
  // Sweeps ALL users' eligible earn tokens (past 3-hour hold) and credits
  // balances automatically every 30 minutes, so points convert shortly after
  // their 3-hour hold clears. Respects the daily $5 cap per user.
  // The manual /api/earnings/claim endpoint still exists for instant conversion.
  const AUTO_CONVERT_INTERVAL_MS = 30 * 60 * 1000;
  const AUTO_CONVERT_LOCK_KEY = 260001; // singleton-job advisory-lock key

  async function runAutoConvert(): Promise<void> {
    try {
      // Only one replica runs the sweep at a time. Per-user FOR UPDATE + the
      // token status transition already make crediting idempotent (no
      // double-credit across restarts/replicas); this lock just avoids
      // redundant duplicate sweeps on the autoscaled fleet.
      const ran = await withAdvisoryLock(AUTO_CONVERT_LOCK_KEY, async () => {
      const now = new Date();
      const expiryThreshold = new Date(now.getTime() - TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

      const usersWithTokens = await db
        .selectDistinct({ userId: earnTokens.userId })
        .from(earnTokens)
        .where(and(
          eq(earnTokens.status, "pending"),
          lte(earnTokens.claimableAt, now),
        ));

      if (usersWithTokens.length === 0) return;

      logger.info({ userCount: usersWithTokens.length }, "auto-convert: starting batch");

      for (const { userId } of usersWithTokens) {
        try {
          await db.transaction(async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
            const userRows = await tx.execute(sql`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`);
            if ((userRows.rows?.length ?? 0) === 0) {
              // User was deleted — expire their orphaned tokens so this sweep
              // never tries to credit them again, then bail out cleanly.
              await tx.update(earnTokens)
                .set({ status: "expired" })
                .where(and(
                  eq(earnTokens.userId, userId),
                  eq(earnTokens.status, "pending"),
                ));
              logger.warn({ userId }, "auto-convert: user not found — expired orphaned tokens");
              return;
            }

            await tx.update(earnTokens)
              .set({ status: "expired" })
              .where(and(
                eq(earnTokens.userId, userId),
                eq(earnTokens.status, "pending"),
                lt(earnTokens.earnedAt, expiryThreshold),
              ));

            const dayStart = new Date(now);
            dayStart.setUTCHours(0, 0, 0, 0);

            const [{ claimedUsd }] = await tx
              .select({ claimedUsd: tokenUsdSumSql() })
              .from(earnTokens)
              .where(and(
                eq(earnTokens.userId, userId),
                eq(earnTokens.status, "claimed"),
                gte(earnTokens.claimedAt, dayStart),
              ));

            const alreadyUsd = parseFloat(claimedUsd ?? "0");
            const remainingCapUsd = DAILY_CLAIM_CAP_USD - alreadyUsd;
            if (remainingCapUsd <= 0) return;

            const ready = await tx.select().from(earnTokens)
              .where(and(
                eq(earnTokens.userId, userId),
                eq(earnTokens.status, "pending"),
                lte(earnTokens.claimableAt, now),
              ));
            if (ready.length === 0) return;

            let totalPts = 0;
            let totalUsd = 0;
            const tokenIds: string[] = [];
            for (const tok of ready) {
              const value = tokenUsd(tok.points, tok.usdPerPointSnapshot);
              if (totalUsd + value > remainingCapUsd + 1e-9) break;
              totalUsd += value;
              totalPts += tok.points;
              tokenIds.push(tok.id);
            }
            if (totalPts === 0) return;

            const creditUsd = parseFloat(totalUsd.toFixed(4));
            const creditStr = creditUsd.toFixed(4);

            await tx.update(earnTokens)
              .set({ status: "claimed", claimedAt: now })
              .where(inArray(earnTokens.id, tokenIds));

            await tx.update(users)
              .set({
                balance:     sql`${users.balance} + ${creditStr}`,
                totalEarned: sql`${users.totalEarned} + ${creditStr}`,
              })
              .where(eq(users.id, userId));

            await tx.insert(earningsLedger).values({
              userId,
              amount:      creditStr,
              type:        "bonus",
              description: `Auto-converted ${tokenIds.length} token(s) · ${totalPts} pts`,
            });

            logger.info({ userId, tokensClaimed: tokenIds.length, totalPts, creditUsd }, "auto-convert: credited user");
          });
        } catch (userErr) {
          logger.error({ err: userErr, userId }, "auto-convert: user transaction failed, skipping");
        }
      }

      logger.info({ userCount: usersWithTokens.length }, "auto-convert: batch complete");
      });
      if (!ran) {
        logger.debug("auto-convert: another replica holds the lock — skipping");
      }
    } catch (err) {
      logger.error({ err }, "auto-convert: job error");
    }
  }

  // Expose the sweep for deterministic testing of the earn→convert flow.
  runAutoConvertForTests = runAutoConvert;

  // Initial run 5 minutes after startup, then every 30 minutes
  setTimeout(() => {
    runAutoConvert().catch((err) => logger.error({ err }, "auto-convert: initial run failed"));
    setInterval(() => {
      runAutoConvert().catch((err) => logger.error({ err }, "auto-convert: interval run failed"));
    }, AUTO_CONVERT_INTERVAL_MS);
  }, 5 * 60 * 1000);
}
