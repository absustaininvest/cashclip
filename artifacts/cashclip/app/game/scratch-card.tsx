import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Platform,
  Dimensions,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useLanguage } from "@/lib/LanguageContext";
import { useCelebration } from "@/lib/CelebrationContext";
import { recordGamePlay, canPlayGame, dollarsToPoints, formatPoints } from "@/lib/storage";
import { useGameEarn } from "@/lib/use-game-earn";

import {
  computeScratchCellSize,
} from "./layout-sizing";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

type SymbolType = "coin" | "gem" | "star" | "diamond";

interface CellData {
  symbol: SymbolType;
  revealed: boolean;
}

const SYMBOL_CONFIG: Record<SymbolType, { icon: string; color: string; reward: number }> = {
  coin: { icon: "cash-outline", color: "#FFD600", reward: 0.10 },
  gem: { icon: "diamond-outline", color: "#00E5FF", reward: 0.15 },
  star: { icon: "star", color: "#FF9100", reward: 0.25 },
  diamond: { icon: "diamond", color: "#E040FB", reward: 0.50 },
};

const WEIGHTED_SYMBOLS: SymbolType[] = [
  "coin", "coin", "coin", "coin", "coin",
  "gem", "gem", "gem",
  "star", "star",
  "diamond",
];

function generateGrid(): CellData[] {
  const cells: CellData[] = [];
  for (let i = 0; i < 9; i++) {
    const symbol = WEIGHTED_SYMBOLS[Math.floor(Math.random() * WEIGHTED_SYMBOLS.length)];
    cells.push({ symbol, revealed: false });
  }
  return cells;
}

function checkForMatch(cells: CellData[]): { matched: boolean; symbol: SymbolType | null } {
  const revealed = cells.filter((c) => c.revealed);
  const counts: Record<string, number> = {};
  for (const cell of revealed) {
    counts[cell.symbol] = (counts[cell.symbol] || 0) + 1;
    if (counts[cell.symbol] >= 3) {
      return { matched: true, symbol: cell.symbol };
    }
  }
  return { matched: false, symbol: null };
}

function ScratchCell({
  cell,
  index,
  onReveal,
  disabled,
}: {
  cell: CellData;
  index: number;
  onReveal: (index: number) => void;
  disabled: boolean;
}) {
  const flipAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (cell.revealed && !hasAnimated.current) {
      hasAnimated.current = true;
      Animated.sequence([
        Animated.timing(scaleAnim, {
          toValue: 0.9,
          duration: 80,
          useNativeDriver: true,
        }),
        Animated.parallel([
          Animated.timing(flipAnim, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.spring(scaleAnim, {
            toValue: 1,
            friction: 4,
            useNativeDriver: true,
          }),
        ]),
      ]).start();
    }
  }, [cell.revealed]);

  const frontInterpolate = flipAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "90deg"],
  });

  const backInterpolate = flipAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["90deg", "0deg"],
  });

  const config = SYMBOL_CONFIG[cell.symbol];
  const cellSize = computeScratchCellSize(SCREEN_WIDTH);

  return (
    <TouchableOpacity
      testID={`scratch-cell-${index}`}
      onPress={() => !disabled && !cell.revealed && onReveal(index)}
      activeOpacity={0.7}
      disabled={disabled || cell.revealed}
    >
      <Animated.View style={[styles.cellContainer, { width: cellSize, height: cellSize, transform: [{ scale: scaleAnim }] }]}>
        <Animated.View
          style={[
            styles.cellFace,
            styles.cellFront,
            { width: cellSize, height: cellSize, transform: [{ rotateY: frontInterpolate }] },
          ]}
        >
          <Ionicons name="help-circle" size={36} color={Colors.textMuted} />
        </Animated.View>

        <Animated.View
          style={[
            styles.cellFace,
            styles.cellBack,
            { width: cellSize, height: cellSize, transform: [{ rotateY: backInterpolate }], borderColor: config.color },
          ]}
        >
          <Ionicons name={config.icon as any} size={36} color={config.color} />
          <Text style={[styles.cellReward, { color: config.color }]}>{formatPoints(dollarsToPoints(config.reward))}</Text>
        </Animated.View>
      </Animated.View>
    </TouchableOpacity>
  );
}

