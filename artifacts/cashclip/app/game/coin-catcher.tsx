import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  PanResponder,
  TouchableOpacity,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  runOnJS,
} from "react-native-reanimated";
import Colors from "@/constants/colors";
import { useLanguage } from "@/lib/LanguageContext";
import { recordGamePlay, canPlayGame, dollarsToPoints, formatPoints } from "@/lib/storage";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");
const CATCHER_WIDTH = 80;
const CATCHER_HEIGHT = 40;
const ITEM_SIZE = 36;
const GAME_DURATION = 30;
const SPAWN_INTERVAL = 800;
const FALL_SPEED = 3;
const TICK_INTERVAL = 30;

interface FallingItem {
  id: string;
  x: number;
  y: number;
  type: "bronze" | "silver" | "gold" | "bomb";
  caught: boolean;
}

const ITEM_VALUES: Record<string, number> = {
  bronze: 0.01,
  silver: 0.02,
  gold: 0.05,
  bomb: -0.02,
};

const ITEM_COLORS: Record<string, string> = {
  bronze: "#CD7F32",
  silver: "#C0C0C0",
  gold: "#FFD700",
  bomb: "#FF5252",
};

const ITEM_ICONS: Record<string, string> = {
  bronze: "logo-usd",
  silver: "logo-usd",
  gold: "logo-usd",
  bomb: "skull",
};

function getRandomItemType(): FallingItem["type"] {
  const r = Math.random();
  if (r < 0.15) return "bomb";
  if (r < 0.35) return "gold";
  if (r < 0.60) return "silver";
  return "bronze";
}

