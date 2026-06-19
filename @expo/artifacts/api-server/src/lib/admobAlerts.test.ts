/**
 * Unit tests for the AdMob reporting operator alerts.
 *
 * Covered:
 *   - stale_sync fires when no fresh snapshot has synced within the window
 *     (and never when AdMob is unconfigured — "no data" is expected then).
 *   - De-dup / rate-limit: a sustained stale_sync condition re-alerts at most
 *     once per cooldown.
 *   - Resolve: a single `resolved` event is emitted when stale_sync clears.
 *   - revenue_divergence is suppressed pre-cutover (ADMOB_MIRROR_EXPECTED_ACTIVE
 *     unset/false) and fires post-cutover when divergence exceeds the threshold,
 *     including the $0 app-reported / positive-official case.
 *
 * Pure in-memory; no DB. The notification POST path is disabled (no
 * ADMIN_ALERT_WEBHOOK_URL) so nothing leaves the process.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  evaluateAdmobAlerts,
  getRecentAdmobAlerts,
  isAdmobMirrorExpectedActive,
  recordSsvMissingUserId,
  getSsvMissingUserIdStats,
  _resetAdmobAlertsForTests,
  type AdmobReconciliationInput,
} from "./admobAlerts";

const HOUR = 60 * 60 * 1000;

function recon(overrides: Partial<AdmobReconciliationInput> = {}): AdmobReconciliationInput {
  return {
    officialEarnings: 100,
    appReportedEarnings: 100,
    differenceAbs: 0,
    differencePct: 0,
    currency: "USD",
    ...overrides,
  };
}

describe("admobAlerts", () => {
  beforeEach(() => {
    _resetAdmobAlertsForTests();
    process.env.ADMOB_ALERT_STALE_HOURS = "6";
    process.env.ADMOB_ALERT_DIVERGENCE_PCT = "25";
    process.env.ADMOB_ALERT_MIN_EARNINGS_USD = "1";
    process.env.ADMOB_ALERT_COOLDOWN_MS = String(6 * HOUR);
    delete process.env.ADMIN_ALERT_WEBHOOK_URL;
  });

  describe("stale_sync", () => {
    it("does not fire while the last sync is fresh", () => {
      const now = Date.now();
      const fired = evaluateAdmobAlerts({
        configured: true,
        lastSyncedAt: new Date(now - 1 * HOUR),
        reconciliation: recon(),
        now,
      });
      expect(fired.some((a) => a.condition === "stale_sync")).toBe(false);
    });

    it("fires once the last sync exceeds the window", () => {
      const now = Date.now();
      const fired = evaluateAdmobAlerts({
        configured: true,
        lastSyncedAt: new Date(now - 7 * HOUR),
        reconciliation: recon(),
        now,
      });
      const stale = fired.find((a) => a.condition === "stale_sync");
      expect(stale).toBeTruthy();
      expect(stale!.status).toBe("firing");
      expect(stale!.threshold).toBe(6 * HOUR);
    });

    it("fires when AdMob has never synced (lastSyncedAt null)", () => {
      const now = Date.now();
      const fired = evaluateAdmobAlerts({
        configured: true,
        lastSyncedAt: null,
        reconciliation: null,
        now,
      });
      const stale = fired.find((a) => a.condition === "stale_sync");
      expect(stale).toBeTruthy();
      expect(stale!.message).toMatch(/never synced/i);
    });

    it("never fires when AdMob is not configured", () => {
      const now = Date.now();
      const fired = evaluateAdmobAlerts({
        configured: false,
        lastSyncedAt: null,
        reconciliation: null,
        now,
      });
      expect(fired.some((a) => a.condition === "stale_sync")).toBe(false);
      expect(getRecentAdmobAlerts().length).toBe(0);
    });
  });

  describe("revenue_divergence — pre-cutover suppression", () => {
    beforeEach(() => {
      delete process.env.ADMOB_MIRROR_EXPECTED_ACTIVE;
    });

    it("never fires even when divergence far exceeds the threshold (flag unset)", () => {
      const now = Date.now();
      const fired = evaluateAdmobAlerts({
        configured: true,
        lastSyncedAt: new Date(now),
        reconciliation: recon({
          officialEarnings: 100,
          appReportedEarnings: 60,
          differenceAbs: 40,
          differencePct: 40,
        }),
        now,
      });
      expect(fired.some((a) => a.condition === "revenue_divergence")).toBe(false);
    });

    it("never fires even when app-reported is $0 and official is positive (flag unset)", () => {
      const now = Date.now();
      const fired = evaluateAdmobAlerts({
        configured: true,
        lastSyncedAt: new Date(now),
        reconciliation: recon({
          officialEarnings: 100,
          appReportedEarnings: 0,
          differenceAbs: 100,
          differencePct: 100,
        }),
        now,
      });
      expect(fired.some((a) => a.condition === "revenue_divergence")).toBe(false);
    });

    it("never fires when flag is explicitly false", () => {
      process.env.ADMOB_MIRROR_EXPECTED_ACTIVE = "false";
      const now = Date.now();
      const fired = evaluateAdmobAlerts({
        configured: true,
        lastSyncedAt: new Date(now),
        reconciliation: recon({
          officialEarnings: 100,
          appReportedEarnings: 0,
          differenceAbs: 100,
          differencePct: 100,
        }),
        now,
      });
      expect(fired.some((a) => a.condition === "revenue_divergence")).toBe(false);
    });
  });

  describe("revenue_divergence — post-cutover firing", () => {
    beforeEach(() => {
      process.env.ADMOB_MIRROR_EXPECTED_ACTIVE = "1";
    });
    afterEach(() => {
      delete process.env.ADMOB_MIRROR_EXPECTED_ACTIVE;
    });

    it("fires when app-reported is $0 and official earnings exceed the noise floor", () => {
      const now = Date.now();
      const fired = evaluateAdmobAlerts({
        configured: true,
        lastSyncedAt: new Date(now),
        reconciliation: recon({
          officialEarnings: 10,
          appReportedEarnings: 0,
          differenceAbs: 10,
          differencePct: 100,
        }),
        now,
      });
      const alert = fired.find((a) => a.condition === "revenue_divergence");
      expect(alert).toBeTruthy();
      expect(alert!.status).toBe("firing");
      expect(alert!.message).toMatch(/\$0 app-reported/i);
      expect(alert!.detail.appReportedEarnings).toBe(0);
      expect(alert!.detail.officialEarnings).toBe(10);
    });

    it("fires when divergence exceeds the threshold (non-zero but below official)", () => {
      const now = Date.now();
      const fired = evaluateAdmobAlerts({
        configured: true,
        lastSyncedAt: new Date(now),
        reconciliation: recon({
          officialEarnings: 100,
          appReportedEarnings: 60,
          differenceAbs: 40,
          differencePct: 40,
        }),
        now,
      });
      const alert = fired.find((a) => a.condition === "revenue_divergence");
      expect(alert).toBeTruthy();
      expect(alert!.status).toBe("firing");
      expect(alert!.message).toMatch(/divergence/i);
      expect(alert!.threshold).toBe(25);
    });

    it("does not fire when divergence is within the threshold", () => {
      const now = Date.now();
      const fired = evaluateAdmobAlerts({
        configured: true,
        lastSyncedAt: new Date(now),
        reconciliation: recon({
          officialEarnings: 100,
          appReportedEarnings: 90,
          differenceAbs: 10,
          differencePct: 10,
        }),
        now,
      });
      expect(fired.some((a) => a.condition === "revenue_divergence")).toBe(false);
    });

    it("does not fire when official earnings are below the noise floor", () => {
      const now = Date.now();
      const fired = evaluateAdmobAlerts({
        configured: true,
        lastSyncedAt: new Date(now),
        reconciliation: recon({
          officialEarnings: 0.5,
          appReportedEarnings: 0,
          differenceAbs: 0.5,
          differencePct: 100,
        }),
        now,
      });
      expect(fired.some((a) => a.condition === "revenue_divergence")).toBe(false);
    });

    it("does not re-fire inside the cooldown window", () => {
      const t0 = Date.now();
      const first = evaluateAdmobAlerts({
        configured: true,
        lastSyncedAt: new Date(t0),
        reconciliation: recon({ officialEarnings: 10, appReportedEarnings: 0, differenceAbs: 10, differencePct: 100 }),
        now: t0,
      });
      expect(first.filter((a) => a.condition === "revenue_divergence").length).toBe(1);

      const second = evaluateAdmobAlerts({
        configured: true,
        lastSyncedAt: new Date(t0),
        reconciliation: recon({ officialEarnings: 10, appReportedEarnings: 0, differenceAbs: 10, differencePct: 100 }),
        now: t0 + HOUR,
      });
      expect(second.some((a) => a.condition === "revenue_divergence")).toBe(false);
    });

    it("resolves when divergence clears after cutover", () => {
      const t0 = Date.now();
      evaluateAdmobAlerts({
        configured: true,
        lastSyncedAt: new Date(t0),
        reconciliation: recon({ officialEarnings: 10, appReportedEarnings: 0, differenceAbs: 10, differencePct: 100 }),
        now: t0,
      });
      const t1 = t0 + HOUR;
      const fired = evaluateAdmobAlerts({
        configured: true,
        lastSyncedAt: new Date(t1),
        reconciliation: recon({ officialEarnings: 10, appReportedEarnings: 10, differenceAbs: 0, differencePct: 0 }),
        now: t1,
      });
      const resolved = fired.find((a) => a.condition === "revenue_divergence");
      expect(resolved).toBeTruthy();
      expect(resolved!.status).toBe("resolved");
      expect(resolved!.message).toMatch(/cleared/i);
    });

    it("does not fire when reconciliation is null", () => {
      const now = Date.now();
      const fired = evaluateAdmobAlerts({
        configured: true,
        lastSyncedAt: new Date(now),
        reconciliation: null,
        now,
      });
      expect(fired.some((a) => a.condition === "revenue_divergence")).toBe(false);
    });
  });

  describe("de-dup / rate-limit", () => {
    it("does not re-fire a sustained stale_sync inside the cooldown", () => {
      const t0 = Date.now();
      const first = evaluateAdmobAlerts({
        configured: true,
        lastSyncedAt: new Date(t0 - 8 * HOUR),
        reconciliation: null,
        now: t0,
      });
      expect(first.filter((a) => a.condition === "stale_sync").length).toBe(1);

      // 1h later, still stale, still inside the 6h cooldown → suppressed.
      const second = evaluateAdmobAlerts({
        configured: true,
        lastSyncedAt: new Date(t0 - 8 * HOUR),
        reconciliation: null,
        now: t0 + HOUR,
      });
      expect(second.some((a) => a.condition === "stale_sync")).toBe(false);

      // Only one stale_sync alert recorded total.
      expect(getRecentAdmobAlerts().filter((a) => a.condition === "stale_sync").length).toBe(1);
    });

    it("re-fires stale_sync once the cooldown elapses while still active", () => {
      const t0 = Date.now();
      evaluateAdmobAlerts({
        configured: true,
        lastSyncedAt: new Date(t0 - 8 * HOUR),
        reconciliation: null,
        now: t0,
      });

      const later = t0 + 7 * HOUR; // past the 6h cooldown
      const reFired = evaluateAdmobAlerts({
        configured: true,
        lastSyncedAt: new Date(t0 - 8 * HOUR),
        reconciliation: null,
        now: later,
      });
      expect(reFired.filter((a) => a.condition === "stale_sync" && a.status === "firing").length).toBe(1);
      expect(getRecentAdmobAlerts().filter((a) => a.condition === "stale_sync").length).toBe(2);
    });
  });

  describe("resolve", () => {
    it("resolves a stale_sync alert when a fresh sync arrives", () => {
      const t0 = Date.now();
      evaluateAdmobAlerts({ configured: true, lastSyncedAt: new Date(t0 - 8 * HOUR), reconciliation: null, now: t0 });
      const t1 = t0 + HOUR;
      const fired = evaluateAdmobAlerts({ configured: true, lastSyncedAt: new Date(t1), reconciliation: null, now: t1 });
      const resolved = fired.find((a) => a.condition === "stale_sync");
      expect(resolved).toBeTruthy();
      expect(resolved!.status).toBe("resolved");
    });
  });

  describe("ssvMissingUserId counter", () => {
    it("starts at zero with no lastSeenAt", () => {
      const stats = getSsvMissingUserIdStats();
      expect(stats.count).toBe(0);
      expect(stats.lastSeenAt).toBeNull();
    });

    it("increments count on each call to recordSsvMissingUserId", () => {
      recordSsvMissingUserId();
      expect(getSsvMissingUserIdStats().count).toBe(1);
      recordSsvMissingUserId();
      expect(getSsvMissingUserIdStats().count).toBe(2);
    });

    it("records a lastSeenAt timestamp after the first call", () => {
      const before = new Date().toISOString();
      recordSsvMissingUserId();
      const after = new Date().toISOString();
      const { lastSeenAt } = getSsvMissingUserIdStats();
      expect(lastSeenAt).not.toBeNull();
      expect(lastSeenAt! >= before).toBe(true);
      expect(lastSeenAt! <= after).toBe(true);
    });

    it("returns a snapshot (mutation does not affect the stored state)", () => {
      recordSsvMissingUserId();
      const snap = getSsvMissingUserIdStats();
      snap.count = 999;
      expect(getSsvMissingUserIdStats().count).toBe(1);
    });

    it("_resetAdmobAlertsForTests resets the counter back to zero", () => {
      recordSsvMissingUserId();
      recordSsvMissingUserId();
      _resetAdmobAlertsForTests();
      const stats = getSsvMissingUserIdStats();
      expect(stats.count).toBe(0);
      expect(stats.lastSeenAt).toBeNull();
    });
  });

  describe("isAdmobMirrorExpectedActive", () => {
    const KEY = "ADMOB_MIRROR_EXPECTED_ACTIVE";
    beforeEach(() => {
      delete process.env[KEY];
    });

    it("defaults to false (pre-cutover) when the flag is unset", () => {
      expect(isAdmobMirrorExpectedActive()).toBe(false);
    });

    it.each(["1", "true", "yes", "on", "TRUE", " on "])(
      "is true when the flag is a truthy value (%s)",
      (value) => {
        process.env[KEY] = value;
        expect(isAdmobMirrorExpectedActive()).toBe(true);
      },
    );

    it.each(["0", "false", "no", "off", ""])(
      "stays false for a non-truthy value (%s)",
      (value) => {
        process.env[KEY] = value;
        expect(isAdmobMirrorExpectedActive()).toBe(false);
      },
    );
  });
});
