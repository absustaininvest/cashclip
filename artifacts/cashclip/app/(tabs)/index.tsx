import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Dimensions,
  Platform,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useFonts, Outfit_400Regular, Outfit_600SemiBold, Outfit_700Bold } from "@expo-google-fonts/outfit";
import Colors from "@/constants/colors";
import { generateVideos, type VideoItem } from "@/lib/video-data";
import { useRouter } from "expo-router";
import { useLanguage } from "@/lib/LanguageContext";
import { toggleLikeVideo, getLikedVideos, recordVideoWatch, getUserStats, getUnreadNotificationCount, addEarnings, type UserStats } from "@/lib/storage";
import { isAdMobReady, showRewardedAd } from "@/lib/admob";
import SponsoredSection from "@/components/SponsoredSection";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const CARD_WIDTH = (SCREEN_WIDTH - 48) / 2;

function VideoCard({
  video,
  liked,
  isWatching,
  onLike,
  onWatch,
}: {
  video: VideoItem;
  liked: boolean;
  isWatching: boolean;
  onLike: () => void;
  onWatch: () => void;
}) {
  const scale = useSharedValue(1);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={[animStyle, { width: CARD_WIDTH }]}>
      <Pressable
        onPressIn={() => { scale.value = withSpring(0.96); }}
        onPressOut={() => { scale.value = withSpring(1); }}
        onPress={isWatching ? undefined : onWatch}
        style={styles.videoCard}
      >
        <View style={[styles.thumbnail, { backgroundColor: video.color }]}>
          {isWatching ? (
            <ActivityIndicator size="large" color="#fff" />
          ) : (
            <Feather name={video.icon as any} size={28} color="rgba(255,255,255,0.9)" />
          )}
          <View style={styles.durationBadge}>
            <Text style={styles.durationText}>{video.duration}</Text>
          </View>
          <View style={styles.rewardBadge}>
            <MaterialCommunityIcons name="cash" size={10} color={Colors.primary} />
            <Text style={styles.rewardText}>${video.reward.toFixed(2)}</Text>
          </View>
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.videoTitle} numberOfLines={2}>{video.title}</Text>
          <View style={styles.videoMeta}>
            <Text style={styles.channelName}>{video.channel}</Text>
            <View style={styles.viewsRow}>
              <Ionicons name="eye-outline" size={12} color={Colors.textMuted} />
              <Text style={styles.viewsText}>{video.views}</Text>
            </View>
          </View>
        </View>
        <View style={styles.cardActions}>
          <Pressable
            onPress={(e) => {
              e.stopPropagation?.();
              onLike();
            }}
            hitSlop={8}
          >
            <Ionicons
              name={liked ? "heart" : "heart-outline"}
              size={18}
              color={liked ? Colors.error : Colors.textMuted}
            />
          </Pressable>
          <Pressable hitSlop={8}>
            <Feather name="share" size={16} color={Colors.textMuted} />
          </Pressable>
        </View>
      </Pressable>
    </Animated.View>
  );
}

function CategoryPill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.pill, active && styles.pillActive]}
    >
      <Text style={[styles.pillText, active && styles.pillTextActive]}>{label}</Text>
    </Pressable>
  );
}

