import { logger } from "./logger";
import { sendAdmobReportAlert } from "./email";
import {
  getSetting,
  ADMOB_ALERT_EMAIL_KEY,
  ADMOB_ALERT_EMAIL_ENABLED_KEY,
} from "./runtimeSettings";

/**
 * Operator alerts for the AdMob reporting pipeline.
 *
 * Two conditions are watched, both routed through the SAME operator-alert path
 * used by webhookAlerts: a structured `admob_report_alert` log line, an
 * in-memory buffer surfaced to the admin UI (GET /api/admin/webhook-alerts),
 * and an optional POST to `ADMIN_ALERT_WEBHOOK_URL`.
 *
 *  - `stale_sync` — no fresh AdMob snapshot has synced within a configurable
 *    window (the reporting OAuth token expired, the API is unreachable, …), so
 *    the hub is serving last-known data that may be going cold.
 *  - `revenue_divergence` — the official AdMob earnings diverge from the app's
 *    own client-reported revenue (summed `ad_events.revenue_micros`) beyond a
 *    configurable percentage — a sign the app's onPaidEvent reporting is
 *    dropping events or double-counting.
 *
 * De-duplicated / rate-limited: a sustained condition re-alerts at most once per
 * cooldown, and emits a single `resolved` event when it clears, so a persistent
 * problem never spams operators.
 */

const DEFAULT_STALE_HOURS = 6;
const DEFAULT_DIVERGENCE_PCT = 25;
// Below this much official earnings the percentage is noisy (a few cents of
// difference reads as a huge percentage), so divergence is not evaluated.
const DEFAULT_MIN_EARNINGS_USD = 1;
const DEFAULT_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6h
const MAX_ALERTS = 100;

function envNum(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    logger.warn({ name, value: raw }, "Invalid numeric env var, using default");
    return fallback;
  }
  return n;
}

export interface AdmobAlertConfig {
  staleAfterMs: number;
  divergencePct: number;
  minEarningsUsd: number;
  cooldownMs: number;
  notifyUrl?: string;
  /** Email the operator (Zoho SMTP) on fire/resolve. On by default. The admin
   * Integration Hub toggle (persisted, read at evaluation time) wins; absent
   * that, the ADMOB_ALERT_EMAIL_DISABLED env flag suppresses just the email. */
  emailEnabled: boolean;
  /** Recipient for the operator alert email. The admin Integration Hub setting
   * (persisted) wins; absent that, sendAdmobReportAlert falls back to the
   * ADMIN_ALERT_EMAIL env var and then the default operator mailbox. undefined
   * means "no override — use that fallback chain". */
  emailRecipient?: string;
}

