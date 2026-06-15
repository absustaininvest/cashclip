import type { Express, Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { storage } from "./storage";
import { logger } from "./lib/logger";
import { sendEmailVerification, sendPasswordResetOTP, sendBackupCodeUsedAlert, sendTwoFactorActiveNotice, sendTwoFactorDisabledNotice, sendPasswordChangedNotice } from "./lib/email";
import { recordLoginAttempt, checkLoginAttempts, clearLoginAttempts } from "./lib/dbRateLimit";
import { getClientIp } from "./lib/clientIp";
import { validateRegistrationEmail } from "./lib/emailValidation";
import type { InsertUser } from "@workspace/db";
import { db, passwordResetTokens, users } from "@workspace/db";
import { eq as drizzleEq, and as drizzleAnd, isNull as drizzleIsNull, gte as drizzleGte, lt as drizzleLt, sql as drizzleSql } from "drizzle-orm";
import { generateTotpSecret, verifyTotp, generateBackupCodes, hashBackupCode } from "./lib/totp";

// ── TOTP verify rate-limit constants ─────────────────────────────────────────
// All counters are DB-backed so they are shared across all autoscaled replicas.
const MAX_TOTP_ATTEMPTS = 5;             // per pending-token (5-minute window)
const MAX_TOTP_ATTEMPTS_PER_IP = 20;    // per IP (15-minute window)
const MAX_TOTP_ATTEMPTS_PER_ACCOUNT = 10; // per account across ALL sessions/IPs (30-minute window)
const TOTP_TOKEN_WINDOW_MS   = 5 * 60 * 1000;    // matches pending-token lifetime
const TOTP_IP_WINDOW_MS      = 15 * 60 * 1000;
const TOTP_ACCOUNT_WINDOW_MS = 30 * 60 * 1000;

function getTotpTokenKey(totpSessionToken: string): string {
  return "totp:token:" + crypto.createHash("sha256").update(totpSessionToken).digest("hex");
}

// ── ADMIN_TOKEN console-token gate brute-force throttle ───────────────────────
// The ADMIN_TOKEN console-token path is a high-privilege operator entry point.
// Failed attempts are counted (per IP) in the shared `login_attempts` table so
// the limit holds across all autoscaled replicas and restarts — a memory-only
// counter would be replica-local and bypassable in production (per the threat
// model). Only *incorrect* tokens consume a slot; a correct token clears it.
// Failure policy: if the DB check throws we fail closed (503) so this control
// never degrades to "unlimited".
const ADMIN_TOKEN_WINDOW_MS = 15 * 60 * 1000;

function getAdminTokenIpLimit(): number {
  const raw = process.env["ADMIN_TOKEN_IP_LIMIT"];
  if (!raw) return 15;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    logger.warn({ value: raw }, "Invalid ADMIN_TOKEN_IP_LIMIT, using default 15");
    return 15;
  }
  return n;
}

// Constant-time compare that tolerates length mismatches without throwing
// (crypto.timingSafeEqual rejects differing-length buffers), so a wrong-length
// token is rejected and throttled like any other incorrect guess.
function adminTokenSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) {
    const pad = Buffer.alloc(Math.max(ab.length, bb.length, 1));
    crypto.timingSafeEqual(pad, pad);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

// Resolved lazily so the server can start and pass the health check even when
// JWT_ACCESS_SECRET hasn't been linked to the production environment yet.
// JWT_ACCESS_SECRET is the primary signing key for access tokens (HS256 fallback).
// JWT_SECRET is accepted as a legacy alias.
function getJwtSecret(): string {
  const s = process.env.JWT_ACCESS_SECRET ?? process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_ACCESS_SECRET environment variable is required");
  return s;
}

// ── HS256 rotation fallback ───────────────────────────────────────────────────
// Only used to verify tokens signed by the old HS256 secret during the 2h
// transition window after a keyswitch.
// Both JWT_ACCESS_SECRET_PREV and JWT_ACCESS_SECRET_PREV_CUTOFF (Unix seconds)
// must be set for the fallback to activate. The cutoff is the time at which the
// key was rotated; only tokens issued at or before that time are accepted.
function getPrevJwtSecretAndCutoff(): { secret: string; cutoff: number } | null {
  const s = process.env.JWT_ACCESS_SECRET_PREV;
  const c = process.env.JWT_ACCESS_SECRET_PREV_CUTOFF;
  if (!s || !c) return null;
  const cutoff = parseInt(c, 10);
  if (!Number.isFinite(cutoff) || cutoff <= 0) return null;
  // Hard server-time sunset: once the maximum token lifetime (2h) has elapsed
  // since the rotation cutoff, stop accepting the old key entirely. This
  // prevents an attacker who backdates `iat` to a value ≤ cutoff from keeping
  // a forged token alive indefinitely — after this window the old key is gone
  // from the server's perspective regardless of what the token claims.
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec > cutoff + TOKEN_EXPIRY_SECONDS) return null;
  return { secret: s, cutoff };
}

const TOKEN_EXPIRY = "2h";
const TOKEN_EXPIRY_SECONDS = 2 * 60 * 60; // numeric equivalent of TOKEN_EXPIRY, used for sunset window

// ── JWT_REFRESH_SECRET — refresh token layer ──────────────────────────────────
// Signs long-lived refresh tokens (30d) stored in the rid httpOnly cookie.
// When the short-lived JWT (2h) expires, POST /api/auth/refresh
// exchanges a valid rid cookie for a fresh JWT + sid cookie without re-login.
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const REFRESH_TOKEN_EXPIRY = "30d";
const REFRESH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const RID_COOKIE = "rid";

function generateRefreshToken(userId: string, tokenVersion: number): string | null {
  if (!REFRESH_SECRET) return null;
  return jwt.sign({ userId, tokenVersion, type: "refresh" }, REFRESH_SECRET, {
    expiresIn: REFRESH_TOKEN_EXPIRY,
  });
}

function verifyRefreshToken(token: string): { userId: string; tokenVersion: number } | null {
  if (!REFRESH_SECRET) return null;
  try {
    const decoded = jwt.verify(token, REFRESH_SECRET);
    if (
      typeof decoded === "object" && decoded !== null &&
      "userId" in decoded && "tokenVersion" in decoded &&
      (decoded as Record<string, unknown>).type === "refresh"
    ) {
      return decoded as { userId: string; tokenVersion: number };
    }
    return null;
  } catch {
    return null;
  }
}

