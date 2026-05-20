import type { Request, Response, NextFunction } from "express";
import { logger } from "./logger";

/**
 * Compares two semver strings (MAJOR.MINOR.PATCH).
 * Returns negative if a < b, 0 if equal, positive if a > b.
 */
function compareSemver(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .replace(/^v/, "")
      .split(".")
      .map((n) => parseInt(n, 10) || 0);
  const [aMaj, aMin, aPatch] = parse(a);
  const [bMaj, bMin, bPatch] = parse(b);
  if (aMaj !== bMaj) return aMaj - bMaj;
  if (aMin !== bMin) return aMin - bMin;
  return aPatch - bPatch;
}

/**
 * Paths that are exempt from the version gate:
 *   - The version check endpoint itself
 *   - Auth endpoints (login/register — user must be able to authenticate
 *     before we can tell them to update)
 *   - Public static/info pages
 *   - Provider webhooks (external callers, not the app)
 */
const EXEMPT_PREFIXES = [
  "/api/app/version",
  "/api/auth/",
  "/api/",           // exact root landing page handled below
  "/api/about",
  "/api/privacy",
  "/api/support",
  "/api/resume/",
];

const EXEMPT_EXACT = new Set(["/api", "/api/", "/api/about", "/api/privacy", "/api/support"]);

const WEBHOOK_PATTERN = /\/webhook\//;

export function appVersionMiddleware(req: Request, res: Response, next: NextFunction): void {
  const minVersion: string = process.env.MIN_APP_VERSION ?? "1.1.0";

  // Webhooks are provider-to-server calls — no app version applies.
  if (WEBHOOK_PATTERN.test(req.path)) return next();

  // Exact exempt paths
  if (EXEMPT_EXACT.has(req.path)) return next();

  // Prefix-exempt paths
  if (
    req.path.startsWith("/api/app/version") ||
    req.path.startsWith("/api/auth/") ||
    req.path.startsWith("/api/about") ||
    req.path.startsWith("/api/privacy") ||
    req.path.startsWith("/api/support") ||
    req.path.startsWith("/api/resume/")
  ) {
    return next();
  }

  const clientVersion = req.headers["x-app-version"] as string | undefined;

  // If no header, allow through — web/browser clients won't send it.
  // We only enforce for clients that DO send the header and are too old.
  if (!clientVersion) return next();

  if (compareSemver(clientVersion, minVersion) < 0) {
    logger.warn(
      { clientVersion, minVersion, path: req.path },
      "Rejected request from outdated app version",
    );
    res.status(426).json({
      error: "App version too old",
      code: "UPGRADE_REQUIRED",
      minVersion,
      currentVersion: clientVersion,
    });
    return;
  }

  next();
}