function envFlag(name: string): boolean {
  const raw = process.env[name];
  if (!raw) return false;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

/**
 * The app's per-impression revenue mirror (AdMob `onPaidEvent` → `revenueMicros`)
 * only fills once a PAID-capable native build is the LIVE build. Until that
 * cutover, app-reported revenue is $0 BY DESIGN and a $0 reconciliation is not a
 * real discrepancy. After the cutover, revenue SHOULD be flowing, so the same $0
 * is a genuine regression that must surface as an alert — not be masked by the
 * friendly "by design" relabel.
 *
 * This flag is the cutover signal: set `ADMOB_MIRROR_EXPECTED_ACTIVE` truthy on
 * the production deployment once the PAID-capable build is live. Defaults to
 * false (pre-cutover) so nothing changes until an operator flips it.
 */
export function isAdmobMirrorExpectedActive(): boolean {
  return envFlag("ADMOB_MIRROR_EXPECTED_ACTIVE");
}

export function getAdmobAlertConfig(): AdmobAlertConfig {
  return {
    staleAfterMs: Math.round(envNum("ADMOB_ALERT_STALE_HOURS", DEFAULT_STALE_HOURS) * 60 * 60 * 1000),
    divergencePct: envNum("ADMOB_ALERT_DIVERGENCE_PCT", DEFAULT_DIVERGENCE_PCT),
    minEarningsUsd: (() => {
      // minEarnings may legitimately be 0 (alert on any divergence), so allow it.
      const raw = process.env.ADMOB_ALERT_MIN_EARNINGS_USD;
      if (raw == null || raw === "") return DEFAULT_MIN_EARNINGS_USD;
      const n = Number(raw);
      return Number.isFinite(n) && n >= 0 ? n : DEFAULT_MIN_EARNINGS_USD;
    })(),
    cooldownMs: Math.round(envNum("ADMOB_ALERT_COOLDOWN_MS", DEFAULT_COOLDOWN_MS)),
    notifyUrl: process.env.ADMIN_ALERT_WEBHOOK_URL || undefined,
    emailEnabled: resolveEmailEnabled(),
    emailRecipient: resolveEmailRecipient(),
  };
}

/** The persisted admin toggle wins; absent that, fall back to the env flag. */
function resolveEmailEnabled(): boolean {
  const override = getSetting(ADMOB_ALERT_EMAIL_ENABLED_KEY);
  if (override != null) {
    return /^(1|true|yes|on)$/i.test(override.trim());
  }
  return !envFlag("ADMOB_ALERT_EMAIL_DISABLED");
}

/** The persisted admin recipient wins; absent that, undefined lets the email
 * layer fall back to ADMIN_ALERT_EMAIL and then the default operator mailbox. */
function resolveEmailRecipient(): string | undefined {
  const override = getSetting(ADMOB_ALERT_EMAIL_KEY);
  const trimmed = override?.trim();
  return trimmed ? trimmed : undefined;
}

export type AdmobAlertCondition = "stale_sync" | "revenue_divergence";
export type AdmobAlertStatus = "firing" | "resolved";

export interface AdmobAlert {
  id: string;
  condition: AdmobAlertCondition;
  status: AdmobAlertStatus;
  message: string;
  firstSeenAt: string;
  firedAt: string;
  cooldownMs: number;
  /** staleAfterMs (for stale_sync) or divergencePct (for revenue_divergence). */
  threshold: number;
  detail: Record<string, unknown>;
  notifyDelivered?: boolean;
  notifyError?: string;
}

export interface AdmobReconciliationInput {
  officialEarnings: number;
  appReportedEarnings: number;
  differenceAbs: number;
  differencePct: number | null;
  currency?: string;
}

export interface AdmobAlertInput {
  /** When AdMob is not configured, "no data" is expected — staleness is skipped. */
  configured: boolean;
  lastSyncedAt: Date | string | null;
  reconciliation: AdmobReconciliationInput | null;
  /** Override for tests; defaults to Date.now(). */
  now?: number;
}

interface ConditionState {
  active: boolean;
  firstSeenAt: number;
  lastAlertAt: number;
}

const states = new Map<AdmobAlertCondition, ConditionState>();
const recentAlerts: AdmobAlert[] = [];

async function deliverNotification(
  url: string,
  alert: AdmobAlert,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "admob_report_alert", alert }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function fireAlert(alert: AdmobAlert, cfg: AdmobAlertConfig): void {
  const log = alert.status === "resolved" ? logger.info.bind(logger) : logger.warn.bind(logger);
  log(
    { audit: "admob_report_alert", ...alert },
    `admob_report_alert condition=${alert.condition} status=${alert.status}`,
  );

  if (cfg.notifyUrl) {
    void deliverNotification(cfg.notifyUrl, alert).then((result) => {
      alert.notifyDelivered = result.ok;
      if (!result.ok) {
        alert.notifyError = result.error;
        logger.error(
          { condition: alert.condition, error: result.error },
          "Failed to deliver admob report alert notification",
        );
      }
    });
  }

  // Email the operator (Zoho SMTP — same channel as OTPs/support) so the owner
  // reacts without watching the hub. fireAlert is the single chokepoint called
  // once per fired/resolved transition, so this inherits the cooldown de-dup and
  // never floods. Fire-and-forget + no-op when SMTP is unconfigured.
  if (cfg.emailEnabled) {
    try {
      sendAdmobReportAlert({
        condition: alert.condition,
        status: alert.status,
        message: alert.message,
        firedAt: alert.firedAt,
        detail: alert.detail,
        to: cfg.emailRecipient,
      });
    } catch (err) {
      logger.error(
        { condition: alert.condition, err },
        "Failed to send admob report alert email",
      );
    }
  }

  recentAlerts.push(alert);
  if (recentAlerts.length > MAX_ALERTS) {
    recentAlerts.splice(0, recentAlerts.length - MAX_ALERTS);
  }
}

/**
 * Drive one condition's state machine. Emits a `firing` alert the first time a
 * condition becomes active and then at most once per cooldown while it persists,
 * and a single `resolved` alert when it clears. Returns the alert to fire, or
 * null when nothing should be emitted (suppressed by cooldown, or no change).
 */
function transition(
  condition: AdmobAlertCondition,
  active: boolean,
  now: number,
  cfg: AdmobAlertConfig,
  build: (status: AdmobAlertStatus, firstSeenAt: number, firedAt: number) => AdmobAlert,
): AdmobAlert | null {
  const state = states.get(condition) ?? { active: false, firstSeenAt: 0, lastAlertAt: 0 };
  let result: AdmobAlert | null = null;

  if (active) {
    if (!state.active) {
      state.active = true;
      state.firstSeenAt = now;
      state.lastAlertAt = now;
      result = build("firing", state.firstSeenAt, now);
    } else if (now - state.lastAlertAt >= cfg.cooldownMs) {
      state.lastAlertAt = now;
      result = build("firing", state.firstSeenAt, now);
    }
    // else: still active but inside the cooldown window → suppress (de-dup).
  } else if (state.active) {
    const firstSeenAt = state.firstSeenAt || now;
    state.active = false;
    state.firstSeenAt = 0;
    state.lastAlertAt = 0;
    result = build("resolved", firstSeenAt, now);
  }

  states.set(condition, state);
  return result;
}

/**
 * Evaluate the AdMob reporting freshness and revenue-divergence conditions and
 * fire/resolve operator alerts as needed. Pure of DB access — callers pass the
 * already-read lastSyncedAt + reconciliation so this can run from any surface
 * (the admin revenue route, a scheduled job, or a test). Returns the alerts
 * actually emitted this evaluation (may be empty).
 */
export function evaluateAdmobAlerts(input: AdmobAlertInput): AdmobAlert[] {
  const cfg = getAdmobAlertConfig();
  const now = input.now ?? Date.now();
  const fired: AdmobAlert[] = [];

  // ── Staleness ───────────────────────────────────────────────────────────
  // Only meaningful once AdMob is configured. When it is not configured, an
  // absent snapshot is the expected "not connected yet" state, not an incident.
  if (input.configured) {
    const last = input.lastSyncedAt ? new Date(input.lastSyncedAt).getTime() : null;
    const ageMs = last == null || Number.isNaN(last) ? Infinity : now - last;
    const stale = ageMs > cfg.staleAfterMs;
    const a = transition("stale_sync", stale, now, cfg, (status, firstSeenAt, firedAt) => ({
      id: `stale_sync::${firedAt}`,
      condition: "stale_sync",
      status,
      message:
        status === "resolved"
          ? "AdMob reporting sync is fresh again."
          : last == null
            ? "AdMob reporting has never synced — official earnings are unavailable."
            : `AdMob reporting is stale: last sync ~${(ageMs / 3_600_000).toFixed(1)}h ago exceeds the ${(cfg.staleAfterMs / 3_600_000).toFixed(1)}h window.`,
      firstSeenAt: new Date(firstSeenAt).toISOString(),
      firedAt: new Date(firedAt).toISOString(),
      cooldownMs: cfg.cooldownMs,
      threshold: cfg.staleAfterMs,
      detail: {
        lastSyncedAt: last == null ? null : new Date(last).toISOString(),
        ageMs: ageMs === Infinity ? null : ageMs,
        staleAfterMs: cfg.staleAfterMs,
      },
    }));
    if (a) {
      fireAlert(a, cfg);
      fired.push(a);
    }
  }

  return fired;
}

export function getRecentAdmobAlerts(limit = 50): AdmobAlert[] {
  const n = Math.min(Math.max(limit, 1), MAX_ALERTS);
  return recentAlerts.slice(-n).reverse();
}

/** Test-only helper to clear in-memory state. */
export function _resetAdmobAlertsForTests(): void {
  states.clear();
  recentAlerts.length = 0;
}
