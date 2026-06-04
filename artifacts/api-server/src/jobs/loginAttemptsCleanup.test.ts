/**
 * Tests that the scheduled login_attempts cleanup job is actually wired up to
 * the pruner and fires on its interval.
 *
 * The SQL correctness of `pruneExpiredLoginAttempts` itself is covered against a
 * real Postgres elsewhere. This suite instead guards the *scheduling*: if the
 * 5-minute interval were dropped or misconfigured, expired `login_attempts`
 * brute-force throttle rows would accumulate silently while the SQL unit test
 * still passed. We mock the pruner and use fake timers to assert the job
 * invokes it on schedule and never lets a pruner failure crash the process.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const pruneMock = vi.fn<() => Promise<void>>();

vi.mock("../lib/dbRateLimit", () => ({
  pruneExpiredLoginAttempts: () => pruneMock(),
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

let startLoginAttemptsCleanupJob: typeof import("./loginAttemptsCleanup").startLoginAttemptsCleanupJob;

const FIVE_MIN_MS = 5 * 60 * 1000;

beforeEach(async () => {
  vi.useFakeTimers();
  pruneMock.mockReset();
  pruneMock.mockResolvedValue(undefined);
  delete process.env["LOGIN_ATTEMPTS_CLEANUP_INTERVAL_MINUTES"];
  ({ startLoginAttemptsCleanupJob } = await import("./loginAttemptsCleanup"));
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("startLoginAttemptsCleanupJob", () => {
  it("does not run the pruner before the first interval elapses", () => {
    const timer = startLoginAttemptsCleanupJob();
    expect(pruneMock).not.toHaveBeenCalled();
    clearInterval(timer);
  });

  it("invokes pruneExpiredLoginAttempts once the 5-minute interval fires", async () => {
    const timer = startLoginAttemptsCleanupJob();

    await vi.advanceTimersByTimeAsync(FIVE_MIN_MS);
    expect(pruneMock).toHaveBeenCalledTimes(1);

    clearInterval(timer);
  });

  it("keeps firing on every subsequent interval", async () => {
    const timer = startLoginAttemptsCleanupJob();

    await vi.advanceTimersByTimeAsync(FIVE_MIN_MS * 3);
    expect(pruneMock).toHaveBeenCalledTimes(3);

    clearInterval(timer);
  });

  it("honours LOGIN_ATTEMPTS_CLEANUP_INTERVAL_MINUTES when set", async () => {
    process.env["LOGIN_ATTEMPTS_CLEANUP_INTERVAL_MINUTES"] = "1";
    vi.resetModules();
    ({ startLoginAttemptsCleanupJob } = await import("./loginAttemptsCleanup"));

    const timer = startLoginAttemptsCleanupJob();

    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(pruneMock).toHaveBeenCalledTimes(1);

    clearInterval(timer);
  });

  it("falls back to the 5-minute default for an invalid interval value", async () => {
    process.env["LOGIN_ATTEMPTS_CLEANUP_INTERVAL_MINUTES"] = "not-a-number";
    vi.resetModules();
    ({ startLoginAttemptsCleanupJob } = await import("./loginAttemptsCleanup"));

    const timer = startLoginAttemptsCleanupJob();

    // Nothing at 1 minute (proves it did not parse to a tiny/zero interval)…
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(pruneMock).not.toHaveBeenCalled();
    // …but it fires at the 5-minute default.
    await vi.advanceTimersByTimeAsync(FIVE_MIN_MS - 60 * 1000);
    expect(pruneMock).toHaveBeenCalledTimes(1);

    clearInterval(timer);
  });

  it("swallows a pruner failure without throwing out of the interval", async () => {
    pruneMock.mockRejectedValue(new Error("db blip"));
    const timer = startLoginAttemptsCleanupJob();

    // A rejected pruner promise must not surface as an unhandled rejection or
    // throw out of the timer callback — the job should keep running and keep
    // firing on subsequent intervals.
    await expect(
      vi.advanceTimersByTimeAsync(FIVE_MIN_MS * 2),
    ).resolves.not.toThrow();
    expect(pruneMock).toHaveBeenCalledTimes(2);

    clearInterval(timer);
  });
});