function RewardToast({ amount, visible }: { amount: number; visible: boolean }) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(20);

  useEffect(() => {
    if (visible) {
      opacity.value = withTiming(1, { duration: 200 });
      translateY.value = withSpring(0);
    } else {
      opacity.value = withTiming(0, { duration: 300 });
      translateY.value = withTiming(20, { duration: 300 });
    }
  }, [visible]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View style={[styles.rewardToast, style]} pointerEvents="none">
      <MaterialCommunityIcons name="cash" size={16} color={Colors.background} />
      <Text style={styles.rewardToastText}>+${amount.toFixed(2)} earned!</Text>
    </Animated.View>
  );
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useLanguage();
  const [videos] = useState(() => generateVideos(25));
  const [likedSet, setLikedSet] = useState<Set<string>>(new Set());
  const [activeCategory, setActiveCategory] = useState(t.home.all);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [watchingId, setWatchingId] = useState<string | null>(null);
  const [toastAmount, setToastAmount] = useState(0);
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [fontsLoaded] = useFonts({ Outfit_400Regular, Outfit_600SemiBold, Outfit_700Bold });

  useEffect(() => {
    getLikedVideos().then(setLikedSet);
    getUserStats().then(setStats);
    getUnreadNotificationCount().then(setUnreadCount);
  }, []);

  useEffect(() => {
    setActiveCategory(t.home.all);
  }, [t]);

  const showToast = useCallback((amount: number) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastAmount(amount);
    setToastVisible(true);
    toastTimerRef.current = setTimeout(() => setToastVisible(false), 2500);
  }, []);

  const categories = useMemo(() => {
    const cats = [t.home.all, ...new Set(videos.map((v) => v.category))];
    return cats;
  }, [videos, t]);

  const filteredVideos = useMemo(() => {
    if (activeCategory === t.home.all) return videos;
    return videos.filter((v) => v.category === activeCategory);
  }, [videos, activeCategory, t]);

  const handleLike = useCallback(async (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const isLiked = await toggleLikeVideo(id);
    setLikedSet((prev) => {
      const next = new Set(prev);
      if (isLiked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const handleWatch = useCallback(async (video: VideoItem) => {
    if (watchingId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (!isAdMobReady()) return;

    setWatchingId(video.id);
    try {
      const result = await showRewardedAd();
      if (result.rewarded) {
        await recordVideoWatch();
        await addEarnings(video.reward, `Watched: ${video.title}`, "earned");
        const updated = await getUserStats();
        setStats(updated);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showToast(video.reward);
      }
    } finally {
      setWatchingId(null);
    }
  }, [watchingId, router, showToast]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    const [liked, s] = await Promise.all([getLikedVideos(), getUserStats()]);
    setLikedSet(liked);
    setStats(s);
    setRefreshing(false);
  }, []);

  if (!fontsLoaded) return null;

  const webTopPad = Platform.OS === "web" ? 67 : 0;

  return (
    <View style={[styles.container, { paddingTop: webTopPad }]}>
      <FlatList
        data={filteredVideos}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.row}
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: Platform.OS === "web" ? 34 : 0, paddingHorizontal: 16 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.topRow}>
              <View>
                <Text style={styles.greeting}>{t.home.title}</Text>
                <Text style={styles.subtitle}>{t.home.subtitle}</Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/notifications"); }}>
                  <Feather name="bell" size={22} color={Colors.text} />
                  {unreadCount > 0 && (
                    <View style={{ position: "absolute", top: -4, right: -4, backgroundColor: Colors.error, borderRadius: 8, minWidth: 16, height: 16, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 }}>
                      <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 9, color: "#fff" }}>{unreadCount}</Text>
                    </View>
                  )}
                </Pressable>
                {stats && (
                  <View style={styles.balanceChip}>
                    <MaterialCommunityIcons name="cash" size={16} color={Colors.primary} />
                    <Text style={styles.balanceChipText}>${stats.balance.toFixed(2)}</Text>
                  </View>
                )}
              </View>
            </View>

            <View style={styles.missionBanner}>
              <LinearGradient
                colors={["rgba(0,230,118,0.12)", "rgba(0,230,118,0.04)"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.missionGradient}
              >
                <Text style={styles.missionQuote}>
                  "We believe every penny moves you forward."
                </Text>
                <View style={styles.mottoRow}>
                  {["BUILD", "GROW", "SUSTAIN", "SUCCEED"].map((word, i) => (
                    <View key={word} style={styles.mottoItem}>
                      <Text style={styles.mottoWord}>{word}</Text>
                      {i < 3 && <Text style={styles.mottoDot}>·</Text>}
                    </View>
                  ))}
                </View>
              </LinearGradient>
            </View>

            <FlatList
              data={categories}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={(item) => item}
              contentContainerStyle={styles.pillRow}
              renderItem={({ item }) => (
                <CategoryPill
                  label={item}
                  active={activeCategory === item}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setActiveCategory(item);
                  }}
                />
              )}
            />

            <View style={styles.quickAccessRow}>
              <Pressable
                style={styles.quickAccessBtn}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/games"); }}
                testID="quick-games"
              >
                <Ionicons name="game-controller" size={18} color="#FFD600" />
                <Text style={styles.quickAccessText}>{t.home.games}</Text>
                <Feather name="chevron-right" size={14} color={Colors.textMuted} />
              </Pressable>
              <Pressable
                style={styles.quickAccessBtn}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/surveys"); }}
                testID="quick-surveys"
              >
                <Ionicons name="clipboard" size={18} color="#4ECDC4" />
                <Text style={styles.quickAccessText}>{t.home.surveys}</Text>
                <Feather name="chevron-right" size={14} color={Colors.textMuted} />
              </Pressable>
            </View>

            <SponsoredSection />
          </View>
        }
        renderItem={({ item }) => (
          <VideoCard
            video={item}
            liked={likedSet.has(item.id)}
            isWatching={watchingId === item.id}
            onLike={() => handleLike(item.id)}
            onWatch={() => handleWatch(item)}
          />
        )}
      />

      <RewardToast amount={toastAmount} visible={toastVisible} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    paddingTop: 8,
    paddingBottom: 8,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  greeting: {
    fontFamily: "Outfit_700Bold",
    fontSize: 28,
    color: Colors.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  balanceChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(0, 230, 118, 0.1)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(0, 230, 118, 0.2)",
  },
  balanceChipText: {
    fontFamily: "Outfit_700Bold",
    fontSize: 15,
    color: Colors.primary,
  },
  missionBanner: {
    marginBottom: 16,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(0,230,118,0.18)",
  },
  missionGradient: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 8,
  },
  missionQuote: {
    fontFamily: "Outfit_400Regular",
    fontSize: 13,
    color: "rgba(255,255,255,0.75)",
    fontStyle: "italic",
    lineHeight: 18,
  },
  mottoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  mottoItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  mottoWord: {
    fontFamily: "Outfit_700Bold",
    fontSize: 11,
    color: "#00E676",
    letterSpacing: 1.2,
  },
  mottoDot: {
    fontFamily: "Outfit_400Regular",
    fontSize: 11,
    color: "rgba(0,230,118,0.4)",
  },
  pillRow: {
    gap: 8,
    paddingBottom: 4,
  },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  pillActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  pillText: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: Colors.textSecondary,
  },
  pillTextActive: {
    color: Colors.background,
  },
  quickAccessRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
    marginBottom: 4,
  },
  quickAccessBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  quickAccessText: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 14,
    color: Colors.text,
    flex: 1,
  },
  row: {
    gap: 12,
    marginBottom: 12,
  },
  videoCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  thumbnail: {
    height: 100,
    alignItems: "center",
    justifyContent: "center",
  },
  durationBadge: {
    position: "absolute",
    bottom: 6,
    right: 6,
    backgroundColor: "rgba(0,0,0,0.7)",
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  durationText: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 10,
    color: "#fff",
  },
  rewardBadge: {
    position: "absolute",
    top: 6,
    left: 6,
    backgroundColor: "rgba(0,0,0,0.7)",
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  rewardText: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 10,
    color: Colors.primary,
  },
  cardBody: {
    padding: 10,
    gap: 4,
  },
  videoTitle: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: Colors.text,
    lineHeight: 17,
  },
  videoMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  channelName: {
    fontFamily: "Outfit_400Regular",
    fontSize: 11,
    color: Colors.textMuted,
  },
  viewsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  viewsText: {
    fontFamily: "Outfit_400Regular",
    fontSize: 11,
    color: Colors.textMuted,
  },
  cardActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingBottom: 10,
  },
  rewardToast: {
    position: "absolute",
    bottom: 100,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  rewardToastText: {
    fontFamily: "Outfit_700Bold",
    fontSize: 15,
    color: Colors.background,
  },
});
