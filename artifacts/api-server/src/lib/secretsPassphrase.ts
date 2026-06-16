import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Response } from "express";
import type { AuthRequest } from "../auth.js";
import {
  recordLoginAttempt,
  checkLoginAttempts,
  clearLoginAttempts,
} from "./dbRateLimit.js";
import { getClientIp } from "./clientIp.js";
import { logger } from "./logger.js";

const HEADER_NAME = "x-secrets-passphrase";

/**
 * DB-backed (replica-safe) brute-force throttle for the high-privilege
 * secrets-passphrase gate. Failed passphrase attempts are counted in the
 * shared `login_attempts` table (different key prefix) so the limit holds
 * across all autoscaled instances and restarts — an in-memory counter would
 * be bypassable in production (per the threat model).
 *
 * Two independent caps over a 15-minute window:
 *   - per-admin (default 5,  env SECRETS_PASSPHRASE_USER_LIMIT)
 *               bounds guessing tied to one (possibly stolen) admin token.
 *   - per-IP    (default 15, env SECRETS_PASSPHRASE_IP_LIMIT)
 *               bounds guessing from one source across admin tokens.
 *
 * Only *incorrect* passphrase attempts consume a slot; a correct passphrase
 * clears both counters. Failure policy: if the DB check throws we fail closed
 * (503) so this defense-in-depth control never degrades to "unlimited".
 */
const WINDOW_MS = 15 * 60 * 1000;

function getUserLimit(): number {
  const raw = process.env["SECRETS_PASSPHRASE_USER_LIMIT"];
  if (!raw) return 5;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    logger.warn({ value: raw }, "Invalid SECRETS_PASSPHRASE_USER_LIMIT, using default 5");
    return 5;
  }
  return n;
}

function getIpLimit(): number {
  const raw = process.env["SECRETS_PASSPHRASE_IP_LIMIT"];
  if (!raw) return 15;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    logger.warn({ value: raw }, "Invalid SECRETS_PASSPHRASE_IP_LIMIT, using default 15");
    return 15;
  }
  return n;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) {
    const pad = Buffer.alloc(Math.max(ab.length, bb.length, 1));
    timingSafeEqual(pad, pad);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export async function secretsPassphraseMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const expected = process.env["SECRETS_PASSPHRASE"];

  if (!expected || expected.length < 8) {
    req.log?.warn(
      { route: req.originalUrl, userId: req.userId },
      "Secrets passphrase gate hit but SECRETS_PASSPHRASE is not configured",
    );
    res.status(503).json({
      error:
        "Secrets passphrase is not configured on the server. An operator must set SECRETS_PASSPHRASE (>= 8 chars) in Replit Secrets before secret-management routes can be used.",
      code: "SECRETS_PASSPHRASE_UNSET",
    });
    return;
  }

  // Require a real authenticated admin identity before evaluating the passphrase.
  // The console-token path (X-Console-Token / ADMIN_TOKEN) does not attach a
  // req.userId, so it must not be able to reach routes gated by this middleware.
  // Without this check, an attacker who knows both shared secrets (ADMIN_TOKEN +
  // SECRETS_PASSPHRASE) could invoke high-privilege operator actions — such as
  // factory-reset — while bypassing account-level auth, TOTP, and the durable
  // actor-attributed audit trail. A real admin JWT is required.
  if (!req.userId) {
    req.log?.warn(
      { route: req.originalUrl },
      "secretsPassphraseMiddleware: rejected — no authenticated admin identity (console-token path not permitted here)",
    );
    res.status(403).json({
      error: "A real admin account JWT is required to use this route. Console-token access is not permitted.",
      code: "ADMIN_IDENTITY_REQUIRED",
    });
    return;
  }

  const ip = getClientIp(req);
  const userId = req.userId;
  const ipKey = `secpass:ip:${ip}`;
  const userKey = `secpass:user:${userId}`;

  // Gate before evaluating the passphrase. Use the read-only check so simply
  // being at the limit does not itself burn a slot; slots are only consumed
  // by an incorrect attempt below.
  const gateChecks: Array<{ key: string; max: number; label: string }> = [
    { key: ipKey, max: getIpLimit(), label: "per-ip" },
    { key: userKey, max: getUserLimit(), label: "per-admin" },
  ];

  for (const c of gateChecks) {
    try {
      const { allowed } = await checkLoginAttempts(c.key, c.max);
      if (!allowed) {
        req.log?.warn(
          { route: req.originalUrl, ip, userId, limit: c.label },
          "Secrets passphrase attempts rate-limited",
        );
        res.status(429).json({
          error: "Too many incorrect passphrase attempts. Please try again later.",
          code: "SECRETS_PASSPHRASE_RATE_LIMITED",
          retryAfterMs: WINDOW_MS,
        });
        return;
      }
    } catch (err) {
      logger.error(
        { err, ip, userId, limit: c.label },
        "secretsPassphraseMiddleware rate-limit check failed — failing closed",
      );
      res.status(503).json({
        error: "Passphrase rate-limit check failed. Try again shortly.",
        code: "SECRETS_PASSPHRASE_RATE_LIMIT_UNAVAILABLE",
      });
      return;
    }
  }

  const raw = req.headers[HEADER_NAME];
  const provided = Array.isArray(raw) ? raw[0] : raw;

  if (typeof provided !== "string" || provided.length === 0) {
    res.status(401).json({
      error: "Secrets passphrase required.",
      code: "SECRETS_PASSPHRASE_MISSING",
    });
    return;
  }

  if (!safeEqual(provided, expected)) {
    // Record the failed guess against both keys so the throttle is shared
    // across replicas. Best-effort: a DB hiccup here must not fail open into
    // an unthrottled 401, but it also must not crash the request.
    try {
      await recordLoginAttempt(ipKey, getIpLimit(), WINDOW_MS);
      await recordLoginAttempt(userKey, getUserLimit(), WINDOW_MS);
    } catch (err) {
      logger.error({ err, ip, userId }, "secretsPassphraseMiddleware failed to record attempt");
    }
    req.log?.warn(
      { route: req.originalUrl, ip, userId },
      "Secrets passphrase rejected",
    );
    res.status(401).json({
      error: "Incorrect secrets passphrase.",
      code: "SECRETS_PASSPHRASE_INVALID",
    });
    return;
  }

  // Correct passphrase: clear both counters so a legitimate operator is not
  // penalized by earlier failed guesses.
  try {
    await clearLoginAttempts(ipKey);
    await clearLoginAttempts(userKey);
  } catch (err) {
    logger.warn({ err, ip, userId }, "secretsPassphraseMiddleware failed to clear attempts");
  }

  next();
}
