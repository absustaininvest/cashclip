/**
 * Tests that the scheduled dedupe cleanup job is actually wired up to the
 * pruner and fires on its interval.
 *
 * The SQL correctness of `pruneExpiredDedupeSlots` itself is covered by
 * lib/dedupe.test.ts against a real Postgres. This suite instead guards the
 * *scheduling*: if the 5-minute interval were dropped or misconfigured,
 * expired `dedupe_slots` rows would accumulate silently while the unit test
 * still passed. We mock the pruner and use fake timers to assert the job
 * invokes it on schedule and never lets a pruner failure crash the process.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const pruneMock = vi.fn<() => Promise<void>>();

vi.mock("../lib/dedupe", () => ({
  pruneExpiredDedupeSlots: () => pruneMock(),
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

let startDedupeCleanupJob: typeof import("./dedupeCleanup").startDedupeCleanupJob;

const FIVE_MIN_MS = 5 * 60 * 1000;

beforeEach(async () => {
  vi.useFakeTimers();
  pruneMock.mockReset();
  pruneMock.mockResolvedValue(undefined);
  delete process.env["DEDUPE_CLEANUP_INTERVAL_MINUTES"];
  ({ startDedupeCleanupJob } = await import("./dedupeCleanup"));
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("startDedupeCleanupJob", () => {
  it("does not run the pruner before the first interval elapses", () => {
    const timer = startDedupeCleanupJob();
    expect(pruneMock).not.toHaveBeenCalled();
    clearInterval(timer);
  });

  it("invokes pruneExpiredDedupeSlots once the 5-minute interval fires", async () => {
    const timer = startDedupeCleanupJob();

    await vi.advanceTimersByTimeAsync(FIVE_MIN_MS);
    expect(pruneMock).toHaveBeenCalledTimes(1);

    clearInterval(timer);
  });

  it("keeps firing on every subsequent interval", async () => {
    const timer = startDedupeCleanupJob();

    await vi.advanceTimersByTimeAsync(FIVE_MIN_MS * 3);
    expect(pruneMock).toHaveBeenCalledTimes(3);

    clearInterval(timer);
  });

  it("honours DEDUPE_CLEANUP_INTERVAL_MINUTES when set", async () => {
    process.env["DEDUPE_CLEANUP_INTERVAL_MINUTES"] = "1";
    vi.resetModules();
    ({ startDedupeCleanupJob } = await import("./dedupeCleanup"));

    const timer = startDedupeCleanupJob();

    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(pruneMock).toHaveBeenCalledTimes(1);

    clearInterval(timer);
  });

  it("falls back to the 5-minute default for an invalid interval value", async () => {
    process.env["DEDUPE_CLEANUP_INTERVAL_MINUTES"] = "not-a-number";
    vi.resetModules();
    ({ startDedupeCleanupJob } = await import("./dedupeCleanup"));

    const timer = startDedupeCleanupJob();

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
    const timer = startDedupeCleanupJob();

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
