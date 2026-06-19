import type { Response, NextFunction } from "express";
import { recordLoginAttempt } from "./dbRateLimit";
import { logger } from "./logger";
import type { AuthRequest } from "../auth";

/**
 * DB-backed rate limiter for authenticated support-ticket submissions.
 * Uses the same login_attempts table as other DB-backed limiters so
 * counters are shared across all autoscaled replicas and survive restarts.
 *
 * Enforces two independent caps:
 *   - per-user  (default 5,  env SUPPORT_TICKET_USER_RATE_LIMIT)
 *               1-hour window; bounds a single authenticated account.
 *   - global    (default 30, env SUPPORT_TICKET_GLOBAL_RATE_LIMIT)
 *               15-minute window; hard ceiling on total volume across all
 *               users, capping coordinated multi-account floods.
 *
 * Failure policy: if the DB check throws for any tier, a per-process
 * in-memory fallback limiter is applied so control degrades to per-replica
 * enforcement rather than failing open with no limit at all.
 */

const USER_WINDOW_MS = 60 * 60 * 1000;
const GLOBAL_WINDOW_MS = 15 * 60 * 1000;

function getMaxUserSubmissions(): number {
  const envVal = process.env.SUPPORT_TICKET_USER_RATE_LIMIT;
  if (!envVal) return 5;
  const parsed = parseInt(envVal, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    logger.warn({ value: envVal }, "Invalid SUPPORT_TICKET_USER_RATE_LIMIT, using default");
    return 5;
  }
  return parsed;
}

function getMaxGlobalSubmissions(): number {
  const envVal = process.env.SUPPORT_TICKET_GLOBAL_RATE_LIMIT;
  if (!envVal) return 30;
  const parsed = parseInt(envVal, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    logger.warn({ value: envVal }, "Invalid SUPPORT_TICKET_GLOBAL_RATE_LIMIT, using default");
    return 30;
  }
  return parsed;
}

const fallbackCounts = new Map<string, { count: number; expiresAt: number }>();

function fallbackAllow(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = fallbackCounts.get(key);
  if (!entry || entry.expiresAt <= now) {
    fallbackCounts.set(key, { count: 1, expiresAt: now + windowMs });
    return true;
  }
  entry.count += 1;
  return entry.count <= max;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of fallbackCounts) {
    if (entry.expiresAt <= now) fallbackCounts.delete(key);
  }
}, GLOBAL_WINDOW_MS).unref();

export async function supportTicketRateLimiter(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const maxUser = getMaxUserSubmissions();
  const maxGlobal = getMaxGlobalSubmissions();

  const checks: Array<{ key: string; max: number; windowMs: number; label: string }> = [
    { key: `support:user:${userId}`, max: maxUser, windowMs: USER_WINDOW_MS, label: "per-user" },
    { key: `support:global`, max: maxGlobal, windowMs: GLOBAL_WINDOW_MS, label: "global" },
  ];

  for (const check of checks) {
    try {
      const { allowed } = await recordLoginAttempt(check.key, check.max, check.windowMs);
      if (!allowed) {
        logger.warn({ userId, limit: check.label }, "Support ticket rate limit exceeded");
        res.status(429).json({ error: "Too many support requests. Please try again later." });
        return;
      }
    } catch (err) {
      logger.warn({ err, userId, limit: check.label }, "supportTicketRateLimiter DB check failed; applying in-process fallback");
      const allowed = fallbackAllow(check.key, check.max, check.windowMs);
      if (!allowed) {
        logger.warn({ userId, limit: check.label }, "Support ticket rate limit exceeded (fallback)");
        res.status(429).json({ error: "Too many support requests. Please try again later." });
        return;
      }
    }
  }

  next();
}
