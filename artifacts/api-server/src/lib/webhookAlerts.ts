import { logger } from "./logger";

export interface WebhookVerificationFailure {
  provider: string;
  reason: string;
  ip: string;
  forwardedFor?: string;
  userAgent?: string;
  method: string;
  path: string;
  hasSignatureHeader: boolean;
  secretConfigured: boolean;
  timestamp: string;
}

const DEFAULT_THRESHOLD = 10;
const DEFAULT_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_COOLDOWN_MS = 15 * 60 * 1000;
const MAX_REJECTIONS = 500;
const MAX_ALERTS = 100;

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

export interface WebhookAlertConfig {
  threshold: number;
  windowMs: number;
  cooldownMs: number;
  notifyUrl?: string;
}

export function getAlertConfig(): WebhookAlertConfig {
  return {
    threshold: envInt("WEBHOOK_ALERT_THRESHOLD", DEFAULT_THRESHOLD),
    windowMs: envInt("WEBHOOK_ALERT_WINDOW_MS", DEFAULT_WINDOW_MS),
    cooldownMs: envInt("WEBHOOK_ALERT_COOLDOWN_MS", DEFAULT_COOLDOWN_MS),
    notifyUrl: process.env.ADMIN_ALERT_WEBHOOK_URL || undefined,
  };
}

export interface WebhookRejectionRecord extends WebhookVerificationFailure {
  receivedAt: number;
}

export type WebhookAlertKind = "ip_burst" | "signature_pattern";

export interface WebhookAttackAlert {
  id: string;
  kind: WebhookAlertKind;
  ip: string;
  provider: string;
  count: number;
  windowMs: number;
  thresholdAtFire: number;
  firstSeenAt: string;
  lastSeenAt: string;
  sampleReason: string;
  /** For signature_pattern alerts: distinct IPs seen with this fingerprint. */
  distinctIps?: number;
  /** For signature_pattern alerts: the fingerprint key. */
  fingerprint?: string;
  notifyDelivered?: boolean;
  notifyError?: string;
}

interface BucketState {
  timestamps: number[];
  ips: string[];
  lastAlertAt: number;
  firstSeenAt: number;
  sampleReason: string;
}

const ipBuckets = new Map<string, BucketState>();
const patternBuckets = new Map<string, BucketState>();
const recentRejections: WebhookRejectionRecord[] = [];
const recentAlerts: WebhookAttackAlert[] = [];

function ipBucketKey(ip: string, provider: string): string {
  return `${ip}::${provider}`;
}

/**
 * Fingerprint a rejection for cross-IP "unknown signature pattern" detection.
 *
 * Same provider + same rejection reason + same signature-header shape +
 * same secret-configured state → likely the same broken/malicious caller
 * fanning out across IPs. Trim the reason so high-cardinality details
 * don't fragment the bucket.
 */
function patternFingerprint(failure: WebhookVerificationFailure): string {
  const reason = failure.reason.length > 80 ? failure.reason.slice(0, 80) : failure.reason;
  return [
    failure.provider,
    failure.hasSignatureHeader ? "sig" : "nosig",
    failure.secretConfigured ? "cfg" : "nocfg",
    reason,
  ].join("|");
}

function pruneBucket(b: BucketState, cutoff: number): void {
  let i = 0;
  while (i < b.timestamps.length && b.timestamps[i]! < cutoff) i++;
  if (i > 0) {
    b.timestamps.splice(0, i);
    b.ips.splice(0, i);
  }
}

function distinctCount(values: string[]): number {
  return new Set(values).size;
}

