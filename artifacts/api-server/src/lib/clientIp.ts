import type { Request } from "express";

/**
 * Returns the trustworthy client IP for abuse-control decisions.
 *
 * Deployment context: the app runs behind one trusted Replit reverse proxy
 * (`app.set("trust proxy", 1)` in app.ts).  In this configuration Express
 * resolves `req.ip` from the *leftmost* X-Forwarded-For entry, which is
 * fully attacker-controlled: a client can send "X-Forwarded-For: spoofed"
 * and the proxy appends the real TCP address, producing "spoofed, real".
 * Express with trust=1 peels the rightmost hop and returns "spoofed".
 *
 * The trustworthy address is always the *rightmost* XFF entry because that
 * is the IP the trusted proxy observed on the actual TCP connection —
 * regardless of anything the client supplied earlier in the chain.
 *
 * All per-IP rate limiters, throttles, and audit writes must use this
 * function rather than `req.ip` to prevent header-rotation bypasses.
 */
export function getClientIp(req: Request): string {
  const xff = req.headers["x-forwarded-for"];
  if (xff) {
    const raw = Array.isArray(xff) ? xff[xff.length - 1] : xff;
    const entries = raw.split(",");
    const rightmost = entries[entries.length - 1]?.trim();
    if (rightmost) return rightmost;
  }
  return req.socket?.remoteAddress ?? "unknown";
}
