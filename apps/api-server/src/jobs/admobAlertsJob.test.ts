/**
 * Tests that the scheduled AdMob-alerts job evaluates staleness on its own
 * cadence — so an operator never has to be staring at the hub for an alert to
 * fire.
 *
 * The alert state-machine logic itself (firing/cooldown/resolve thresholds) is
 * covered by lib/admobAlerts.test.ts. This suite instead guards the *wiring*:
 *   - the job reads storage.getAdmobSnapshotSummary / getAdmobReconciliation /
 *     getAdmobLastSyncedAt and feeds evaluateAdmobAlerts the right input
 *     (configured flag, and reconciliation only when the summary has rows),
 *   - the job reads storage.getSsvHealthStats and feeds evaluateSsvAlerts the
 *     right input so the ssv_credit_stale alert fires on schedule without any
 *     admin viewing the hub,
 *   - a storage/DB error is caught and logged, never thrown out of the timer,
 *   - the advisory lock gates the work (a busy lock skips evaluation),
 *   - and end-to-end a stale lastSyncedAt drives the real admobAlerts state
 *     machine to record a firing stale_sync alert with no admin in the loop.
 *
 * revenue_divergence is intentionally disabled and never fires; those cases
 * are not tested here.
 *
 * Storage, config state, the advisory lock and the logger are mocked. The
 * admobAlerts module is partially mocked: evaluateAdmobAlerts is wrapped in a
 * spy that still delegates to the REAL implementation, so we can both assert the
 * input the job passed AND observe the genuine alert it produced.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const {
  getAdmobSnapshotSummary,
  getAdmobReconciliation,
  getAdmobLastSyncedAt,
  getSsvHealthStats,
  getAdMobConfigState,
  withAdvisoryLockMock,
  logger,
  evaluateSpy,
  evaluateSsvSpy,
} = vi.hoisted(() => ({
  getAdmobSnapshotSummary: vi.fn(),
  getAdmobReconciliation: vi.fn(),
  getAdmobLastSyncedAt: vi.fn(),
  getSsvHealthStats: vi.fn(),
  getAdMobConfigState: vi.fn(),
  withAdvisoryLockMock: vi.fn(
    async (_key: number, fn: () => Promise<void>) => {
      await fn();
      return true;
    },
  ),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  evaluateSpy: vi.fn(),
  evaluateSsvSpy: vi.fn(),
}));

vi.mock("../storage", () => ({
  storage: {
    getAdmobSnapshotSummary: (...args: unknown[]) => getAdmobSnapshotSummary(...args),
    getAdmobReconciliation: (...args: unknown[]) => getAdmobReconciliation(...args),
    getAdmobLastSyncedAt: (...args: unknown[]) => getAdmobLastSyncedAt(...args),
    getSsvHealthStats: (...args: unknown[]) => getSsvHealthStats(...args),
  },
}));

vi.mock("../lib/admobReporting", () => ({
  getAdMobConfigState: () => getAdMobConfigState(),
}));

vi.mock("../lib/advisoryLock", () => ({
  withAdvisoryLock: (key: number, fn: () => Promise<void>) =>
    withAdvisoryLockMock(key, fn),
}));

vi.mock("../lib/logger", () => ({ logger }));

// Wrap evaluateAdmobAlerts + evaluateSsvAlerts in spies but keep the REAL state
// machine + helpers, so assertions can inspect both the input the job passed AND
// the genuine alert it produced.
vi.mock("../lib/admobAlerts", async (importActual) => {
  const actual = await importActual<typeof import("../lib/admobAlerts")>();
  return {
    ...actual,
    evaluateAdmobAlerts: (input: import("../lib/admobAlerts").AdmobAlertInput) => {
      evaluateSpy(input);
      return actual.evaluateAdmobAlerts(input);
    },
    evaluateSsvAlerts: (input: import("../lib/admobAlerts").SsvAlertInput) => {
      evaluateSsvSpy(input);
      return actual.evaluateSsvAlerts(input);
    },
  };
});

import {
  getRecentAdmobAlerts,
  getRecentSsvAlerts,
  _resetAdmobAlertsForTests,
  _resetSsvAlertsForTests,
} from "../lib/admobAlerts";

let startAdmobAlertsJob: typeof import("./admobAlertsJob").startAdmobAlertsJob;

const HOUR = 60 * 60 * 1000;
const INITIAL_DELAY_MS = 90 * 1000;
const EVALUATE_INTERVAL_MS = 30 * 60 * 1000;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  _resetAdmobAlertsForTests();
  _resetSsvAlertsForTests();

  // Sensible defaults: configured, has rows, fresh sync, balanced revenue.
  getAdMobConfigState.mockReturnValue({ configured: true, missing: [] });
  getAdmobSnapshotSummary.mockResolvedValue({ rowCount: 5 });
  getAdmobReconciliation.mockResolvedValue({
    officialEarnings: 100,
    appReportedEarnings: 100,
    differenceAbs: 0,
    differencePct: 0,
    currency: "USD",
  });
  getAdmobLastSyncedAt.mockResolvedValue(new Date());
  // Default SSV: no activity today — staleAlert false.
  getSsvHealthStats.mockResolvedValue({
    ssvToday: 0,
    fallbackToday: 0,
    totalToday: 0,
    lastSsvAt: null,
    staleAlert: false,
  });

  process.env.ADMOB_ALERT_STALE_HOURS = "6";
  process.env.ADMOB_ALERT_DIVERGENCE_PCT = "25";
  process.env.ADMOB_ALERT_MIN_EARNINGS_USD = "1";
  process.env.ADMOB_ALERT_COOLDOWN_MS = String(6 * HOUR);
  delete process.env.ADMIN_ALERT_WEBHOOK_URL;

  ({ startAdmobAlertsJob } = await import("./admobAlertsJob"));
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("startAdmobAlertsJob", () => {
  it("does not evaluate before the initial boot delay elapses", async () => {
    startAdmobAlertsJob();
    await vi.advanceTimersByTimeAsync(INITIAL_DELAY_MS - 1000);
    expect(evaluateSpy).not.toHaveBeenCalled();
    expect(evaluateSsvSpy).not.toHaveBeenCalled();
  });

  it("reads the snapshot summary, reconciliation and last-synced time and passes them to evaluateAdmobAlerts", async () => {
    const lastSyncedAt = new Date();
    getAdmobLastSyncedAt.mockResolvedValue(lastSyncedAt);

    startAdmobAlertsJob();
    await vi.advanceTimersByTimeAsync(INITIAL_DELAY_MS);

    expect(getAdmobSnapshotSummary).toHaveBeenCalledWith(30);
    expect(getAdmobReconciliation).toHaveBeenCalledWith(30);
    expect(getAdmobLastSyncedAt).toHaveBeenCalledTimes(1);

    expect(evaluateSpy).toHaveBeenCalledTimes(1);
    expect(evaluateSpy).toHaveBeenCalledWith({
      configured: true,
      lastSyncedAt,
      reconciliation: {
        officialEarnings: 100,
        appReportedEarnings: 100,
        differenceAbs: 0,
        differencePct: 0,
        currency: "USD",
      },
    });
  });

  it("calls getSsvHealthStats and passes its output to evaluateSsvAlerts", async () => {
    const ssvStats = {
      ssvToday: 5,
      fallbackToday: 0,
      totalToday: 5,
      lastSsvAt: new Date().toISOString(),
      staleAlert: false,
    };
    getSsvHealthStats.mockResolvedValue(ssvStats);

    startAdmobAlertsJob();
    await vi.advanceTimersByTimeAsync(INITIAL_DELAY_MS);

    expect(getSsvHealthStats).toHaveBeenCalledTimes(1);
    expect(evaluateSsvSpy).toHaveBeenCalledTimes(1);
    expect(evaluateSsvSpy).toHaveBeenCalledWith({
      staleAlert: false,
      totalToday: 5,
      lastSsvAt: ssvStats.lastSsvAt,
    });
  });

  it("passes the configured flag straight through from getAdMobConfigState", async () => {
    getAdMobConfigState.mockReturnValue({ configured: false, missing: ["X"] });

    startAdmobAlertsJob();
    await vi.advanceTimersByTimeAsync(INITIAL_DELAY_MS);

    expect(evaluateSpy).toHaveBeenCalledTimes(1);
    expect(evaluateSpy.mock.calls[0][0]).toMatchObject({ configured: false });
  });

  it("passes reconciliation only when the summary has rows (rowCount > 0)", async () => {
    getAdmobSnapshotSummary.mockResolvedValue({ rowCount: 0 });

    startAdmobAlertsJob();
    await vi.advanceTimersByTimeAsync(INITIAL_DELAY_MS);

    expect(evaluateSpy).toHaveBeenCalledTimes(1);
    expect(evaluateSpy.mock.calls[0][0]).toMatchObject({ reconciliation: null });
  });

  it("keeps re-evaluating on its interval after the first run", async () => {
    startAdmobAlertsJob();
    await vi.advanceTimersByTimeAsync(INITIAL_DELAY_MS);
    expect(evaluateSpy).toHaveBeenCalledTimes(1);
    expect(evaluateSsvSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(EVALUATE_INTERVAL_MS * 2);
    expect(evaluateSpy).toHaveBeenCalledTimes(3);
    expect(evaluateSsvSpy).toHaveBeenCalledTimes(3);
  });

  it("fires a stale_sync alert through the real state machine when the last sync is too old", async () => {
    // No admin watching — the job alone must surface this.
    getAdmobLastSyncedAt.mockResolvedValue(new Date(Date.now() - 8 * HOUR));
    getAdmobSnapshotSummary.mockResolvedValue({ rowCount: 0 });

    startAdmobAlertsJob();
    await vi.advanceTimersByTimeAsync(INITIAL_DELAY_MS);

    const stale = getRecentAdmobAlerts().find((a) => a.condition === "stale_sync");
    expect(stale).toBeTruthy();
    expect(stale!.status).toBe("firing");
    expect(stale!.threshold).toBe(6 * HOUR);
  });

  it("does not fire a stale_sync alert when the last sync is fresh", async () => {
    getAdmobLastSyncedAt.mockResolvedValue(new Date(Date.now() - 1 * HOUR));

    startAdmobAlertsJob();
    await vi.advanceTimersByTimeAsync(INITIAL_DELAY_MS);

    expect(
      getRecentAdmobAlerts().some((a) => a.condition === "stale_sync"),
    ).toBe(false);
  });

  it("never fires a revenue_divergence alert regardless of reconciliation data", async () => {
    getAdmobReconciliation.mockResolvedValue({
      officialEarnings: 100,
      appReportedEarnings: 50,
      differenceAbs: 50,
      differencePct: 50,
      currency: "USD",
    });
    getAdmobSnapshotSummary.mockResolvedValue({ rowCount: 5 });

    startAdmobAlertsJob();
    await vi.advanceTimersByTimeAsync(INITIAL_DELAY_MS);

    expect(
      getRecentAdmobAlerts().some((a) => a.condition === "revenue_divergence"),
    ).toBe(false);
  });

  it("resolves a stale_sync alert automatically when the sync comes back fresh", async () => {
    // Run 1: last sync is too old — a firing stale_sync alert must be recorded.
    getAdmobLastSyncedAt.mockResolvedValue(new Date(Date.now() - 8 * HOUR));
    getAdmobSnapshotSummary.mockResolvedValue({ rowCount: 0 });

    startAdmobAlertsJob();
    await vi.advanceTimersByTimeAsync(INITIAL_DELAY_MS);

    const firing = getRecentAdmobAlerts().find(
      (a) => a.condition === "stale_sync" && a.status === "firing",
    );
    expect(firing).toBeTruthy();

    // Run 2: sync is now fresh — the state machine must emit a resolved alert.
    getAdmobLastSyncedAt.mockResolvedValue(new Date(Date.now() - 1 * HOUR));

    await vi.advanceTimersByTimeAsync(EVALUATE_INTERVAL_MS);

    const resolved = getRecentAdmobAlerts().find(
      (a) => a.condition === "stale_sync" && a.status === "resolved",
    );
    expect(resolved).toBeTruthy();
    expect(resolved!.threshold).toBe(6 * HOUR);
  });

  it("fires an ssv_credit_stale alert when staleAlert is true (AD_ADMOB_NATIVE=true)", async () => {
    process.env.AD_ADMOB_NATIVE = "true";
    try {
      getSsvHealthStats.mockResolvedValue({
        ssvToday: 0,
        fallbackToday: 3,
        totalToday: 3,
        lastSsvAt: null,
        staleAlert: true,
      });

      startAdmobAlertsJob();
      await vi.advanceTimersByTimeAsync(INITIAL_DELAY_MS);

      const alert = getRecentSsvAlerts().find((a) => a.condition === "ssv_credit_stale");
      expect(alert).toBeTruthy();
      expect(alert!.status).toBe("firing");
      expect(alert!.detail).toMatchObject({ staleAlert: true, totalToday: 3 });
    } finally {
      delete process.env.AD_ADMOB_NATIVE;
    }
  });

  it("does not fire an ssv_credit_stale alert when staleAlert is false", async () => {
    getSsvHealthStats.mockResolvedValue({
      ssvToday: 5,
      fallbackToday: 0,
      totalToday: 5,
      lastSsvAt: new Date().toISOString(),
      staleAlert: false,
    });

    startAdmobAlertsJob();
    await vi.advanceTimersByTimeAsync(INITIAL_DELAY_MS);

    expect(getRecentSsvAlerts().length).toBe(0);
  });

  it("does not fire an ssv_credit_stale alert when AD_ADMOB_NATIVE is not set", async () => {
    delete process.env.AD_ADMOB_NATIVE;
    getSsvHealthStats.mockResolvedValue({
      ssvToday: 0,
      fallbackToday: 5,
      totalToday: 5,
      lastSsvAt: null,
      staleAlert: true,
    });

    startAdmobAlertsJob();
    await vi.advanceTimersByTimeAsync(INITIAL_DELAY_MS);

    // evaluateSsvAlerts is gated on AD_ADMOB_NATIVE — no alert without it.
    expect(getRecentSsvAlerts().length).toBe(0);
  });

  it("resolves an ssv_credit_stale alert when SSV credits resume", async () => {
    process.env.AD_ADMOB_NATIVE = "true";
    try {
      // Run 1: stale → fires alert
      getSsvHealthStats.mockResolvedValue({
        ssvToday: 0,
        fallbackToday: 2,
        totalToday: 2,
        lastSsvAt: null,
        staleAlert: true,
      });

      startAdmobAlertsJob();
      await vi.advanceTimersByTimeAsync(INITIAL_DELAY_MS);

      const firing = getRecentSsvAlerts().find(
        (a) => a.condition === "ssv_credit_stale" && a.status === "firing",
      );
      expect(firing).toBeTruthy();

      // Run 2: fresh SSV credits → state machine must emit a resolved alert
      getSsvHealthStats.mockResolvedValue({
        ssvToday: 4,
        fallbackToday: 0,
        totalToday: 4,
        lastSsvAt: new Date().toISOString(),
        staleAlert: false,
      });

      await vi.advanceTimersByTimeAsync(EVALUATE_INTERVAL_MS);

      const resolved = getRecentSsvAlerts().find(
        (a) => a.condition === "ssv_credit_stale" && a.status === "resolved",
      );
      expect(resolved).toBeTruthy();
    } finally {
      delete process.env.AD_ADMOB_NATIVE;
    }
  });

  it("catches a storage/DB error, logs it, and never throws out of the timer", async () => {
    getAdmobSnapshotSummary.mockRejectedValue(new Error("db blip"));

    startAdmobAlertsJob();
    await expect(
      vi.advanceTimersByTimeAsync(INITIAL_DELAY_MS),
    ).resolves.not.toThrow();

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining("evaluation failed"),
    );
    // A failed run must not leave any alert recorded and must not block the
    // next interval from running.
    expect(getRecentAdmobAlerts().length).toBe(0);

    getAdmobSnapshotSummary.mockResolvedValue({ rowCount: 5 });
    await vi.advanceTimersByTimeAsync(EVALUATE_INTERVAL_MS);
    expect(evaluateSpy).toHaveBeenCalled();
  });

  it("skips evaluation (and logs) when another replica holds the advisory lock", async () => {
    withAdvisoryLockMock.mockImplementationOnce(async () => false);

    startAdmobAlertsJob();
    await vi.advanceTimersByTimeAsync(INITIAL_DELAY_MS);

    expect(evaluateSpy).not.toHaveBeenCalled();
    expect(evaluateSsvSpy).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining("another replica holds the lock"),
    );
  });
});
