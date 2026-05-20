import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Response } from "express";
import type { AuthRequest } from "../auth.js";

const HEADER_NAME = "x-secrets-passphrase";

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

export function secretsPassphraseMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void {
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
    req.log?.warn(
      { route: req.originalUrl, userId: req.userId },
      "Secrets passphrase rejected",
    );
    res.status(401).json({
      error: "Incorrect secrets passphrase.",
      code: "SECRETS_PASSPHRASE_INVALID",
    });
    return;
  }

  next();
}
