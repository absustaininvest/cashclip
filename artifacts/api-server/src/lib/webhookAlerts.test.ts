import { describe, it, expect, beforeEach } from "vitest";
import {
  recordWebhookRejection,
  getRecentRejections,
  getRecentAlerts,
  getRejectionSummary,
  _resetWebhookAlertsForTests,
  type WebhookVerificationFailure,
} from "./webhookAlerts";

function makeFailure(overrides: Partial<WebhookVerificationFailure> = {}): WebhookVerificationFailure {
  return {
    provider: "pollfish",
    reason: "Invalid signature",
    ip: "1.2.3.4",
    method: "POST",
    path: "/api/surveys/webhook/pollfish",
    hasSignatureHeader: true,
    secretConfigured: true,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe("webhookAlerts", () => {
  beforeEach(() => {
    _resetWebhookAlertsForTests();
    process.env.WEBHOOK_ALERT_THRESHOLD = "5";
    process.env.WEBHOOK_ALERT_WINDOW_MS = "60000";
    process.env.WEBHOOK_ALERT_COOLDOWN_MS = "60000";
    delete process.env.ADMIN_ALERT_WEBHOOK_URL;
  });

  it("records rejections without firing an alert below the threshold", () => {
    for (let i = 0; i < 4; i++) {
      const result = recordWebhookRejection(makeFailure());
      expect(result).toBeNull();
    }
    expect(getRecentRejections().length).toBe(4);
    expect(getRecentAlerts().length).toBe(0);
  });

  it("fires an ip_burst alert once the threshold is crossed", () => {
    let alert = null;
    for (let i = 0; i < 5; i++) {
      alert = recordWebhookRejection(makeFailure({ reason: `bad-sig-${i}` }));
    }
    expect(alert).not.toBeNull();
    expect(alert!.kind).toBe("ip_burst");
    expect(alert!.ip).toBe("1.2.3.4");
    expect(alert!.provider).toBe("pollfish");
    expect(alert!.count).toBe(5);
    expect(alert!.thresholdAtFire).toBe(5);
    expect(alert!.sampleReason).toBe("bad-sig-4");
    expect(getRecentAlerts().length).toBe(1);
  });

  it("respects the cooldown so it does not double-alert", () => {
    for (let i = 0; i < 5; i++) recordWebhookRejection(makeFailure());
    expect(getRecentAlerts().length).toBe(1);
    // Fire many more — still within cooldown so no new alerts
    for (let i = 0; i < 10; i++) recordWebhookRejection(makeFailure());
    expect(getRecentAlerts().length).toBe(1);
  });

  it("tracks each (ip, provider) bucket independently", () => {
    for (let i = 0; i < 5; i++) recordWebhookRejection(makeFailure({ ip: "1.1.1.1" }));
    for (let i = 0; i < 4; i++) recordWebhookRejection(makeFailure({ ip: "2.2.2.2" }));
    const alerts = getRecentAlerts();
    expect(alerts.length).toBe(1);
    expect(alerts[0]!.ip).toBe("1.1.1.1");
  });

  it("fires a signature_pattern alert when the same fingerprint repeats across IPs", () => {
    let alert = null;
    for (let i = 0; i < 5; i++) {
      alert = recordWebhookRejection(makeFailure({
        ip: `10.0.0.${i + 1}`,
        reason: "Invalid provider-specific signature for pollfish",
      }));
    }
    const alerts = getRecentAlerts();
    // No single IP crossed threshold, so the only alert should be a pattern alert.
    expect(alerts.length).toBe(1);
    expect(alerts[0]!.kind).toBe("signature_pattern");
    expect(alerts[0]!.distinctIps).toBe(5);
    expect(alerts[0]!.fingerprint).toContain("pollfish");
    expect(alerts[0]!.count).toBe(5);
    expect(alert!.kind).toBe("signature_pattern");
  });

  it("does not fire a signature_pattern alert when only one IP is involved", () => {
    for (let i = 0; i < 5; i++) {
      recordWebhookRejection(makeFailure({ reason: "same-reason" }));
    }
    const alerts = getRecentAlerts();
    // Only the ip_burst alert fires; pattern bucket has distinctIps=1 → suppressed.
    expect(alerts.length).toBe(1);
    expect(alerts[0]!.kind).toBe("ip_burst");
  });

  it("includes the fields downstream notification channels need", () => {
    for (let i = 0; i < 5; i++) {
      recordWebhookRejection(makeFailure({ reason: "bad" }));
    }
    const alert = getRecentAlerts()[0]!;
    expect(alert.id).toMatch(/^ip_burst::/);
    expect(typeof alert.firstSeenAt).toBe("string");
    expect(typeof alert.lastSeenAt).toBe("string");
    expect(alert.windowMs).toBeGreaterThan(0);
    expect(alert.thresholdAtFire).toBeGreaterThan(0);
    expect(alert.sampleReason).toBe("bad");
    expect(alert.provider).toBe("pollfish");
    expect(alert.ip).toBe("1.2.3.4");
  });

  it("summary reports top offenders sorted by count", () => {
    for (let i = 0; i < 3; i++) recordWebhookRejection(makeFailure({ ip: "1.1.1.1", provider: "cint" }));
    for (let i = 0; i < 6; i++) recordWebhookRejection(makeFailure({ ip: "9.9.9.9", provider: "tapjoy" }));
    const summary = getRejectionSummary();
    expect(summary.totalRejections).toBe(9);
    expect(summary.topOffenders[0]!.ip).toBe("9.9.9.9");
    expect(summary.topOffenders[0]!.provider).toBe("tapjoy");
    expect(summary.topOffenders[0]!.count).toBe(6);
    expect(summary.topOffenders[1]!.ip).toBe("1.1.1.1");
    expect(summary.notifyConfigured).toBe(false);
  });
});