export const RESERVED_ADMIN_USERNAMES: ReadonlySet<string> = new Set([
  "support@absustaininvest.com",
  "support@cash-clip.app",
]);

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
}

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS_PER_IP = 10;
// Per-(IP, account) ceiling: limits how many password guesses any single IP
// can make against any single account within one window.  Because the key
// includes BOTH the IP and the normalised username, this does not create a
// per-account DoS surface — a different IP is still able to log in to the
// same account, so an attacker cannot keep an account permanently locked out
// the way they could with a plain per-account counter.  DB-backed so the
// guard is shared across all autoscaled replicas.
const MAX_LOGIN_ATTEMPTS_PER_IP_ACCOUNT = 5;
// Global per-account failure budget (across ALL source IPs).
// Checked (read-only) before the bcrypt comparison so the gate fires even
// when the attacker rotates IPs to evade the per-IP and per-(IP,account)
// ceilings above.  Only genuine password failures increment this counter;
// the counter is cleared on successful login so legitimate users always
// recover once they supply the correct password.
//
// The threshold is intentionally higher than the per-(IP,account) cap to
// bound the DoS window: exhausting this counter requires 20 failed attempts
// sourced from different IPs, and the self-expiring 15-minute DB window
// means the account becomes accessible again without any operator action.
// This is a deliberate trade-off between brute-force resistance and DoS
// impact — neither a permanent lockout nor an unconstrained guessing surface.
const MAX_LOGIN_FAILURES_PER_ACCOUNT = 20;
const MAX_REGISTER_ATTEMPTS_PER_IP = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

// The prunes for the shared login_attempts and dedupe_slots tables now run as
// dedicated, test-covered scheduled jobs (jobs/loginAttemptsCleanup.ts and
// jobs/dedupeCleanup.ts), registered at server startup in index.ts.

function generateToken(userId: string, role: string, tokenVersion: number): string {
  return jwt.sign({ userId, role, tokenVersion }, getJwtSecret(), { expiresIn: TOKEN_EXPIRY });
}

function verifyToken(token: string): { userId: string; role: string; tokenVersion: number } | null {
  // Try current signing secret first.
  try {
    const decoded = jwt.verify(token, getJwtSecret());
    if (
      typeof decoded === "object" && decoded !== null &&
      "userId" in decoded && "role" in decoded && "tokenVersion" in decoded
    ) {
      return decoded as { userId: string; role: string; tokenVersion: number };
    }
  } catch { /* try fallback */ }

  // Try previous signing secret only when both the secret and a rotation
  // cutoff timestamp are explicitly configured. Only tokens whose iat is at
  // or before the cutoff are accepted — this prevents an attacker who knows
  // the old secret from minting fresh tokens with arbitrary future iat values.
  const prev = getPrevJwtSecretAndCutoff();
  if (prev) {
    try {
      const decoded = jwt.verify(token, prev.secret);
      if (
        typeof decoded === "object" && decoded !== null &&
        "userId" in decoded && "role" in decoded && "tokenVersion" in decoded
      ) {
        const iat = (decoded as Record<string, unknown>).iat;
        if (typeof iat === "number" && iat <= prev.cutoff) {
          return decoded as { userId: string; role: string; tokenVersion: number };
        }
      }
    } catch { /* invalid token */ }
  }

  return null;
}

const SID_COOKIE = "sid";
const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const isProd = process.env.NODE_ENV === "production";

export function setSessionCookie(res: Response, token: string): void {
  if (!process.env.ADMIN_TOKEN) return;
  res.cookie(SID_COOKIE, token, {
    signed: true, httpOnly: true, secure: isProd, sameSite: "strict",
    maxAge: COOKIE_MAX_AGE_MS,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SID_COOKIE, { httpOnly: true, secure: isProd, sameSite: "strict" });
}

export function setRefreshCookie(res: Response, userId: string, tokenVersion: number): void {
  const refreshToken = generateRefreshToken(userId, tokenVersion);
  if (!refreshToken) return;
  res.cookie(RID_COOKIE, refreshToken, {
    httpOnly: true, secure: isProd, sameSite: "strict",
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(RID_COOKIE, { httpOnly: true, secure: isProd, sameSite: "strict" });
}

export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  // Accept Bearer header first, then fall back to signed sid cookie (ADMIN_TOKEN layer).
  let token: string | undefined;
  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.split(" ")[1];
  } else if (req.signedCookies?.[SID_COOKIE]) {
    token = req.signedCookies[SID_COOKIE] as string;
  }
  if (!token) {
    res.status(401).json({ error: "No token provided" });
    return;
  }
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
  const user = await storage.getUser(payload.userId);
  if (!user) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
  if (user.tokenVersion !== payload.tokenVersion) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
  req.userId = user.id;
  req.userRole = user.role;
  // Refresh the online-presence signal used by the admin Integration Hub.
  // Fire-and-forget and throttled per-replica so it never delays or fails the
  // request; the storage layer also guards the write with a staleness check.
  touchLastSeen(user.id);
  next();
}

// Per-replica throttle so we don't issue an UPDATE on every authenticated
// request — at most one touch per user per THROTTLE window. The DB write is
// additionally guarded by a staleness WHERE clause (see storage.touchUserLastSeen)
// so correctness holds even across multiple replicas with independent caches.
const LAST_SEEN_THROTTLE_MS = 60_000;
const lastSeenTouchedAt = new Map<string, number>();

function touchLastSeen(userId: string): void {
  const now = Date.now();
  const prev = lastSeenTouchedAt.get(userId);
  if (prev && now - prev < LAST_SEEN_THROTTLE_MS) return;
  lastSeenTouchedAt.set(userId, now);
  // Opportunistically bound the map so it can't grow without limit on a
  // long-lived replica serving many distinct users.
  if (lastSeenTouchedAt.size > 10_000) {
    const cutoff = now - LAST_SEEN_THROTTLE_MS;
    for (const [id, ts] of lastSeenTouchedAt) {
      if (ts < cutoff) lastSeenTouchedAt.delete(id);
    }
  }
  void storage.touchUserLastSeen(userId).catch((err) => {
    logger.warn({ err, userId }, "failed to update lastSeenAt");
  });
}

export async function adminMiddleware(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  // A valid admin Bearer JWT is always sufficient — this covers the web portal.
  // The ADMIN_TOKEN console-token path is for internal/programmatic access only.
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.split(" ")[1];
    const payload = verifyToken(token);
    if (payload) {
      const user = await storage.getUser(payload.userId);
      if (user && user.tokenVersion === payload.tokenVersion && user.role === "admin") {
        req.userId = user.id;
        req.userRole = user.role;
        next();
        return;
      }
    }
  }

  // Fallback: console-token path (internal tooling / ADMIN_TOKEN secret).
  const consoleToken = process.env.ADMIN_TOKEN;
  if (consoleToken) {
    const ip = getClientIp(req);
    const ipKey = `admintoken:ip:${ip}`;

    // Gate before evaluating the token. Read-only check so simply being at the
    // limit does not itself burn a slot; slots are consumed only by an
    // incorrect attempt below. Fail closed (503) if the DB check throws.
    try {
      const { allowed } = await checkLoginAttempts(ipKey, getAdminTokenIpLimit());
      if (!allowed) {
        req.log?.warn({ route: req.originalUrl, ip }, "Admin console-token attempts rate-limited");
        res.status(429).json({
          error: "Too many incorrect admin token attempts. Please try again later.",
          code: "ADMIN_TOKEN_RATE_LIMITED",
          retryAfterMs: ADMIN_TOKEN_WINDOW_MS,
        });
        return;
      }
    } catch (err) {
      logger.error({ err, ip }, "adminMiddleware console-token rate-limit check failed — failing closed");
      res.status(503).json({
        error: "Admin token rate-limit check failed. Try again shortly.",
        code: "ADMIN_TOKEN_RATE_LIMIT_UNAVAILABLE",
      });
      return;
    }

    const provided = req.headers["x-console-token"];
    if (typeof provided !== "string" || !adminTokenSafeEqual(provided, consoleToken)) {
      // Record the failed guess against the shared key so the throttle holds
      // across replicas. Best-effort: a DB hiccup must not fail open here.
      try {
        await recordLoginAttempt(ipKey, getAdminTokenIpLimit(), ADMIN_TOKEN_WINDOW_MS);
      } catch (err) {
        logger.error({ err, ip }, "adminMiddleware failed to record console-token attempt");
      }
      req.log?.warn({ route: req.originalUrl, ip }, "Admin console-token rejected");
      res.status(401).json({ error: "No token provided" });
      return;
    }

    // Correct console token: clear the counter so a legitimate operator is not
    // penalized by earlier failed guesses.
    try {
      await clearLoginAttempts(ipKey);
    } catch (err) {
      logger.warn({ err, ip }, "adminMiddleware failed to clear console-token attempts");
    }
    // Token verified — skip the Bearer check entirely.
    next();
    return;
  }
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "No token provided" });
    return;
  }
  const token = authHeader.split(" ")[1];
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
  const user = await storage.getUser(payload.userId);
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }
  if (user.tokenVersion !== payload.tokenVersion) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
  if (user.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  req.userId = user.id;
  req.userRole = user.role;
  next();
}

