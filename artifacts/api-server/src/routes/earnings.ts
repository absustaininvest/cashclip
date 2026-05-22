import type { Express, Request, Response } from "express";
import { authMiddleware, type AuthRequest } from "../auth";
import { db, earnTokens, users, earningsLedger } from "@workspace/db";
import { eq, and, lte, gte, sql, count } from "drizzle-orm";
import { logger } from "../lib/logger";
import { rateLimit } from "express-rate-limit";

// ── CONVERSION & LIMITS ───────────────────────────────────────────────────────
const POINTS_PER_DOLLAR = 1000;           // 1000 pts = $1.00
const PENDING_WINDOW_MS = 3 * 60 * 60 * 1000; // 3-hour lock
const DAILY_CLAIM_CAP_USD = 5;            // max $5.00 claimable per calendar day

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
  spin:           { points: null, dailyCap: 12 }, // every 2h = 12/day max
  mission_daily:  { points: 100,  dailyCap: 10 },
  mission_weekly: { points: 500,  dailyCap: 4  },
  game:           { points: null, dailyCap: 10 },
  video:          { points: 5,    dailyCap: 50 },
};

export function registerEarningsRoutes(app: Express): void {

  const earnLimit = rateLimit({
    windowMs: 60_000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => (req as AuthRequest).userId ?? "anon",
    message: { error: "Too many requests — slow down" },
  });

  // ── POST /api/earnings/record ───────────────────────────────────────────────
  // Records a single earn action.
  // Server sets the point amount — the client sends only the action type.
  // Daily caps are enforced per action type.
  app.post(
    "/api/earnings/record",
    authMiddleware,
    earnLimit,
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const { actionType, description } = req.body;

        if (!actionType || typeof actionType !== "string" || !(actionType in ACTION_CONFIG)) {
          res.status(400).json({ error: "Invalid action type" }); return;
        }

        const config = ACTION_CONFIG[actionType];
        const now = new Date();
        const dayStart = new Date(now);
        dayStart.setUTCHours(0, 0, 0, 0);

        // Count tokens already issued today for this action type
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
            cap: config.dailyCap,
            used: Number(todayCount),
          }); return;
        }

        // Determine points — always set server-side
        let pts: number;
        if (config.points !== null) {
          pts = config.points;
        } else if (actionType === "spin") {
          pts = pickRandom(SPIN_POOL);
        } else {
          pts = pickRandom(GAME_POOL);
        }

        const claimableAt = new Date(now.getTime() + PENDING_WINDOW_MS);
        const desc = typeof description === "string"
          ? description.slice(0, 120)
          : actionType;

        const [token] = await db.insert(earnTokens).values({
          userId:     req.userId!,
          points:     pts,
          actionType,
          description: desc,
          earnedAt:   now,
          claimableAt,
          status:     "pending",
        }).returning();

        logger.info({ userId: req.userId, actionType, pts }, "earn token issued");

        res.status(201).json({
          tokenId:    token.id,
          points:     pts,
          claimableAt: claimableAt.toISOString(),
          dailyUsed:  Number(todayCount) + 1,
          dailyCap:   config.dailyCap,
        });
      } catch (err) {
        logger.error({ err }, "earnings/record error");
        res.status(500).json({ error: "Failed to record earn action" });
      }
    },
  );

  // ── POST /api/earnings/claim ────────────────────────────────────────────────
  // Claims all earn tokens that have passed their 3-hour pending window.
  // 3-hour check, daily USD cap, and balance credit are all enforced
  // atomically inside a single transaction with a row-level lock.
  app.post(
    "/api/earnings/claim",
    authMiddleware,
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const now = new Date();
        const dayStart = new Date(now);
        dayStart.setUTCHours(0, 0, 0, 0);

        const result = await db.transaction(async (tx) => {
          // Row-level lock on the user to prevent concurrent claims
          await tx.execute(
            sql`SELECT id FROM users WHERE id = ${req.userId!} FOR UPDATE`,
          );

          // How many points claimed already today?
          const [{ claimedPts }] = await tx
            .select({ claimedPts: sql<string>`COALESCE(SUM(points), 0)` })
            .from(earnTokens)
            .where(and(
              eq(earnTokens.userId, req.userId!),
              eq(earnTokens.status, "claimed"),
              gte(earnTokens.claimedAt, dayStart),
            ));

          const alreadyPts = parseInt(claimedPts ?? "0", 10);
          const dailyCapPts = DAILY_CLAIM_CAP_USD * POINTS_PER_DOLLAR;
          const remainingCapPts = dailyCapPts - alreadyPts;

          if (remainingCapPts <= 0) {
            return { ok: false as const, reason: "DAILY_CAP" as const };
          }

          // Fetch all ready tokens (pending + past 3h window)
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

          // Apply daily cap — take tokens until cap is hit
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

          // Mark claimed
          await tx
            .update(earnTokens)
            .set({ status: "claimed", claimedAt: now })
            .where(and(
              eq(earnTokens.userId, req.userId!),
              eq(earnTokens.status, "pending"),
              lte(earnTokens.claimableAt, now),
            ));

          // Credit real balance
          const [updated] = await tx
            .update(users)
            .set({
              balance:     sql`${users.balance} + ${creditStr}`,
              totalEarned: sql`${users.totalEarned} + ${creditStr}`,
            })
            .where(eq(users.id, req.userId!))
            .returning({ balance: users.balance, totalEarned: users.totalEarned });

          // Ledger entry
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
  // Returns the user's pending and claimable earn tokens for UI display.
  app.get(
    "/api/earnings/pending",
    authMiddleware,
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const now = new Date();
        const tokens = await db
          .select()
          .from(earnTokens)
          .where(and(
            eq(earnTokens.userId, req.userId!),
            eq(earnTokens.status, "pending"),
          ));

        const pending  = tokens.filter(t => t.claimableAt > now);
        const claimable = tokens.filter(t => t.claimableAt <= now);

        res.json({
          pending: pending.map(t => ({
            id:          t.id,
            points:      t.points,
            actionType:  t.actionType,
            description: t.description,
            earnedAt:    t.earnedAt,
            claimableAt: t.claimableAt,
          })),
          claimable: claimable.map(t => ({
            id:          t.id,
            points:      t.points,
            actionType:  t.actionType,
            description: t.description,
            claimableAt: t.claimableAt,
          })),
          pendingPoints:   pending.reduce((s, t) => s + t.points, 0),
          claimablePoints: claimable.reduce((s, t) => s + t.points, 0),
        });
      } catch (err) {
        logger.error({ err }, "earnings/pending error");
        res.status(500).json({ error: "Failed to fetch pending earnings" });
      }
    },
  );

  // ── GET /api/admob/ssv ──────────────────────────────────────────────────────
  // AdMob Server-Side Verification — Google's servers call this after every
  // rewarded ad is watched. Must always return 200 to prevent Google retries.
  // Signature verification will be wired in once SSV is configured in AdMob
  // dashboard and the public key ID is known.
  app.get("/api/admob/ssv", async (req: Request, res: Response): Promise<void> => {
    try {
      const { user_id, reward_item, reward_amount, timestamp, signature, key_id } = req.query;

      if (!user_id || !timestamp || !signature || !key_id) {
        logger.warn({ query: req.query }, "AdMob SSV: missing params");
        res.status(200).send("OK"); return;
      }

      // TODO: Verify Google's ECDSA-SHA256 signature using the public key for
      // key_id from https://gstatic.com/admob/reward/verifier-keys.json
      // Once verified, call recordEarnAction for user_id with type 'rewarded_ad'.
      // Until verification is implemented, NO balance is credited.

      logger.info(
        { userId: user_id, rewardItem: reward_item, rewardAmount: reward_amount, keyId: key_id },
        "AdMob SSV callback received — verification pending",
      );

      res.status(200).send("OK");
    } catch (err) {
      logger.error({ err }, "AdMob SSV error");
      res.status(200).send("OK"); // Always 200 to stop Google retries
    }
  });
}
