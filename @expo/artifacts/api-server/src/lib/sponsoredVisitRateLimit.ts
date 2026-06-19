import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../auth";
import { recordLoginAttempt } from "./dbRateLimit";
import { logger } from "./logger";
import { getClientIp } from "./clientIp";

/**
 * DB-backed rate limiter for the sponsored-visit `/begin` endpoint.
 * Shares the login_attempts table so counters are authoritative across
 * all autoscaled replicas (per the threat model: in-memory counters are
 * bypassable in production).
 *
 * Two independent caps:
 *   - per-user   (default 10, env SPONSORED_BEGIN_USER_LIMIT)
 *                1-hour window; bounds one account's claim rate so a
 *                single user cannot script /begin against every active
 *                campaign in seconds.
 *   - per-IP     (default 30, env SPONSORED_BEGIN_IP_LIMIT)
 *                1-hour window; bounds Sybil farms coming from the same
 *                source IP. Combined with the per-user cap this raises
 *                the cost of automated draining of campaign budgets.
 *
 * Failure policy: if the DB check throws, fail-closed for this request
 * with a 429 so money-bearing endpoints never fall back to "unlimited".
 */
const WINDOW_MS = 60 * 60 * 1000;

function getUserLimit(): number {
  const raw = process.env.SPONSORED_BEGIN_USER_LIMIT;
  if (!raw) return 10;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    logger.warn({ value: raw }, "Invalid SPONSORED_BEGIN_USER_LIMIT, using default 10");
    return 10;
  }
  return n;
}

function getIpLimit(): number {
  const raw = process.env.SPONSORED_BEGIN_IP_LIMIT;
  if (!raw) return 30;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    logger.warn({ value: raw }, "Invalid SPONSORED_BEGIN_IP_LIMIT, using default 30");
    return 30;
  }
  return n;
}

export async function sponsoredBeginRateLimiter(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = req.userId;
  const ip = getClientIp(req);

  const checks: Array<{ key: string; max: number; label: string }> = [
    { key: `sponsored:ip:${ip}`, max: getIpLimit(), label: "per-ip" },
  ];
  if (userId) {
    checks.push({ key: `sponsored:user:${userId}`, max: getUserLimit(), label: "per-user" });
  }

  for (const c of checks) {
    try {
      const { allowed } = await recordLoginAttempt(c.key, c.max, WINDOW_MS);
      if (!allowed) {
        req.log?.warn({ ip, userId, limit: c.label }, "Sponsored begin rate limit exceeded");
        res.status(429).json({
          error: "Too many sponsored visit attempts. Please try again later.",
          retryAfterMs: WINDOW_MS,
        });
        return;
      }
    } catch (err) {
      logger.error({ err, ip, userId, limit: c.label }, "sponsoredBeginRateLimiter DB check failed — failing closed");
      res.status(503).json({ error: "Rate limit check failed. Try again shortly." });
      return;
    }
  }

  next();
}