export function registerAuthRoutes(app: Express) {
  app.post("/api/auth/register", async (req: Request, res: Response): Promise<void> => {
    try {
      if (["true", "1", "yes", "on"].includes((process.env.REGISTRATION_PAUSED || "").trim().toLowerCase())) {
        res.status(503).json({
          error: "We're polishing CashClip for our next release — new signups reopen in a few days. Thanks for your patience!",
          paused: true,
        });
        return;
      }
      const ip = getClientIp(req);
      const { allowed: ipRegAllowed } = await recordLoginAttempt(`reg:${ip}`, MAX_REGISTER_ATTEMPTS_PER_IP, RATE_LIMIT_WINDOW_MS);
      if (!ipRegAllowed) {
        res.status(429).json({ error: "Too many attempts. Please try again later." });
        return;
      }

      const { username, password, email, referralCode, agreedToTerms } = req.body;
      if (!username || !password) {
        res.status(400).json({ error: "Username and password are required" });
        return;
      }
      if (typeof username !== "string" || username.trim().length < 3) {
        res.status(400).json({ error: "Username must be at least 3 characters" });
        return;
      }
      if (username.trim().length > 30) {
        res.status(400).json({ error: "Username must be 30 characters or fewer" });
        return;
      }
      if (!/^[\p{L}\p{N}_-]+$/u.test(username.trim())) {
        res.status(400).json({ error: "Username may only contain letters, numbers, underscores, and hyphens" });
        return;
      }
      if (typeof password !== "string" || password.length < 8) {
        res.status(400).json({ error: "Password must be at least 8 characters" });
        return;
      }
      if (password.length > 72) {
        res.status(400).json({ error: "Password must be 72 characters or fewer" });
        return;
      }
      if (!email || typeof email !== "string" || email.trim().length === 0) {
        res.status(400).json({ error: "Email is required" });
        return;
      }
      const emailCheck = validateRegistrationEmail(email);
      if (!emailCheck.valid) {
        res.status(400).json({ error: emailCheck.reason ?? "Invalid email address" });
        return;
      }
      if (agreedToTerms === false) {
        res.status(400).json({ error: "You must agree to the Terms of Service and Privacy Policy" });
        return;
      }

      const normalizedUsername = username.toLowerCase().trim();
      const normalizedEmail = email.trim().toLowerCase();

      if (RESERVED_ADMIN_USERNAMES.has(normalizedUsername)) {
        res.status(400).json({ error: "Username is not available" });
        return;
      }

      const [existingByUsername, existingByEmail] = await Promise.all([
        storage.getUserByUsername(normalizedUsername),
        storage.getUserByEmail(normalizedEmail),
      ]);

      if (existingByEmail) {
        // Return the same generic message to avoid confirming whether an email is registered
        res.status(200).json({ message: "Registration processed. Please check your email to verify your account." });
        return;
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      if (!existingByUsername) {
        const newUser: InsertUser & { role?: string } = {
          username: normalizedUsername,
          password: hashedPassword,
          email: email.trim().toLowerCase(),
          referredBy: referralCode && typeof referralCode === "string" && referralCode.trim().length > 0 ? referralCode.trim().toLowerCase() : undefined,
        };
        const created = await storage.createUser(newUser);
        // Send verification email (best-effort — never blocks registration)
        const verifyToken = crypto.randomBytes(32).toString("hex");
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await storage.setEmailVerificationToken(created.id, verifyToken, expiresAt);
        const domain = process.env["EXPO_PUBLIC_DOMAIN"] ?? "cash-clip.app";
        const verifyUrl = `https://${domain}/api/auth/verify-email?token=${verifyToken}`;
        sendEmailVerification({ to: email.trim().toLowerCase(), username: normalizedUsername, verifyUrl });
      }

      res.status(200).json({
        message: "Registration processed. Please check your email to verify your account.",
      });
    } catch (err: unknown) {
      logger.error({ err }, "Register error");
      res.status(500).json({ error: "Registration failed" });
    }
  });

  app.post("/api/auth/resend-verification", async (req: Request, res: Response): Promise<void> => {
    try {
      const { username } = req.body;
      if (!username || typeof username !== "string") {
        res.status(400).json({ error: "Username is required" });
        return;
      }
      const user = await storage.getUserByUsername(username.toLowerCase().trim());
      if (!user || user.emailVerified) {
        res.status(200).json({ message: "If the account exists and is unverified, a new email has been sent." });
        return;
      }
      const verifyToken = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await storage.setEmailVerificationToken(user.id, verifyToken, expiresAt);
      const domain = process.env["EXPO_PUBLIC_DOMAIN"] ?? "cash-clip.app";
      const verifyUrl = `https://${domain}/api/auth/verify-email?token=${verifyToken}`;
      if (!user.email) {
        res.status(200).json({ message: "If the account exists and is unverified, a new email has been sent." });
        return;
      }
      sendEmailVerification({ to: user.email, username: user.username, verifyUrl });
      res.status(200).json({ message: "If the account exists and is unverified, a new email has been sent." });
    } catch (err) {
      logger.error({ err }, "resend-verification error");
      res.status(500).json({ error: "Failed to resend verification email" });
    }
  });

  app.get("/api/auth/verify-email", async (req: Request, res: Response): Promise<void> => {
    const { token } = req.query;
    const fail = (msg: string) => {
      res.status(400).send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CashClip</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0A0A0F;color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}.card{background:#141420;border-radius:20px;padding:40px 32px;max-width:400px;width:100%;text-align:center}.icon{font-size:48px;margin-bottom:16px}.title{font-size:22px;font-weight:700;margin-bottom:8px}.msg{font-size:15px;color:#888;line-height:1.5;margin-bottom:28px}.btn{display:inline-block;background:#B0FF4C;color:#0A0A0F;font-weight:700;font-size:16px;padding:14px 32px;border-radius:12px;text-decoration:none}</style></head><body><div class="card"><div class="icon">❌</div><div class="title">Verification Failed</div><div class="msg">${msg}</div><a class="btn" href="cashclip://">Open CashClip</a></div></body></html>`);
    };
    if (!token || typeof token !== "string") { fail("Invalid or missing verification link."); return; }
    try {
      const user = await storage.getUserByVerificationToken(token);
      if (!user) { fail("This verification link is invalid or has already been used."); return; }
      if (user.emailVerificationExpiresAt && new Date() > new Date(user.emailVerificationExpiresAt)) {
        fail("This verification link has expired. Please register again or contact support."); return;
      }
      await storage.markEmailVerified(user.id);
      res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CashClip — Email Verified</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0A0A0F;color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}.card{background:#141420;border-radius:20px;padding:40px 32px;max-width:400px;width:100%;text-align:center}.icon{font-size:48px;margin-bottom:16px}.title{font-size:22px;font-weight:700;margin-bottom:8px;color:#B0FF4C}.msg{font-size:15px;color:#888;line-height:1.5;margin-bottom:28px}.btn{display:inline-block;background:#B0FF4C;color:#0A0A0F;font-weight:700;font-size:16px;padding:14px 32px;border-radius:12px;text-decoration:none;margin-bottom:12px;display:block}.sub{font-size:13px;color:#555}</style></head><body><div class="card"><div class="icon">✅</div><div class="title">Email Verified!</div><div class="msg">Your CashClip account is now active. Open the app and log in to start earning.</div><a class="btn" href="cashclip://">Open CashClip</a><div class="sub">If the app doesn't open, launch CashClip manually and log in.</div></div></body></html>`);
    } catch (err) {
      logger.error({ err }, "verify-email error");
      fail("Something went wrong. Please try again or contact support.");
    }
  });

  app.post("/api/auth/login", async (req: Request, res: Response): Promise<void> => {
    try {
      const ip = getClientIp(req);
      const { allowed: ipLoginAllowed } = await recordLoginAttempt(`ip:${ip}`, MAX_LOGIN_ATTEMPTS_PER_IP, RATE_LIMIT_WINDOW_MS);
      if (!ipLoginAllowed) {
        res.status(429).json({ error: "Too many attempts. Please try again later." });
        return;
      }

      const { username, password } = req.body;
      if (!username || !password) {
        res.status(400).json({ error: "Username and password are required" });
        return;
      }

      const normalizedUsername = username.toLowerCase().trim();

      // Per-(IP, account) guard: each source IP is limited to
      // MAX_LOGIN_ATTEMPTS_PER_IP_ACCOUNT guesses against any single account
      // per window.  The combined key means a different IP is completely
      // unaffected, so this does not create the per-account DoS surface that
      // made a plain per-account lockout dangerous (where any IP could
      // continuously lock out known admin accounts).  DB-backed so the counter
      // is shared across all autoscaled replicas.
      const { allowed: ipAccountAllowed } = await recordLoginAttempt(
        `acctip:${ip}:${normalizedUsername}`,
        MAX_LOGIN_ATTEMPTS_PER_IP_ACCOUNT,
        RATE_LIMIT_WINDOW_MS,
      );
      if (!ipAccountAllowed) {
        res.status(429).json({ error: "Too many attempts. Please try again later." });
        return;
      }

      const user = await storage.getUserByUsername(normalizedUsername);
      if (!user) {
        await bcrypt.hash("dummy-timing-equalization", 10);
        res.status(401).json({ error: "Invalid credentials" });
        return;
      }

      // Global per-account failure gate — enforced across all source IPs.
      // Using checkLoginAttempts (read-only) before bcrypt avoids burning a
      // slot on an already-locked account and short-circuits expensive hashing.
      // Key is user.id (not username) so the counter is immune to username
      // enumeration.
      const { allowed: acctAllowed } = await checkLoginAttempts(
        `acct:${user.id}`,
        MAX_LOGIN_FAILURES_PER_ACCOUNT,
      );
      if (!acctAllowed) {
        res.status(429).json({ error: "Too many attempts. Please try again later." });
        return;
      }

      const valid = await bcrypt.compare(password, user.password);
      if (!valid) {
        // Increment the global per-account failure counter on a genuine bad
        // password.  The self-expiring window means no operator action is
        // required to unblock the account after the window elapses.
        await recordLoginAttempt(`acct:${user.id}`, MAX_LOGIN_FAILURES_PER_ACCOUNT, RATE_LIMIT_WINDOW_MS);
        res.status(401).json({ error: "Invalid credentials" });
        return;
      }

      // Successful password — reset the global failure counter so legitimate
      // users who had a few failures can log in again immediately next time.
      await clearLoginAttempts(`acct:${user.id}`);

      // Non-admin accounts must verify their email before receiving a token.
      // Admin accounts bypass this gate so operators are never locked out.
      if (user.role !== "admin" && !user.emailVerified) {
        res.status(403).json({
          error: "Please verify your email address before logging in. Check your inbox for a verification link.",
          code: "EMAIL_NOT_VERIFIED",
        });
        return;
      }

      // If TOTP is enabled, issue a short-lived pending token instead of the
      // full JWT. The client must complete login via POST /api/auth/totp/verify.
      if (user.totpEnabled && user.totpSecret) {
        const totpSessionToken = jwt.sign(
          { userId: user.id, type: "totp-pending", tokenVersion: user.tokenVersion },
          getJwtSecret(),
          { expiresIn: "5m" },
        );
        res.json({ requiresTotp: true, totpSessionToken });
        return;
      }

      const token = generateToken(user.id, user.role, user.tokenVersion);
      const refreshToken = generateRefreshToken(user.id, user.tokenVersion);
      setSessionCookie(res, token);
      setRefreshCookie(res, user.id, user.tokenVersion);
      res.json({
        token,
        ...(refreshToken ? { refreshToken } : {}),
        user: { id: user.id, username: user.username, role: user.role, emailVerified: user.emailVerified },
      });
    } catch (err: unknown) {
      logger.error({ err }, "Login error");
      res.status(500).json({ error: "Login failed" });
    }
  });

  // ── TOTP 2FA routes ───────────────────────────────────────────────────────

  app.post("/api/auth/totp/verify", async (req: Request, res: Response): Promise<void> => {
    try {
      const { totpSessionToken, code } = req.body;
      if (!totpSessionToken || !code) {
        res.status(400).json({ error: "totpSessionToken and code are required" });
        return;
      }

      // DB-backed per-IP rate limit (shared across all replicas).
      const ip = getClientIp(req) ?? "unknown";
      const { allowed: ipAllowed } = await recordLoginAttempt(
        `totp:ip:${ip}`,
        MAX_TOTP_ATTEMPTS_PER_IP,
        TOTP_IP_WINDOW_MS,
      );
      if (!ipAllowed) {
        res.status(429).json({ error: "Too many verification attempts. Please try again later." });
        return;
      }

      // DB-backed per-pending-token failure limit (shared across all replicas).
      const tokenKey = getTotpTokenKey(totpSessionToken);
      const { allowed: tokenAllowed } = await checkLoginAttempts(tokenKey, MAX_TOTP_ATTEMPTS);
      if (!tokenAllowed) {
        res.status(429).json({ error: "Too many incorrect attempts. Please log in again." });
        return;
      }

      let payload: { userId: string; type: string; tokenVersion: number; exp?: number } | null = null;
      try {
        const decoded = jwt.verify(totpSessionToken, getJwtSecret());
        if (
          typeof decoded === "object" && decoded !== null &&
          "userId" in decoded && "type" in decoded &&
          (decoded as Record<string, unknown>).type === "totp-pending"
        ) {
          payload = decoded as { userId: string; type: string; tokenVersion: number; exp?: number };
        }
      } catch { /* invalid token */ }
      if (!payload) {
        res.status(401).json({ error: "Invalid or expired session. Please log in again." });
        return;
      }
      const user = await storage.getUser(payload.userId);
      if (!user || !user.totpEnabled || !user.totpSecret) {
        res.status(401).json({ error: "Invalid session." });
        return;
      }
      if (user.tokenVersion !== payload.tokenVersion) {
        res.status(401).json({ error: "Invalid or expired session. Please log in again." });
        return;
      }

      // DB-backed per-account TOTP failure counter — shared across ALL sessions
      // and source IPs for this user.  An attacker who holds the admin password
      // and distributes requests across many IPs can mint fresh totpSessionTokens
      // from each IP (bypassing the per-token and per-IP limits) but this counter
      // accumulates every wrong guess regardless of origin, anchoring the defence
      // to the target account rather than to any single session or IP.
      const acctTotpKey = `totp:acct:${user.id}`;
      const { allowed: acctTotpAllowed } = await checkLoginAttempts(acctTotpKey, MAX_TOTP_ATTEMPTS_PER_ACCOUNT);
      if (!acctTotpAllowed) {
        res.status(429).json({ error: "Too many incorrect attempts. Please try again later." });
        return;
      }

      // Accept either a live TOTP code or a single-use backup recovery code so a
      // lost authenticator never locks the admin out. Backup codes are consumed
      // atomically on use.
      const codeStr = String(code);
      let authed = verifyTotp(user.totpSecret, codeStr);
      let usedBackupCode = false;
      if (!authed) {
        authed = await storage.consumeTotpBackupCode(user.id, hashBackupCode(codeStr));
        usedBackupCode = authed;
      }
      if (!authed) {
        // Increment both the per-token counter and the shared per-account counter.
        const { count: failures } = await recordLoginAttempt(tokenKey, MAX_TOTP_ATTEMPTS, TOTP_TOKEN_WINDOW_MS);
        await recordLoginAttempt(acctTotpKey, MAX_TOTP_ATTEMPTS_PER_ACCOUNT, TOTP_ACCOUNT_WINDOW_MS);
        const remaining = MAX_TOTP_ATTEMPTS - failures;
        if (remaining <= 0) {
          res.status(429).json({ error: "Too many incorrect attempts. Please log in again." });
        } else {
          res.status(400).json({ error: "Invalid code. Enter a code from your authenticator app or one of your backup codes." });
        }
        return;
      }
      await clearLoginAttempts(tokenKey);
      await clearLoginAttempts(acctTotpKey);
      if (usedBackupCode) {
        // Notify the admin a single-use backup code was consumed so an
        // unnoticed exhaustion can't quietly lock them out again.
        const recipient = user.email && user.email.trim().length > 0 ? user.email : undefined;
        if (recipient) {
          try {
            const remaining = await storage.getTotpBackupCodesRemaining(user.id);
            sendBackupCodeUsedAlert({ to: recipient, username: user.username, remaining });
          } catch (mailErr) {
            logger.error({ err: mailErr, userId: user.id }, "Failed to send backup code used alert");
          }
        } else {
          logger.warn({ userId: user.id }, "Backup code used but admin has no email on file — skipping alert");
        }
      }
      const token = generateToken(user.id, user.role, user.tokenVersion);
      const refreshToken = generateRefreshToken(user.id, user.tokenVersion);
      setSessionCookie(res, token);
      setRefreshCookie(res, user.id, user.tokenVersion);
      // When a single-use backup code was consumed, tell the client how many
      // remain so it can remind the admin to regenerate before running out.
      let backupCodesRemaining: number | undefined;
      if (usedBackupCode) {
        const refreshed = await storage.getUser(user.id);
        backupCodesRemaining = refreshed?.totpBackupCodes?.length ?? 0;
      }
      res.json({
        token,
        ...(refreshToken ? { refreshToken } : {}),
        user: { id: user.id, username: user.username, role: user.role },
        ...(usedBackupCode ? { usedBackupCode: true, backupCodesRemaining } : {}),
      });
    } catch (err: unknown) {
      logger.error({ err }, "TOTP verify error");
      res.status(500).json({ error: "Verification failed" });
    }
  });

  app.get("/api/auth/totp/status", authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
    const user = await storage.getUser(req.userId!);
    if (!user) { res.status(401).json({ error: "User not found" }); return; }
    if (user.role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }
    res.json({
      enabled: user.totpEnabled ?? false,
      backupCodesRemaining: user.totpBackupCodes?.length ?? 0,
    });
  });

  app.post("/api/auth/totp/setup", authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
    const user = await storage.getUser(req.userId!);
    if (!user) { res.status(401).json({ error: "User not found" }); return; }
    if (user.role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }
    const { secret, uri } = generateTotpSecret();
    res.json({ secret, uri });
  });

  app.post("/api/auth/totp/enable", authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const user = await storage.getUser(req.userId!);
      if (!user) { res.status(401).json({ error: "User not found" }); return; }
      if (user.role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }
      const { secret, code, currentCode } = req.body;
      if (!secret || !code) { res.status(400).json({ error: "secret and code are required" }); return; }
      if (user.totpEnabled && user.totpSecret) {
        if (!currentCode) {
          res.status(400).json({ error: "currentCode is required to replace an existing 2FA secret" });
          return;
        }
        if (!verifyTotp(user.totpSecret, String(currentCode))) {
          res.status(400).json({ error: "Current 2FA code is invalid" });
          return;
        }
      }
      if (!verifyTotp(String(secret), String(code))) {
        res.status(400).json({ error: "Invalid code. Please try again." });
        return;
      }
      const { codes, hashes } = generateBackupCodes(10);
      // Mutation + durable audit entry commit atomically: if the audit write
      // fails the 2FA change is rolled back (fail-closed), so there is never a
      // security-sensitive change without a persisted trail.
      await db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({ totpSecret: secret, totpEnabled: true, totpBackupCodes: hashes })
          .where(drizzleEq(users.id, req.userId!));
        await storage.recordSecurityAudit({ actorUserId: user.id, event: "totp_enabled", ip: getClientIp(req) }, tx);
      });
      logger.info({ userId: req.userId }, "Admin enabled TOTP 2FA");
      // Send a confirmation email (never containing the actual codes) so the admin
      // has a durable record that 2FA is active and how many backup codes they hold.
      const enableRecipient = user.email && user.email.trim().length > 0 ? user.email : undefined;
      if (enableRecipient) {
        try {
          sendTwoFactorActiveNotice({
            to: enableRecipient,
            username: user.username,
            backupCodesCount: codes.length,
            context: "enabled",
          });
        } catch (mailErr) {
          logger.error({ err: mailErr, userId: user.id }, "Failed to send 2FA enabled confirmation");
        }
      } else {
        logger.warn({ userId: user.id }, "2FA enabled but admin has no email on file — skipping confirmation");
      }
      // backupCodes are returned in plaintext exactly once — only hashes persist.
      res.json({ ok: true, backupCodes: codes });
    } catch (err: unknown) {
      logger.error({ err }, "TOTP enable error");
      res.status(500).json({ error: "Failed to enable 2FA" });
    }
  });

  app.post("/api/auth/totp/backup-codes/regenerate", authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const user = await storage.getUser(req.userId!);
      if (!user) { res.status(401).json({ error: "User not found" }); return; }
      if (user.role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }
      if (!user.totpEnabled || !user.totpSecret) {
        res.status(400).json({ error: "2FA is not enabled" }); return;
      }
      const { code } = req.body;
      if (!code) { res.status(400).json({ error: "code is required" }); return; }
      if (!verifyTotp(user.totpSecret, String(code))) {
        res.status(400).json({ error: "Invalid code. Please check your authenticator app." });
        return;
      }
      // Regenerating invalidates every previously issued code.
      const { codes, hashes } = generateBackupCodes(10);
      // Code rotation + durable audit entry commit atomically (fail-closed).
      await db.transaction(async (tx) => {
        await storage.setTotpBackupCodes(user.id, hashes, tx);
        await storage.recordSecurityAudit({ actorUserId: user.id, event: "backup_codes_regenerated", ip: getClientIp(req) }, tx);
      });
      logger.info({ userId: req.userId }, "Admin regenerated 2FA backup codes");
      // Confirmation email (never containing the actual codes) recording that the
      // codes were refreshed and how many the admin now holds.
      const regenRecipient = user.email && user.email.trim().length > 0 ? user.email : undefined;
      if (regenRecipient) {
        try {
          sendTwoFactorActiveNotice({
            to: regenRecipient,
            username: user.username,
            backupCodesCount: codes.length,
            context: "regenerated",
          });
        } catch (mailErr) {
          logger.error({ err: mailErr, userId: user.id }, "Failed to send backup codes regenerated confirmation");
        }
      } else {
        logger.warn({ userId: user.id }, "Backup codes regenerated but admin has no email on file — skipping confirmation");
      }
      res.json({ ok: true, backupCodes: codes });
    } catch (err: unknown) {
      logger.error({ err }, "TOTP backup-codes regenerate error");
      res.status(500).json({ error: "Failed to regenerate backup codes" });
    }
  });

  app.post("/api/auth/totp/disable", authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const user = await storage.getUser(req.userId!);
      if (!user) { res.status(401).json({ error: "User not found" }); return; }
      if (user.role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }
      if (!user.totpEnabled || !user.totpSecret) {
        res.status(400).json({ error: "2FA is not enabled" }); return;
      }
      const { code } = req.body;
      if (!code) { res.status(400).json({ error: "code is required" }); return; }
      if (!verifyTotp(user.totpSecret, String(code))) {
        res.status(400).json({ error: "Invalid code. Please try again." });
        return;
      }
      // 2FA teardown + durable audit entry commit atomically (fail-closed).
      await db.transaction(async (tx) => {
        await tx.update(users).set({ totpSecret: null, totpEnabled: false, totpBackupCodes: null }).where(drizzleEq(users.id, req.userId!));
        await storage.recordSecurityAudit({ actorUserId: user.id, event: "totp_disabled", ip: getClientIp(req) }, tx);
      });
      logger.info({ userId: req.userId }, "Admin disabled TOTP 2FA");
      // Security alert email (never containing secrets or codes) so the admin is
      // tipped off if someone else turned off 2FA on their account.
      const disableRecipient = user.email && user.email.trim().length > 0 ? user.email : undefined;
      if (disableRecipient) {
        try {
          sendTwoFactorDisabledNotice({
            to: disableRecipient,
            username: user.username,
          });
        } catch (mailErr) {
          logger.error({ err: mailErr, userId: user.id }, "Failed to send 2FA disabled security alert");
        }
      } else {
        logger.warn({ userId: user.id }, "2FA disabled but admin has no email on file — skipping security alert");
      }
      res.json({ ok: true });
    } catch (err: unknown) {
      logger.error({ err }, "TOTP disable error");
      res.status(500).json({ error: "Failed to disable 2FA" });
    }
  });

  app.get("/api/auth/me", authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
    const user = await storage.getUser(req.userId!);
    if (!user) {
      res.status(401).json({ error: "User not found" });
      return;
    }
    res.json({
      user: { id: user.id, username: user.username, role: user.role, paypalEmail: user.paypalEmail ?? null },
    });
  });

  app.delete("/api/auth/account", authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const user = await storage.getUser(req.userId!);
      if (!user) {
        res.status(401).json({ error: "User not found" });
        return;
      }
      const { password } = req.body;
      if (!password) {
        res.status(400).json({ error: "Password is required to delete your account" });
        return;
      }
      const valid = await bcrypt.compare(password, user.password);
      if (!valid) {
        res.status(400).json({ error: "Incorrect password" });
        return;
      }
      await storage.deleteUser(user.id);
      logger.info({ userId: user.id }, "User deleted account");
      clearSessionCookie(res);
      clearRefreshCookie(res);
      res.json({ message: "Account deleted successfully" });
    } catch (err: unknown) {
      logger.error({ err }, "Delete account error");
      res.status(500).json({ error: "Failed to delete account" });
    }
  });

  app.patch("/api/auth/change-password", authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) {
        res.status(400).json({ error: "Current password and new password are required" });
        return;
      }
      if (newPassword.length < 8) {
        res.status(400).json({ error: "New password must be at least 8 characters" });
        return;
      }
      const user = await storage.getUser(req.userId!);
      if (!user) {
        res.status(401).json({ error: "User not found" });
        return;
      }
      const valid = await bcrypt.compare(currentPassword, user.password);
      if (!valid) {
        res.status(400).json({ error: "Current password is incorrect" });
        return;
      }
      const hashed = await bcrypt.hash(newPassword, 10);
      // Password change + durable audit entry commit atomically (fail-closed).
      const { tokenVersion } = await db.transaction(async (tx) => {
        const result = await storage.updateUserPassword(user.id, hashed, tx);
        await storage.recordSecurityAudit({ actorUserId: user.id, event: "password_changed", ip: getClientIp(req) }, tx);
        return result;
      });
      logger.info({ userId: user.id }, "User changed password");
      // Security alert email (never containing the password or any secret) so an
      // admin is tipped off if someone else changed their password. Mirrors the
      // 2FA notices: admin-only, best-effort, never blocks the response.
      if (user.role === "admin") {
        const changeRecipient = user.email && user.email.trim().length > 0 ? user.email : undefined;
        if (changeRecipient) {
          try {
            sendPasswordChangedNotice({ to: changeRecipient, username: user.username, context: "changed" });
          } catch (mailErr) {
            logger.error({ err: mailErr, userId: user.id }, "Failed to send password changed security alert");
          }
        } else {
          logger.warn({ userId: user.id }, "Password changed but admin has no email on file — skipping security alert");
        }
      }
      const newToken = generateToken(user.id, user.role, tokenVersion);
      setSessionCookie(res, newToken);
      setRefreshCookie(res, user.id, tokenVersion);
      res.json({ message: "Password updated successfully", token: newToken });
    } catch (err: unknown) {
      logger.error({ err }, "Change password error");
      res.status(500).json({ error: "Failed to change password" });
    }
  });

  // ── POST /api/auth/forgot-password ───────────────────────────────────────
  app.post("/api/auth/forgot-password", async (req: Request, res: Response): Promise<void> => {
    const ALWAYS_OK = { message: "If that username exists and has an email on file, a reset code has been sent." };
    try {
      const ip = getClientIp(req);
      const { allowed } = await recordLoginAttempt(`forgot:${ip}`, 5, 15 * 60 * 1000);
      if (!allowed) {
        res.status(429).json({ error: "Too many attempts. Please try again later." });
        return;
      }
      const { username } = req.body;
      if (!username || typeof username !== "string") {
        res.json(ALWAYS_OK);
        return;
      }
      const user = await storage.getUserByUsername(username.trim().toLowerCase());
      if (!user || !user.email) {
        res.json(ALWAYS_OK);
        return;
      }
      // Per-user rate limit: max 3 codes per 5 min
      const { allowed: userAllowed } = await recordLoginAttempt(`forgot:uid:${user.id}`, 3, 5 * 60 * 1000);
      if (!userAllowed) {
        res.json(ALWAYS_OK);
        return;
      }
      const otp = String(crypto.randomInt(100000, 999999));
      const tokenHash = crypto.createHash("sha256").update(otp).digest("hex");
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
      // Invalidate any prior unused tokens for this user
      await db
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(drizzleAnd(drizzleEq(passwordResetTokens.userId, user.id), drizzleIsNull(passwordResetTokens.usedAt)));
      await db.insert(passwordResetTokens).values({ userId: user.id, tokenHash, expiresAt });
      sendPasswordResetOTP({ to: user.email, username: user.username, otp });
      logger.info({ userId: user.id }, "Password reset OTP issued");
      res.json(ALWAYS_OK);
    } catch (err: unknown) {
      logger.error({ err }, "Forgot password error");
      res.json({ message: "If that username exists and has an email on file, a reset code has been sent." });
    }
  });

  // ── POST /api/auth/reset-password ─────────────────────────────────────────
  // Max wrong guesses before a reset token is burned.
  const MAX_RESET_ATTEMPTS = 5;

  app.post("/api/auth/reset-password", async (req: Request, res: Response): Promise<void> => {
    try {
      const ip = getClientIp(req);
      const { allowed } = await recordLoginAttempt(`resetpw:${ip}`, 10, 15 * 60 * 1000);
      if (!allowed) {
        res.status(429).json({ error: "Too many attempts. Please try again later." });
        return;
      }
      const { username, code, newPassword } = req.body;
      if (!username || !code || !newPassword) {
        res.status(400).json({ error: "Username, code, and new password are required" });
        return;
      }
      if (typeof newPassword !== "string" || newPassword.length < 8) {
        res.status(400).json({ error: "Password must be at least 8 characters" });
        return;
      }
      if (newPassword.length > 72) {
        res.status(400).json({ error: "Password must be 72 characters or fewer" });
        return;
      }
      const user = await storage.getUserByUsername(String(username).trim().toLowerCase());
      if (!user) {
        res.status(400).json({ error: "Invalid or expired code" });
        return;
      }
      const now = new Date();
      // Look up the active token by userId only — not by hash — so we can
      // track and limit wrong guesses regardless of which code is submitted.
      const [token] = await db
        .select()
        .from(passwordResetTokens)
        .where(
          drizzleAnd(
            drizzleEq(passwordResetTokens.userId, user.id),
            drizzleIsNull(passwordResetTokens.usedAt),
            drizzleGte(passwordResetTokens.expiresAt, now),
          ),
        )
        .limit(1);
      if (!token) {
        res.status(400).json({ error: "Invalid or expired code" });
        return;
      }
      const tokenHash = crypto.createHash("sha256").update(String(code).trim()).digest("hex");
      if (token.tokenHash !== tokenHash) {
        // Wrong code — atomically increment the failure counter in a single
        // UPDATE statement so concurrent requests cannot race past the limit.
        // The CASE expression burns the token (sets used_at) the moment
        // failed_attempts reaches the threshold, and the WHERE clause ensures
        // the UPDATE is a no-op if the token has already been burned.
        await db
          .update(passwordResetTokens)
          .set({
            failedAttempts: drizzleSql`failed_attempts + 1`,
            usedAt: drizzleSql`CASE WHEN failed_attempts + 1 >= ${MAX_RESET_ATTEMPTS} THEN NOW() ELSE used_at END`,
          })
          .where(
            drizzleAnd(
              drizzleEq(passwordResetTokens.id, token.id),
              drizzleIsNull(passwordResetTokens.usedAt),
              drizzleGte(passwordResetTokens.expiresAt, now),
              drizzleLt(passwordResetTokens.failedAttempts, MAX_RESET_ATTEMPTS),
            ),
          );
        res.status(400).json({ error: "Invalid or expired code" });
        return;
      }
      // Correct code — atomically consume the token.  The WHERE guards against
      // double-use if two concurrent correct submissions race each other.
      const [consumed] = await db
        .update(passwordResetTokens)
        .set({ usedAt: now })
        .where(
          drizzleAnd(
            drizzleEq(passwordResetTokens.id, token.id),
            drizzleIsNull(passwordResetTokens.usedAt),
            drizzleGte(passwordResetTokens.expiresAt, now),
          ),
        )
        .returning({ id: passwordResetTokens.id });
      if (!consumed) {
        res.status(400).json({ error: "Invalid or expired code" });
        return;
      }
      const hashed = await bcrypt.hash(newPassword, 10);
      // Password reset + durable audit entry commit atomically (fail-closed).
      await db.transaction(async (tx) => {
        await storage.updateUserPassword(user.id, hashed, tx);
        await storage.recordSecurityAudit({ actorUserId: user.id, event: "password_reset", ip: getClientIp(req) }, tx);
      });
      logger.info({ userId: user.id }, "Password reset via OTP");
      // Security alert email (never containing the password or any secret) so an
      // admin is tipped off if someone else reset their password via recovery.
      // Mirrors the 2FA notices: admin-only, best-effort, never blocks the response.
      if (user.role === "admin") {
        const resetRecipient = user.email && user.email.trim().length > 0 ? user.email : undefined;
        if (resetRecipient) {
          try {
            sendPasswordChangedNotice({ to: resetRecipient, username: user.username, context: "reset" });
          } catch (mailErr) {
            logger.error({ err: mailErr, userId: user.id }, "Failed to send password reset security alert");
          }
        } else {
          logger.warn({ userId: user.id }, "Password reset but admin has no email on file — skipping security alert");
        }
      }
      res.json({ message: "Password reset successfully" });
    } catch (err: unknown) {
      logger.error({ err }, "Reset password error");
      res.status(500).json({ error: "Failed to reset password" });
    }
  });

  // ── POST /api/auth/logout ─────────────────────────────────────────────────
  // Increments tokenVersion so all outstanding refresh tokens for the user are
  // immediately invalidated server-side. Clears the rid and sid cookies.
  // Accepts the request on a best-effort basis even without a valid access
  // token so that clients can always sign out cleanly.
  app.post("/api/auth/logout", async (req: Request, res: Response): Promise<void> => {
    try {
      // Attempt to identify the user so we can bump their tokenVersion and
      // immediately invalidate all outstanding refresh tokens server-side.
      // Try access token first (Bearer header or sid cookie), then fall back to
      // the refresh token (rid cookie, body, or x-refresh-token header) so that
      // logout works correctly even when the access token is already expired.
      let userId: string | undefined;

      const authHeader = req.headers.authorization;
      let accessToken: string | undefined;
      if (authHeader?.startsWith("Bearer ")) {
        accessToken = authHeader.split(" ")[1];
      } else if (req.signedCookies?.[SID_COOKIE]) {
        accessToken = req.signedCookies[SID_COOKIE] as string;
      }
      if (accessToken) {
        const payload = verifyToken(accessToken);
        if (payload) userId = payload.userId;
      }

      // If access token didn't yield a user (e.g. expired), try the refresh token.
      // Only accept the refresh token if its tokenVersion matches the user's
      // current DB record — a stale/replayed token must not force-logout a
      // legitimate active session.
      if (!userId) {
        const ridToken =
          (req.cookies?.[RID_COOKIE] as string | undefined) ||
          (req.body?.refreshToken as string | undefined) ||
          (req.headers?.["x-refresh-token"] as string | undefined);
        if (ridToken) {
          const refreshPayload = verifyRefreshToken(ridToken);
          if (refreshPayload) {
            const candidate = await storage.getUser(refreshPayload.userId);
            if (candidate && candidate.tokenVersion === refreshPayload.tokenVersion) {
              userId = candidate.id;
            }
          }
        }
      }

      if (userId) {
        await storage.incrementTokenVersion(userId);
        logger.info({ userId }, "User logged out — tokenVersion incremented");
      }
      clearRefreshCookie(res);
      clearSessionCookie(res);
      res.json({ message: "Logged out" });
    } catch (err: unknown) {
      logger.error({ err }, "Logout error");
      clearRefreshCookie(res);
      clearSessionCookie(res);
      res.json({ message: "Logged out" });
    }
  });

  // ── POST /api/auth/refresh ────────────────────────────────────────────────
  // Exchanges a valid rid cookie for a new JWT + refreshed sid + rid cookies.
  // No credentials required — the signed rid cookie is the proof of identity.
  app.post("/api/auth/refresh", async (req: Request, res: Response): Promise<void> => {
    try {
      // Accept token from: signed rid cookie (browsers) OR body/header (mobile)
      const ridToken =
        (req.cookies?.[RID_COOKIE] as string | undefined) ||
        (req.body?.refreshToken as string | undefined) ||
        (req.headers?.["x-refresh-token"] as string | undefined);
      if (!ridToken) {
        res.status(401).json({ error: "No refresh token" }); return;
      }
      const payload = verifyRefreshToken(ridToken);
      if (!payload) {
        clearRefreshCookie(res);
        res.status(401).json({ error: "Invalid or expired refresh token" }); return;
      }
      const user = await storage.getUser(payload.userId);
      if (!user || user.tokenVersion !== payload.tokenVersion) {
        clearRefreshCookie(res);
        res.status(401).json({ error: "Session invalidated — please log in again" }); return;
      }
      // Atomically rotate tokenVersion only when the stored version still matches
      // the one embedded in this refresh token. If another concurrent request
      // already incremented the version, the WHERE clause matches 0 rows and we
      // get null back — reject immediately so the race loser cannot obtain a
      // fresh session. This turns the read-then-write into a compare-and-swap,
      // closing the concurrent-replay window.
      const rotated = await storage.incrementTokenVersion(user.id, payload.tokenVersion);
      if (!rotated) {
        clearRefreshCookie(res);
        res.status(401).json({ error: "Session invalidated — please log in again" }); return;
      }
      const { tokenVersion: newVersion } = rotated;
      const newToken = generateToken(user.id, user.role, newVersion);
      const newRefreshToken = generateRefreshToken(user.id, newVersion);
      setSessionCookie(res, newToken);
      setRefreshCookie(res, user.id, newVersion);
      res.json({
        token: newToken,
        ...(newRefreshToken ? { refreshToken: newRefreshToken } : {}),
        user: { id: user.id, username: user.username, role: user.role },
      });
    } catch (err: unknown) {
      logger.error({ err }, "Token refresh error");
      res.status(500).json({ error: "Token refresh failed" });
    }
  });
}
