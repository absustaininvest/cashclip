export interface GameInfo {
  id: string;
  nameKey: string;
  descKey: string;
  emoji: string;
  gradientColors: [string, string];
  rewardRange: string;
  route: string;
  hot?: boolean;
}

export const CASUAL_GAMES: GameInfo[] = [
  {
    id: "scratch-card",
    nameKey: "scratchCard",
    descKey: "scratchCardDesc",
    emoji: "🎟️",
    gradientColors: ["#F59E0B", "#D97706"],
    rewardRange: "$0.01 – $0.10",
    route: "/game/scratch-card",
  },
  {
    id: "memory-match",
    nameKey: "memoryMatch",
    descKey: "memoryMatchDesc",
    emoji: "🧠",
    gradientColors: ["#10B981", "#059669"],
    rewardRange: "$0.01 – $0.05",
    route: "/game/memory-match",
  },
  {
    id: "trivia",
    nameKey: "triviaQuiz",
    descKey: "triviaQuizDesc",
    emoji: "💡",
    gradientColors: ["#6366F1", "#4F46E5"],
    rewardRange: "$0.01 – $0.25",
    route: "/game/trivia",
    hot: true,
  },
];

export const CLASSIC_GAMES: GameInfo[] = [
  {
    id: "solitaire",
    nameKey: "solitaire",
    descKey: "solitaireDesc",
    emoji: "🃏",
    gradientColors: ["#EF4444", "#DC2626"],
    rewardRange: "$0.05 – $0.25",
    route: "/game/solitaire",
    hot: true,
  },
  {
    id: "dominoes",
    nameKey: "dominoes",
    descKey: "dominoesDesc",
    emoji: "🎲",
    gradientColors: ["#64748B", "#475569"],
    rewardRange: "$0.05 – $0.20",
    route: "/game/dominoes",
  },
];

export const ARCADE_GAMES: GameInfo[] = [
  {
    id: "tetris",
    nameKey: "tetris",
    descKey: "tetrisDesc",
    emoji: "🟦",
    gradientColors: ["#06B6D4", "#0891B2"],
    rewardRange: "$0.01 – $0.25",
    route: "/game/tetris",
  },
  {
    id: "block-blitz",
    nameKey: "blockBlitz",
    descKey: "blockBlitzDesc",
    emoji: "🟧",
    gradientColors: ["#F97316", "#EA580C"],
    rewardRange: "$0.03 – $0.25",
    route: "/game/block-blitz",
    hot: true,
  },
  {
    id: "coin-catcher",
    nameKey: "coinCatcher",
    descKey: "coinCatcherDesc",
    emoji: "🪙",
    gradientColors: ["#F59E0B", "#B45309"],
    rewardRange: "$0.01 – $0.05",
    route: "/game/coin-catcher",
  },
  {
    id: "tap-frenzy",
    nameKey: "tapFrenzy",
    descKey: "tapFrenzyDesc",
    emoji: "⚡",
    gradientColors: ["#A855F7", "#9333EA"],
    rewardRange: "$0.03 – $0.25",
    route: "/game/tap-frenzy",
  },
];

export const ALL_GAMES: GameInfo[] = [
  ...CASUAL_GAMES,
  ...CLASSIC_GAMES,
  ...ARCADE_GAMES,
];
