import type { Express, Request, Response } from "express";
import { createVerify } from "node:crypto";
import { authMiddleware, type AuthRequest } from "../auth";
import { db, earnTokens, users, earningsLedger } from "@workspace/db";
import { eq, and, lte, gte, lt, sql, count } from "drizzle-orm";
import { logger } from "../lib/logger";
import { rateLimit } from "express-rate-limit";

// ── CONVERSION & LIMITS ───────────────────────────────────────────────────────
const POINTS_PER_DOLLAR       = 1000;
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

// Points per action — fully server-authoritative, client cannot override
interface ActionConfig {
  points: number | null; // null = server-random from pool
  dailyCap: number;
}

const ACTION_CONFIG: Record<string, ActionConfig> = {
  checkin:        { points: 100,  dailyCap: 1  },
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
]);

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
        const now      = new Date();
        const dayStart = new Date(now);
        dayStart.setUTCHours(0, 0, 0, 0);

        // ── Daily cap check ─────────────────────────────────────────────────
        const [{ todayCount }] = await db
          .select({ todayCount: count() })
          .from(earnTokens)
          .where(and(
            eq(earnTokens.userId, req.userId!),
            eq(earnTokens.actionType, actionType),
            gte(earnTokens.earnedAt, dayStart),
          ));

        if (Number(todayCount) >= config.dailyCap) {
          res.status(429).json({
            error: `Daily limit reached for ${actionType}`,
            cap:   config.dailyCap,
            used:  Number(todayCount),
          }); return;
        }

        // ── Server-side 2h spin cooldown (DB-enforced) ─────────────────────
        // The client-side timer is UI-only convenience — this is the real gate.
        if (actionType === "spin") {
          const cooldownSince = new Date(now.getTime() - SPIN_COOLDOWN_MS);
          const [recentSpin]  = await db
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
            res.status(429).json({
              error:           "Spin cooldown active",
              nextAvailableAt: nextAt.toISOString(),
            }); return;
          }
        }

        // ── Points are always server-determined ─────────────────────────────
        let pts: number;
        if (config.points !== null)   pts = config.points;
        else if (actionType === "spin") pts = pickRandom(SPIN_POOL);
        else                            pts = pickRandom(GAME_POOL);

        const claimableAt = new Date(now.getTime() + PENDING_WINDOW_MS);
        const desc = typeof description === "string" ? description.slice(0, 120) : actionType;

        const [token] = await db.insert(earnTokens).values({
          userId:      req.userId!,
          points:      pts,
          actionType,
          description: desc,
          earnedAt:    now,
          claimableAt,
          status:      "pending",
        }).returning();

        logger.info({ userId: req.userId, actionType, pts }, "earn token issued");

        res.status(201).json({
          tokenId:     token.id,
          points:      pts,
          claimableAt: claimableAt.toISOString(),
          dailyUsed:   Number(todayCount) + 1,
          dailyCap:    config.dailyCap,
        });
      } catch (err) {
        logger.error({ err }, "earnings/record error");
        res.status(500).json({ error: "Failed to record earn action" });
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

          // ── Daily cap check ────────────────────────────────────────────────
          const [{ claimedPts }] = await tx
            .select({ claimedPts: sql<string>`COALESCE(SUM(points), 0)` })
            .from(earnTokens)
            .where(and(
              eq(earnTokens.userId, req.userId!),
              eq(earnTokens.status, "claimed"),
              gte(earnTokens.claimedAt, dayStart),
            ));

          const alreadyPts      = parseInt(claimedPts ?? "0", 10);
          const dailyCapPts     = DAILY_CLAIM_CAP_USD * POINTS_PER_DOLLAR;
          const remainingCapPts = dailyCapPts - alreadyPts;

          if (remainingCapPts <= 0) {
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

          // ── Apply daily cap — take tokens until ceiling ────────────────────
          let totalPts = 0;
          const tokenIds: string[] = [];
          for (const t of ready) {
            if (totalPts + t.points > remainingCapPts) break;
            totalPts += t.points;
            tokenIds.push(t.id);
          }

          if (totalPts === 0) {
            return { ok: false as const, reason: "DAILY_CAP" as const };
          }

          const creditUsd = parseFloat((totalPts / POINTS_PER_DOLLAR).toFixed(4));
          const creditStr = creditUsd.toFixed(4);

          // ── Mark claimed ───────────────────────────────────────────────────
          await tx
            .update(earnTokens)
            .set({ status: "claimed", claimedAt: now })
            .where(and(
              eq(earnTokens.userId, req.userId!),
              eq(earnTokens.status, "pending"),
              lte(earnTokens.claimableAt, now),
            ));

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

        res.json({
          pending: pending.map((t: EarnTokenRow) => ({
            id:          t.id,
            points:      t.points,
            actionType:  t.actionType,
            description: t.description,
            earnedAt:    t.earnedAt,
            claimableAt: t.claimableAt,
          })),
          claimable: claimable.map((t: EarnTokenRow) => ({
            id:          t.id,
            points:      t.points,
            actionType:  t.actionType,
            description: t.description,
            claimableAt: t.claimableAt,
          })),
          pendingPoints:   pending.reduce((s: number, t: EarnTokenRow) => s + t.points, 0),
          claimablePoints: claimable.reduce((s: number, t: EarnTokenRow) => s + t.points, 0),
        });
      } catch (err) {
        logger.error({ err }, "earnings/pending error");
        res.status(500).json({ error: "Failed to fetch pending earnings" });
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
      await db.insert(earnTokens).values({
        userId:        user_id,
        points:        ACTION_CONFIG.rewarded_ad.points!,
        actionType:    "rewarded_ad",
        description:   `Rewarded ad · SSV verified · ${reward_item ?? "reward"}`,
        earnedAt:      now,
        claimableAt,
        status:        "pending",
        transactionId: transaction_id ?? null,
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
}
