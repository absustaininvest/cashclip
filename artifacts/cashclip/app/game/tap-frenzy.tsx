import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Dimensions,
  Platform,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useLanguage } from "@/lib/LanguageContext";
import { recordGamePlay, canPlayGame, formatPoints, dollarsToPoints } from "@/lib/storage";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

const GAME_DURATION = 20;
const SPAWN_INTERVAL = 800;
const COIN_LIFETIME = 1500;
const COIN_SIZE = 64;
const COMBO_WINDOW = 1000;

const PLAY_AREA_TOP = 120;
const PLAY_AREA_BOTTOM = 100;

interface Coin {
  id: string;
  x: number;
  y: number;
  opacity: Animated.Value;
  scale: Animated.Value;
  tapped: boolean;
  spawnTime: number;
}

function getRewardTier(taps: number): number {
  if (taps >= 31) return 0.25;
  if (taps >= 21) return 0.15;
  if (taps >= 11) return 0.08;
  return 0.03;
}

function getPerformanceLabel(taps: number, t: any): string {
  if (taps >= 31) return t.games.perfect;
  if (taps >= 21) return t.games.great;
  if (taps >= 11) return t.games.good;
  return t.games.tryHarder;
}

export default function TapFrenzyScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  const [gameState, setGameState] = useState<"idle" | "playing" | "finished">("idle");
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [bestCombo, setBestCombo] = useState(0);
  const [canPlay, setCanPlay] = useState(true);
  const [reward, setReward] = useState(0);
  const coinsRef = useRef<Coin[]>([]);
  const [coins, setCoins] = useState<Coin[]>([]);
  const scoreRef = useRef(0);
  const comboRef = useRef(0);
  const bestComboRef = useRef(0);
  const lastTapTimeRef = useRef(0);
  const gameActiveRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const spawnerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cleanerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const playAreaHeight = SCREEN_HEIGHT - PLAY_AREA_TOP - PLAY_AREA_BOTTOM - topInset - bottomInset;

  useEffect(() => {
    canPlayGame("tap-frenzy").then(setCanPlay);
  }, []);

  const spawnCoin = useCallback(() => {
    if (!gameActiveRef.current) return;

    const padding = COIN_SIZE;
    const x = padding + Math.random() * (SCREEN_WIDTH - padding * 2);
    const y = padding + Math.random() * Math.max(playAreaHeight - padding * 2, 100);

    const coin: Coin = {
      id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
      x,
      y,
      opacity: new Animated.Value(0),
      scale: new Animated.Value(0.3),
      tapped: false,
      spawnTime: Date.now(),
    };

    Animated.parallel([
      Animated.timing(coin.opacity, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.spring(coin.scale, {
        toValue: 1,
        friction: 5,
        tension: 100,
        useNativeDriver: true,
      }),
    ]).start();

    Animated.timing(coin.opacity, {
      toValue: 0.3,
      duration: COIN_LIFETIME - 150,
      delay: 150,
      useNativeDriver: true,
    }).start();

    coinsRef.current = [...coinsRef.current, coin];
    setCoins([...coinsRef.current]);
  }, [playAreaHeight]);

  const cleanExpiredCoins = useCallback(() => {
    const now = Date.now();
    const alive = coinsRef.current.filter(
      (c) => !c.tapped && now - c.spawnTime < COIN_LIFETIME
    );
    if (alive.length !== coinsRef.current.length) {
      coinsRef.current = alive;
      setCoins([...alive]);
    }
  }, []);

  const startGame = useCallback(() => {
    setGameState("playing");
    setTimeLeft(GAME_DURATION);
    setScore(0);
    bankedRef.current = false;
    setCombo(0);
    setBestCombo(0);
    scoreRef.current = 0;
    comboRef.current = 0;
    bestComboRef.current = 0;
    lastTapTimeRef.current = 0;
    coinsRef.current = [];
    setCoins([]);
    gameActiveRef.current = true;

    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          endGame();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    spawnerRef.current = setInterval(() => {
      if (gameActiveRef.current) spawnCoin();
    }, SPAWN_INTERVAL);

    cleanerRef.current = setInterval(cleanExpiredCoins, 200);
  }, [spawnCoin, cleanExpiredCoins]);

  const bankedRef = useRef(false);

  const endGame = useCallback(() => {
    gameActiveRef.current = false;
    if (timerRef.current) clearInterval(timerRef.current);
    if (spawnerRef.current) clearInterval(spawnerRef.current);
    if (cleanerRef.current) clearInterval(cleanerRef.current);

    const finalScore = scoreRef.current;
    const earnedReward = getRewardTier(finalScore);
    setReward(earnedReward);
    setGameState("finished");

    if (!bankedRef.current) {
      bankedRef.current = true;
      void recordGamePlay("tap-frenzy", dollarsToPoints(earnedReward), `Tap Frenzy: ${finalScore} taps`);
    }
    setCanPlay(false);
  }, []);

  useEffect(() => {
    return () => {
      gameActiveRef.current = false;
      if (timerRef.current) clearInterval(timerRef.current);
      if (spawnerRef.current) clearInterval(spawnerRef.current);
      if (cleanerRef.current) clearInterval(cleanerRef.current);
    };
  }, []);

  const handleTapCoin = useCallback((coinId: string) => {
    const coin = coinsRef.current.find((c) => c.id === coinId);
    if (!coin || coin.tapped) return;

    coin.tapped = true;

    Animated.parallel([
      Animated.timing(coin.scale, {
        toValue: 1.8,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(coin.opacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();

    scoreRef.current += 1;
    setScore(scoreRef.current);

    const now = Date.now();
    if (now - lastTapTimeRef.current < COMBO_WINDOW) {
      comboRef.current += 1;
    } else {
      comboRef.current = 1;
    }
    lastTapTimeRef.current = now;

    if (comboRef.current > bestComboRef.current) {
      bestComboRef.current = comboRef.current;
      setBestCombo(bestComboRef.current);
    }
    setCombo(comboRef.current);

    setTimeout(() => {
      coinsRef.current = coinsRef.current.filter((c) => c.id !== coinId);
      setCoins([...coinsRef.current]);
    }, 200);
  }, []);

  return (
    <View style={[styles.container, { paddingTop: topInset, paddingBottom: gameState === "playing" ? bottomInset : 0 }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} testID="back-button" style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t.games.tapFrenzy}</Text>
        <View style={styles.backButton} />
      </View>

      {gameState === "idle" && (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[styles.centerContent, { paddingBottom: bottomInset + 24 }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.iconContainer}>
            <Ionicons name="finger-print" size={80} color={Colors.accent} />
          </View>
          <Text style={styles.gameName}>{t.games.tapFrenzy}</Text>
          <Text style={styles.gameDescription}>{t.games.tapFrenzyDesc}</Text>

          <View style={styles.rulesContainer}>
            <View style={styles.ruleRow}>
              <Ionicons name="time-outline" size={20} color={Colors.primary} />
              <Text style={styles.ruleText}>20s</Text>
            </View>
            <View style={styles.ruleRow}>
              <Ionicons name="trophy-outline" size={20} color={Colors.accent} />
              <Text style={styles.ruleText}>31+ {t.games.tap}s = $0.25</Text>
            </View>
            <View style={styles.ruleRow}>
              <Ionicons name="flash-outline" size={20} color={Colors.primary} />
              <Text style={styles.ruleText}>{t.games.combo}</Text>
            </View>
          </View>

          {canPlay ? (
            <TouchableOpacity style={styles.playButton} onPress={startGame} testID="play-button">
              <Ionicons name="play" size={28} color={Colors.background} />
              <Text style={styles.playButtonText}>{t.games.play}</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.cooldownContainer}>
              <Ionicons name="time" size={28} color={Colors.textMuted} />
              <Text style={styles.cooldownText}>{t.games.comeBackTomorrow}</Text>
            </View>
          )}
        </ScrollView>
      )}

      {gameState === "playing" && (
        <View style={styles.playArea}>
          <View style={styles.hud}>
            <View style={styles.hudItem}>
              <Ionicons name="time-outline" size={18} color={Colors.text} />
              <Text style={[styles.hudValue, timeLeft <= 5 && styles.hudValueDanger]}>
                {timeLeft}s
              </Text>
            </View>
            <View style={styles.hudItem}>
              <Ionicons name="star" size={18} color={Colors.accent} />
              <Text style={styles.hudValue}>{score}</Text>
            </View>
            {combo > 1 && (
              <View style={styles.comboContainer}>
                <Ionicons name="flash" size={16} color={Colors.primary} />
                <Text style={styles.comboText}>x{combo}</Text>
              </View>
            )}
          </View>

          <View style={[styles.gameField, { height: playAreaHeight }]}>
            {coins.map((coin) => (
              <Animated.View
                key={coin.id}
                style={[
                  styles.coin,
                  {
                    left: coin.x - COIN_SIZE / 2,
                    top: coin.y - COIN_SIZE / 2,
                    opacity: coin.opacity,
                    transform: [{ scale: coin.scale }],
                  },
                ]}
              >
                <TouchableOpacity
                  onPress={() => handleTapCoin(coin.id)}
                  activeOpacity={0.7}
                  testID={`coin-${coin.id}`}
                  style={styles.coinTouchable}
                >
                  <Ionicons name="logo-bitcoin" size={36} color={Colors.background} />
                </TouchableOpacity>
              </Animated.View>
            ))}
          </View>

          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${(timeLeft / GAME_DURATION) * 100}%` }]} />
          </View>
        </View>
      )}

      {gameState === "finished" && (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[styles.centerContent, { paddingBottom: bottomInset + 24 }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.resultIconContainer}>
            <Ionicons name="trophy" size={64} color={Colors.accent} />
          </View>
          <Text style={styles.resultLabel}>{t.games.gameOver}</Text>
          <Text style={styles.performanceLabel}>{getPerformanceLabel(score, t)}</Text>

          <View style={styles.resultStats}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{score}</Text>
              <Text style={styles.statLabel}>{t.games.tap}s</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>x{bestCombo}</Text>
              <Text style={styles.statLabel}>{t.games.combo}</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, styles.rewardValue]}>{formatPoints(dollarsToPoints(reward))}</Text>
              <Text style={styles.statLabel}>{t.games.earned}</Text>
            </View>
          </View>

          <View style={styles.tierBreakdown}>
            {[
              { min: 0, max: 10, reward: "300 pts" },
              { min: 11, max: 20, reward: "800 pts" },
              { min: 21, max: 30, reward: "1,500 pts" },
              { min: 31, max: 99, reward: "2,500 pts" },
            ].map((tier, i) => (
              <View
                key={i}
                style={[
                  styles.tierRow,
                  score >= tier.min && score <= tier.max && styles.tierRowActive,
                ]}
              >
                <Text style={styles.tierRange}>
                  {tier.min}-{tier.max === 99 ? "+" : tier.max} {t.games.tap}s
                </Text>
                <Text style={[styles.tierReward, score >= tier.min && score <= tier.max && styles.tierRewardActive]}>
                  {tier.reward}
                </Text>
              </View>
            ))}
          </View>

          <TouchableOpacity style={styles.doneButton} onPress={() => router.back()} testID="done-button">
            <Ionicons name="checkmark" size={24} color={Colors.background} />
          </TouchableOpacity>
        </ScrollView>
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
    fontSize: 18,
    fontWeight: "700" as const,
    color: Colors.text,
  },
  scrollView: {
    flex: 1,
  },
  centerContent: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  iconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: Colors.surfaceLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  gameName: {
    fontSize: 28,
    fontWeight: "800" as const,
    color: Colors.text,
    marginBottom: 8,
  },
  gameDescription: {
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: "center",
    marginBottom: 32,
  },
  rulesContainer: {
    width: "100%",
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 32,
    gap: 12,
  },
  ruleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  ruleText: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  playButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.primary,
    paddingHorizontal: 40,
    paddingVertical: 16,
    borderRadius: 30,
  },
  playButtonText: {
    fontSize: 18,
    fontWeight: "700" as const,
    color: Colors.background,
  },
  cooldownContainer: {
    alignItems: "center",
    gap: 8,
  },
  cooldownText: {
    fontSize: 16,
    color: Colors.textMuted,
  },
  playArea: {
    flex: 1,
  },
  hud: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 24,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  hudItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  hudValue: {
    fontSize: 20,
    fontWeight: "700" as const,
    color: Colors.text,
  },
  hudValueDanger: {
    color: Colors.error,
  },
  comboContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.surfaceLight,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  comboText: {
    fontSize: 16,
    fontWeight: "700" as const,
    color: Colors.primary,
  },
  gameField: {
    flex: 1,
    position: "relative",
  },
  coin: {
    position: "absolute",
    width: COIN_SIZE,
    height: COIN_SIZE,
  },
  coinTouchable: {
    width: COIN_SIZE,
    height: COIN_SIZE,
    borderRadius: COIN_SIZE / 2,
    backgroundColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 6,
  },
  progressBar: {
    height: 4,
    backgroundColor: Colors.surfaceLight,
    marginHorizontal: 16,
    borderRadius: 2,
    marginBottom: 16,
  },
  progressFill: {
    height: "100%",
    backgroundColor: Colors.primary,
    borderRadius: 2,
  },
  resultIconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: Colors.surfaceLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  resultLabel: {
    fontSize: 24,
    fontWeight: "800" as const,
    color: Colors.text,
    marginBottom: 4,
  },
  performanceLabel: {
    fontSize: 18,
    fontWeight: "600" as const,
    color: Colors.primary,
    marginBottom: 24,
  },
  resultStats: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
    width: "100%",
  },
  statItem: {
    flex: 1,
    alignItems: "center",
  },
  statValue: {
    fontSize: 24,
    fontWeight: "700" as const,
    color: Colors.text,
  },
  rewardValue: {
    color: Colors.primary,
  },
  statLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  statDivider: {
    width: 1,
    height: 30,
    backgroundColor: Colors.border,
  },
  tierBreakdown: {
    width: "100%",
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 12,
    marginBottom: 32,
    gap: 4,
  },
  tierRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  tierRowActive: {
    backgroundColor: Colors.surfaceLight,
  },
  tierRange: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  tierReward: {
    fontSize: 14,
    fontWeight: "600" as const,
    color: Colors.textMuted,
  },
  tierRewardActive: {
    color: Colors.primary,
  },
  doneButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
});
