import { logger } from "./logger";
import { sendWithdrawalEmailFailureAlert } from "./email";

/**
 * Operator alerting for failed withdrawal status-update emails.
 *
 * Payout outcome emails (paid / rejected) are money-critical: if they silently
 * fail to send, the user never learns their withdrawal outcome. Each individual
 * failure is logged at the call site with the withdrawal id + recipient. This
 * module watches for a *sustained* failure rate — a misconfigured SMTP secret
 * or a systematically bad recipient — and surfaces it to the operator with a
 * single debounced alert email so the inbox is never spammed.
 *
 * Counters are in-memory and therefore replica-local; that is acceptable here
 * because this is a best-effort operational heads-up, not a money-moving guard.
 */

const DEFAULT_THRESHOLD = 3;
const DEFAULT_WINDOW_MS = 30 * 60 * 1000; // 30 min
const DEFAULT_COOLDOWN_MS = 60 * 60 * 1000; // 1 h between alerts

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    logger.warn({ name, value: raw }, "Invalid integer env var, using default");
    return fallback;
  }
  return n;
}

function getConfig(): { threshold: number; windowMs: number; cooldownMs: number } {
  return {
    threshold: envInt("WITHDRAWAL_EMAIL_ALERT_THRESHOLD", DEFAULT_THRESHOLD),
    windowMs: envInt("WITHDRAWAL_EMAIL_ALERT_WINDOW_MS", DEFAULT_WINDOW_MS),
    cooldownMs: envInt("WITHDRAWAL_EMAIL_ALERT_COOLDOWN_MS", DEFAULT_COOLDOWN_MS),
  };
}

const failureTimestamps: number[] = [];
let lastAlertAt = 0;

export interface WithdrawalEmailFailure {
  withdrawalId: string;
  /** Recipient address — already logged elsewhere, no new PII exposure. */
  recipient: string;
  status: string;
  reason: string;
}

/**
 * Record one failed withdrawal status-update email. Always logs a structured
 * `withdrawal_email_failure` warning. When the rolling failure count crosses
 * the configured threshold within the window (and we are outside the cooldown),
 * fires a single debounced operator alert email.
 */
export function recordWithdrawalEmailFailure(failure: WithdrawalEmailFailure): void {
  const cfg = getConfig();
  const now = Date.now();

  logger.warn(
    {
      audit: "withdrawal_email_failure",
      withdrawalId: failure.withdrawalId,
      recipient: failure.recipient,
      status: failure.status,
      reason: failure.reason,
    },
    "Failed to deliver withdrawal status-update email",
  );

  failureTimestamps.push(now);
  const cutoff = now - cfg.windowMs;
  while (failureTimestamps.length > 0 && failureTimestamps[0]! < cutoff) {
    failureTimestamps.shift();
  }

  if (failureTimestamps.length < cfg.threshold) return;
  if (now - lastAlertAt < cfg.cooldownMs) return;

  lastAlertAt = now;
  sendWithdrawalEmailFailureAlert({
    failureCount: failureTimestamps.length,
    windowMs: cfg.windowMs,
    sampleWithdrawalId: failure.withdrawalId,
    sampleRecipient: failure.recipient,
    sampleReason: failure.reason,
  });
}

/** Test-only helper to clear in-memory state. */
export function _resetWithdrawalEmailAlertsForTests(): void {
  failureTimestamps.length = 0;
  lastAlertAt = 0;
}
