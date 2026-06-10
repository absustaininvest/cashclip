/**
 * Tests that the scheduled AdMob-alerts job evaluates staleness / divergence on
 * its own cadence — so an operator never has to be staring at the hub for an
 * alert to fire (Task #397).
 *
 * The alert state-machine logic itself (firing/cooldown/resolve thresholds) is
 * covered by lib/admobAlerts.test.ts. This suite instead guards the *wiring*:
 *   - the job reads storage.getAdmobSnapshotSummary / getAdmobReconciliation /
 *     getAdmobLastSyncedAt and feeds evaluateAdmobAlerts the right input
 *     (configured flag, and reconciliation only when the summary has rows),
 *   - a storage/DB error is caught and logged, never thrown out of the timer,
 *   - the advisory lock gates the work (a busy lock skips evaluation),
 *   - and end-to-end a stale lastSyncedAt drives the real admobAlerts state
 *     machine to record a firing stale_sync alert with no admin in the loop.
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
  getAdMobConfigState,
  withAdvisoryLockMock,
  logger,
  evaluateSpy,
} = vi.hoisted(() => ({
  getAdmobSnapshotSummary: vi.fn(),
  getAdmobReconciliation: vi.fn(),
  getAdmobLastSyncedAt: vi.fn(),
  getAdMobConfigState: vi.fn(),
  withAdvisoryLockMock: vi.fn(
    async (_key: number, fn: () => Promise<void>) => {
      await fn();
      return true;
    },
  ),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  evaluateSpy: vi.fn(),
}));

vi.mock("../storage", () => ({
  storage: {
    getAdmobSnapshotSummary: (...args: unknown[]) => getAdmobSnapshotSummary(...args),
    getAdmobReconciliation: (...args: unknown[]) => getAdmobReconciliation(...args),
    getAdmobLastSyncedAt: (...args: unknown[]) => getAdmobLastSyncedAt(...args),
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

// Wrap evaluateAdmobAlerts in a spy but keep the REAL state machine + helpers,
// so assertions can inspect both the input the job passed and the alert it fired.
vi.mock("../lib/admobAlerts", async (importActual) => {
  const actual = await importActual<typeof import("../lib/admobAlerts")>();
  return {
    ...actual,
    evaluateAdmobAlerts: (input: import("../lib/admobAlerts").AdmobAlertInput) => {
      evaluateSpy(input);
      return actual.evaluateAdmobAlerts(input);
    },
  };
});

import {
  getRecentAdmobAlerts,
  _resetAdmobAlertsForTests,
} from "../lib/admobAlerts";

let startAdmobAlertsJob: typeof import("./admobAlertsJob").startAdmobAlertsJob;

const HOUR = 60 * 60 * 1000;
const INITIAL_DELAY_MS = 90 * 1000;
const EVALUATE_INTERVAL_MS = 30 * 60 * 1000;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  _resetAdmobAlertsForTests();

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

    await vi.advanceTimersByTimeAsync(EVALUATE_INTERVAL_MS * 2);
    expect(evaluateSpy).toHaveBeenCalledTimes(3);
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

  it("fires a revenue_divergence alert through the real state machine when official vs app revenue diverges beyond the threshold", async () => {
    // No admin watching — the job alone must surface this.
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

    const diverged = getRecentAdmobAlerts().find(
      (a) => a.condition === "revenue_divergence",
    );
    expect(diverged).toBeTruthy();
    expect(diverged!.status).toBe("firing");
    expect(diverged!.threshold).toBe(25);
    expect(diverged!.detail).toMatchObject({
      officialEarnings: 100,
      appReportedEarnings: 50,
      differencePct: 50,
    });
  });

  it("resolves a revenue_divergence alert automatically when earnings come back within threshold", async () => {
    // Run 1: diverged — a firing alert must be recorded.
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

    const firing = getRecentAdmobAlerts().find(
      (a) => a.condition === "revenue_divergence" && a.status === "firing",
    );
    expect(firing).toBeTruthy();

    // Run 2: back within threshold — the state machine must emit a resolved alert.
    getAdmobReconciliation.mockResolvedValue({
      officialEarnings: 100,
      appReportedEarnings: 97,
      differenceAbs: 3,
      differencePct: 3,
      currency: "USD",
    });

    await vi.advanceTimersByTimeAsync(EVALUATE_INTERVAL_MS);

    const resolved = getRecentAdmobAlerts().find(
      (a) => a.condition === "revenue_divergence" && a.status === "resolved",
    );
    expect(resolved).toBeTruthy();
    expect(resolved!.threshold).toBe(25);
  });

  it("does not fire a revenue_divergence alert when reconciliation is within threshold", async () => {
    getAdmobReconciliation.mockResolvedValue({
      officialEarnings: 100,
      appReportedEarnings: 95,
      differenceAbs: 5,
      differencePct: 5,
      currency: "USD",
    });
    getAdmobSnapshotSummary.mockResolvedValue({ rowCount: 5 });

    startAdmobAlertsJob();
    await vi.advanceTimersByTimeAsync(INITIAL_DELAY_MS);

    expect(
      getRecentAdmobAlerts().some((a) => a.condition === "revenue_divergence"),
    ).toBe(false);
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
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining("another replica holds the lock"),
    );
  });
});
