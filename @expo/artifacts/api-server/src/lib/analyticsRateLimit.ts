import { rateLimit } from "express-rate-limit";
import { getClientIp } from "./clientIp";

/**
 * Per-IP rate limit for the public, cookieless analytics collector.
 *
 * Analytics beacons are cheap, fire-and-forget, and do not move money or
 * mutate user state, so a memory-only limiter is acceptable here: the worst a
 * bypass across autoscaled replicas can do is inflate event counts. The cap is
 * generous (a single browsing session fires far fewer events than this) but
 * still bounds bot floods. On limit we return 204 — beacons must never see an
 * error and the client must not retry.
 */
export const analyticsRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: parseInt(process.env.ANALYTICS_RATE_LIMIT ?? "240", 10),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => getClientIp(req),
  // getClientIp already extracts the correct client address for this
  // deployment, so suppress the library's IPv6 keyGenerator heuristic.
  validate: { keyGeneratorIpFallback: false },
  handler(_req, res) {
    res.status(204).end();
  },
});
