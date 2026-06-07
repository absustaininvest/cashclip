/**
 * Unit tests for the AdMob reporting operator alerts (Task #393).
 *
 * Covered:
 *   - stale_sync fires when no fresh snapshot has synced within the window
 *     (and never when AdMob is unconfigured — "no data" is expected then).
 *   - revenue_divergence fires when official vs app-reported diverges beyond
 *     the configured percentage, and is suppressed below the min-earnings floor
 *     and when the percentage is undefined (divide-by-zero on official = 0).
 *   - De-dup / rate-limit: a sustained condition re-alerts at most once per
 *     cooldown.
 *   - Resolve: a single `resolved` event is emitted when the condition clears.
 *
 * Pure in-memory; no DB. The notification POST path is disabled (no
 * ADMIN_ALERT_WEBHOOK_URL) so nothing leaves the process.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  evaluateAdmobAlerts,
  getRecentAdmobAlerts,
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

  describe("revenue_divergence", () => {
    it("fires when divergence exceeds the threshold", () => {
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
      const div = fired.find((a) => a.condition === "revenue_divergence");
      expect(div).toBeTruthy();
      expect(div!.status).toBe("firing");
      expect(div!.threshold).toBe(25);
      expect(div!.detail.differencePct).toBe(40);
    });

    it("does not fire when divergence is within threshold", () => {
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

    it("is suppressed below the min-earnings floor (noisy small numbers)", () => {
      const now = Date.now();
      const fired = evaluateAdmobAlerts({
        configured: true,
        lastSyncedAt: new Date(now),
        reconciliation: recon({
          officialEarnings: 0.5, // below the $1 floor
          appReportedEarnings: 0.1,
          differenceAbs: 0.4,
          differencePct: 80,
        }),
        now,
      });
      expect(fired.some((a) => a.condition === "revenue_divergence")).toBe(false);
    });

    it("is suppressed when the percentage is undefined (official earnings 0)", () => {
      const now = Date.now();
      const fired = evaluateAdmobAlerts({
        configured: true,
        lastSyncedAt: new Date(now),
        reconciliation: recon({
          officialEarnings: 0,
          appReportedEarnings: 3,
          differenceAbs: -3,
          differencePct: null,
        }),
        now,
      });
      expect(fired.some((a) => a.condition === "revenue_divergence")).toBe(false);
    });
  });

  describe("de-dup / rate-limit", () => {
    it("does not re-fire a sustained condition inside the cooldown", () => {
      const t0 = Date.now();
      const div = recon({ officialEarnings: 100, appReportedEarnings: 50, differenceAbs: 50, differencePct: 50 });
      const first = evaluateAdmobAlerts({ configured: true, lastSyncedAt: new Date(t0), reconciliation: div, now: t0 });
      expect(first.filter((a) => a.condition === "revenue_divergence").length).toBe(1);

      // 1h later, still diverged, still inside the 6h cooldown → suppressed.
      const second = evaluateAdmobAlerts({
        configured: true,
        lastSyncedAt: new Date(t0 + HOUR),
        reconciliation: div,
        now: t0 + HOUR,
      });
      expect(second.some((a) => a.condition === "revenue_divergence")).toBe(false);

      // Only one divergence alert recorded total.
      expect(getRecentAdmobAlerts().filter((a) => a.condition === "revenue_divergence").length).toBe(1);
    });

    it("re-fires once the cooldown elapses while still active", () => {
      const t0 = Date.now();
      const div = recon({ officialEarnings: 100, appReportedEarnings: 50, differenceAbs: 50, differencePct: 50 });
      evaluateAdmobAlerts({ configured: true, lastSyncedAt: new Date(t0), reconciliation: div, now: t0 });

      const later = t0 + 7 * HOUR; // past the 6h cooldown
      const reFired = evaluateAdmobAlerts({
        configured: true,
        lastSyncedAt: new Date(later),
        reconciliation: div,
        now: later,
      });
      expect(reFired.filter((a) => a.condition === "revenue_divergence" && a.status === "firing").length).toBe(1);
      expect(getRecentAdmobAlerts().filter((a) => a.condition === "revenue_divergence").length).toBe(2);
    });
  });

  describe("resolve", () => {
    it("emits a single resolved event when divergence clears", () => {
      const t0 = Date.now();
      const diverged = recon({ officialEarnings: 100, appReportedEarnings: 50, differenceAbs: 50, differencePct: 50 });
      evaluateAdmobAlerts({ configured: true, lastSyncedAt: new Date(t0), reconciliation: diverged, now: t0 });

      // Now back within threshold.
      const cleared = recon({ officialEarnings: 100, appReportedEarnings: 98, differenceAbs: 2, differencePct: 2 });
      const t1 = t0 + HOUR;
      const fired = evaluateAdmobAlerts({ configured: true, lastSyncedAt: new Date(t1), reconciliation: cleared, now: t1 });
      const resolved = fired.find((a) => a.condition === "revenue_divergence");
      expect(resolved).toBeTruthy();
      expect(resolved!.status).toBe("resolved");

      // Re-evaluating while clear emits nothing further.
      const t2 = t1 + HOUR;
      const again = evaluateAdmobAlerts({ configured: true, lastSyncedAt: new Date(t2), reconciliation: cleared, now: t2 });
      expect(again.some((a) => a.condition === "revenue_divergence")).toBe(false);
    });

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
});