async function deliverNotification(
  url: string,
  alert: WebhookAttackAlert,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "webhook_attack_alert",
        alert,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Record a webhook rejection. If the rolling rejection count for the
 * (ip, provider) pair crosses the configured threshold within the window
 * (and we are outside the cooldown for that pair), emit a structured
 * `webhook_attack_alert` log event, append it to the in-memory alert
 * buffer for the admin dashboard, and optionally POST it to
 * `ADMIN_ALERT_WEBHOOK_URL`.
 */
function fireAlert(alert: WebhookAttackAlert, cfg: WebhookAlertConfig): void {
  logger.warn(
    { audit: "webhook_attack_alert", ...alert },
    `webhook_attack_alert kind=${alert.kind} provider=${alert.provider} ip=${alert.ip} count=${alert.count}`,
  );

  if (cfg.notifyUrl) {
    void deliverNotification(cfg.notifyUrl, alert).then((result) => {
      alert.notifyDelivered = result.ok;
      if (!result.ok) {
        alert.notifyError = result.error;
        logger.error(
          { alertId: alert.id, error: result.error },
          "Failed to deliver webhook attack alert notification",
        );
      }
    });
  }

  recentAlerts.push(alert);
  if (recentAlerts.length > MAX_ALERTS) {
    recentAlerts.splice(0, recentAlerts.length - MAX_ALERTS);
  }
}

function checkBucket(
  bucket: BucketState,
  failure: WebhookVerificationFailure,
  now: number,
  cfg: WebhookAlertConfig,
  kind: WebhookAlertKind,
  fingerprint?: string,
): WebhookAttackAlert | null {
  bucket.timestamps.push(now);
  bucket.ips.push(failure.ip);
  bucket.sampleReason = failure.reason;
  pruneBucket(bucket, now - cfg.windowMs);
  if (bucket.timestamps.length === 1) bucket.firstSeenAt = now;

  if (bucket.timestamps.length < cfg.threshold) return null;
  if (now - bucket.lastAlertAt < cfg.cooldownMs) return null;

  bucket.lastAlertAt = now;

  const alert: WebhookAttackAlert = {
    id: `${kind}::${fingerprint ?? `${failure.ip}::${failure.provider}`}::${now}`,
    kind,
    ip: failure.ip,
    provider: failure.provider,
    count: bucket.timestamps.length,
    windowMs: cfg.windowMs,
    thresholdAtFire: cfg.threshold,
    firstSeenAt: new Date(bucket.timestamps[0]!).toISOString(),
    lastSeenAt: new Date(now).toISOString(),
    sampleReason: bucket.sampleReason,
  };
  if (kind === "signature_pattern") {
    alert.distinctIps = distinctCount(bucket.ips);
    alert.fingerprint = fingerprint;
  }
  return alert;
}

/**
 * Record a webhook rejection and check both alert paths:
 *
 * 1. **ip_burst** — many rejections from the same `(ip, provider)` in
 *    the window. Catches a single attacker hammering one endpoint.
 * 2. **signature_pattern** — many rejections sharing the same provider +
 *    rejection reason + signature shape, regardless of source IP. Catches
 *    a botnet or fingerprint-spoofing tool fanning the same bad request
 *    across IPs (the "unknown signature pattern repeats" case).
 *
 * Either bucket crossing the configured threshold (subject to a cooldown)
 * emits a structured `webhook_attack_alert` log, appends to the in-memory
 * alert buffer, and optionally POSTs to `ADMIN_ALERT_WEBHOOK_URL`.
 */
export function recordWebhookRejection(
  failure: WebhookVerificationFailure,
): WebhookAttackAlert | null {
  const cfg = getAlertConfig();
  const now = Date.now();

  const record: WebhookRejectionRecord = { ...failure, receivedAt: now };
  recentRejections.push(record);
  if (recentRejections.length > MAX_REJECTIONS) {
    recentRejections.splice(0, recentRejections.length - MAX_REJECTIONS);
  }

  // (1) Per-IP burst bucket.
  const ipKey = ipBucketKey(failure.ip, failure.provider);
  let ipBucket = ipBuckets.get(ipKey);
  if (!ipBucket) {
    ipBucket = { timestamps: [], ips: [], lastAlertAt: 0, firstSeenAt: now, sampleReason: failure.reason };
    ipBuckets.set(ipKey, ipBucket);
  }
  const ipAlert = checkBucket(ipBucket, failure, now, cfg, "ip_burst");
  if (ipAlert) fireAlert(ipAlert, cfg);

  // (2) Cross-IP signature-pattern bucket.
  const fp = patternFingerprint(failure);
  let patternBucket = patternBuckets.get(fp);
  if (!patternBucket) {
    patternBucket = { timestamps: [], ips: [], lastAlertAt: 0, firstSeenAt: now, sampleReason: failure.reason };
    patternBuckets.set(fp, patternBucket);
  }
  const patternAlert = checkBucket(patternBucket, failure, now, cfg, "signature_pattern", fp);
  // Only treat a pattern alert as distinct from an IP burst when it spans
  // more than one source IP. A single noisy IP is already covered by (1).
  if (patternAlert && (patternAlert.distinctIps ?? 1) > 1) {
    fireAlert(patternAlert, cfg);
    return patternAlert;
  }

  return ipAlert;
}

export function getRecentRejections(limit = 100): WebhookRejectionRecord[] {
  const n = Math.min(Math.max(limit, 1), MAX_REJECTIONS);
  return recentRejections.slice(-n).reverse();
}

export function getRecentAlerts(limit = 50): WebhookAttackAlert[] {
  const n = Math.min(Math.max(limit, 1), MAX_ALERTS);
  return recentAlerts.slice(-n).reverse();
}

export interface WebhookRejectionSummary {
  totalRejections: number;
  totalAlerts: number;
  windowMs: number;
  threshold: number;
  cooldownMs: number;
  notifyConfigured: boolean;
  topOffenders: Array<{ ip: string; provider: string; count: number; lastSeenAt: string }>;
}

export function getRejectionSummary(): WebhookRejectionSummary {
  const cfg = getAlertConfig();
  const now = Date.now();
  const cutoff = now - cfg.windowMs;
  const counts = new Map<string, { ip: string; provider: string; count: number; lastSeenAt: number }>();
  for (const r of recentRejections) {
    if (r.receivedAt < cutoff) continue;
    const key = ipBucketKey(r.ip, r.provider);
    const entry = counts.get(key);
    if (entry) {
      entry.count += 1;
      if (r.receivedAt > entry.lastSeenAt) entry.lastSeenAt = r.receivedAt;
    } else {
      counts.set(key, { ip: r.ip, provider: r.provider, count: 1, lastSeenAt: r.receivedAt });
    }
  }
  const topOffenders = Array.from(counts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map((e) => ({
      ip: e.ip,
      provider: e.provider,
      count: e.count,
      lastSeenAt: new Date(e.lastSeenAt).toISOString(),
    }));
  return {
    totalRejections: recentRejections.length,
    totalAlerts: recentAlerts.length,
    windowMs: cfg.windowMs,
    threshold: cfg.threshold,
    cooldownMs: cfg.cooldownMs,
    notifyConfigured: !!cfg.notifyUrl,
    topOffenders,
  };
}

/** Test-only helper to clear in-memory state. */
export function _resetWebhookAlertsForTests(): void {
  ipBuckets.clear();
  patternBuckets.clear();
  recentRejections.length = 0;
  recentAlerts.length = 0;
}
