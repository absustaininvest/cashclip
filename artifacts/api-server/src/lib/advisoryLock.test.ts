import { describe, it, expect, afterAll } from "vitest";
import { pool } from "@workspace/db";
import { withAdvisoryLock } from "./advisoryLock";

// Use high, test-only keys that don't collide with the real job keys
// (260001 auto-convert sweep, 260002 conversion-rate recompute).
const KEY_A = 990001;
const KEY_B = 990002;

afterAll(async () => {
  await pool.end();
});

describe("withAdvisoryLock", () => {
  it("runs the body and reports acquisition", async () => {
    let ran = false;
    const acquired = await withAdvisoryLock(KEY_A, async () => {
      ran = true;
    });
    expect(acquired).toBe(true);
    expect(ran).toBe(true);
  });

  it("blocks a concurrent holder of the same key (cross-connection mutual exclusion)", async () => {
    let nestedAcquired: boolean | null = null;
    const outer = await withAdvisoryLock(KEY_A, async () => {
      // A second attempt borrows a DIFFERENT pooled client; because the lock is
      // held on the outer session it must NOT be granted.
      nestedAcquired = await withAdvisoryLock(KEY_A, async () => {
        /* should never run */
      });
    });
    expect(outer).toBe(true);
    expect(nestedAcquired).toBe(false);
  });

  it("releases the lock so the same key is immediately reacquirable", async () => {
    // This is the regression guard: the previous implementation unlocked on a
    // possibly-different pooled connection, which could leave the lock wedged.
    const first = await withAdvisoryLock(KEY_A, async () => {});
    expect(first).toBe(true);
    const second = await withAdvisoryLock(KEY_A, async () => {});
    expect(second).toBe(true);
  });

  it("releases the lock even when the body throws", async () => {
    await expect(
      withAdvisoryLock(KEY_A, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    // Lock must be free again after the throw.
    const after = await withAdvisoryLock(KEY_A, async () => {});
    expect(after).toBe(true);
  });

  it("does not block across different keys", async () => {
    let nestedAcquired: boolean | null = null;
    await withAdvisoryLock(KEY_A, async () => {
      nestedAcquired = await withAdvisoryLock(KEY_B, async () => {});
    });
    expect(nestedAcquired).toBe(true);
  });
});
