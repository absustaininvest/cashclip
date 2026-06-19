import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * DB-backed shared store for the spin wheel's anti-cheat challenge tokens.
 *
 * Production runs on an autoscaled fleet, so a token issued by one replica
 * must be validatable (and single-use consumable) by any other. Keeping these
 * in the `spin_challenges` table — instead of a process-local Map — ensures
 * /api/earn/spin/begin and /api/earn/spin/complete work no matter which
 * replicas they land on, while preserving the original single-use + TTL +
 * min-wait semantics.
 */

/**
 * Raised when a spin-challenge DB query fails (e.g. a brief database blip).
 *
 * This lets the begin/complete routes distinguish an *infrastructure* failure
 * — which should surface as a friendly, retryable 503 — from a genuine
 * validation rejection (not_found / wrong_user / expired / too_early), which
 * is a deliberate 4xx. The original error is preserved as `cause` for logging.
 */
export class SpinChallengeStoreError extends Error {
  constructor(
    public readonly op: "issue" | "consume",
    cause: unknown,
  ) {
    super(`spin challenge store ${op} failed`, { cause });
    this.name = "SpinChallengeStoreError";
  }
}

/**
 * Persist a freshly issued challenge token. `issuedAt` is stamped by the DB
 * (NOW()) and the row expires `ttlMs` later. `points` is the predetermined
 * reward amount picked at begin-time so completeSpin can use the same value
 * instead of re-rolling (keeping the visual wheel segment in sync).
 */
export async function issueSpinChallenge(
  token: string,
  userId: string,
  ttlMs: number,
  points: number,
): Promise<void> {
  const ttlSecs = Math.ceil(ttlMs / 1000);
  try {
    await db.execute(sql`
      INSERT INTO spin_challenges (token, user_id, issued_at, expires_at, points)
      VALUES (
        ${token},
        ${userId},
        NOW(),
        NOW() + (${ttlSecs} * INTERVAL '1 second'),
        ${points}
      )
    `);
  } catch (err) {
    throw new SpinChallengeStoreError("issue", err);
  }
}

export type SpinChallengeConsumeResult =
  | { status: "ok"; points: number | null }
  | { status: "not_found" }
  | { status: "wrong_user" }
  | { status: "expired" }
  | { status: "too_early"; retryAfterMs: number };

/**
 * Validate and atomically consume a challenge token.
 *
 * Mirrors the original in-memory checks, in order:
 *   - missing token            -> "not_found"
 *   - belongs to another user  -> "wrong_user"  (token left in place)
 *   - past its TTL             -> "expired"     (token deleted)
 *   - completed too quickly    -> "too_early"   (token left in place so the
 *                                                client can retry after waiting)
 *   - otherwise                -> "ok"          (token deleted — single use)
 *
 * Single-use is enforced by `DELETE ... RETURNING`: only the first concurrent
 * /complete that wins the delete sees a returned row; any racing replica that
 * already passed the read gets "not_found".
 *
 * All timing is computed against the database clock (NOW()) so it is consistent
 * regardless of per-replica clock skew.
 */
export async function consumeSpinChallenge(
  token: string,
  userId: string,
  minMs: number,
): Promise<SpinChallengeConsumeResult> {
  const minSecs = minMs / 1000;
  try {
    const sel = await db.execute(sql`
      SELECT
        user_id,
        points,
        (NOW() > expires_at)                                AS expired,
        EXTRACT(EPOCH FROM (NOW() - issued_at)) < ${minSecs} AS too_early,
        GREATEST(0, EXTRACT(EPOCH FROM (issued_at + (${minSecs} * INTERVAL '1 second') - NOW()))) AS retry_after_secs
      FROM spin_challenges
      WHERE token = ${token}
    `);

    if (sel.rows.length === 0) return { status: "not_found" };

    const row = sel.rows[0] as {
      user_id: string;
      points: number | null;
      expired: boolean;
      too_early: boolean;
      retry_after_secs: string | number;
    };

    if (row.user_id !== userId) return { status: "wrong_user" };

    if (row.expired) {
      await db.execute(sql`DELETE FROM spin_challenges WHERE token = ${token}`);
      return { status: "expired" };
    }

    if (row.too_early) {
      const retryAfterMs = Math.ceil(Number(row.retry_after_secs) * 1000);
      return { status: "too_early", retryAfterMs };
    }

    // Atomic single-use consume — only the winner of the delete proceeds.
    const del = await db.execute(sql`
      DELETE FROM spin_challenges WHERE token = ${token} RETURNING token
    `);
    if (del.rows.length === 0) return { status: "not_found" };

    return { status: "ok", points: row.points };
  } catch (err) {
    throw new SpinChallengeStoreError("consume", err);
  }
}
