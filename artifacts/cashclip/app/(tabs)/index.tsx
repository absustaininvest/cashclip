import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Dimensions,
  Platform,
  RefreshControl,
  Share,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useFonts, Outfit_400Regular, Outfit_600SemiBold, Outfit_700Bold } from "@expo-google-fonts/outfit";
import Colors from "@/constants/colors";
import { useRouter } from "expo-router";
import { useLanguage } from "@/lib/LanguageContext";
import { getUnreadNotificationCount, recordAdWatch } from "@/lib/storage";
import { fetchServerBalance, fetchProfileComplete, beginAdView, completeAdView } from "@/lib/earn-client";
import { showRewardedAd, isAdMobReady, preloadRewardedAd } from "@/lib/admob";
import SponsoredSection from "@/components/SponsoredSection";
import NativeAdCard, { CARD_WIDTH, PLACEHOLDER_CARDS, adSlotReward } from "@/components/NativeAdCard";
import RewardedAdModal from "@/components/RewardedAdModal";
import InFeedBanner from "@/components/InFeedBanner";
import Chipley from "@/components/Chipley";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const AD_CARD_COUNT = 25;
// OTA rollout: how many of the 25 home ad slots are live (tappable + paying).
// Shipped in small batches — bump +3 each delivery: 3 → 6 → 9 → 12 → 15 → 18 → 21 → 25.
const LIVE_AD_SLOTS = 25;
const AD_DURATION_SECONDS = 15;

const QUICK_ACCESS = [
  { icon: "film", label: "Videos", color: "#00E676", route: "/earn" },
  { icon: "clipboard", label: "Surveys", color: "#4ECDC4", route: "/surveys" },
  { icon: "game-controller", label: "Games", color: "#FFD600", route: "/games" },
  { icon: "layers", label: "Offers", color: "#E040FB", route: "/offerwalls" },
] as const;

// Shows the survey-profile reminder at most once per app session (module scope
// persists across Home remounts but resets on a cold start).
let surveyProfilePromptShown = false;

const EARN_HIGHLIGHTS = [
  { icon: "rotate-cw", label: "Spin", value: "Up to 500 pts", color: "#1E88E5", route: "/earn" },
  { icon: "check-circle", label: "Check-in", value: "100 pts/day", color: "#43A047", route: "/earn" },
  { icon: "users", label: "Refer", value: "After $3 cashout", color: "#E53935", route: "/referral" },
];

function AnnouncementBanner() {
  const [dismissed, setDismissed] = useState(false);
  const STORAGE_KEY = "cashclip_announcement_v37_dismissed";

  useEffect(() => {
    (async () => {
      try {
        const AsyncStorage = require("@react-native-async-storage/async-storage").default;
        const v = await AsyncStorage.getItem(STORAGE_KEY);
        if (v === "1") setDismissed(true);
      } catch {}
    })();
  }, []);

  if (dismissed) return null;

  const onDismiss = async () => {
    setDismissed(true);
    try {
      const AsyncStorage = require("@react-native-async-storage/async-storage").default;
      await AsyncStorage.setItem(STORAGE_KEY, "1");
    } catch {}
  };

  return (
    <View style={{
      flexDirection: "row", alignItems: "center", gap: 10,
      backgroundColor: "rgba(0,198,160,0.10)",
      borderColor: "rgba(0,198,160,0.30)", borderWidth: 1,
      borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
      marginBottom: 12,
    }}>
      <MaterialCommunityIcons name="rocket-launch" size={20} color={Colors.primary} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 13, color: Colors.text }}>
          New surveys & partners coming soon
        </Text>
        <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: Colors.textSecondary, marginTop: 2 }}>
          Our next update unlocks higher-paying offers — keep earning with games & ads in the meantime!
        </Text>
      </View>
      <Pressable onPress={onDismiss} hitSlop={10}>
        <Feather name="x" size={18} color={Colors.textMuted} />
      </Pressable>
    </View>
  );
}

function EarnHighlightStrip() {
  const router = useRouter();
  return (
    <View style={styles.highlightStrip}>
      <LinearGradient
        colors={["rgba(0,230,118,0.10)", "rgba(0,230,118,0.03)"]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={styles.highlightGradient}
      >
        <View style={styles.highlightHeader}>
          <MaterialCommunityIcons name="lightning-bolt" size={14} color={Colors.primary} />
          <Text style={styles.highlightTitle}>Today's Earn Opportunities</Text>
        </View>
        <View style={styles.highlightRow}>
          {EARN_HIGHLIGHTS.map((h) => (
            <Pressable
              key={h.label}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(h.route as any); }}
              style={({ pressed }) => [styles.highlightItem, { opacity: pressed ? 0.7 : 1 }]}
            >
              <View style={[styles.highlightIcon, { backgroundColor: `${h.color}20` }]}>
                <Feather name={h.icon as any} size={14} color={h.color} />
              </View>
              <Text style={styles.highlightLabel}>{h.label}</Text>
              <Text style={styles.highlightValue}>{h.value}</Text>
            </Pressable>
          ))}
        </View>
      </LinearGradient>
    </View>
  );
}


