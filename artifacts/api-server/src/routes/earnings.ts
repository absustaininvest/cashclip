import type { Express, Request, Response } from "express";
import { createVerify } from "node:crypto";
import { authMiddleware, type AuthRequest } from "../auth";
import { db, earnTokens, users, earningsLedger } from "@workspace/db";
import { eq, and, lte, gte, lt, sql, count, inArray } from "drizzle-orm";
import { logger } from "../lib/logger";
import { rateLimit } from "express-rate-limit";
import {
  DEFAULT_REGION,
  getCurrentRate,
  snapshotRateString,
  tokenUsd,
  tokenUsdSumSql,
  LEGACY_USD_PER_POINT,
} from "../lib/pointsEconomy";
import { withAdvisoryLock } from "../lib/advisoryLock";

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
};

// Actions that may ONLY be credited by trusted server-to-server callbacks
// (e.g. AdMob SSV, provider webhooks, server-side mission completion records).
// Clients submitting these via POST /api/earnings/record are rejected with 403.
//
// rewarded_ad  — only via GET /api/admob/ssv (ECDSA-SHA256 verified by Google)
// mission_daily/mission_weekly — no server-side mission state exists yet; block
//   until a proper /api/missions/claim endpoint with server-tracked mission
//   completion is implemented. Clients currently call claimMissionReward() which
//   only updates AsyncStorage, providing no server-verifiable proof.
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

// ── SPIN CHALLENGE STORE ──────────────────────────────────────────────────────
// Server-issued single-use challenge tokens for the spin wheel.
// /begin issues a token; /complete requires it before crediting the earn token.
// This ensures the client called /begin (server-observed) before earning points.
const SPIN_CHALLENGE_TTL_MS  = 60_000;  // challenge valid for 60 s
const SPIN_CHALLENGE_MIN_MS  = 3_000;   // must wait ≥3 s between begin→complete
interface SpinChallenge { userId: string; issuedAt: number; }
const spinChallenges = new Map<string, SpinChallenge>();
setInterval(() => {
  const cutoff = Date.now() - SPIN_CHALLENGE_TTL_MS;
  for (const [k, v] of spinChallenges) {
    if (v.issuedAt < cutoff) spinChallenges.delete(k);
  }
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
        spinChallenges.set(challengeToken, { userId: req.userId!, issuedAt: Date.now() });
        logger.info({ userId: req.userId }, "spin challenge issued");
        res.status(201).json({ challengeToken });
      } catch (err) {
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

        const challenge = spinChallenges.get(challengeToken);
        if (!challenge) {
          res.status(403).json({ error: "Invalid or expired spin challenge" }); return;
        }
        if (challenge.userId !== req.userId) {
          res.status(403).json({ error: "Spin challenge does not belong to this user" }); return;
        }
        const age = Date.now() - challenge.issuedAt;
        if (age > SPIN_CHALLENGE_TTL_MS) {
          spinChallenges.delete(challengeToken);
          res.status(403).json({ error: "Spin challenge expired — please spin again" }); return;
        }
        if (age < SPIN_CHALLENGE_MIN_MS) {
          res.status(425).json({
            error: "Spin completed too quickly",
            retryAfterMs: SPIN_CHALLENGE_MIN_MS - age,
          }); return;
        }

        // Consume challenge — single use (in-memory, done before the transaction)
        spinChallenges.delete(challengeToken);

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

          const pts = pickRandom(SPIN_POOL);
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
        logger.error({ err }, "earn/spin/complete error");
        res.status(500).json({ error: "Failed to complete spin" });
      }
    },
  );

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

  // ── GET /api/economy/rate ───────────────────────────────────────────────────
  // The current server-authoritative points→cash conversion rate (read-only).
  // There is intentionally NO write counterpart: the rate is set only by the
  // recompute job from code constants, never by any client or admin request.
  app.get(
    "/api/economy/rate",
    authMiddleware,
    async (_req: AuthRequest, res: Response): Promise<void> => {
      try {
        const rate = await getCurrentRate(DEFAULT_REGION);
        res.json({
          usdPerPoint:       rate.usdPerPoint,
          floorUsdPerPoint:  rate.floorUsdPerPoint,
          legacyUsdPerPoint: LEGACY_USD_PER_POINT,
          pointsPerDollar:   rate.usdPerPoint > 0 ? Math.round(1 / rate.usdPerPoint) : null,
          method:            rate.method,
          region:            rate.region,
          updatedAt:         rate.computedAt,
        });
      } catch (err) {
        logger.error({ err }, "economy/rate error");
        res.status(500).json({ error: "Failed to load conversion rate" });
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

      // ── 1. Required parameters ──────────────────────────────────────────
      if (!user_id || !timestamp || !signature || !key_id) {
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
        logger.warn({ ...ctx, keyId: key_id, userId: user_id }, "AdMob SSV: invalid signature — rejected");
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

      // ── 5. Replay prevention (transaction_id deduplication) ─────────────
      if (transaction_id) {
        const [dup] = await db
          .select({ id: earnTokens.id })
          .from(earnTokens)
          .where(eq(earnTokens.transactionId, transaction_id))
          .limit(1);

        if (dup) {
          logger.warn({ ...ctx, transactionId: transaction_id }, "AdMob SSV: duplicate — skipped");
          res.status(200).send("OK"); return;
        }
      }

      // ── 6. Daily rewarded_ad cap ────────────────────────────────────────
      const now      = new Date();
      const dayStart = new Date(now);
      dayStart.setUTCHours(0, 0, 0, 0);

      const [{ todayCount }] = await db
        .select({ todayCount: count() })
        .from(earnTokens)
        .where(and(
          eq(earnTokens.userId, user_id),
          eq(earnTokens.actionType, "rewarded_ad"),
          gte(earnTokens.earnedAt, dayStart),
        ));

      if (Number(todayCount) >= ACTION_CONFIG.rewarded_ad.dailyCap) {
        logger.info({ ...ctx, userId: user_id }, "AdMob SSV: daily ad cap reached");
        res.status(200).send("OK"); return;
      }

      // ── 7. Issue earn token ─────────────────────────────────────────────
      const claimableAt = new Date(now.getTime() + PENDING_WINDOW_MS);
      const snapshot = await snapshotRateString();
      await db.insert(earnTokens).values({
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

      logger.info(
        { userId: user_id, rewardItem: reward_item, rewardAmount: reward_amount, transactionId: transaction_id },
        "AdMob SSV: earn token issued",
      );

      res.status(200).send("OK");
    } catch (err) {
      logger.error({ err }, "AdMob SSV: unhandled error");
      res.status(200).send("OK"); // Always 200 — stop Google retries
    }
  });

  // ── 2-HOUR AUTO-CONVERSION JOB ────────────────────────────────────────────────
  // Sweeps ALL users' eligible earn tokens (past 3-hour hold) and credits
  // balances automatically every 2 hours. Respects the daily $5 cap per user.
  // The manual /api/earnings/claim endpoint still exists for instant conversion.
  const AUTO_CONVERT_INTERVAL_MS = 2 * 60 * 60 * 1000;
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
            await tx.execute(sql`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`);

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

  // Initial run 5 minutes after startup, then every 2 hours
  setTimeout(() => {
    runAutoConvert().catch((err) => logger.error({ err }, "auto-convert: initial run failed"));
    setInterval(() => {
      runAutoConvert().catch((err) => logger.error({ err }, "auto-convert: interval run failed"));
    }, AUTO_CONVERT_INTERVAL_MS);
  }, 5 * 60 * 1000);
}
