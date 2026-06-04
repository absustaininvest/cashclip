import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockInfo, mockWarn } = vi.hoisted(() => ({
  mockInfo: vi.fn(),
  mockWarn: vi.fn(),
}));

vi.mock("./lib/logger.js", () => ({
  logger: { info: mockInfo, warn: mockWarn, error: vi.fn() },
}));

import {
  runSpinChallengeSweep,
  type SpinChallenge,
} from "./lib/spinChallengeSweep";

const TTL_MS = 60_000;
const NOW = 1_000_000_000;

function challengeStore(
  entries: Record<string, number>,
): Map<string, SpinChallenge> {
  const store = new Map<string, SpinChallenge>();
  for (const [token, issuedAt] of Object.entries(entries)) {
    store.set(token, { userId: `user-${token}`, issuedAt });
  }
  return store;
}

describe("runSpinChallengeSweep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes expired rows", () => {
    const store = challengeStore({
      a: NOW - TTL_MS - 1,
      b: NOW - TTL_MS - 5_000,
    });

    const removed = runSpinChallengeSweep(store, TTL_MS, NOW);

    expect(removed).toBe(2);
    expect(store.size).toBe(0);
  });

  it("leaves non-expired rows untouched", () => {
    const store = challengeStore({
      fresh: NOW - 1_000,
      onEdge: NOW - TTL_MS, // exactly at cutoff is NOT expired (strict <)
    });

    const removed = runSpinChallengeSweep(store, TTL_MS, NOW);

    expect(removed).toBe(0);
    expect(store.size).toBe(2);
    expect(store.has("fresh")).toBe(true);
    expect(store.has("onEdge")).toBe(true);
    expect(mockInfo).not.toHaveBeenCalled();
  });

  it("removes only expired rows from a mixed set", () => {
    const store = challengeStore({
      expired1: NOW - TTL_MS - 10,
      fresh1: NOW - 2_000,
      expired2: NOW - TTL_MS - 90_000,
      fresh2: NOW - 30_000,
    });

    const removed = runSpinChallengeSweep(store, TTL_MS, NOW);

    expect(removed).toBe(2);
    expect(store.size).toBe(2);
    expect(store.has("expired1")).toBe(false);
    expect(store.has("expired2")).toBe(false);
    expect(store.has("fresh1")).toBe(true);
    expect(store.has("fresh2")).toBe(true);
  });

  it('emits an INFO "spin challenge startup sweep complete" log with the removed count', () => {
    const store = challengeStore({
      a: NOW - TTL_MS - 1,
      b: NOW - TTL_MS - 1,
      c: NOW - TTL_MS - 1,
      keep: NOW - 1_000,
    });

    runSpinChallengeSweep(store, TTL_MS, NOW);

    expect(mockInfo).toHaveBeenCalledTimes(1);
    expect(mockInfo).toHaveBeenCalledWith(
      { removed: 3 },
      "spin challenge startup sweep complete",
    );
  });

  it("catches a sweep failure, logs a WARN, and does not throw", () => {
    // A store whose iterator throws simulates an unexpected failure mid-sweep.
    const exploding = {
      [Symbol.iterator]() {
        throw new Error("store iteration blew up");
      },
    } as unknown as Map<string, SpinChallenge>;

    let removed: number | undefined;
    expect(() => {
      removed = runSpinChallengeSweep(exploding, TTL_MS, NOW);
    }).not.toThrow();

    expect(removed).toBe(0);
    expect(mockWarn).toHaveBeenCalledTimes(1);
    expect(mockWarn.mock.calls[0][1]).toBe("spin challenge startup sweep failed");
    expect(mockInfo).not.toHaveBeenCalled();
  });
});