export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useLanguage();
  const [balance, setBalance] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [adLoading, setAdLoading] = useState(false);
  const [watching, setWatching] = useState<
    null | { brand: string; description: string; color: string; reward: number; duration: number }
  >(null);

  const [fontsLoaded] = useFonts({ Outfit_400Regular, Outfit_600SemiBold, Outfit_700Bold });

  const adIndices = Array.from({ length: AD_CARD_COUNT }, (_, i) => ({ id: `ad_${i}`, index: i }));

  const loadBalance = useCallback(async () => {
    const srv = await fetchServerBalance();
    if (srv) setBalance(srv.balance);
  }, []);

  useEffect(() => {
    loadBalance();
    getUnreadNotificationCount().then(setUnreadCount);
    if (isAdMobReady()) preloadRewardedAd();
    // Once-per-session nudge to finish the survey profile (required to withdraw
    // and unlocks a one-time +350 pts bonus). Only fires when we can confirm the
    // profile is actually incomplete, so we never nag offline or mid-load.
    if (!surveyProfilePromptShown) {
      surveyProfilePromptShown = true;
      fetchProfileComplete().then((complete) => {
        if (complete === false) {
          Alert.alert(
            "Finish your survey profile",
            "Complete your profile to unlock higher-paying surveys and enable withdrawals — plus a one-time +350 points bonus.",
            [
              { text: "Later", style: "cancel" },
              { text: "Complete now", onPress: () => router.push("/survey-profile") },
            ],
          );
        }
      });
    }
  }, [loadBalance, router]);

  // Holds the server-issued challenge token for an in-progress fallback ad watch,
  // so completeAdView() can prove the watch began on the server (anti-fraud).
  const adChallengeRef = useRef<string | null>(null);

  const handleAdPress = useCallback(async (index: number) => {
    if (adLoading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (index >= LIVE_AD_SLOTS) {
      Alert.alert("More ads coming soon", "We're rolling out new ad slots in batches. Check back shortly!");
      return;
    }

    // Real rewarded ad when AdMob is ready — payout comes via Google's verified
    // SSV callback server-side, so we don't credit on the client here.
    if (isAdMobReady()) {
      setAdLoading(true);
      try {
        const result = await showRewardedAd();
        if (result.rewarded) {
          await recordAdWatch();
          loadBalance();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } else if (result.timedOut) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          Alert.alert("Ad Timed Out", "The ad took too long to load. Please check your connection and try again.");
        } else {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          Alert.alert("Ad Not Available", "No ads available right now. Please try again later.");
        }
      } catch {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert("Something Went Wrong", "Could not load the ad. Please try again.");
      } finally {
        setAdLoading(false);
      }
      return;
    }

    // AdMob isn't filling — fall back to the in-app ad. It still pays a small
    // server-decided reward via the secure begin→complete flow (can't be faked
    // by the phone). Get the challenge first so we only show the ad if it can pay.
    setAdLoading(true);
    const begin = await beginAdView();
    setAdLoading(false);
    if (!begin.ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert(
        "Try again",
        begin.retryable
          ? "Ads are busy right now. Please try again in a moment."
          : "Couldn't start the ad. Please try again.",
      );
      return;
    }
    adChallengeRef.current = begin.challengeToken;

    const card = PLACEHOLDER_CARDS[index % PLACEHOLDER_CARDS.length];
    setWatching({
      brand: card.advertiser,
      description: card.headline,
      color: card.color,
      reward: adSlotReward(index),
      duration: AD_DURATION_SECONDS,
    });
  }, [adLoading, loadBalance]);

  const handleAdComplete = useCallback(async () => {
    setWatching(null);
    const token = adChallengeRef.current;
    adChallengeRef.current = null;
    await recordAdWatch();
    if (token) {
      const res = await completeAdView(token, "Watched video");
      if (res.ok) loadBalance();
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [loadBalance]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    const [srv, unread] = await Promise.all([fetchServerBalance(), getUnreadNotificationCount()]);
    if (srv) setBalance(srv.balance);
    setUnreadCount(unread);
    setRefreshing(false);
  }, []);

  const handleShare = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await Share.share({
        message: "I'm earning real cash with CashClip! Watch ads, play games & complete surveys to get paid. Join me: https://cash-clip.app",
        title: "Earn real cash with CashClip",
      });
    } catch {}
  }, []);

  if (!fontsLoaded) return null;

  const webTopPad = Platform.OS === "web" ? 67 : 0;

  return (
    <View style={[styles.container, { paddingTop: webTopPad }]}>
      <FlatList
        data={adIndices}
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
            {/* Top row */}
            <View style={styles.topRow}>
              <View style={styles.greetingRow}>
                <Chipley pose="wave" size={52} style={styles.greetingChip} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.greeting}>{t.home.title}</Text>
                  <Text style={styles.subtitle}>{t.home.subtitle}</Text>
                </View>
              </View>
              <View style={styles.topActions}>
                <Pressable onPress={handleShare} hitSlop={8}>
                  <Feather name="share-2" size={21} color={Colors.textSecondary} />
                </Pressable>
                <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/notifications"); }}>
                  <Feather name="bell" size={22} color={Colors.text} />
                  {unreadCount > 0 && (
                    <View style={styles.notifDot}>
                      <Text style={styles.notifDotText}>{unreadCount}</Text>
                    </View>
                  )}
                </Pressable>
              </View>
            </View>

            {/* Balance card — matches Wallet's balance card */}
            {balance !== null && (
              <LinearGradient
                colors={["#0D2818", "#0A1F14"]}
                style={styles.balanceCard}
              >
                <View style={styles.balanceRow}>
                  <View>
                    <Text style={styles.balanceLabel}>{t.wallet.totalBalance}</Text>
                    <Text style={styles.balanceAmount}>${balance.toFixed(2)}</Text>
                  </View>
                  <View style={styles.coinIcon}>
                    <MaterialCommunityIcons name="wallet" size={28} color={Colors.primary} />
                  </View>
                </View>
              </LinearGradient>
            )}

            {/* Today's earn strip */}
            <EarnHighlightStrip />

            {/* Quick access — 4 items */}
            <View style={styles.quickRow}>
              {QUICK_ACCESS.map((item) => (
                <Pressable
                  key={item.label}
                  style={styles.quickBtn}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(item.route as any); }}
                >
                  <View style={[styles.quickIconBg, { backgroundColor: `${item.color}18` }]}>
                    <Ionicons name={item.icon as any} size={20} color={item.color} />
                  </View>
                  <Text style={styles.quickLabel}>{item.label}</Text>
                </Pressable>
              ))}
            </View>

            {/* Announcement: upcoming release */}
            <AnnouncementBanner />

            {/* Sponsored campaigns */}
            <SponsoredSection />

            {/* In-feed banner ad */}
            <InFeedBanner />

            {/* Section label */}
            <View style={styles.sectionHeader}>
              <MaterialCommunityIcons name="google" size={14} color={Colors.textMuted} />
              <Text style={styles.sectionLabel}>Google Ad Feed</Text>
              <View style={styles.sectionDot} />
              <Text style={styles.sectionCount}>{AD_CARD_COUNT} ads</Text>
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <NativeAdCard
            key={item.id}
            index={item.index}
            live={item.index < LIVE_AD_SLOTS}
            onPress={() => handleAdPress(item.index)}
          />
        )}
        ItemSeparatorComponent={() => null}
      />
      {watching && (
        <RewardedAdModal
          visible={!!watching}
          brand={watching.brand}
          description={watching.description}
          color={watching.color}
          reward={watching.reward}
          duration={watching.duration}
          onComplete={handleAdComplete}
          onClose={() => setWatching(null)}
        />
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
    paddingTop: 8,
    paddingBottom: 8,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 14,
  },
  greetingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  greetingChip: {
    marginLeft: -4,
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
  topActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  notifDot: {
    position: "absolute",
    top: -4,
    right: -4,
    backgroundColor: Colors.error,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  notifDotText: {
    fontFamily: "Outfit_700Bold",
    fontSize: 9,
    color: "#fff",
  },
  balanceCard: {
    borderRadius: 20,
    padding: 24,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "rgba(0, 230, 118, 0.15)",
  },
  balanceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  balanceLabel: {
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  balanceAmount: {
    fontFamily: "Outfit_700Bold",
    fontSize: 40,
    color: Colors.text,
    letterSpacing: -1,
  },
  coinIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(0, 230, 118, 0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  highlightStrip: {
    marginBottom: 12,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(0,230,118,0.15)",
  },
  highlightGradient: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  highlightHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  highlightTitle: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: Colors.primary,
    flex: 1,
  },
  highlightRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  highlightItem: {
    alignItems: "center",
    gap: 4,
    flex: 1,
  },
  highlightIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  highlightLabel: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 11,
    color: Colors.text,
  },
  highlightValue: {
    fontFamily: "Outfit_400Regular",
    fontSize: 10,
    color: Colors.textMuted,
  },
  quickRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 14,
  },
  quickBtn: {
    flex: 1,
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  quickIconBg: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  quickLabel: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 11,
    color: Colors.text,
  },
  bannerWrapper: {
    alignItems: "center",
    marginBottom: 12,
    gap: 4,
  },
  bannerLabel: {
    fontFamily: "Outfit_400Regular",
    fontSize: 10,
    color: Colors.textMuted,
    alignSelf: "flex-start",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 10,
    marginTop: 2,
  },
  sectionLabel: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: Colors.textSecondary,
    flex: 1,
  },
  sectionDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: Colors.textMuted,
  },
  sectionCount: {
    fontFamily: "Outfit_400Regular",
    fontSize: 12,
    color: Colors.textMuted,
  },
  row: {
    gap: 12,
    marginBottom: 12,
  },
});
