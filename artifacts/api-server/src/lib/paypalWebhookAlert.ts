import { logger } from "./logger";
import { sendPayPalWebhookSecretMissingAlert } from "./email";
import { reserveDedupeSlot, releaseDedupeSlot } from "./dedupe";

/**
 * Operator push-alert (email) for the silent PayPal-payout failure mode:
 * payout credentials ARE set (so payouts can go out) but PAYPAL_WEBHOOK_ID is
 * missing, so every PayPal status callback is rejected (401) and withdrawals
 * stay stuck in "paying"/"pending" forever.
 *
 * A loud server log (startup + first callback) and an admin Integration Hub
 * flag already surface this, but those only help if someone is looking. This
 * sends an active email — matching the AdMob/withdrawal operator-alert pattern —
 * so the owner reacts without watching the hub.
 *
 * Throttled to at most once per cooldown window so it cannot spam the inbox on
 * every rejected callback. Unlike the AdMob alert (which throttles in-memory,
 * per-replica), this throttle is DB-backed via the shared `dedupe_slots` table,
 * so the cooldown is enforced GLOBALLY across the whole autoscaled fleet — one
 * email per cooldown for the entire deployment, not one per replica.
 */

const DEFAULT_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6h

/** Shared dedupe-slot key gating the alert across every replica. */
const DEDUPE_KEY = "paypal_webhook_secret_missing_alert";

function resolveCooldownMs(): number {
  const raw = process.env.PAYPAL_WEBHOOK_ALERT_COOLDOWN_MS;
  if (!raw) return DEFAULT_COOLDOWN_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    logger.warn(
      { value: raw },
      "Invalid PAYPAL_WEBHOOK_ALERT_COOLDOWN_MS, using default",
    );
    return DEFAULT_COOLDOWN_MS;
  }
  return n;
}

/**
 * Send the missing-webhook-secret operator alert email, throttled to at most
 * once per cooldown window across the whole fleet. Fire-and-forget; never
 * throws. Resolves true when an email was actually dispatched (i.e. this caller
 * won the shared cooldown slot), mainly for tests/observability.
 *
 * The throttle is reserved in the DB FIRST so concurrent callbacks on different
 * replicas can't both slip through; only the caller that reserves a fresh slot
 * sends. If the email send fails the slot is released so a later callback can
 * retry rather than the alert being silently lost for a whole cooldown window.
 */
export async function alertPayPalWebhookSecretMissing(
  source: "startup" | "callback" | "payout",
): Promise<boolean> {
  let reserved: { count: number; duplicate: boolean };
  try {
    reserved = await reserveDedupeSlot(DEDUPE_KEY, resolveCooldownMs());
  } catch (err) {
    // The shared throttle store is unreachable. Suppress rather than fail open
    // so a database blip can't turn PayPal's callback retries into an inbox
    // flood; the loud server log and the admin Integration Hub flag still
    // surface the underlying webhook-missing condition.
    logger.error(
      { err, source },
      "PayPal webhook-secret-missing alert throttle unavailable; suppressing email",
    );
    return false;
  }

  if (reserved.duplicate) {
    return false; // within cooldown — suppress to avoid inbox flooding
  }

  try {
    await sendPayPalWebhookSecretMissingAlert({
      source,
      mode: process.env.PAYPAL_MODE || "sandbox",
    });
  } catch (err) {
    logger.error(
      { err, source },
      "Failed to send PayPal webhook-secret-missing alert email",
    );
    // The guarded operation did not complete — release the slot so the next
    // callback within the window can retry instead of the alert being lost.
    await releaseDedupeSlot(DEDUPE_KEY).catch((relErr) =>
      logger.warn(
        { err: relErr },
        "Failed to release PayPal webhook-secret-missing alert slot after send failure",
      ),
    );
  }
  return true;
}
