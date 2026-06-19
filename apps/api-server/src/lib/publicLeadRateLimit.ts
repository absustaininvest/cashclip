import { createHash } from "crypto";
import type { Request, Response, NextFunction } from "express";
import { recordLoginAttempt } from "./dbRateLimit";
import { logger } from "./logger";
import { getClientIp } from "./clientIp";

/**
 * DB-backed rate limiter for public lead/partner-interest submission
 * endpoints.  Uses the same login_attempts table as the auth rate limiter
 * (different key prefixes) so counters are shared across all autoscaled
 * instances and survive restarts.
 *
 * Enforces three independent caps:
 *   - per-IP         (default 5,  env PUBLIC_LEAD_RATE_LIMIT)
 *                    15-minute window; bounds a single client/source.
 *   - per-email      (default 3,  env PUBLIC_LEAD_EMAIL_RATE_LIMIT)
 *                    24-hour window; bounds repeated targeting of one
 *                    recipient/topic even when submitted from rotating IPs.
 *                    Email address is SHA-256 hashed so no PII is stored.
 *   - global         (default 60, env PUBLIC_LEAD_GLOBAL_RATE_LIMIT)
 *                    15-minute window; hard ceiling on total public
 *                    submissions per window, capping botnet/IP-rotation
 *                    flood of the admin inbox.
 *
 * Failure policy: if the DB check throws for any tier, a per-process
 * in-memory fallback limiter is applied so the control degrades to
 * per-replica enforcement rather than failing open with no limit at all.
 */

const IP_WINDOW_MS = 15 * 60 * 1000;
const EMAIL_WINDOW_MS = 24 * 60 * 60 * 1000;

function getMaxIpSubmissions(): number {
  const envVal = process.env.PUBLIC_LEAD_RATE_LIMIT;
  if (!envVal) return 5;
  const parsed = parseInt(envVal, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    logger.warn({ value: envVal }, "Invalid PUBLIC_LEAD_RATE_LIMIT value, falling back to default");
    return 5;
  }
  return parsed;
}

function getMaxGlobalSubmissions(): number {
  const envVal = process.env.PUBLIC_LEAD_GLOBAL_RATE_LIMIT;
  if (!envVal) return 60;
  const parsed = parseInt(envVal, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    logger.warn({ value: envVal }, "Invalid PUBLIC_LEAD_GLOBAL_RATE_LIMIT value, falling back to default");
    return 60;
  }
  return parsed;
}

function getMaxEmailSubmissions(): number {
  const envVal = process.env.PUBLIC_LEAD_EMAIL_RATE_LIMIT;
  if (!envVal) return 3;
  const parsed = parseInt(envVal, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    logger.warn({ value: envVal }, "Invalid PUBLIC_LEAD_EMAIL_RATE_LIMIT value, falling back to default");
    return 3;
  }
  return parsed;
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.length > 320) return null;
  return trimmed;
}

/** Hash an email address so no PII is stored in the rate-limit table. */
function hashEmail(email: string): string {
  return createHash("sha256").update(email).digest("hex");
}

/** In-process fallback: only used when the DB limiter throws. */
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

// Periodically evict expired fallback entries so the map does not grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of fallbackCounts) {
    if (entry.expiresAt <= now) fallbackCounts.delete(key);
  }
}, IP_WINDOW_MS).unref();

export async function publicLeadRateLimiter(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const ip = getClientIp(req);
  const maxIp = getMaxIpSubmissions();
  const maxGlobal = getMaxGlobalSubmissions();
  const maxEmail = getMaxEmailSubmissions();
  const email = normalizeEmail((req.body ?? {}).email);

  // Three-tier limiter: per-IP (single source), per-email (target one victim
  // or admin-inbox topic from many IPs), and global (botnet-wide flood cap).
  // All three share the DB-backed login_attempts table so the counters are
  // authoritative across autoscaled replicas.
  const checks: Array<{ key: string; max: number; windowMs: number; label: string }> = [
    { key: `lead:${ip}`, max: maxIp, windowMs: IP_WINDOW_MS, label: "per-ip" },
    { key: `lead:global`, max: maxGlobal, windowMs: IP_WINDOW_MS, label: "global" },
  ];
  if (email) {
    checks.push({ key: `lead:email:${hashEmail(email)}`, max: maxEmail, windowMs: EMAIL_WINDOW_MS, label: "per-email" });
  }

  for (const check of checks) {
    try {
      const { allowed } = await recordLoginAttempt(check.key, check.max, check.windowMs);
      if (!allowed) {
        logger.warn({ ip, path: req.path, limit: check.label }, "Public lead rate limit exceeded");
        res.status(429).json({ error: "Too many submissions. Please try again later." });
        return;
      }
    } catch (err) {
      logger.warn({ err, ip, limit: check.label }, "publicLeadRateLimiter DB check failed; applying in-process fallback");
      const allowed = fallbackAllow(check.key, check.max, check.windowMs);
      if (!allowed) {
        logger.warn({ ip, path: req.path, limit: check.label }, "Public lead rate limit exceeded (fallback)");
        res.status(429).json({ error: "Too many submissions. Please try again later." });
        return;
      }
    }
  }

  next();
}