export default function ScratchCardGame() {
  const { claimGameReward } = useGameEarn();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const { celebrate } = useCelebration();

  const [cells, setCells] = useState<CellData[]>(generateGrid);
  const [gameState, setGameState] = useState<"playing" | "won" | "lost" | "cooldown">("playing");
  const [matchedSymbol, setMatchedSymbol] = useState<SymbolType | null>(null);
  const [revealCount, setRevealCount] = useState(0);
  const [canPlay, setCanPlay] = useState(true);

  const resultOpacity = useRef(new Animated.Value(0)).current;
  const resultScale = useRef(new Animated.Value(0.5)).current;

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  useEffect(() => {
    let cancelled = false;
    canPlayGame("scratch-card").then((available) => {
      if (cancelled) return;
      if (!available) {
        setCanPlay(false);
        setGameState("cooldown");
      }
    });
    return () => { cancelled = true; };
  }, []);

  const showResult = useCallback(() => {
    Animated.parallel([
      Animated.timing(resultOpacity, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }),
      Animated.spring(resultScale, {
        toValue: 1,
        friction: 5,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const bankReward = useCallback(
    async (symbol: SymbolType) => {
      const desc = `Scratch Card: matched 3 ${symbol}s`;
      const pts = dollarsToPoints(SYMBOL_CONFIG[symbol].reward);
      await claimGameReward("scratch-card", pts, desc);
      celebrate({
        tier: "epic",
        label: `+${formatPoints(pts)} pts`,
        title: "You Won!",
      });
    },
    [celebrate]
  );

  const handleReveal = useCallback(
    (index: number) => {
      if (gameState !== "playing") return;

      const newCells = [...cells];
      newCells[index] = { ...newCells[index], revealed: true };
      setCells(newCells);

      const newCount = revealCount + 1;
      setRevealCount(newCount);

      const { matched, symbol } = checkForMatch(newCells);

      if (matched && symbol) {
        setMatchedSymbol(symbol);
        setGameState("won");
        void bankReward(symbol);
        setTimeout(showResult, 500);
      } else if (newCount >= 9) {
        setGameState("lost");
        setTimeout(showResult, 500);
      }
    },
    [cells, gameState, revealCount, showResult, bankReward]
  );

  const handlePlayAgain = useCallback(() => {
    resultOpacity.setValue(0);
    resultScale.setValue(0.5);
    setCells(generateGrid());
    setGameState("cooldown");
    setCanPlay(false);
    setMatchedSymbol(null);
    setRevealCount(0);
  }, []);

  return (
    <View style={[styles.container, { paddingTop: topInset }]}>
      <View style={styles.header}>
        <TouchableOpacity testID="back-button" onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t.games.scratchCard}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.content, { paddingBottom: bottomInset + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.infoSection}>
          <Text style={styles.subtitle}>{t.games.scratchCardDesc}</Text>
          <Text style={styles.hint}>
            {revealCount}/9 {t.games.matched.toLowerCase()}
          </Text>
        </View>

        {gameState === "cooldown" && !canPlay ? (
          <View style={styles.cooldownContainer}>
            <Ionicons name="time-outline" size={64} color={Colors.textMuted} />
            <Text style={styles.cooldownTitle}>{t.games.comeBackTomorrow}</Text>
            <Text style={styles.cooldownSubtitle}>{t.games.dailyPlaysLeft}: 0</Text>
          </View>
        ) : (
          <>
            <View style={styles.grid}>
              {cells.map((cell, i) => (
                <ScratchCell
                  key={i}
                  cell={cell}
                  index={i}
                  onReveal={handleReveal}
                  disabled={gameState !== "playing"}
                />
              ))}
            </View>

            <View style={styles.legend}>
              {(Object.entries(SYMBOL_CONFIG) as [SymbolType, typeof SYMBOL_CONFIG[SymbolType]][]).map(
                ([key, config]) => (
                  <View key={key} style={styles.legendItem}>
                    <Ionicons name={config.icon as any} size={18} color={config.color} />
                    <Text style={[styles.legendText, { color: config.color }]}>
                      {formatPoints(dollarsToPoints(config.reward))}
                    </Text>
                  </View>
                )
              )}
            </View>
          </>
        )}
      </ScrollView>

      {(gameState === "won" || gameState === "lost") && (
        <Animated.View
          style={[
            styles.resultOverlay,
            { opacity: resultOpacity },
          ]}
        >
          <Animated.View style={[styles.resultCard, { transform: [{ scale: resultScale }] }]}>
            {gameState === "won" ? (
              <>
                <View style={styles.resultIconWin}>
                  <Ionicons name="trophy" size={48} color={Colors.accent} />
                </View>
                <Text style={styles.resultTitle}>{t.games.youWon}</Text>
                {matchedSymbol && (
                  <Text style={styles.resultReward}>{formatPoints(dollarsToPoints(SYMBOL_CONFIG[matchedSymbol].reward))}</Text>
                )}
                <Text style={styles.resultSubtext}>
                  Added to pending — claim after 3 hours
                </Text>
              </>
            ) : (
              <>
                <View style={styles.resultIconLose}>
                  <Ionicons name="close-circle" size={48} color={Colors.error} />
                </View>
                <Text style={styles.resultTitle}>{t.games.noMatch}</Text>
                <Text style={styles.resultSubtext}>{t.games.tryHarder}</Text>
              </>
            )}

            <TouchableOpacity
              testID="play-again-button"
              style={styles.resultButton}
              onPress={handlePlayAgain}
            >
              <Text style={styles.resultButtonText}>{t.games.playAgain}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              testID="back-to-games-button"
              style={styles.resultButtonSecondary}
              onPress={() => router.back()}
            >
              <Ionicons name="arrow-back" size={18} color={Colors.textSecondary} />
              <Text style={styles.resultButtonSecondaryText}>{t.games.title}</Text>
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700" as const,
    color: Colors.text,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  infoSection: {
    alignItems: "center",
    marginBottom: 32,
  },
  subtitle: {
    fontSize: 16,
    color: Colors.textSecondary,
    marginBottom: 8,
  },
  hint: {
    fontSize: 14,
    color: Colors.textMuted,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 12,
    maxWidth: 340,
  },
  cellContainer: {
    position: "relative",
  },
  cellFace: {
    position: "absolute",
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backfaceVisibility: "hidden",
  },
  cellFront: {
    backgroundColor: Colors.surfaceLight,
    borderWidth: 2,
    borderColor: Colors.border,
  },
  cellBack: {
    backgroundColor: Colors.surface,
    borderWidth: 2,
  },
  cellReward: {
    fontSize: 12,
    fontWeight: "600" as const,
    marginTop: 4,
  },
  legend: {
    flexDirection: "row",
    marginTop: 32,
    gap: 20,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  legendText: {
    fontSize: 12,
    fontWeight: "600" as const,
  },
  cooldownContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
  },
  cooldownTitle: {
    fontSize: 22,
    fontWeight: "700" as const,
    color: Colors.text,
    marginTop: 16,
  },
  cooldownSubtitle: {
    fontSize: 14,
    color: Colors.textMuted,
    marginTop: 8,
  },
  resultOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.overlay,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  resultCard: {
    backgroundColor: Colors.surface,
    borderRadius: 24,
    padding: 32,
    alignItems: "center",
    width: SCREEN_WIDTH - 64,
    maxWidth: 340,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  resultIconWin: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "rgba(255, 214, 0, 0.15)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  resultIconLose: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "rgba(255, 82, 82, 0.15)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  resultTitle: {
    fontSize: 28,
    fontWeight: "800" as const,
    color: Colors.text,
    marginBottom: 8,
  },
  resultReward: {
    fontSize: 36,
    fontWeight: "800" as const,
    color: Colors.primary,
    marginBottom: 4,
  },
  resultSubtext: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginBottom: 24,
  },
  resultButton: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 40,
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 12,
  },
  resultButtonText: {
    fontSize: 16,
    fontWeight: "700" as const,
    color: Colors.background,
  },
  resultButtonSecondary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
  },
  resultButtonSecondaryText: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
});
