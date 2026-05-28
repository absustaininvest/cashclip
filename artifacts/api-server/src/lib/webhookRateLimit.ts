import rateLimit from "express-rate-limit";
import { logger } from "./logger";
import { getClientIp } from "./clientIp";

// ---------------------------------------------------------------------------
// Per-replica webhook rate limiter — fast-path, non-authoritative filter
//
// This limiter uses the default in-process memory store from express-rate-limit.
// In an autoscaled deployment each replica enforces its own independent budget,
// so the effective fleet-wide budget is `limit * replica_count`. This limiter
// is intentionally a non-authoritative fast-path filter: it quickly sheds
// obvious per-IP bulk traffic on a single replica before requests reach
// handler logic, but it does NOT provide a globally authoritative cap.
//
// Endpoints that perform expensive or money-moving work (e.g. outbound PayPal
// OAuth + verify-webhook-signature calls) MUST enforce a DB-backed, shared
// rate check inside the handler — before the expensive operation — so the cap
// holds across the entire autoscaled fleet.  The in-memory limiter here is
// complementary, not a substitute for that fleet-wide guard.
//
// For protection against write-amplification DoS (flooding webhook_audit with
// invalid requests that slip under the per-replica budget), a separate per-IP
// audit write cap is enforced inside `logWebhookVerificationFailure` in
// webhookAuth.ts — that cap applies after auth fails and prevents persistent
// DB writes from being produced at an unbounded rate.
// ---------------------------------------------------------------------------

const DEFAULT_WEBHOOK_RPM = 60;

function getWebhookRpm(): number {
  const envVal = process.env.WEBHOOK_RATE_LIMIT_RPM;
  if (!envVal) return DEFAULT_WEBHOOK_RPM;
  const parsed = parseInt(envVal, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    logger.warn(
      { value: envVal },
      "Invalid WEBHOOK_RATE_LIMIT_RPM value, falling back to default",
    );
    return DEFAULT_WEBHOOK_RPM;
  }
  return parsed;
}

export const webhookRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: getWebhookRpm(),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  // Key on the rightmost XFF entry (the trusted-proxy-observed IP) instead of
  // the default req.ip. With "trust proxy: 1", req.ip resolves to the leftmost
  // XFF entry, which is attacker-controlled and allows per-replica budget
  // exhaustion by rotating spoofed header values.
  keyGenerator: (req) => getClientIp(req),
  // Suppress only the IPv6 keyGenerator validation: our getClientIp already
  // extracts the rightmost XFF entry correctly for this deployment, so the
  // library's heuristic is a false positive. All other validations remain on.
  validate: { keyGeneratorIpFallback: false },
  handler: (_req, res) => {
    logger.warn(
      { ip: getClientIp(_req) },
      "Webhook rate limit exceeded",
    );
    res.status(429).json({ error: "Too many requests. Please try again later." });
  },
});
