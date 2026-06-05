import { Router, type Request, type Response } from "express";
import { db, analyticsEvents } from "@workspace/db";
import { analyticsRateLimiter } from "../lib/analyticsRateLimit";

const router = Router();

// Allowlists keep the table clean: unknown event names / surfaces from
// scrapers or stale clients are silently dropped rather than stored.
const ALLOWED_EVENTS = new Set([
  "pageview",
  "app_store_click",
  "download_click",
  "referral_click",
  "lead_submit",
]);

const ALLOWED_SURFACES = new Set(["absustain", "cashclip-landing"]);

/** Coerce to a trimmed, length-capped string, or null when absent/invalid. */
function cleanStr(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

/**
 * Sanitize the free-form props bag: keep only string/number/boolean values
 * under a small key/value cap, drop everything else. Bounds payload size and
 * prevents arbitrary nested objects from being persisted.
 */
function cleanProps(value: unknown): Record<string, string | number | boolean> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, string | number | boolean> = {};
  let count = 0;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (count >= 20) break;
    if (typeof k !== "string" || k.length > 64) continue;
    if (typeof v === "string") out[k] = v.slice(0, 256);
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "boolean") out[k] = v;
    else continue;
    count += 1;
  }
  return Object.keys(out).length ? out : null;
}

// POST /api/analytics/collect — first-party, cookieless event sink.
// Accepts a single event from the web surfaces (sent via navigator.sendBeacon
// or fetch keepalive). Always responds 204 so beacons never surface an error
// and never retry; invalid payloads are quietly swallowed.
router.post("/analytics/collect", analyticsRateLimiter, async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown> | undefined;

  const eventName = cleanStr(body?.eventName, 64);
  const surface = cleanStr(body?.surface, 32);

  if (!eventName || !surface || !ALLOWED_EVENTS.has(eventName) || !ALLOWED_SURFACES.has(surface)) {
    res.status(204).end();
    return;
  }

  try {
    const userAgent = (req.get("user-agent") ?? "").slice(0, 512) || null;
    await db.insert(analyticsEvents).values({
      eventName,
      surface,
      path: cleanStr(body?.path, 512),
      referrer: cleanStr(body?.referrer, 1024),
      utmSource: cleanStr(body?.utmSource, 256),
      utmMedium: cleanStr(body?.utmMedium, 256),
      utmCampaign: cleanStr(body?.utmCampaign, 256),
      utmTerm: cleanStr(body?.utmTerm, 256),
      utmContent: cleanStr(body?.utmContent, 256),
      props: cleanProps(body?.props),
      userAgent,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to record analytics event");
  }

  res.status(204).end();
});

export default router;
