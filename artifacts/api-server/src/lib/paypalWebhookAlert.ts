import { logger } from "./logger";
import { sendPayPalWebhookSecretMissingAlert } from "./email";

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
 * Throttled in-memory once per cooldown window so it cannot spam the inbox on
 * every rejected callback. Like the AdMob alert debounce, this state is
 * per-process/per-replica (best-effort), which is acceptable: the worst case is
 * one email per replica per cooldown, not one per callback.
 */

const DEFAULT_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6h

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

let lastAlertAt = 0;
let hasAlerted = false;

/**
 * Send the missing-webhook-secret operator alert email, throttled to at most
 * once per cooldown window. Fire-and-forget; never throws. Returns true when an
 * email was actually dispatched (i.e. not suppressed by the cooldown), mainly
 * for tests/observability.
 */
export function alertPayPalWebhookSecretMissing(
  source: "startup" | "callback" | "payout",
  now: number = Date.now(),
): boolean {
  if (hasAlerted && now - lastAlertAt < resolveCooldownMs()) {
    return false; // within cooldown — suppress to avoid inbox flooding
  }
  hasAlerted = true;
  lastAlertAt = now;
  try {
    sendPayPalWebhookSecretMissingAlert({
      source,
      mode: process.env.PAYPAL_MODE || "sandbox",
    });
  } catch (err) {
    logger.error({ err, source }, "Failed to send PayPal webhook-secret-missing alert email");
  }
  return true;
}

/** Test-only helper to reset the throttle state. */
export function _resetPayPalWebhookAlertForTests(): void {
  lastAlertAt = 0;
  hasAlerted = false;
}
