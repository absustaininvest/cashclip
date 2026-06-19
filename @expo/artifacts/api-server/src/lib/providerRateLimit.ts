import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../auth";
import { recordLoginAttempt } from "./dbRateLimit";
import { logger } from "./logger";
import { getClientIp } from "./clientIp";

/**
 * DB-backed rate limiters for provider-backed reward routes.
 *
 * Both the list endpoints (/surveys/available, /offerwalls/available) and the
 * completion endpoints (/surveys/complete, /offerwalls/complete) fan out to
 * third-party providers on every request. Without a shared cap an authenticated
 * attacker can loop these routes across all replicas and exhaust provider
 * quotas, triggering rate-limit responses that block legitimate users.
 *
 * Uses the same login_attempts table as sponsoredVisitRateLimit so counters
 * are authoritative across the autoscaled fleet — in-memory counters are
 * explicitly rejected by the threat model for money-bearing routes.
 *
 * Failure policy: if the DB check throws, fail-closed (503) so provider
 * endpoints never fall back to "unlimited" on a DB blip.
 *
 * Environment overrides (per window, all integers ≥ 1):
 *   PROVIDER_LIST_USER_LIMIT    default 20  — fetches per user per hour
 *   PROVIDER_LIST_IP_LIMIT      default 60  — fetches per IP per hour
 *   PROVIDER_COMPLETE_USER_LIMIT default 10  — verify calls per user per hour
 *   PROVIDER_COMPLETE_IP_LIMIT  default 30  — verify calls per IP per hour
 */

const WINDOW_MS = 60 * 60 * 1000;

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    logger.warn({ name, value: raw }, `Invalid ${name}, using default ${fallback}`);
    return fallback;
  }
  return n;
}

/**
 * Build a middleware that enforces per-user + per-IP DB-backed rate limiting.
 * `prefix` is embedded in the key so different route families get independent
 * counters even though they share the same login_attempts table.
 */
function makeProviderLimiter(
  prefix: string,
  getUserLimit: () => number,
  getIpLimit: () => number,
  errorMessage: string,
) {
  return async function providerLimiter(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const userId = req.userId;
    const ip = getClientIp(req);

    const checks: Array<{ key: string; max: number; label: string }> = [
      { key: `${prefix}:ip:${ip}`, max: getIpLimit(), label: "per-ip" },
    ];
    if (userId) {
      checks.push({ key: `${prefix}:user:${userId}`, max: getUserLimit(), label: "per-user" });
    }

    for (const c of checks) {
      try {
        const { allowed } = await recordLoginAttempt(c.key, c.max, WINDOW_MS);
        if (!allowed) {
          req.log?.warn({ ip, userId, limit: c.label, prefix }, "Provider rate limit exceeded");
          res.status(429).json({
            error: errorMessage,
            retryAfterMs: WINDOW_MS,
          });
          return;
        }
      } catch (err) {
        logger.error({ err, ip, userId, limit: c.label, prefix }, "providerRateLimiter DB check failed — failing closed");
        res.status(503).json({ error: "Rate limit check failed. Try again shortly." });
        return;
      }
    }

    next();
  };
}

/** Guards GET /api/surveys/available and GET /api/offerwalls/available. */
export const providerListRateLimiter = makeProviderLimiter(
  "provider:list",
  () => readIntEnv("PROVIDER_LIST_USER_LIMIT", 20),
  () => readIntEnv("PROVIDER_LIST_IP_LIMIT", 60),
  "Too many offer list requests. Please try again later.",
);

/** Guards POST /api/surveys/complete and POST /api/offerwalls/complete. */
export const providerCompleteRateLimiter = makeProviderLimiter(
  "provider:complete",
  () => readIntEnv("PROVIDER_COMPLETE_USER_LIMIT", 10),
  () => readIntEnv("PROVIDER_COMPLETE_IP_LIMIT", 30),
  "Too many reward completion attempts. Please try again later.",
);
