import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../auth";
import { recordLoginAttempt } from "./dbRateLimit";
import { logger } from "./logger";

/**
 * DB-backed per-user rate limiter for POST /api/earn/ad-fill.
 *
 * A single user can report at most AD_FILL_USER_LIMIT requests per minute
 * (default 10). Because the fill-state write is in-memory only, the main risk
 * is log noise and wasted connection slots rather than financial loss, but we
 * still use a DB-backed counter so the guard holds across all autoscaled
 * replicas (in-memory counters are replica-local per the threat model).
 *
 * Failure policy: if the DB check throws, fail-closed with 429 so the
 * money-adjacent endpoint never silently becomes unlimited.
 */
const WINDOW_MS = 60 * 1000;

function getUserLimit(): number {
  const raw = process.env.AD_FILL_USER_LIMIT;
  if (!raw) return 10;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    logger.warn({ value: raw }, "Invalid AD_FILL_USER_LIMIT, using default 10");
    return 10;
  }
  return n;
}

export async function adFillRateLimiter(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const key = `ad-fill:user:${userId}`;
  const max = getUserLimit();

  try {
    const { allowed } = await recordLoginAttempt(key, max, WINDOW_MS);
    if (!allowed) {
      req.log?.warn({ userId, limit: "per-user" }, "ad-fill rate limit exceeded");
      res.status(429).json({
        error: "Too many fill reports. Please try again later.",
        retryAfterMs: WINDOW_MS,
      });
      return;
    }
  } catch (err) {
    logger.error({ err, userId }, "adFillRateLimiter DB check failed — failing closed");
    res.status(429).json({ error: "Rate limit check failed. Try again shortly." });
    return;
  }

  next();
}
