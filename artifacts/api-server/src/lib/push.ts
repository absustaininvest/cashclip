import { db, users } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const WITHDRAWAL_THRESHOLD = 1.00;

export async function sendExpoPush(
  token: string,
  title: string,
  body: string,
): Promise<void> {
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ to: token, title, body, sound: "default" }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "expo-push: HTTP error");
    }
  } catch (err) {
    logger.warn({ err }, "expo-push: send failed (fire-and-forget)");
  }
}

/**
 * Fire-and-forget: sends a "you can withdraw now!" push notification if the
 * user's balance just crossed the $1.00 withdrawal threshold.
 *
 * Called after every balance credit.  The check is:
 *   prevBalance < $1.00  AND  newBalance >= $1.00
 *
 * This fires exactly once per crossing event.  After a withdrawal drops the
 * balance below $1 the user can cross again (and get notified again), which
 * is the correct UX — each crossing is a meaningful moment.
 *
 * The push is best-effort: any error is logged and swallowed so it never
 * blocks or rolls back the credit that triggered it.
 */
export function maybeSendThresholdPush(
  userId: string,
  prevBalance: number,
  newBalance: number,
): void {
  if (prevBalance >= WITHDRAWAL_THRESHOLD || newBalance < WITHDRAWAL_THRESHOLD) return;

  (async () => {
    try {
      const [user] = await db
        .select({ expoPushToken: users.expoPushToken, username: users.username })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user?.expoPushToken) return;

      await sendExpoPush(
        user.expoPushToken,
        "You can withdraw now! 💸",
        `Your balance just reached $${newBalance.toFixed(2)}. Withdraw to PayPal now.`,
      );

      logger.info({ userId, prevBalance, newBalance }, "threshold push sent");
    } catch (err) {
      logger.warn({ err, userId }, "maybeSendThresholdPush: error (swallowed)");
    }
  })();
}
