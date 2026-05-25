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
  nameKey: keyof typeof GAME_META;
  descKey: keyof typeof GAME_META;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  rewardRange: string;
  route: string;
}

const GAME_META = {
  scratchCard: "scratchCard",
  scratchCardDesc: "scratchCardDesc",
  memoryMatch: "memoryMatch",
  memoryMatchDesc: "memoryMatchDesc",
  triviaQuiz: "triviaQuiz",
  triviaQuizDesc: "triviaQuizDesc",
  coinCatcher: "coinCatcher",
  coinCatcherDesc: "coinCatcherDesc",
  tapFrenzy: "tapFrenzy",
  tapFrenzyDesc: "tapFrenzyDesc",
  solitaire: "solitaire",
  solitaireDesc: "solitaireDesc",
  dominoes: "dominoes",
  dominoesDesc: "dominoesDesc",
  tetris: "tetris",
  tetrisDesc: "tetrisDesc",
  blockBlitz: "blockBlitz",
  blockBlitzDesc: "blockBlitzDesc",
} as const;

const CASUAL_GAMES: GameInfo[] = [
  {
    id: "scratch-card",
    nameKey: "scratchCard" as any,
    descKey: "scratchCardDesc" as any,
    icon: "grid-outline",
    iconColor: "#FFD600",
    rewardRange: "100 - 500 pts",
    route: "/game/scratch-card",
  },
  {
    id: "memory-match",
    nameKey: "memoryMatch" as any,
    descKey: "memoryMatchDesc" as any,
    icon: "layers-outline",
    iconColor: "#00E676",
    rewardRange: "50 - 150 pts",
    route: "/game/memory-match",
  },
  {
    id: "trivia",
    nameKey: "triviaQuiz" as any,
    descKey: "triviaQuizDesc" as any, // nosemgrep: generic.secrets.gitleaks.generic-api-key
    icon: "help-circle-outline",
    iconColor: "#448AFF",
    rewardRange: "10 - 200 pts",
    route: "/game/trivia",
  },
];

const CLASSIC_GAMES: GameInfo[] = [
  {
    id: "solitaire",
    nameKey: "solitaire" as any,
    descKey: "solitaireDesc" as any,
    icon: "card-outline",
    iconColor: "#FF5252",
    rewardRange: "50 - 250 pts",
    route: "/game/solitaire",
  },
  {
    id: "dominoes",
    nameKey: "dominoes" as any,
    descKey: "dominoesDesc" as any,
    icon: "dice-outline",
    iconColor: "#FFFFFF",
    rewardRange: "50 - 200 pts",
    route: "/game/dominoes",
  },
];

