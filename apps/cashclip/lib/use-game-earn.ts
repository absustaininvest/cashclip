import { useRef, useEffect, useCallback } from "react";
import * as Haptics from "expo-haptics";
import { beginGame, completeGame } from "./earn-client";
import { recordGamePlay } from "./storage";
import { DISPLAY_POINTS_PER_DOLLAR, CASH_POINTS_PER_DOLLAR } from "./points";

// Fallback when server is unreachable: minimum GAME_POOL value (25 server pts)
// converted to display points.
const FALLBACK_DISPLAY_PTS = Math.round(
  25 * (DISPLAY_POINTS_PER_DOLLAR / CASH_POINTS_PER_DOLLAR)
);

export function useGameEarn() {
  const challengeRef = useRef<string | null>(null);

  useEffect(() => {
    beginGame()
      .then((r) => { if (r.ok) challengeRef.current = r.challengeToken; })
      .catch(() => {});
  }, []);

  // The server picks the reward from its demand-based GAME_POOL — no fixed
  // amount is passed in. Returns the display pts actually credited so callers
  // can show the real number to the user. Fires a success haptic on credit
  // so users feel the reward physically on every game completion.
  const claimGameReward = useCallback(async (
    gameId: string,
    description: string,
  ): Promise<number> => {
    const tok = challengeRef.current;
    challengeRef.current = null;
    if (tok) {
      const result = await completeGame(tok, description);
      if (result.ok) {
        const displayPts = Math.round(
          result.token.points * (DISPLAY_POINTS_PER_DOLLAR / CASH_POINTS_PER_DOLLAR)
        );
        await recordGamePlay(gameId, displayPts, description, { creditLocally: true });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        return displayPts;
      }
    }
    await recordGamePlay(gameId, FALLBACK_DISPLAY_PTS, description, { creditLocally: true });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    return FALLBACK_DISPLAY_PTS;
  }, []);

  return { claimGameReward };
}
