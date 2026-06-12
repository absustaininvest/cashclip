import React, { useState, useEffect, useRef, useCallback } from "react";
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
import { recordGamePlay, canPlayGame, formatPoints, dollarsToPoints } from "@/lib/storage";
import { useGameEarn } from "@/lib/use-game-earn";
import {
  MEMORY_COLUMNS as COLUMNS,
  MEMORY_ROWS as ROWS,
  MEMORY_CARD_GAP as CARD_GAP,
  MEMORY_GRID_PADDING as GRID_PADDING,
  memoryCardWidth,
  memoryCardHeight,
} from "./layout-sizing";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

const TOTAL_CARDS = COLUMNS * ROWS;
const PAIRS = TOTAL_CARDS / 2;

const CARD_WIDTH = memoryCardWidth(SCREEN_WIDTH);
const CARD_HEIGHT = memoryCardHeight(SCREEN_WIDTH);

interface CardSymbol {
  name: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
}

const SYMBOLS: CardSymbol[] = [
  { name: "star", icon: "star", color: "#FFD600" },
  { name: "heart", icon: "heart", color: "#FF5252" },
  { name: "diamond", icon: "diamond", color: "#40C4FF" },
  { name: "flash", icon: "flash", color: "#FF9100" },
  { name: "leaf", icon: "leaf", color: "#00E676" },
  { name: "moon", icon: "moon", color: "#CE93D8" },
];

interface Card {
  id: number;
  symbolIndex: number;
  flipped: boolean;
  matched: boolean;
}

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateCards(): Card[] {
  const indices: number[] = [];
  for (let i = 0; i < PAIRS; i++) {
    indices.push(i, i);
  }
  const shuffled = shuffleArray(indices);
  return shuffled.map((symbolIndex, id) => ({
    id,
    symbolIndex,
    flipped: false,
    matched: false,
  }));
}

