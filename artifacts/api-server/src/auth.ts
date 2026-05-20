import type { Express, Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { storage } from "./storage";
import { logger } from "./lib/logger";
import { sendEmailVerification, sendPasswordResetOTP } from "./lib/email";
import { recordLoginAttempt, pruneExpiredLoginAttempts } from "./lib/dbRateLimit";
import { getClientIp } from "./lib/clientIp";
import { validateRegistrationEmail } from "./lib/emailValidation";
import type { InsertUser } from "@workspace/db";
import { db, passwordResetTokens } from "@workspace/db";
import { eq as drizzleEq, and as drizzleAnd, isNull as drizzleIsNull, gte as drizzleGte } from "drizzle-orm";

// Resolved lazily so the server can start and pass the health check even when
// JWT_TRIDENTE / JWT_SECRET hasn't been linked to the production environment yet.
// Auth routes that call getJwtSecret() will return 500 if the secret is absent,
// rather than crashing the whole process at import time.
function getJwtSecret(): string {
  const s = process.env.JWT_TRIDENTE ?? process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_TRIDENTE (or JWT_SECRET) environment variable is required");
  if (s.length < 64) throw new Error("JWT_TRIDENTE is too short — must be at least 64 characters.");
  return s;
}

// ── Secret rotation support ───────────────────────────────────────────────────
// During a key rotation:
//   1. Set JWT_TRIDENTE_PREV = current JWT_TRIDENTE value
//   2. Set JWT_TRIDENTE     = new 64-byte secret
//   3. Restart the server — new tokens are signed with the new secret,
//      but tokens signed with the old secret remain valid for their full 7d TTL.
//   4. After 7 days all old tokens have expired — clear JWT_TRIDENTE_PREV.
function getPrevJwtSecret(): string | null {
  const s = process.env.JWT_TRIDENTE_PREV;
  if (!s) return null;
  if (s.length < 64) {
    logger.warn("JWT_TRIDENTE_PREV is set but too short (<64 chars) — ignoring it");
    return null;
  }
  return s;
}

const TOKEN_EXPIRY = "7d";

// ── RIPRENDERE — refresh token layer ─────────────────────────────────────────
// Signs long-lived refresh tokens (30d) stored in the rid httpOnly cookie.
// When the short-lived JWT (TRIDENTE, 7d) expires, POST /api/auth/refresh
// exchanges a valid rid cookie for a fresh JWT + sid cookie without re-login.
const RIPRENDERE_SECRET = process.env.RIPRENDERE;
const REFRESH_TOKEN_EXPIRY = "30d";
const REFRESH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const RID_COOKIE = "rid";

function generateRefreshToken(userId: string, tokenVersion: number): string | null {
  if (!RIPRENDERE_SECRET) return null;
  return jwt.sign({ userId, tokenVersion, type: "refresh" }, RIPRENDERE_SECRET, {
    expiresIn: REFRESH_TOKEN_EXPIRY,
  });
}

function verifyRefreshToken(token: string): { userId: string; tokenVersion: number } | null {
  if (!RIPRENDERE_SECRET) return null;
  try {
    const decoded = jwt.verify(token, RIPRENDERE_SECRET);
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
  "jorge.ballen@cash-clip.app",
]);

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
}

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS_PER_IP = 10;
const MAX_REGISTER_ATTEMPTS_PER_IP = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

// Periodically prune expired rows from the shared login_attempts table.
setInterval(() => { pruneExpiredLoginAttempts(); }, 5 * 60 * 1000);

function generateToken(userId: string, role: string, tokenVersion: number): string {
  return jwt.sign({ userId, role, tokenVersion }, getJwtSecret(), { expiresIn: TOKEN_EXPIRY });
}

function verifyToken(token: string): { userId: string; role: string; tokenVersion: number } | null {
  const secrets: string[] = [getJwtSecret()];
  const prev = getPrevJwtSecret();
  if (prev) secrets.push(prev);

  for (const secret of secrets) {
    try {
      const decoded = jwt.verify(token, secret);
      if (
        typeof decoded === "object" &&
        decoded !== null &&
        "userId" in decoded &&
        "role" in decoded &&
        "tokenVersion" in decoded
      ) {
        return decoded as { userId: string; role: string; tokenVersion: number };
      }
    } catch {
      // try next secret
    }
  }
  return null;
}

const SID_COOKIE = "sid";
const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const isProd = process.env.NODE_ENV === "production";

export function setSessionCookie(res: Response, token: string): void {
  if (!process.env.INVECE) return;
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
  // Accept Bearer header first, then fall back to signed sid cookie (INVECE layer).
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
  next();
}

