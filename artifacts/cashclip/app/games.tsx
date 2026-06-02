import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Platform,
  Dimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import Colors from "@/constants/colors";
import { useLanguage } from "@/lib/LanguageContext";
import { canPlayGame, getGamesPlayedToday } from "@/lib/storage";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const CARD_GAP = 12;
const CARD_WIDTH = (SCREEN_WIDTH - 32 - CARD_GAP) / 2;
const MAX_DAILY_GAMES = 9;

interface GameInfo {
  id: string;
  nameKey: string;
  descKey: string;
  emoji: string;
  gradientColors: [string, string];
  rewardRange: string;
  route: string;
  hot?: boolean;
}

const CASUAL_GAMES: GameInfo[] = [
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

const CLASSIC_GAMES: GameInfo[] = [
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

const ARCADE_GAMES: GameInfo[] = [
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

function GameCard({
  game,
  available,
  onPress,
  t,
}: {
  game: GameInfo;
  available: boolean;
  onPress: () => void;
  t: any;
}) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  const gameName = (t.games as any)[game.nameKey] || game.nameKey;
  const gameDesc = (t.games as any)[game.descKey] || game.descKey;

  return (
    <Animated.View style={[animStyle, { width: CARD_WIDTH }]}>
      <Pressable
        testID={`game-card-${game.id}`}
        onPressIn={() => { scale.value = withSpring(0.95); }}
        onPressOut={() => { scale.value = withSpring(1); }}
        onPress={onPress}
        style={[cardStyles.card, !available && cardStyles.cardDisabled]}
      >
        <LinearGradient
          colors={[game.gradientColors[0] + "18", game.gradientColors[1] + "08", "transparent"]}
          style={cardStyles.gradientOverlay}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />
        {game.hot && (
          <View style={cardStyles.hotBadge}>
            <Text style={cardStyles.hotText}>🔥 HOT</Text>
          </View>
        )}
        <Text style={cardStyles.emoji}>{game.emoji}</Text>
        <Text style={cardStyles.name} numberOfLines={1}>{gameName}</Text>
        <Text style={cardStyles.desc} numberOfLines={2}>{gameDesc}</Text>
        <View style={[cardStyles.rewardPill, { backgroundColor: game.gradientColors[0] + "22", borderColor: game.gradientColors[0] + "44" }]}>
          <Ionicons name="cash-outline" size={11} color={game.gradientColors[0]} />
          <Text style={[cardStyles.rewardText, { color: game.gradientColors[0] }]}>{game.rewardRange}</Text>
        </View>
        {!available && (
          <View style={cardStyles.cooldownOverlay}>
            <Ionicons name="time-outline" size={20} color={Colors.accent} />
            <Text style={cardStyles.cooldownText}>{t.games.comeBackTomorrow}</Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

export default function GamesHubScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useLanguage();
  const [availability, setAvailability] = useState<Record<string, boolean>>({});
  const [gamesPlayedToday, setGamesPlayedToday] = useState(0);

  const loadAvailability = useCallback(async () => {
    const allGames = [...CASUAL_GAMES, ...CLASSIC_GAMES, ...ARCADE_GAMES];
    const results: Record<string, boolean> = {};
    await Promise.all(allGames.map(async (g) => { results[g.id] = await canPlayGame(g.id); }));
    setAvailability(results);
    setGamesPlayedToday(await getGamesPlayedToday());
  }, []);

  useEffect(() => { loadAvailability(); }, []);

  const webTopPad = Platform.OS === "web" ? 67 : 0;
  const webBottomPad = Platform.OS === "web" ? 34 : 0;
  const remaining = Math.max(0, MAX_DAILY_GAMES - gamesPlayedToday);

  const handleGamePress = (game: GameInfo) => {
    if (remaining <= 0 || availability[game.id] === false) return;
    router.push(game.route as any);
  };

  return (
    <View style={[styles.container, { paddingTop: Platform.OS === "web" ? webTopPad : insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="games-back-button" onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{t.games.title}</Text>
          <Text style={styles.headerSubtitle}>{t.games.subtitle}</Text>
        </View>
        <View style={styles.dailyCounter}>
          <Ionicons name="game-controller-outline" size={16} color={Colors.primary} />
          <Text style={styles.dailyCounterText}>{remaining}</Text>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: Platform.OS === "web" ? webBottomPad + 20 : insets.bottom + 20,
        }}
      >
        <Pressable testID="real-games-hero" onPress={() => router.push("/offerwalls" as any)}>
          <LinearGradient
            colors={["#4F46E5", "#7C3AED", "#9333EA"]}
            style={styles.heroCard}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <View style={styles.heroLeft}>
              <Text style={styles.heroLabel}>🎮 PLAY REAL APP GAMES</Text>
              <Text style={styles.heroTitle}>Earn up to $25/game</Text>
              <Text style={styles.heroDesc}>Install real games, reach milestones, cash out via PayPal</Text>
            </View>
            <View style={styles.heroRight}>
              <Text style={styles.heroBigReward}>$25</Text>
              <Text style={styles.heroPerGame}>per game</Text>
              <View style={styles.heroArrowBtn}>
                <Ionicons name="arrow-forward" size={16} color="#FFF" />
              </View>
            </View>
          </LinearGradient>
        </Pressable>

        <View style={styles.dailyInfoCard}>
          <Ionicons name="trophy-outline" size={16} color={Colors.accent} />
          <Text style={styles.dailyInfoText}>
            {t.games.dailyPlaysLeft}: {remaining}/{MAX_DAILY_GAMES}
          </Text>
        </View>

        <Text style={styles.sectionLabel}>⚡ {t.games.casualGames}</Text>
        <View style={styles.grid}>
          {CASUAL_GAMES.map((game) => (
            <GameCard
              key={game.id}
              game={game}
              available={availability[game.id] !== false}
              onPress={() => handleGamePress(game)}
              t={t}
            />
          ))}
        </View>

        <Text style={styles.sectionLabel}>🃏 {t.games.classicGames}</Text>
        <View style={styles.grid}>
          {CLASSIC_GAMES.map((game) => (
            <GameCard
              key={game.id}
              game={game}
              available={availability[game.id] !== false}
              onPress={() => handleGamePress(game)}
              t={t}
            />
          ))}
        </View>

        <Text style={styles.sectionLabel}>🕹️ {t.games.arcadeGames}</Text>
        <View style={styles.grid}>
          {ARCADE_GAMES.map((game) => (
            <GameCard
              key={game.id}
              game={game}
              available={availability[game.id] !== false}
              onPress={() => handleGamePress(game)}
              t={t}
            />
          ))}
        </View>
      </ScrollView>
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
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  headerCenter: { flex: 1 },
  headerTitle: {
    fontFamily: "Outfit_700Bold",
    fontSize: 22,
    color: Colors.text,
  },
  headerSubtitle: {
    fontFamily: "Outfit_400Regular",
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  dailyCounter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.surface,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  dailyCounterText: {
    fontFamily: "Outfit_700Bold",
    fontSize: 16,
    color: Colors.primary,
  },
  heroCard: {
    borderRadius: 20,
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
    overflow: "hidden",
  },
  heroLeft: {
    flex: 1,
    gap: 5,
    paddingRight: 12,
  },
  heroLabel: {
    fontFamily: "Outfit_700Bold",
    fontSize: 10,
    color: "rgba(255,255,255,0.75)",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  heroTitle: {
    fontFamily: "Outfit_700Bold",
    fontSize: 20,
    color: "#FFF",
    lineHeight: 24,
  },
  heroDesc: {
    fontFamily: "Outfit_400Regular",
    fontSize: 12,
    color: "rgba(255,255,255,0.75)",
    lineHeight: 17,
  },
  heroRight: {
    alignItems: "center",
    gap: 2,
  },
  heroBigReward: {
    fontFamily: "Outfit_700Bold",
    fontSize: 32,
    color: "#FFF",
  },
  heroPerGame: {
    fontFamily: "Outfit_400Regular",
    fontSize: 11,
    color: "rgba(255,255,255,0.75)",
  },
  heroArrowBtn: {
    marginTop: 8,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  dailyInfoCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  dailyInfoText: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 14,
    color: Colors.textSecondary,
  },
  sectionLabel: {
    fontFamily: "Outfit_700Bold",
    fontSize: 18,
    color: Colors.text,
    marginBottom: 12,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: CARD_GAP,
    marginBottom: 28,
  },
});

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    minHeight: 168,
    overflow: "hidden",
  },
  cardDisabled: { opacity: 0.5 },
  gradientOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  hotBadge: {
    position: "absolute",
    top: 10,
    right: 10,
    backgroundColor: "rgba(239,68,68,0.15)",
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.3)",
  },
  hotText: {
    fontFamily: "Outfit_700Bold",
    fontSize: 9,
    color: "#EF4444",
    letterSpacing: 0.5,
  },
  emoji: {
    fontSize: 30,
    marginBottom: 8,
  },
  name: {
    fontFamily: "Outfit_700Bold",
    fontSize: 15,
    color: Colors.text,
    marginBottom: 3,
  },
  desc: {
    fontFamily: "Outfit_400Regular",
    fontSize: 11,
    color: Colors.textMuted,
    marginBottom: 10,
    lineHeight: 15,
  },
  rewardPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
    borderWidth: 1,
  },
  rewardText: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 11,
  },
  cooldownOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 18,
    backgroundColor: "rgba(10, 10, 15, 0.80)",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  cooldownText: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 11,
    color: Colors.accent,
    textAlign: "center",
    paddingHorizontal: 12,
  },
});
