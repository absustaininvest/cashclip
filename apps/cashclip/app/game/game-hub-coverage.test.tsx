import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ARCADE_GAMES, CASUAL_GAMES, CLASSIC_GAMES } from "./game-registry";

const APP_DIR = path.resolve(__dirname, "..");

function routeToFilePath(route: string): string {
  // "/game/scratch-card" → "<app>/game/scratch-card.tsx"
  const relative = route.replace(/^\//, "");
  return path.join(APP_DIR, `${relative}.tsx`);
}

describe("Game hub coverage — every hub card has a screen file", () => {
  const sections: { label: string; games: typeof CASUAL_GAMES }[] = [
    { label: "CASUAL_GAMES", games: CASUAL_GAMES },
    { label: "CLASSIC_GAMES", games: CLASSIC_GAMES },
    { label: "ARCADE_GAMES", games: ARCADE_GAMES },
  ];

  for (const { label, games } of sections) {
    describe(label, () => {
      for (const game of games) {
        it(`${game.id} → ${game.route}.tsx exists`, () => {
          const filePath = routeToFilePath(game.route);
          expect(
            fs.existsSync(filePath),
            `Missing screen file for "${game.id}" (route: "${game.route}"). ` +
              `Expected: ${filePath}`,
          ).toBe(true);
        });
      }
    });
  }
});