export async function adminMiddleware(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
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
      if (!/^[a-zA-Z0-9_-]+$/.test(username.trim())) {
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
      if (!agreedToTerms) {
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
        const domain = process.env["REPLIT_DOMAINS"]?.split(",")[0]?.trim() ?? "ad-revenue-engine.replit.app";
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

      // Per-account lockout was removed: keying the lockout counter on username
      // alone made it trivially attacker-triggerable for any known username —
      // five garbage-password requests from one IP were enough to lock an
      // account for 15 minutes. Because admin usernames are publicly seeded
      // constants, the entire admin pool could be kept continuously locked out
      // by a handful of IPs. The per-IP DB-backed counter (above) is the correct
      // brute-force boundary: it is shared across all replicas, cannot be evaded
      // by rotating target usernames, and does not expose a targeted DoS surface.
      const user = await storage.getUserByUsername(normalizedUsername);
      if (!user) {
        await bcrypt.hash("dummy-timing-equalization", 10);
        res.status(401).json({ error: "Invalid credentials" });
        return;
      }

      const valid = await bcrypt.compare(password, user.password);
      if (!valid) {
        res.status(401).json({ error: "Invalid credentials" });
        return;
      }

      // Non-admin accounts must verify their email before receiving a token.
      // Admin accounts bypass this gate so operators are never locked out.
      if (user.role !== "admin" && !user.emailVerified) {
        res.status(403).json({
          error: "Please verify your email address before logging in. Check your inbox for a verification link.",
          code: "EMAIL_NOT_VERIFIED",
        });
        return;
      }

      const token = generateToken(user.id, user.role, user.tokenVersion);
      const refreshToken = generateRefreshToken(user.id, user.tokenVersion);
      setSessionCookie(res, token);
      setRefreshCookie(res, user.id, user.tokenVersion);
      res.json({
        token,
        ...(refreshToken ? { refreshToken } : {}),
        user: { id: user.id, username: user.username, role: user.role },
      });
    } catch (err: unknown) {
      logger.error({ err }, "Login error");
      res.status(500).json({ error: "Login failed" });
    }
  });

  app.get("/api/auth/me", authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
    const user = await storage.getUser(req.userId!);
    if (!user) {
      res.status(401).json({ error: "User not found" });
      return;
    }
    res.json({
      user: { id: user.id, username: user.username, role: user.role },
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
      const { tokenVersion } = await storage.updateUserPassword(user.id, hashed);
      logger.info({ userId: user.id }, "User changed password");
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
      const tokenHash = crypto.createHash("sha256").update(String(code).trim()).digest("hex");
      const now = new Date();
      const [token] = await db
        .select()
        .from(passwordResetTokens)
        .where(
          drizzleAnd(
            drizzleEq(passwordResetTokens.userId, user.id),
            drizzleEq(passwordResetTokens.tokenHash, tokenHash),
            drizzleIsNull(passwordResetTokens.usedAt),
            drizzleGte(passwordResetTokens.expiresAt, now),
          ),
        )
        .limit(1);
      if (!token) {
        res.status(400).json({ error: "Invalid or expired code" });
        return;
      }
      await db.update(passwordResetTokens).set({ usedAt: now }).where(drizzleEq(passwordResetTokens.id, token.id));
      const hashed = await bcrypt.hash(newPassword, 10);
      await storage.updateUserPassword(user.id, hashed);
      logger.info({ userId: user.id }, "Password reset via OTP");
      res.json({ message: "Password reset successfully" });
    } catch (err: unknown) {
      logger.error({ err }, "Reset password error");
      res.status(500).json({ error: "Failed to reset password" });
    }
  });

  // ── POST /api/auth/operator-recovery (TRIDENTE layer) ────────────────────
  // Issues a fresh admin token to the operator without needing a password.
  // Proof of identity is possession of JWT_TRIDENTE (the signing secret).
  // Only works for accounts that already have role=admin in the database.
  app.post("/api/auth/operator-recovery", async (req: Request, res: Response): Promise<void> => {
    try {
      const { operatorKey, username } = req.body;
      if (!operatorKey || !username) {
        res.status(400).json({ error: "operatorKey and username are required" }); return;
      }
      const secret = process.env.JWT_TRIDENTE ?? process.env.JWT_SECRET;
      if (!secret) {
        res.status(503).json({ error: "Recovery unavailable" }); return;
      }
      // Constant-time comparison to prevent timing attacks
      let match = false;
      try {
        const a = Buffer.from(String(operatorKey));
        const b = Buffer.from(secret);
        match = a.length === b.length && crypto.timingSafeEqual(a, b);
      } catch {
        match = false;
      }
      if (!match) {
        res.status(401).json({ error: "Invalid operator key" }); return;
      }
      const user = await storage.getUserByUsername(String(username).trim().toLowerCase());
      if (!user || user.role !== "admin") {
        res.status(403).json({ error: "No admin account found for that username" }); return;
      }
      const token = generateToken(user.id, user.role, user.tokenVersion);
      setSessionCookie(res, token);
      setRefreshCookie(res, user.id, user.tokenVersion);
      logger.warn({ username: user.username }, "Admin token issued via operator-recovery (TRIDENTE)");
      res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
    } catch (err: unknown) {
      logger.error({ err }, "Operator recovery error");
      res.status(500).json({ error: "Recovery failed" });
    }
  });

  // ── POST /api/auth/refresh (RIPRENDERE layer) ─────────────────────────────
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
      const newToken = generateToken(user.id, user.role, user.tokenVersion);
      const newRefreshToken = generateRefreshToken(user.id, user.tokenVersion);
      setSessionCookie(res, newToken);
      setRefreshCookie(res, user.id, user.tokenVersion);
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