export default function CoinCatcherScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  const [gameState, setGameState] = useState<"ready" | "playing" | "ended">("ready");
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION);
  const [canPlay, setCanPlay] = useState(true);
  const [items, setItems] = useState<FallingItem[]>([]);

  const catcherX = useRef(SCREEN_WIDTH / 2 - CATCHER_WIDTH / 2);
  const catcherXAnim = useSharedValue(SCREEN_WIDTH / 2 - CATCHER_WIDTH / 2);
  const itemsRef = useRef<FallingItem[]>([]);
  const scoreRef = useRef(0);
  const gameLoopRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const spawnRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const playAreaTop = topInset + 60;
  const playAreaBottom = SCREEN_HEIGHT - bottomInset - CATCHER_HEIGHT - 20;

  useEffect(() => {
    canPlayGame("coin-catcher").then(setCanPlay);
  }, []);

  const catcherStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: catcherXAnim.value }],
  }));

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const touchX = evt.nativeEvent.pageX;
        const newX = Math.max(0, Math.min(touchX - CATCHER_WIDTH / 2, SCREEN_WIDTH - CATCHER_WIDTH));
        catcherX.current = newX;
        catcherXAnim.value = withTiming(newX, { duration: 100 });
      },
      onPanResponderMove: (evt) => {
        const touchX = evt.nativeEvent.pageX;
        const newX = Math.max(0, Math.min(touchX - CATCHER_WIDTH / 2, SCREEN_WIDTH - CATCHER_WIDTH));
        catcherX.current = newX;
        catcherXAnim.value = newX;
      },
    })
  ).current;

  const cleanup = useCallback(() => {
    if (gameLoopRef.current) clearInterval(gameLoopRef.current);
    if (spawnRef.current) clearInterval(spawnRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    gameLoopRef.current = null;
    spawnRef.current = null;
    timerRef.current = null;
  }, []);

  const endGame = useCallback(() => {
    cleanup();
    setGameState("ended");
    const finalScore = Math.max(0, scoreRef.current);
    const reward = parseFloat(finalScore.toFixed(2));
    if (reward > 0) {
      recordGamePlay("coin-catcher", dollarsToPoints(reward), `Coin Catcher: earned ${formatPoints(dollarsToPoints(reward))}`);
    }
  }, [cleanup]);

  const spawnItem = useCallback(() => {
    const margin = ITEM_SIZE;
    const x = margin + Math.random() * (SCREEN_WIDTH - margin * 2);
    const newItem: FallingItem = {
      id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
      x,
      y: playAreaTop,
      type: getRandomItemType(),
      caught: false,
    };
    itemsRef.current = [...itemsRef.current, newItem];
  }, [playAreaTop]);

  const startGame = useCallback(() => {
    setGameState("playing");
    setScore(0);
    setTimeLeft(GAME_DURATION);
    setItems([]);
    scoreRef.current = 0;
    itemsRef.current = [];
    catcherX.current = SCREEN_WIDTH / 2 - CATCHER_WIDTH / 2;
    catcherXAnim.value = SCREEN_WIDTH / 2 - CATCHER_WIDTH / 2;

    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          endGame();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    spawnRef.current = setInterval(() => {
      spawnItem();
    }, SPAWN_INTERVAL);

    gameLoopRef.current = setInterval(() => {
      const currentCatcherX = catcherX.current;
      const catcherY = playAreaBottom;

      let scoreChange = 0;
      const updated = itemsRef.current
        .map((item) => {
          if (item.caught) return item;
          const newY = item.y + FALL_SPEED;

          const itemCenterX = item.x + ITEM_SIZE / 2;
          const itemBottom = newY + ITEM_SIZE;
          const catcherLeft = currentCatcherX;
          const catcherRight = currentCatcherX + CATCHER_WIDTH;

          if (
            itemBottom >= catcherY &&
            itemBottom <= catcherY + CATCHER_HEIGHT + 10 &&
            itemCenterX >= catcherLeft &&
            itemCenterX <= catcherRight
          ) {
            scoreChange += ITEM_VALUES[item.type];
            return { ...item, y: newY, caught: true };
          }

          return { ...item, y: newY };
        })
        .filter((item) => !item.caught && item.y < SCREEN_HEIGHT);

      if (scoreChange !== 0) {
        scoreRef.current = Math.max(0, scoreRef.current + scoreChange);
        setScore(parseFloat(Math.max(0, scoreRef.current).toFixed(2)));
      }

      itemsRef.current = updated;
      setItems([...updated]);
    }, TICK_INTERVAL);
  }, [endGame, spawnItem, playAreaBottom]);

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  const finalReward = Math.max(0, parseFloat(score.toFixed(2)));

  return (
    <View style={[styles.container, { paddingTop: topInset }]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => { cleanup(); router.back(); }}
          testID="back-button"
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t.games.coinCatcher}</Text>
        <View style={styles.headerRight}>
          {gameState === "playing" && (
            <>
              <View style={styles.statBadge}>
                <Ionicons name="time-outline" size={14} color={Colors.accent} />
                <Text style={styles.statText}>{timeLeft}s</Text>
              </View>
              <View style={styles.statBadge}>
                <Ionicons name="logo-usd" size={14} color={Colors.primary} />
                <Text style={styles.statText}>${score.toFixed(2)}</Text>
              </View>
            </>
          )}
        </View>
      </View>

      {gameState === "ready" && (
        <View style={styles.centeredContent}>
          <View style={styles.iconCircle}>
            <Ionicons name="game-controller" size={64} color={Colors.accent} />
          </View>
          <Text style={styles.readyTitle}>{t.games.coinCatcher}</Text>
          <Text style={styles.readyDesc}>{t.games.coinCatcherDesc}</Text>
          <View style={styles.infoRow}>
            <View style={styles.infoCard}>
              <Ionicons name="time-outline" size={20} color={Colors.accent} />
              <Text style={styles.infoValue}>{GAME_DURATION}s</Text>
              <Text style={styles.infoLabel}>{t.games.time}</Text>
            </View>
            <View style={styles.infoCard}>
              <Ionicons name="logo-usd" size={20} color={Colors.primary} />
              <Text style={styles.infoValue}>$0.01-$0.05</Text>
              <Text style={styles.infoLabel}>{t.games.reward}</Text>
            </View>
          </View>
          {canPlay ? (
            <TouchableOpacity
              style={styles.playButton}
              onPress={startGame}
              testID="play-button"
            >
              <Ionicons name="play" size={24} color={Colors.background} />
              <Text style={styles.playButtonText}>{t.games.play}</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.cooldownBadge}>
              <Ionicons name="time" size={20} color={Colors.textSecondary} />
              <Text style={styles.cooldownText}>{t.games.comeBackTomorrow}</Text>
            </View>
          )}
        </View>
      )}

      {gameState === "playing" && (
        <View style={styles.gameArea} {...panResponder.panHandlers}>
          {items.map((item) => (
            <View
              key={item.id}
              style={[
                styles.fallingItem,
                {
                  left: item.x,
                  top: item.y,
                  backgroundColor: ITEM_COLORS[item.type],
                },
              ]}
            >
              <Ionicons
                name={ITEM_ICONS[item.type] as any}
                size={20}
                color={item.type === "bomb" ? "#FFF" : Colors.background}
              />
            </View>
          ))}

          <Animated.View style={[styles.catcher, { top: playAreaBottom }, catcherStyle]}>
            <View style={styles.catcherInner}>
              <Ionicons name="basket" size={28} color={Colors.background} />
            </View>
          </Animated.View>
        </View>
      )}

      {gameState === "ended" && (
        <View style={styles.centeredContent}>
          <View style={[styles.iconCircle, { borderColor: finalReward > 0 ? Colors.primary : Colors.error }]}>
            <Ionicons
              name={finalReward > 0 ? "trophy" : "sad"}
              size={64}
              color={finalReward > 0 ? Colors.accent : Colors.error}
            />
          </View>
          <Text style={styles.resultTitle}>
            {finalReward > 0 ? t.games.youWon : t.games.gameOver}
          </Text>
          {finalReward > 0 && (
            <Text style={styles.rewardAmount}>{formatPoints(dollarsToPoints(finalReward))}</Text>
          )}
          <Text style={styles.resultSubtitle}>
            {finalReward > 0
              ? `${t.games.earned}: ${formatPoints(dollarsToPoints(finalReward))}`
              : t.games.tryHarder}
          </Text>
          <TouchableOpacity
            style={styles.playButton}
            onPress={() => { cleanup(); router.back(); }}
            testID="done-button"
          >
            <Ionicons name="arrow-back" size={20} color={Colors.background} />
            <Text style={styles.playButtonText}>{t.games.playAgain}</Text>
          </TouchableOpacity>
        </View>
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
    height: 56,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    color: Colors.text,
    fontSize: 18,
    fontFamily: "Outfit_600SemiBold",
  },
  headerRight: {
    flexDirection: "row",
    gap: 8,
    minWidth: 40,
  },
  statBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.surface,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statText: {
    color: Colors.text,
    fontSize: 13,
    fontFamily: "Outfit_600SemiBold",
  },
  centeredContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  iconCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: Colors.surface,
    borderWidth: 3,
    borderColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  readyTitle: {
    color: Colors.text,
    fontSize: 28,
    fontFamily: "Outfit_700Bold",
    marginBottom: 8,
  },
  readyDesc: {
    color: Colors.textSecondary,
    fontSize: 16,
    fontFamily: "Outfit_400Regular",
    textAlign: "center",
    marginBottom: 32,
  },
  infoRow: {
    flexDirection: "row",
    gap: 16,
    marginBottom: 40,
  },
  infoCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 24,
    alignItems: "center",
    gap: 4,
  },
  infoValue: {
    color: Colors.text,
    fontSize: 18,
    fontFamily: "Outfit_700Bold",
  },
  infoLabel: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontFamily: "Outfit_400Regular",
  },
  playButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.primary,
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 16,
  },
  playButtonText: {
    color: Colors.background,
    fontSize: 18,
    fontFamily: "Outfit_700Bold",
  },
  cooldownBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.surface,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 16,
  },
  cooldownText: {
    color: Colors.textSecondary,
    fontSize: 16,
    fontFamily: "Outfit_500Medium",
  },
  gameArea: {
    flex: 1,
    position: "relative",
  },
  fallingItem: {
    position: "absolute",
    width: ITEM_SIZE,
    height: ITEM_SIZE,
    borderRadius: ITEM_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  catcher: {
    position: "absolute",
    width: CATCHER_WIDTH,
    height: CATCHER_HEIGHT,
  },
  catcherInner: {
    width: CATCHER_WIDTH,
    height: CATCHER_HEIGHT,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 6,
  },
  resultTitle: {
    color: Colors.text,
    fontSize: 32,
    fontFamily: "Outfit_700Bold",
    marginBottom: 8,
  },
  rewardAmount: {
    color: Colors.primary,
    fontSize: 48,
    fontFamily: "Outfit_700Bold",
    marginBottom: 8,
  },
  resultSubtitle: {
    color: Colors.textSecondary,
    fontSize: 16,
    fontFamily: "Outfit_400Regular",
    marginBottom: 40,
  },
});
