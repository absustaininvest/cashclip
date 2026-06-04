/**
 * Anti-cheat unit tests for the DB-backed spin challenge store.
 *
 * Why this matters: production runs on an autoscaled fleet, so the spin
 * begin/complete flow keeps its single-use challenge tokens in the shared
 * `spin_challenges` table instead of a process-local Map. That lets a token
 * issued by one replica be validated — and atomically consumed exactly once —
 * by any other replica.
 *
 * These tests lock in `consumeSpinChallenge`'s guarantees so a future change
 * can't silently regress them:
 *   - token not found            -> "not_found"
 *   - belongs to another user    -> "wrong_user"  (token left in place)
 *   - past its TTL               -> "expired"     (token deleted)
 *   - completed too quickly      -> "too_early"   (token left in place + retryAfterMs)
 *   - happy path                 -> "ok"          (token deleted, single use)
 *   - two replicas race the same token -> the loser gets "not_found"
 *
 * The store talks to the DB only through `db.execute(sql\`...\`)`, so we mock
 * that single method and drive each branch by the rows it returns — the same
 * db.execute mocking pattern used by sponsoredWitness.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockExecute } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
}));

vi.mock("@workspace/db", async () => {
  const actual = await vi.importActual<typeof import("@workspace/db")>("@workspace/db");
  return { ...actual, db: { execute: mockExecute } };
});

import { consumeSpinChallenge } from "./spinChallengeStore";

const TOKEN   = "a".repeat(64);
const USER_ID = "user-1";
const MIN_MS  = 3_000;

// One row as returned by the SELECT in consumeSpinChallenge.
function selectRow(over: Partial<{
  user_id: string;
  expired: boolean;
  too_early: boolean;
  retry_after_secs: string | number;
}> = {}) {
  return {
    rows: [
      {
        user_id: USER_ID,
        expired: false,
        too_early: false,
        retry_after_secs: 0,
        ...over,
      },
    ],
  };
}

describe("consumeSpinChallenge (DB-backed, cross-replica anti-cheat)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns "not_found" when the token does not exist (no DELETE issued)', async () => {
    // SELECT finds nothing — e.g. a forged or already-consumed token.
    mockExecute.mockResolvedValueOnce({ rows: [] });

    const result = await consumeSpinChallenge(TOKEN, USER_ID, MIN_MS);

    expect(result).toEqual({ status: "not_found" });
    // Only the SELECT ran; no delete should be attempted.
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it('returns "wrong_user" and leaves the token in place when it belongs to someone else', async () => {
    // A token issued for another user must never be consumable here — and it
    // must NOT be deleted, so its real owner can still complete their spin.
    mockExecute.mockResolvedValueOnce(selectRow({ user_id: "someone-else" }));

    const result = await consumeSpinChallenge(TOKEN, USER_ID, MIN_MS);

    expect(result).toEqual({ status: "wrong_user" });
    expect(mockExecute).toHaveBeenCalledTimes(1); // SELECT only — token untouched
  });

  it('returns "expired" and deletes the token when it is past its TTL', async () => {
    mockExecute
      .mockResolvedValueOnce(selectRow({ expired: true })) // SELECT
      .mockResolvedValueOnce({ rows: [] });                 // DELETE expired

    const result = await consumeSpinChallenge(TOKEN, USER_ID, MIN_MS);

    expect(result).toEqual({ status: "expired" });
    // SELECT + DELETE: the expired token is cleaned up.
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  it('returns "too_early" with retryAfterMs and leaves the token in place (min-wait gate)', async () => {
    // Completed faster than SPIN_CHALLENGE_MIN_MS after begin — anti-instant
    // replay. Token is left so the client can retry once enough time passes.
    mockExecute.mockResolvedValueOnce(
      selectRow({ too_early: true, retry_after_secs: 1.2 }),
    );

    const result = await consumeSpinChallenge(TOKEN, USER_ID, MIN_MS);

    expect(result).toEqual({ status: "too_early", retryAfterMs: 1200 });
    expect(mockExecute).toHaveBeenCalledTimes(1); // SELECT only — token NOT deleted
  });

  it("rounds retryAfterMs up to whole milliseconds", async () => {
    mockExecute.mockResolvedValueOnce(
      selectRow({ too_early: true, retry_after_secs: "2.9994" }),
    );

    const result = await consumeSpinChallenge(TOKEN, USER_ID, MIN_MS);

    expect(result).toEqual({ status: "too_early", retryAfterMs: 3000 });
  });

  it('happy path: returns "ok" and atomically consumes the token via DELETE ... RETURNING', async () => {
    mockExecute
      .mockResolvedValueOnce(selectRow())              // SELECT — valid, same user, not expired/early
      .mockResolvedValueOnce({ rows: [{ token: TOKEN }] }); // DELETE RETURNING — this caller won

    const result = await consumeSpinChallenge(TOKEN, USER_ID, MIN_MS);

    expect(result).toEqual({ status: "ok" });
    expect(mockExecute).toHaveBeenCalledTimes(2); // SELECT + consuming DELETE
  });

  it('single-use across replicas: the racer that loses the DELETE gets "not_found"', async () => {
    // Two autoscaled replicas race the same valid token: both pass the SELECT
    // gate, but the DELETE ... RETURNING is atomic, so only one row comes back.
    // The loser sees zero returned rows and must be treated as not_found —
    // it must NOT also credit a spin.
    mockExecute
      .mockResolvedValueOnce(selectRow()) // SELECT passes (read happened before the winner deleted)
      .mockResolvedValueOnce({ rows: [] }); // DELETE RETURNING — winner already removed the row

    const result = await consumeSpinChallenge(TOKEN, USER_ID, MIN_MS);

    expect(result).toEqual({ status: "not_found" });
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });
});