function MemoryCard({
  card,
  onPress,
  disabled,
}: {
  card: Card;
  onPress: () => void;
  disabled: boolean;
}) {
  const flipAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const prevFlipped = useRef(false);

  useEffect(() => {
    if (card.flipped !== prevFlipped.current) {
      prevFlipped.current = card.flipped;
      Animated.spring(flipAnim, {
        toValue: card.flipped ? 1 : 0,
        friction: 8,
        tension: 60,
        useNativeDriver: true,
      }).start();
    }
  }, [card.flipped]);

  useEffect(() => {
    if (card.matched) {
      Animated.sequence([
        Animated.timing(scaleAnim, {
          toValue: 1.15,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [card.matched]);

  const frontInterpolate = flipAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "180deg"],
  });
  const backInterpolate = flipAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["180deg", "360deg"],
  });

  const symbol = SYMBOLS[card.symbolIndex];

  return (
    <TouchableOpacity
      testID={`memory-card-${card.id}`}
      onPress={onPress}
      disabled={disabled || card.flipped || card.matched}
      activeOpacity={0.7}
      style={styles.cardContainer}
    >
      <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
        <Animated.View
          style={[
            styles.card,
            styles.cardBack,
            {
              transform: [{ rotateY: frontInterpolate }],
              opacity: card.matched ? 0.5 : 1,
            },
          ]}
        >
          <Ionicons name="help" size={32} color={Colors.textMuted} />
        </Animated.View>
        <Animated.View
          style={[
            styles.card,
            styles.cardFront,
            {
              transform: [{ rotateY: backInterpolate }],
              borderColor: card.matched ? symbol.color : Colors.border,
              opacity: card.matched ? 0.6 : 1,
            },
          ]}
        >
          <Ionicons
            name={symbol.icon}
            size={36}
            color={symbol.color}
          />
        </Animated.View>
      </Animated.View>
    </TouchableOpacity>
  );
}

export default function MemoryMatchGame() {
  const { claimGameReward } = useGameEarn();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();

  const [cards, setCards] = useState<Card[]>(generateCards());
  const [selectedCards, setSelectedCards] = useState<number[]>([]);
  const [moves, setMoves] = useState(0);
  const [matchedPairs, setMatchedPairs] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [reward, setReward] = useState(0);
  const [timer, setTimer] = useState(0);
  const [gameStarted, setGameStarted] = useState(false);
  const [canPlay, setCanPlay] = useState(true);
  const [checking, setChecking] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const resultOpacity = useRef(new Animated.Value(0)).current;
  const resultScale = useRef(new Animated.Value(0.5)).current;
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    canPlayGame("memory-match").then(setCanPlay);
  }, []);

  useEffect(() => {
    if (gameStarted && !gameOver) {
      timerRef.current = setInterval(() => {
        setTimer((prev) => prev + 1);
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [gameStarted, gameOver]);

  const calculateReward = useCallback((totalMoves: number): number => {
    if (totalMoves < 10) return 0.15;
    if (totalMoves < 15) return 0.10;
    if (totalMoves < 20) return 0.05;
    return 0.03;
  }, []);

  const getPerformanceLabel = useCallback(
    (totalMoves: number): string => {
      if (totalMoves < 10) return t.games.perfect;
      if (totalMoves < 15) return t.games.great;
      if (totalMoves < 20) return t.games.good;
      return t.games.tryHarder;
    },
    [t]
  );

  const bankedRef = useRef(false);

  const bankReward = useCallback(async (totalMoves: number, desc: string) => {
    if (bankedRef.current) return;
    bankedRef.current = true;
    const pts = dollarsToPoints(calculateReward(totalMoves));
    await claimGameReward("memory-match", pts, desc);
  }, [calculateReward]);

  const handleCardPress = useCallback(
    (cardId: number) => {
      if (!gameStarted) setGameStarted(true);
      if (checking || selectedCards.length >= 2) return;

      const card = cards[cardId];
      if (card.flipped || card.matched) return;

      const newCards = [...cards];
      newCards[cardId] = { ...newCards[cardId], flipped: true };
      setCards(newCards);

      const newSelected = [...selectedCards, cardId];
      setSelectedCards(newSelected);

      if (newSelected.length === 2) {
        const newMoves = moves + 1;
        setMoves(newMoves);
        setChecking(true);

        const [first, second] = newSelected;
        if (newCards[first].symbolIndex === newCards[second].symbolIndex) {
          setTimeout(() => {
            setCards((prev) => {
              const updated = [...prev];
              updated[first] = { ...updated[first], matched: true };
              updated[second] = { ...updated[second], matched: true };
              return updated;
            });
            const newMatched = matchedPairs + 1;
            setMatchedPairs(newMatched);
            setSelectedCards([]);
            setChecking(false);

            if (newMatched === PAIRS) {
              const earnedReward = calculateReward(newMoves);
              setReward(earnedReward);
              setGameOver(true);
              if (timerRef.current) clearInterval(timerRef.current);

              void bankReward(newMoves, `Memory Match - ${newMoves} moves`);

              setTimeout(() => {
                setShowResult(true);
                Animated.parallel([
                  Animated.timing(resultOpacity, {
                    toValue: 1,
                    duration: 300,
                    useNativeDriver: true,
                  }),
                  Animated.spring(resultScale, {
                    toValue: 1,
                    friction: 6,
                    useNativeDriver: true,
                  }),
                ]).start();
              }, 500);
            }
          }, 400);
        } else {
          setTimeout(() => {
            setCards((prev) => {
              const updated = [...prev];
              updated[first] = { ...updated[first], flipped: false };
              updated[second] = { ...updated[second], flipped: false };
              return updated;
            });
            setSelectedCards([]);
            setChecking(false);
          }, 800);
        }
      }
    },
    [cards, selectedCards, moves, matchedPairs, checking, gameStarted, calculateReward]
  );

  const resetGame = useCallback(() => {
    setCards(generateCards());
    setSelectedCards([]);
    setMoves(0);
    setMatchedPairs(0);
    setGameOver(false);
    setReward(0);
    setTimer(0);
    setGameStarted(false);
    setChecking(false);
    setShowResult(false);
    bankedRef.current = false;
    resultOpacity.setValue(0);
    resultScale.setValue(0.5);
  }, []);

  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  if (!canPlay) {
    return (
      <View style={[styles.container, { paddingTop: topInset, paddingBottom: bottomInset }]}>
        <View style={styles.header}>
          <TouchableOpacity
            testID="back-button"
            onPress={() => router.back()}
            style={styles.backButton}
          >
            <Ionicons name="arrow-back" size={24} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t.games.memoryMatch}</Text>
          <View style={styles.backButton} />
        </View>
        <View style={styles.cooldownContainer}>
          <Ionicons name="time-outline" size={64} color={Colors.textMuted} />
          <Text style={styles.cooldownText}>{t.games.comeBackTomorrow}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: topInset }]}>
      <View style={styles.header}>
        <TouchableOpacity
          testID="back-button"
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t.games.memoryMatch}</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: bottomInset + 24 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Ionicons name="swap-horizontal" size={18} color={Colors.primary} />
            <Text style={styles.statLabel}>{t.games.moves}</Text>
            <Text style={styles.statValue}>{moves}</Text>
          </View>
          <View style={styles.statItem}>
            <Ionicons name="checkmark-circle" size={18} color={Colors.accent} />
            <Text style={styles.statLabel}>{t.games.matched}</Text>
            <Text style={styles.statValue}>
              {matchedPairs}/{PAIRS}
            </Text>
          </View>
          <View style={styles.statItem}>
            <Ionicons name="timer-outline" size={18} color={Colors.textSecondary} />
            <Text style={styles.statLabel}>{t.games.time}</Text>
            <Text style={styles.statValue}>{formatTime(timer)}</Text>
          </View>
        </View>

        <View style={styles.grid}>
          {cards.map((card) => (
            <MemoryCard
              key={card.id}
              card={card}
              onPress={() => handleCardPress(card.id)}
              disabled={checking || gameOver}
            />
          ))}
        </View>
      </ScrollView>

      {showResult && (
        <Animated.View
          style={[
            styles.resultOverlay,
            {
              opacity: resultOpacity,
            },
          ]}
        >
          <Animated.View
            style={[
              styles.resultCard,
              { transform: [{ scale: resultScale }] },
            ]}
          >
            <Ionicons name="trophy" size={56} color={Colors.accent} />
            <Text style={styles.resultTitle}>{t.games.youWon}</Text>
            <Text style={styles.performanceLabel}>
              {getPerformanceLabel(moves)}
            </Text>

            <View style={styles.resultStats}>
              <View style={styles.resultStatItem}>
                <Text style={styles.resultStatLabel}>{t.games.moves}</Text>
                <Text style={styles.resultStatValue}>{moves}</Text>
              </View>
              <View style={styles.resultStatItem}>
                <Text style={styles.resultStatLabel}>{t.games.time}</Text>
                <Text style={styles.resultStatValue}>{formatTime(timer)}</Text>
              </View>
              <View style={styles.resultStatItem}>
                <Text style={styles.resultStatLabel}>{t.games.reward}</Text>
                <Text style={[styles.resultStatValue, { color: Colors.primary }]}>
                  {formatPoints(dollarsToPoints(calculateReward(moves)))}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              testID="play-again-button"
              style={styles.playAgainButton}
              onPress={resetGame}
            >
              <Ionicons name="refresh" size={20} color={Colors.background} />
              <Text style={styles.playAgainText}>{t.games.playAgain}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              testID="back-to-games-button"
              style={styles.backToGamesButton}
              onPress={() => router.back()}
            >
              <Text style={styles.backToGamesText}>{t.games.title}</Text>
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
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
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingHorizontal: GRID_PADDING,
    paddingVertical: 16,
    marginHorizontal: 16,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    marginBottom: 20,
  },
  statItem: {
    alignItems: "center",
    gap: 4,
  },
  statLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  statValue: {
    fontSize: 20,
    fontWeight: "700" as const,
    color: Colors.text,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: GRID_PADDING,
    gap: CARD_GAP,
    justifyContent: "center",
  },
  cardContainer: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
  },
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backfaceVisibility: "hidden",
    position: "absolute",
    borderWidth: 1.5,
  },
  cardBack: {
    backgroundColor: Colors.surfaceLight,
    borderColor: Colors.border,
  },
  cardFront: {
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
  },
  cooldownContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  cooldownText: {
    fontSize: 18,
    color: Colors.textSecondary,
    fontWeight: "600" as const,
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
    marginHorizontal: 32,
    width: SCREEN_WIDTH - 64,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  resultTitle: {
    fontSize: 28,
    fontWeight: "800" as const,
    color: Colors.text,
    marginTop: 12,
  },
  performanceLabel: {
    fontSize: 18,
    fontWeight: "600" as const,
    color: Colors.accent,
    marginTop: 4,
  },
  resultStats: {
    flexDirection: "row",
    justifyContent: "space-around",
    width: "100%",
    marginTop: 24,
    marginBottom: 24,
  },
  resultStatItem: {
    alignItems: "center",
    gap: 4,
  },
  resultStatLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  resultStatValue: {
    fontSize: 22,
    fontWeight: "700" as const,
    color: Colors.text,
  },
  rewardPending: {
    alignItems: "center",
    gap: 4,
  },
  rewardPendingText: {
    fontSize: 11,
    color: Colors.textSecondary,
  },
  playAgainButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 14,
    gap: 8,
    width: "100%",
    justifyContent: "center",
  },
  playAgainText: {
    fontSize: 16,
    fontWeight: "700" as const,
    color: Colors.background,
  },
  backToGamesButton: {
    marginTop: 12,
    paddingVertical: 10,
  },
  backToGamesText: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontWeight: "600" as const,
  },
});
