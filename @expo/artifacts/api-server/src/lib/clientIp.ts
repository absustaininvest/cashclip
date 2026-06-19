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

/**
 * Normalize a raw X-Forwarded-For / socket entry into a bare IP literal:
 * strips brackets, an attached port, an IPv6 zone id, and unwraps an
 * IPv4-mapped IPv6 address (::ffff:1.2.3.4 → 1.2.3.4).
 */
function normalizeIp(raw: string): string {
  let ip = (raw || "").trim();
  if (!ip) return "";
  if (ip.startsWith("[")) {
    const end = ip.indexOf("]");
    if (end !== -1) ip = ip.slice(1, end);
  } else if (ip.includes(".") && ip.split(":").length === 2) {
    // IPv4:port
    ip = ip.split(":")[0];
  }
  const pct = ip.indexOf("%");
  if (pct !== -1) ip = ip.slice(0, pct);
  const mapped = ip.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  if (mapped) ip = mapped[1];
  return ip.toLowerCase();
}

/**
 * Returns true only for globally-routable (public) IPs. Filters out the
 * private/loopback/link-local/CGNAT ranges that a reverse proxy injects into
 * X-Forwarded-For (e.g. the internal "10.x" hop) so they are never mistaken
 * for the real end-user address.
 */
function isPublicIp(ip: string): boolean {
  if (!ip) return false;
  if (ip.includes(".")) {
    const parts = ip.split(".").map((p) => parseInt(p, 10));
    if (parts.length !== 4 || parts.some((nn) => Number.isNaN(nn) || nn < 0 || nn > 255)) return false;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 169 && b === 254) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT 100.64.0.0/10
    if (a >= 224) return false; // multicast + reserved
    return true;
  }
  if (ip.includes(":")) {
    if (ip === "::1" || ip === "::") return false;
    if (ip.startsWith("fe80")) return false; // link-local
    if (ip.startsWith("fc") || ip.startsWith("fd")) return false; // unique-local fc00::/7
    return true;
  }
  return false;
}

/**
 * Returns the real end-user's *public* IP for geo-targeting third-party
 * providers (e.g. CPX survey matching), or undefined if none can be resolved.
 *
 * Unlike getClientIp (which returns the rightmost/proxy-observed hop for
 * abuse control), this scans X-Forwarded-For left-to-right and returns the
 * first globally-routable address — the originating client. Providers like
 * CPX return 0 surveys when handed a missing/private IP, so passing the wrong
 * hop here silently collapses the survey list to a single offerwall card.
 *
 * Never use this for rate limiting or audit writes — the leftmost XFF entries
 * are client-spoofable. Use getClientIp for those.
 */
export function getEndUserPublicIp(req: Request): string | undefined {
  const xff = req.headers["x-forwarded-for"];
  if (xff) {
    const raw = Array.isArray(xff) ? xff.join(",") : xff;
    for (const entry of raw.split(",")) {
      const ip = normalizeIp(entry);
      if (isPublicIp(ip)) return ip;
    }
  }
  const socketIp = normalizeIp(req.socket?.remoteAddress ?? "");
  return isPublicIp(socketIp) ? socketIp : undefined;
}
