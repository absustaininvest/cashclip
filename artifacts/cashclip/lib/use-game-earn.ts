import { useRef, useEffect, useCallback } from "react";
import { beginGame, completeGame } from "./earn-client";
import { recordGamePlay } from "./storage";

export function useGameEarn() {
  const challengeRef = useRef<string | null>(null);

  useEffect(() => {
    beginGame()
      .then((r) => { if (r.ok) challengeRef.current = r.challengeToken; })
      .catch(() => {});
  }, []);

  const claimGameReward = useCallback(async (
    gameId: string,
    points: number,
    description: string,
  ): Promise<void> => {
    const tok = challengeRef.current;
    challengeRef.current = null;
    if (tok) {
      const result = await completeGame(tok, description);
      if (result.ok) {
        await recordGamePlay(gameId, points, description, { creditLocally: false });
        return;
      }
    }
    await recordGamePlay(gameId, points, description);
  }, []);

  return { claimGameReward };
}
