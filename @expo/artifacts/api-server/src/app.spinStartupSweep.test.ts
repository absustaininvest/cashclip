import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockInfo, mockWarn } = vi.hoisted(() => ({
  mockInfo: vi.fn(),
  mockWarn: vi.fn(),
}));

const { mockExecute } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
}));

vi.mock("./lib/logger.js", () => ({
  logger: { info: mockInfo, warn: mockWarn, error: vi.fn() },
}));

vi.mock("@workspace/db", async () => {
  const actual = await vi.importActual<typeof import("@workspace/db")>("@workspace/db");
  return { ...actual, db: { execute: mockExecute } };
});

import { runSpinChallengeSweep } from "./lib/spinChallengeSweep";

// Each returned row represents one expired spin-challenge token deleted by the
// DB-backed sweep (DELETE ... RETURNING token).
function rows(n: number): { rows: Array<{ token: string }> } {
  return { rows: Array.from({ length: n }, (_, i) => ({ token: `t${i}` })) };
}

describe("runSpinChallengeSweep (DB-backed)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the number of expired rows the DB deleted", async () => {
    mockExecute.mockResolvedValueOnce(rows(2));

    const removed = await runSpinChallengeSweep();

    expect(removed).toBe(2);
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it("returns 0 and does not log when nothing was expired", async () => {
    mockExecute.mockResolvedValueOnce(rows(0));

    const removed = await runSpinChallengeSweep();

    expect(removed).toBe(0);
    expect(mockInfo).not.toHaveBeenCalled();
  });

  it('emits an INFO "spin challenge startup sweep complete" log with the removed count', async () => {
    mockExecute.mockResolvedValueOnce(rows(3));

    await runSpinChallengeSweep();

    expect(mockInfo).toHaveBeenCalledTimes(1);
    expect(mockInfo).toHaveBeenCalledWith(
      { removed: 3 },
      "spin challenge startup sweep complete",
    );
  });

  it("catches a DB failure, logs a WARN, and does not throw", async () => {
    mockExecute.mockRejectedValueOnce(new Error("connection reset"));

    let removed: number | undefined;
    await expect(
      (async () => {
        removed = await runSpinChallengeSweep();
      })(),
    ).resolves.toBeUndefined();

    expect(removed).toBe(0);
    expect(mockWarn).toHaveBeenCalledTimes(1);
    expect(mockWarn.mock.calls[0][1]).toBe("spin challenge startup sweep failed");
    expect(mockInfo).not.toHaveBeenCalled();
  });
});