const ARCADE_GAMES: GameInfo[] = [
  {
    id: "tetris",
    nameKey: "tetris" as any,
    descKey: "tetrisDesc" as any,
    icon: "apps-outline",
    iconColor: "#00BCD4",
    rewardRange: "25 - 250 pts",
    route: "/game/tetris",
  },
  {
    id: "block-blitz",
    nameKey: "blockBlitz" as any,
    descKey: "blockBlitzDesc" as any,
    icon: "cube-outline",
    iconColor: "#FF6D00",
    rewardRange: "25 - 250 pts",
    route: "/game/block-blitz",
  },
  {
    id: "coin-catcher",
    nameKey: "coinCatcher" as any,
    descKey: "coinCatcherDesc" as any,
    icon: "arrow-down-circle-outline",
    iconColor: "#FF9100",
    rewardRange: "10 - 150 pts",
    route: "/game/coin-catcher",
  },
  {
    id: "tap-frenzy",
    nameKey: "tapFrenzy" as any,
    descKey: "tapFrenzyDesc" as any,
    icon: "finger-print-outline",
    iconColor: "#E040FB",
    rewardRange: "25 - 250 pts",
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

  const gameName = t.games[game.nameKey] || game.nameKey;
  const gameDesc = t.games[game.descKey] || game.descKey;

  return (
    <Animated.View style={[animStyle, { width: CARD_WIDTH }]}>
      <Pressable
        testID={`game-card-${game.id}`}
        onPressIn={() => {
          scale.value = withSpring(0.95);
        }}
        onPressOut={() => {
          scale.value = withSpring(1);
        }}
        onPress={onPress}
        style={[
          cardStyles.card,
          !available && cardStyles.cardDisabled,
        ]}
      >
        <View
          style={[
            cardStyles.iconContainer,
            { backgroundColor: game.iconColor + "20" },
          ]}
        >
          <Ionicons name={game.icon} size={28} color={game.iconColor} />
        </View>
        <Text style={cardStyles.name} numberOfLines={1}>
          {gameName}
        </Text>
        <Text style={cardStyles.desc} numberOfLines={2}>
          {gameDesc}
        </Text>
        <View style={cardStyles.rewardRow}>
          <Ionicons name="cash-outline" size={14} color={Colors.primary} />
          <Text style={cardStyles.rewardText}>{game.rewardRange}</Text>
        </View>
        {!available && (
          <View style={cardStyles.cooldownOverlay}>
            <Ionicons name="time-outline" size={18} color={Colors.accent} />
            <Text style={cardStyles.cooldownText}>
              {t.games.comeBackTomorrow}
            </Text>
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
    await Promise.all(
      allGames.map(async (g) => {
        results[g.id] = await canPlayGame(g.id);
      })
    );
    setAvailability(results);
    const played = await getGamesPlayedToday();
    setGamesPlayedToday(played);
  }, []);

  useEffect(() => {
    loadAvailability();
  }, []);

  const webTopPad = Platform.OS === "web" ? 67 : 0;
  const webBottomPad = Platform.OS === "web" ? 34 : 0;

  const remaining = MAX_DAILY_GAMES - gamesPlayedToday;

  const handleGamePress = (game: GameInfo) => {
    if (remaining <= 0 || availability[game.id] === false) return;
    router.push(game.route as any);
  };

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: Platform.OS === "web" ? webTopPad : insets.top,
        },
      ]}
    >
      <View style={styles.header}>
        <Pressable
          testID="games-back-button"
          onPress={() => router.back()}
          hitSlop={12}
        >
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{t.games.title}</Text>
          <Text style={styles.headerSubtitle}>{t.games.subtitle}</Text>
        </View>
        <View style={styles.dailyCounter}>
          <Ionicons name="game-controller-outline" size={16} color={Colors.primary} />
          <Text style={styles.dailyCounterText}>
            {remaining > 0 ? remaining : 0}
          </Text>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: Platform.OS === "web" ? webBottomPad + 20 : insets.bottom + 20,
        }}
      >
        <View style={styles.dailyInfoCard}>
          <Ionicons name="trophy-outline" size={20} color={Colors.accent} />
          <Text style={styles.dailyInfoText}>
            {t.games.dailyPlaysLeft}: {remaining > 0 ? remaining : 0}/{MAX_DAILY_GAMES}
          </Text>
        </View>

        <Text style={styles.sectionLabel}>{t.games.casualGames}</Text>
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

        <Text style={styles.sectionLabel}>{t.games.classicGames}</Text>
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

        <Text style={styles.sectionLabel}>{t.games.arcadeGames}</Text>
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
  headerCenter: {
    flex: 1,
  },
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
    marginBottom: 24,
  },
});

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    minHeight: 160,
  },
  cardDisabled: {
    opacity: 0.5,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
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
    marginBottom: 8,
    lineHeight: 15,
  },
  rewardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  rewardText: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 12,
    color: Colors.primary,
  },
  cooldownOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 16,
    backgroundColor: "rgba(10, 10, 15, 0.75)",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  cooldownText: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 11,
    color: Colors.accent,
    textAlign: "center",
  },
});
