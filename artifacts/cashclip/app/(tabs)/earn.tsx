import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Dimensions,
  Platform,
  Modal,
  ActivityIndicator,
  Alert,
  Linking,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withSequence,
  withRepeat,
  Easing,
} from "react-native-reanimated";
import {
  useFonts,
  Outfit_400Regular,
  Outfit_600SemiBold,
  Outfit_700Bold,
} from "@expo-google-fonts/outfit";
import { useRouter } from "expo-router";
import Colors from "@/constants/colors";
import SponsoredSection from "@/components/SponsoredSection";
import { adVideos, AD_CATEGORIES, AD_CATEGORY_EMOJI } from "@/lib/video-data";
import { useLanguage } from "@/lib/LanguageContext";
import { isAdMobReady, showRewardedAd, preloadRewardedAd, isRewardedAdPreloaded } from "@/lib/admob";
import { useAuth } from "@/lib/AuthContext";
import {
  trackAdImpression,
  trackAdCompletion,
  trackAdRewardEarned,
} from "@/lib/ad-analytics";
import type { Translations } from "@/lib/i18n";
import {
  recordAdWatch,
  getUserStats,
  performDailyCheckin,
  getDailyCheckinInfo,
  getDailyMissions,
  getWeeklyMissions,
  claimMissionReward,
  type UserStats,
  type DailyMission,
  type WeeklyMission,
} from "@/lib/storage";
import {
  recordEarnAction,
  recordCheckin,
  fetchCheckinStatus,
  beginSpin,
  completeSpin,
  claimAllReady,
  refreshPendingFromServer,
  canSpinNow,
  recordSpinTimestamp,
  getNextSpinTime,
  formatPoints,
  formatCountdown,
  pointsToUsd,
  type PendingState,
} from "@/lib/earn-client";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const DAILY_GOAL = 20;

// Visual-only wheel segments — actual reward is server-issued after spin
const WHEEL_SEGMENTS = [
  { value: 50,  label: "50 pts",  color: "#E53935" },
  { value: 80,  label: "80 pts",  color: "#FB8C00" },
  { value: 100, label: "100 pts", color: "#FDD835" },
  { value: 150, label: "150 pts", color: "#43A047" },
  { value: 200, label: "200 pts", color: "#00ACC1" },
  { value: 300, label: "300 pts", color: "#1E88E5" },
  { value: 400, label: "400 pts", color: "#8E24AA" },
  { value: 500, label: "500 pts", color: "#D81B60" },
];

// Fallback check-in streak ladder (pts per consecutive day). The server is
// authoritative — these values mirror CHECKIN_REWARD_LADDER in the API and are
// only shown until GET /api/earnings/checkin-status returns the live ladder.
const DAY_REWARDS_FALLBACK = [100, 120, 140, 160, 180, 200, 240];

function AdCard({
  ad,
  onWatch,
  disabled,
  adPreloaded,
  readyLabel,
}: {
  ad: (typeof adVideos)[0];
  onWatch: (ad: (typeof adVideos)[0]) => void;
  disabled?: boolean;
  adPreloaded?: boolean;
  readyLabel?: string;
}) {
  const scale = useSharedValue(1);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={animStyle}>
      <Pressable
        onPressIn={() => {
          if (!disabled) scale.value = withSpring(0.97);
        }}
        onPressOut={() => {
          scale.value = withSpring(1);
        }}
        onPress={() => !disabled && onWatch(ad)}
        style={[styles.adCard, disabled && { opacity: 0.5 }]}
        disabled={disabled}
      >
        <View style={[styles.adThumbnail, { backgroundColor: ad.color }]}>
          <Feather name="play-circle" size={32} color="#fff" />
          <View style={styles.adDuration}>
            <Text style={styles.adDurationText}>{ad.duration}s</Text>
          </View>
        </View>
        <View style={styles.adInfo}>
          <Text style={styles.adBrand}>{ad.brand}</Text>
          <Text style={styles.adDescription} numberOfLines={1}>
            {ad.description}
          </Text>
          <View style={styles.adReward}>
            <MaterialCommunityIcons
              name="cash"
              size={14}
              color={Colors.primary}
            />
            <Text style={styles.adRewardText}>+${ad.reward.toFixed(2)}</Text>
          </View>
        </View>
        <View style={styles.watchBtnContainer}>
          {adPreloaded && (
            <View style={styles.instantPlayBadge}>
              <View style={styles.instantPlayDot} />
              <Text style={styles.instantPlayText}>{readyLabel || "Ready"}</Text>
            </View>
          )}
          <View style={[styles.watchBtn, adPreloaded && styles.watchBtnReady]}>
            <Ionicons name="play" size={16} color={Colors.background} />
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

function WatchingModal({
  visible,
  ad,
  onComplete,
  onClose,
  t,
}: {
  visible: boolean;
  ad: (typeof adVideos)[0] | null;
  onComplete: (reward: number) => void;
  onClose: () => void;
  t: Translations;
}) {
  const [timeLeft, setTimeLeft] = useState(0);
  const [completed, setCompleted] = useState(false);
  const progressAnim = useSharedValue(0);
  const coinScale = useSharedValue(0);
  const coinRotate = useSharedValue(0);

  useEffect(() => {
    if (visible && ad) {
      setTimeLeft(ad.duration);
      setCompleted(false);
      progressAnim.value = 0;
      progressAnim.value = withTiming(1, {
        duration: ad.duration * 1000,
        easing: Easing.linear,
      });
    }
  }, [visible, ad]);

  useEffect(() => {
    if (!visible || !ad) return;
    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setCompleted(true);
          coinScale.value = withSpring(1, { damping: 8, stiffness: 120 });
          coinRotate.value = withRepeat(
            withTiming(360, { duration: 2000, easing: Easing.linear }),
            -1,
            false
          );
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [visible, ad]);

  const progressStyle = useAnimatedStyle(() => ({
    width: `${progressAnim.value * 100}%`,
  }));

  const coinStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: coinScale.value },
      { rotateY: `${coinRotate.value}deg` },
    ],
  }));

  if (!ad) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View
            style={[styles.watchingThumbnail, { backgroundColor: ad.color }]}
          >
            {!completed ? (
              <>
                <Feather
                  name="monitor"
                  size={48}
                  color="rgba(255,255,255,0.9)"
                />
                <Text style={styles.watchingBrand}>{ad.brand}</Text>
                <Text style={styles.watchingDesc}>{ad.description}</Text>
              </>
            ) : (
              <>
                <Animated.View style={coinStyle}>
                  <MaterialCommunityIcons
                    name="cash-multiple"
                    size={64}
                    color={Colors.accent}
                  />
                </Animated.View>
                <Text style={styles.rewardEarned}>
                  +${ad.reward.toFixed(2)}
                </Text>
                <Text style={styles.rewardLabel}>{t.earn.rewardEarned}</Text>
              </>
            )}
          </View>

          <View style={styles.progressContainer}>
            <Animated.View style={[styles.progressBar, progressStyle]} />
          </View>

          {!completed ? (
            <View style={styles.watchingFooter}>
              <Text style={styles.timeLeftText}>{timeLeft}{t.earn.sRemaining}</Text>
              <ActivityIndicator color={Colors.primary} size="small" />
            </View>
          ) : (
            <Pressable
              onPress={() => {
                onComplete(ad.reward);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              }}
              style={styles.claimButton}
            >
              <LinearGradient
                colors={[Colors.primary, Colors.primaryDark]}
                style={styles.claimGradient}
              >
                <Text style={styles.claimText}>{t.earn.claimReward}</Text>
              </LinearGradient>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

function SpinRewardModal({
  visible,
  reward,
  onClose,
  t,
}: {
  visible: boolean;
  reward: number;
  onClose: () => void;
  t: Translations;
}) {
  const celebScale = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      celebScale.value = 0;
      celebScale.value = withSpring(1, { damping: 6, stiffness: 100 });
    }
  }, [visible]);

  const celebStyle = useAnimatedStyle(() => ({
    transform: [{ scale: celebScale.value }],
  }));

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View style={styles.modalOverlay}>
        <Animated.View style={celebStyle}>
          <View style={styles.spinRewardModal}>
            <MaterialCommunityIcons
              name="star-circle"
              size={64}
              color={Colors.accent}
            />
            <Text style={styles.spinRewardTitle}>{t.earn.congratulations}</Text>
            <Text style={styles.spinRewardAmount}>+{reward} pts</Text>
            <Text style={styles.spinRewardSubtext}>
              Added to pending earnings — claim after 3 hours
            </Text>
            <Pressable onPress={onClose} style={styles.claimButton}>
              <LinearGradient
                colors={[Colors.primary, Colors.primaryDark]}
                style={styles.claimGradient}
              >
                <Text style={styles.claimText}>{t.earn.collect}</Text>
              </LinearGradient>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function WheelSegment({
  index,
  segment,
  wheelSize,
}: {
  index: number;
  segment: (typeof WHEEL_SEGMENTS)[0];
  wheelSize: number;
}) {
  const angle = (index * 360) / 8;
  const radius = wheelSize / 2 - 20;
  const radians = ((angle - 90) * Math.PI) / 180;
  const x = Math.cos(radians) * radius;
  const y = Math.sin(radians) * radius;

  return (
    <View
      style={[
        styles.wheelSegment,
        {
          left: wheelSize / 2 + x - 24,
          top: wheelSize / 2 + y - 16,
        },
      ]}
    >
      <View
        style={[styles.segmentDot, { backgroundColor: segment.color }]}
      />
      <Text style={styles.segmentLabel}>{segment.label}</Text>
    </View>
  );
}

function DailyMissionCard({
  mission,
  onClaim,
}: {
  mission: DailyMission;
  onClaim: (id: string) => void;
}) {
  const scale = useSharedValue(1);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const progress = Math.min(mission.progress / mission.target, 1);

  return (
    <Animated.View style={animStyle}>
      <Pressable
        onPressIn={() => {
          scale.value = withSpring(0.98);
        }}
        onPressOut={() => {
          scale.value = withSpring(1);
        }}
        style={styles.missionCard}
      >
        <View style={styles.missionLeft}>
          <View
            style={[
              styles.missionIcon,
              mission.completed && !mission.claimed
                ? { backgroundColor: "rgba(0,230,118,0.15)" }
                : { backgroundColor: Colors.surfaceHighlight },
            ]}
          >
            <Feather
              name={mission.icon as any}
              size={18}
              color={
                mission.completed && !mission.claimed
                  ? Colors.primary
                  : Colors.textSecondary
              }
            />
          </View>
          <View style={styles.missionInfo}>
            <Text style={styles.missionTitle}>{mission.title}</Text>
            <Text style={styles.missionDesc}>{mission.description}</Text>
            <View style={styles.missionProgressRow}>
              <View style={styles.missionBarBg}>
                <View
                  style={[
                    styles.missionBarFill,
                    {
                      width: `${progress * 100}%`,
                      backgroundColor: mission.completed
                        ? Colors.primary
                        : Colors.accent,
                    },
                  ]}
                />
              </View>
              <Text style={styles.missionProgressText}>
                {mission.progress}/{mission.target}
              </Text>
            </View>
          </View>
        </View>
        {mission.completed && !mission.claimed ? (
          <Pressable
            onPress={() => onClaim(mission.id)}
            style={styles.missionClaimBtn}
          >
            <Text style={styles.missionClaimText}>
              +{mission.reward.toLocaleString()} pts
            </Text>
          </Pressable>
        ) : mission.claimed ? (
          <View style={styles.missionClaimedBadge}>
            <Ionicons
              name="checkmark-circle"
              size={20}
              color={Colors.primary}
            />
          </View>
        ) : (
          <Text style={styles.missionRewardText}>
            {mission.reward.toLocaleString()} pts
          </Text>
        )}
      </Pressable>
    </Animated.View>
  );
}

function WeeklyMissionCard({
  mission,
  onClaim,
}: {
  mission: WeeklyMission;
  onClaim: (id: string) => void;
}) {
  const scale = useSharedValue(1);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const progress = Math.min(mission.progress / mission.target, 1);

  return (
    <Animated.View style={animStyle}>
      <Pressable
        onPressIn={() => {
          scale.value = withSpring(0.98);
        }}
        onPressOut={() => {
          scale.value = withSpring(1);
        }}
        style={styles.missionCard}
      >
        <View style={styles.missionLeft}>
          <View
            style={[
              styles.missionIcon,
              mission.completed && !mission.claimed
                ? { backgroundColor: "rgba(255,214,0,0.15)" }
                : { backgroundColor: Colors.surfaceHighlight },
            ]}
          >
            <Feather
              name={mission.icon as any}
              size={18}
              color={
                mission.completed && !mission.claimed
                  ? Colors.accent
                  : Colors.textSecondary
              }
            />
          </View>
          <View style={styles.missionInfo}>
            <Text style={styles.missionTitle}>{mission.title}</Text>
            <Text style={styles.missionDesc}>{mission.description}</Text>
            <View style={styles.missionProgressRow}>
              <View style={styles.missionBarBg}>
                <View
                  style={[
                    styles.missionBarFill,
                    {
                      width: `${progress * 100}%`,
                      backgroundColor: mission.completed
                        ? Colors.accent
                        : Colors.primary,
                    },
                  ]}
                />
              </View>
              <Text style={styles.missionProgressText}>
                {mission.progress}/{mission.target}
              </Text>
            </View>
          </View>
        </View>
        {mission.completed && !mission.claimed ? (
          <Pressable
            onPress={() => onClaim(mission.id)}
            style={[
              styles.missionClaimBtn,
              { backgroundColor: "rgba(255,214,0,0.15)" },
            ]}
          >
            <Text style={[styles.missionClaimText, { color: Colors.accent }]}>
              +{mission.reward.toLocaleString()} pts
            </Text>
          </Pressable>
        ) : mission.claimed ? (
          <View style={styles.missionClaimedBadge}>
            <Ionicons
              name="checkmark-circle"
              size={20}
              color={Colors.accent}
            />
          </View>
        ) : (
          <Text style={[styles.missionRewardText, { color: Colors.accent }]}>
            {mission.reward.toLocaleString()} pts
          </Text>
        )}
      </Pressable>
    </Animated.View>
  );
}


export default function EarnScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useLanguage();
  const { user } = useAuth();
  const [stats, setStats] = useState<UserStats | null>(null);
  const [watchingAd, setWatchingAd] = useState<(typeof adVideos)[0] | null>(
    null
  );
  const [showModal, setShowModal] = useState(false);
  const [checkedInToday, setCheckedInToday] = useState(false);
  const [checkinStreak, setCheckinStreak] = useState(0);
  const [dayRewards, setDayRewards] = useState<number[]>(DAY_REWARDS_FALLBACK);
  const [spinAvailable, setSpinAvailable] = useState(false);
  const [isSpinning, setIsSpinning] = useState(false);
  const [spinReward, setSpinReward] = useState(0); // pts from server
  const [showSpinReward, setShowSpinReward] = useState(false);
  const [dailyMissions, setDailyMissions] = useState<DailyMission[]>([]);
  const [weeklyMissions, setWeeklyMissions] = useState<WeeklyMission[]>([]);
  const [pendingState, setPendingState] = useState<PendingState | null>(null);
  const [nextSpinTime, setNextSpinTime] = useState<number | null>(null);
  const [isClaiming, setIsClaiming] = useState(false);

  const balancePulse = useSharedValue(1);
  const wheelRotation = useSharedValue(0);

  const [fontsLoaded] = useFonts({
    Outfit_400Regular,
    Outfit_600SemiBold,
    Outfit_700Bold,
  });

  const wheelSize = Math.min(SCREEN_WIDTH - 64, 280);

  const loadAll = useCallback(async () => {
    const [s, checkinInfo, checkinServer, spinReady, dm, wm, pending, spinNext] = await Promise.all([
      getUserStats(),
      getDailyCheckinInfo(),
      fetchCheckinStatus(),
      canSpinNow(),
      getDailyMissions(),
      getWeeklyMissions(),
      refreshPendingFromServer(),
      getNextSpinTime(),
    ]);
    setStats(s);
    // Server is the source of truth for the streak + reward ladder; fall back to
    // the local cache only when offline so the UI still renders something.
    if (checkinServer) {
      setCheckedInToday(checkinServer.checkedInToday);
      setCheckinStreak(checkinServer.checkinStreak);
      if (checkinServer.ladder.length > 0) setDayRewards(checkinServer.ladder);
    } else {
      setCheckedInToday(checkinInfo.checkedInToday);
      setCheckinStreak(checkinInfo.checkinStreak);
    }
    setSpinAvailable(spinReady);
    setDailyMissions(dm);
    setWeeklyMissions(wm);
    if (pending) setPendingState(pending);
    setNextSpinTime(spinNext);
  }, []);

  useEffect(() => {
    loadAll();
  }, []);

  // Warm a rewarded ad once we know who the user is. The SSV identity itself is
  // attached centrally in AuthContext, so this preload already carries it.
  useEffect(() => {
    if (user?.id && isAdMobReady()) {
      preloadRewardedAd();
    }
  }, [user?.id]);

  const handleCheckin = useCallback(async () => {
    if (checkedInToday) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Optimistic local UI (also keeps the offline streak cache warm).
    await performDailyCheckin();
    setCheckedInToday(true);
    // Server is authoritative: it advances the streak and returns the scaled
    // reward. Reflect the real streak it reports before the full refresh.
    const server = await recordCheckin();
    if (server) {
      setCheckinStreak(server.checkinStreak);
      if (server.milestoneBonus > 0) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    }
    balancePulse.value = withSequence(
      withSpring(1.1, { damping: 4 }),
      withSpring(1, { damping: 8 })
    );
    await loadAll();
  }, [checkedInToday]);

  const handleSpin = useCallback(async () => {
    if (!spinAvailable || isSpinning) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setIsSpinning(true);

    // Begin spin challenge BEFORE animation — challenge has 60s TTL
    const challengeToken = await beginSpin();

    // Spin animation — visual only, reward is server-determined
    const segmentIndex = Math.floor(Math.random() * WHEEL_SEGMENTS.length);
    const segmentAngle = (segmentIndex * 360) / WHEEL_SEGMENTS.length;
    const targetRotation = 360 * 5 + (360 - segmentAngle);

    wheelRotation.value = withTiming(
      wheelRotation.value + targetRotation,
      { duration: 4000, easing: Easing.out(Easing.cubic) },
    );

    setTimeout(async () => {
      // Lock spin timer client-side immediately
      await recordSpinTimestamp();
      setSpinAvailable(false);
      setNextSpinTime(Date.now() + 2 * 60 * 60 * 1000);
      // Complete spin with the server-issued challenge token
      const token = challengeToken ? await completeSpin(challengeToken) : null;
      const pts = token?.points ?? WHEEL_SEGMENTS[segmentIndex].value;
      setSpinReward(pts);
      setIsSpinning(false);
      setShowSpinReward(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await loadAll();
    }, 4200);
  }, [spinAvailable, isSpinning, wheelRotation]);

  const [adLoading, setAdLoading] = useState(false);
  const [adPreloaded, setAdPreloaded] = useState(false);
  const [selectedAdCategory, setSelectedAdCategory] = useState<string>("All");

  useEffect(() => {
    setAdPreloaded(isRewardedAdPreloaded());
    const interval = setInterval(() => {
      setAdPreloaded(isRewardedAdPreloaded());
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleWatchAd = useCallback(async (ad: (typeof adVideos)[0]) => {
    if (adLoading) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (isAdMobReady()) {
      setAdLoading(true);
      setAdPreloaded(false);
      try {
        const result = await showRewardedAd();
        setAdPreloaded(isRewardedAdPreloaded());
        if (result.rewarded) {
          await recordAdWatch();
          // Issue server earn token for watching a rewarded ad
          recordEarnAction("rewarded_ad", "Watched rewarded ad");
          await loadAll();
          balancePulse.value = withSequence(
            withSpring(1.1, { damping: 4 }),
            withSpring(1, { damping: 8 })
          );
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

    // AdMob not yet initialized — show mock ad for dev/simulator
    setWatchingAd(ad);
    setShowModal(true);
  }, [adLoading, loadAll, t]);

  const handleComplete = useCallback(async (reward: number) => {
    trackAdImpression("rewarded");
    trackAdCompletion("rewarded", watchingAd ? watchingAd.duration * 1000 : undefined);
    trackAdRewardEarned("rewarded", reward, "rewarded");
    await recordAdWatch();
    // Issue server earn token for the simulated ad completion
    recordEarnAction("rewarded_ad", "Watched rewarded ad");
    await loadAll();
    setShowModal(false);
    setWatchingAd(null);
    balancePulse.value = withSequence(
      withSpring(1.1, { damping: 4 }),
      withSpring(1, { damping: 8 })
    );
  }, [watchingAd]);

  const handleClaimDaily = useCallback(
    async (id: string) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await claimMissionReward(id, false);
      // Mission server credit is pending a proper /api/missions/claim endpoint
      // that validates server-side mission completion state before crediting.
      // recordEarnAction("mission_daily") is intentionally removed — the server
      // now rejects it (no verifiable proof) to prevent fraudulent minting.
      await loadAll();
      balancePulse.value = withSequence(
        withSpring(1.1, { damping: 4 }),
        withSpring(1, { damping: 8 })
      );
    },
    []
  );

  const handleClaimWeekly = useCallback(
    async (id: string) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await claimMissionReward(id, true);
      // Mission server credit is pending a proper /api/missions/claim endpoint
      // that validates server-side mission completion state before crediting.
      // recordEarnAction("mission_weekly") is intentionally removed — the server
      // now rejects it (no verifiable proof) to prevent fraudulent minting.
      await loadAll();
      balancePulse.value = withSequence(
        withSpring(1.1, { damping: 4 }),
        withSpring(1, { damping: 8 })
      );
    },
    []
  );

  const handleClaimAll = useCallback(async () => {
    if (isClaiming) return;
    setIsClaiming(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const result = await claimAllReady();
      if (!result || result.claimed === 0) {
        Alert.alert("Nothing to claim", "Your earnings are still in the 3-hour pending window. Check back later.");
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        "Earnings Claimed!",
        `$${result.creditedUsd.toFixed(2)} has been added to your verified balance.`
      );
      await loadAll();
      balancePulse.value = withSequence(
        withSpring(1.15, { damping: 4 }),
        withSpring(1, { damping: 8 })
      );
    } finally {
      setIsClaiming(false);
    }
  }, [isClaiming, loadAll]);

  const balanceStyle = useAnimatedStyle(() => ({
    transform: [{ scale: balancePulse.value }],
  }));

  const wheelStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${wheelRotation.value}deg` }],
  }));

  if (!fontsLoaded || !stats) return null;

  const dailyProgress = Math.min(stats.dailyAdsWatched / DAILY_GOAL, 1);
  const webTopPad = Platform.OS === "web" ? 67 : 0;
  const webBottomPad = Platform.OS === "web" ? 34 : 0;

  return (
    <View style={[styles.container, { paddingTop: webTopPad }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingBottom: webBottomPad + insets.bottom + 128,
          paddingHorizontal: 16,
        }}
      >
        <View style={styles.header}>
          <LinearGradient
            colors={[Colors.surfaceLight, Colors.surface]}
            style={styles.earningsCard}
          >
            <Text style={styles.earningsLabel}>Pending Earnings</Text>
            <Animated.View style={balanceStyle}>
              <Text style={styles.earningsAmount}>
                {formatPoints((pendingState?.pendingPoints ?? 0) + (pendingState?.claimablePoints ?? 0))}
              </Text>
            </Animated.View>
            {((pendingState?.pendingUsd ?? 0) + (pendingState?.claimableUsd ?? 0)) > 0 && (
              <Text style={styles.earningsLabel}>
                {t.wallet.estCashValue} · ${((pendingState?.pendingUsd ?? 0) + (pendingState?.claimableUsd ?? 0)).toFixed(2)}
              </Text>
            )}
            {(pendingState?.claimablePoints ?? 0) > 0 && (
              <Pressable
                onPress={handleClaimAll}
                disabled={isClaiming}
                style={styles.claimReadyBadge}
              >
                <Feather name="download" size={12} color={Colors.background} />
                <Text style={styles.claimReadyText}>
                  {isClaiming
                    ? "Claiming..."
                    : `${formatPoints(pendingState!.claimablePoints)} ready — tap to claim`}
                </Text>
              </Pressable>
            )}
            {(pendingState?.pendingPoints ?? 0) > 0 && (pendingState?.claimablePoints ?? 0) === 0 && (
              <View style={styles.streakRow}>
                <Feather name="clock" size={14} color={Colors.textMuted} />
                <Text style={[styles.streakText, { color: Colors.textMuted }]}>Claimable after 3-hour window</Text>
              </View>
            )}
            <View style={styles.streakRow}>
              <Ionicons name="flame" size={16} color={Colors.accent} />
              <Text style={styles.streakText}>{stats.streak} {t.earn.dayStreak}</Text>
              {stats.streak >= 3 && (
                <View style={styles.bonusBadge}>
                  <Text style={styles.bonusBadgeText}>{t.earn.bonus2x}</Text>
                </View>
              )}
            </View>
          </LinearGradient>
        </View>

        {/* Daily Check-in */}
        <View style={[styles.sectionCard, styles.availableAdsSection]}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderLeft}>
              <Ionicons name="calendar" size={20} color={Colors.primary} />
              <Text style={styles.sectionTitle}>{t.earn.dailyCheckin}</Text>
            </View>
            <View style={styles.streakBadge}>
              <Ionicons name="flame" size={14} color={Colors.accent} />
              <Text style={styles.streakBadgeText}>
                {checkinStreak} {checkinStreak !== 1 ? t.earn.days : t.earn.day}
              </Text>
            </View>
          </View>

          <View style={styles.dayRow}>
            {dayRewards.map((reward, i) => {
              const dayNum = i + 1;
              const isActive = dayNum <= checkinStreak;
              const isCurrent = dayNum === checkinStreak + 1 && !checkedInToday;
              const isToday = dayNum === checkinStreak && checkedInToday;
              return (
                <View
                  key={i}
                  style={[
                    styles.dayCircle,
                    isActive && styles.dayCircleActive,
                    isToday && styles.dayCircleToday,
                    isCurrent && styles.dayCircleCurrent,
                  ]}
                >
                  {isActive ? (
                    <Ionicons
                      name="checkmark"
                      size={14}
                      color={Colors.background}
                    />
                  ) : (
                    <Text
                      style={[
                        styles.dayNum,
                        isCurrent && { color: Colors.primary },
                      ]}
                    >
                      {dayNum}
                    </Text>
                  )}
                  <Text
                    style={[
                      styles.dayReward,
                      isActive && { color: Colors.primary },
                      isCurrent && { color: Colors.primary },
                    ]}
                  >
                    {reward} pts
                  </Text>
                </View>
              );
            })}
          </View>

          <Pressable
            onPress={handleCheckin}
            disabled={checkedInToday}
            style={[
              styles.checkinBtn,
              checkedInToday && styles.checkinBtnDisabled,
            ]}
          >
            <LinearGradient
              colors={
                checkedInToday
                  ? [Colors.surfaceHighlight, Colors.surfaceHighlight]
                  : [Colors.primary, Colors.primaryDark]
              }
              style={styles.checkinGradient}
            >
              {checkedInToday ? (
                <View style={styles.checkinBtnRow}>
                  <Ionicons
                    name="checkmark-circle"
                    size={18}
                    color={Colors.primary}
                  />
                  <Text
                    style={[styles.checkinBtnText, { color: Colors.primary }]}
                  >
                    {t.earn.checkedIn}
                  </Text>
                </View>
              ) : (
                <View style={styles.checkinBtnRow}>
                  <Feather
                    name="log-in"
                    size={18}
                    color={Colors.background}
                  />
                  <Text style={styles.checkinBtnText}>{t.earn.checkIn}</Text>
                </View>
              )}
            </LinearGradient>
          </Pressable>
        </View>

        {/* Spin the Wheel */}
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderLeft}>
              <MaterialCommunityIcons
                name="tire"
                size={20}
                color={Colors.accent}
              />
              <Text style={styles.sectionTitle}>{t.earn.spinTheWheel}</Text>
            </View>
            {!spinAvailable && (
              <View style={styles.usedBadge}>
                <Text style={styles.usedBadgeText}>{t.earn.usedToday}</Text>
              </View>
            )}
          </View>

          <View style={styles.wheelContainer}>
            <Animated.View
              style={[
                styles.wheel,
                { width: wheelSize, height: wheelSize },
                wheelStyle,
              ]}
            >
              {WHEEL_SEGMENTS.map((seg, i) => {
                const startAngle = (i * 360) / 8;
                return (
                  <View
                    key={i}
                    style={[
                      styles.wheelSlice,
                      {
                        transform: [{ rotate: `${startAngle}deg` }],
                        borderTopColor: seg.color,
                        borderLeftWidth: wheelSize / 2,
                        borderRightWidth: wheelSize / 2,
                        borderTopWidth: wheelSize / 2,
                        borderLeftColor: "transparent",
                        borderRightColor: "transparent",
                      },
                    ]}
                  />
                );
              })}
              {WHEEL_SEGMENTS.map((seg, i) => (
                <WheelSegment
                  key={`label-${i}`}
                  index={i}
                  segment={seg}
                  wheelSize={wheelSize}
                />
              ))}
              <View style={styles.wheelCenter}>
                <MaterialCommunityIcons
                  name="star-four-points"
                  size={24}
                  color={Colors.accent}
                />
              </View>
            </Animated.View>
            <View style={styles.wheelPointer}>
              <Ionicons
                name="caret-down"
                size={32}
                color={Colors.accent}
              />
            </View>
          </View>

          <Pressable
            onPress={handleSpin}
            disabled={!spinAvailable || isSpinning}
            style={[
              styles.spinBtn,
              (!spinAvailable || isSpinning) && styles.spinBtnDisabled,
            ]}
          >
            <LinearGradient
              colors={
                !spinAvailable || isSpinning
                  ? [Colors.surfaceHighlight, Colors.surfaceHighlight]
                  : [Colors.accent, "#FFC107"]
              }
              style={styles.spinGradient}
            >
              <Text
                style={[
                  styles.spinBtnText,
                  (!spinAvailable || isSpinning) && {
                    color: Colors.textMuted,
                  },
                ]}
              >
                {isSpinning
                  ? t.earn.spinning
                  : spinAvailable
                  ? t.earn.spin
                  : nextSpinTime
                    ? `Next spin in ${formatCountdown(nextSpinTime)}`
                    : "Spin again in 2h"}
              </Text>
            </LinearGradient>
          </Pressable>
        </View>

        {/* Play Games */}
        <Pressable
          testID="play-games-card"
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/games"); }}
          style={({ pressed }) => [styles.sectionCard, { opacity: pressed ? 0.9 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] }]}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: "rgba(224,64,251,0.15)", alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="game-controller" size={24} color="#E040FB" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: Colors.text }}>{t.games.playGames}</Text>
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: Colors.textSecondary, marginTop: 2 }}>{t.games.earnUpTo}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={Colors.textMuted} />
          </View>
        </Pressable>

        {/* Daily Missions */}
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderLeft}>
              <Feather name="target" size={20} color={Colors.primary} />
              <Text style={styles.sectionTitle}>{t.earn.dailyMissions}</Text>
            </View>
            <Text style={styles.sectionSubtitle}>{t.earn.resetsDaily}</Text>
          </View>
          {dailyMissions.map((m) => (
            <DailyMissionCard
              key={m.id}
              mission={m}
              onClaim={handleClaimDaily}
            />
          ))}
        </View>

        {/* Weekly Missions */}
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderLeft}>
              <Feather name="award" size={20} color={Colors.accent} />
              <Text style={styles.sectionTitle}>{t.earn.weeklyMissions}</Text>
            </View>
            <Text style={styles.sectionSubtitle}>{t.earn.resetsWeekly}</Text>
          </View>
          {weeklyMissions.map((m) => (
            <WeeklyMissionCard
              key={m.id}
              mission={m}
              onClaim={handleClaimWeekly}
            />
          ))}
        </View>

        {/* Surveys */}
        <Pressable
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/surveys"); }}
          style={({ pressed }) => [{ opacity: pressed ? 0.9 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] }]}
        >
          <LinearGradient
            colors={["#1A1A2E", "#0D1B2A"]}
            style={{
              borderRadius: 16, padding: 16, marginBottom: 16,
              flexDirection: "row", alignItems: "center", justifyContent: "space-between",
              borderWidth: 1, borderColor: "rgba(78, 205, 196, 0.2)",
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1 }}>
              <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(78, 205, 196, 0.12)", alignItems: "center", justifyContent: "center" }}>
                <MaterialCommunityIcons name="clipboard-text-outline" size={22} color="#4ECDC4" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 15, color: Colors.text }}>{t.earn.paidSurveys}</Text>
                <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: Colors.textSecondary }}>{t.earn.earnPerSurvey}</Text>
              </View>
            </View>
            <Feather name="chevron-right" size={20} color="#4ECDC4" />
          </LinearGradient>
        </Pressable>

        {/* Offerwalls */}
        <Pressable
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/offerwalls"); }}
          style={({ pressed }) => [{ opacity: pressed ? 0.9 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] }]}
        >
          <LinearGradient
            colors={["#1A1A2E", "#0D1B2A"]}
            style={{
              borderRadius: 16, padding: 16, marginBottom: 16,
              flexDirection: "row", alignItems: "center", justifyContent: "space-between",
              borderWidth: 1, borderColor: "rgba(255, 107, 53, 0.25)",
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1 }}>
              <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,107,53,0.12)", alignItems: "center", justifyContent: "center" }}>
                <MaterialCommunityIcons name="gift-outline" size={22} color="#FF6B35" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 15, color: Colors.text }}>Offerwalls</Text>
                <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: Colors.textSecondary }}>Earn $0.25–$5 per offer · Apps, sign-ups & more</Text>
              </View>
            </View>
            <Feather name="chevron-right" size={20} color="#FF6B35" />
          </LinearGradient>
        </Pressable>

        {/* Daily Goal */}
        <View style={styles.dailyGoal}>
          <View style={styles.goalHeader}>
            <Text style={styles.goalTitle}>{t.earn.dailyAdGoal}</Text>
            <Text style={styles.goalCount}>
              {stats.dailyAdsWatched}/{DAILY_GOAL}
            </Text>
          </View>
          <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: Colors.textMuted, marginTop: 4 }}>
            Earn 50 pts per ad · up to 30 ads/day
          </Text>
          <View style={styles.goalBarBg}>
            <LinearGradient
              colors={[Colors.primary, Colors.accent]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[
                styles.goalBarFill,
                { width: `${dailyProgress * 100}%` },
              ]}
            />
          </View>
          {dailyProgress >= 1 && (
            <View style={styles.goalComplete}>
              <Ionicons
                name="checkmark-circle"
                size={16}
                color={Colors.primary}
              />
              <Text style={styles.goalCompleteText}>
                {t.earn.dailyGoalReached}
              </Text>
            </View>
          )}
        </View>

        {/* Sponsored Campaigns */}
        <SponsoredSection />

        {/* Ads Section */}
        <Text style={styles.adsSectionTitle}>{t.earn.availableAds}</Text>

        {/* Category Filter Chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.categoryScroll}
          contentContainerStyle={styles.categoryScrollContent}
        >
          {[
            { key: "All", emoji: "", label: t.earn.categoryAll },
            ...AD_CATEGORIES.map((cat) => ({
              key: cat,
              emoji: AD_CATEGORY_EMOJI[cat],
              label: t.earn.adCategoryLabel[cat],
            })),
          ].map((cat) => (
            <Pressable
              key={cat.key}
              onPress={() => setSelectedAdCategory(cat.key)}
              style={[styles.categoryChip, selectedAdCategory === cat.key && styles.categoryChipActive]}
            >
              <Text style={[styles.categoryChipText, selectedAdCategory === cat.key && styles.categoryChipTextActive]}>
                {cat.emoji}{cat.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {(() => {
          const filtered = selectedAdCategory === "All"
            ? adVideos
            : adVideos.filter((ad) => ad.category === selectedAdCategory);
          return filtered.length > 0 ? (
            filtered.map((ad, i) => (
              <View key={ad.id} style={{ marginBottom: i < filtered.length - 1 ? 10 : 0 }}>
                <AdCard ad={ad} onWatch={handleWatchAd} disabled={adLoading} adPreloaded={adPreloaded} readyLabel={t.earn.adReady} />
              </View>
            ))
          ) : (
            <Text style={styles.categoryEmptyText}>{t.earn.categoryEmpty}</Text>
          );
        })()}
        <View style={{ height: 48 }} />
      </ScrollView>

      <WatchingModal
        visible={showModal}
        ad={watchingAd}
        onComplete={handleComplete}
        onClose={() => setShowModal(false)}
        t={t}
      />

      <SpinRewardModal
        visible={showSpinReward}
        reward={spinReward}
        onClose={() => setShowSpinReward(false)}
        t={t}
      />

      <Modal visible={adLoading} transparent animationType="fade">
        <View style={styles.adLoadingOverlay}>
          <View style={styles.adLoadingBox}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.adLoadingText}>{t.earn.loadingAd}</Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    paddingTop: 12,
    paddingBottom: 8,
  },
  earningsCard: {
    borderRadius: 20,
    padding: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  earningsLabel: {
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  earningsAmount: {
    fontFamily: "Outfit_700Bold",
    fontSize: 44,
    color: Colors.primary,
    letterSpacing: -1,
  },
  streakRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
  },
  streakText: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 14,
    color: Colors.accent,
  },
  bonusBadge: {
    backgroundColor: "rgba(255, 214, 0, 0.15)",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  bonusBadgeText: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 11,
    color: Colors.accent,
  },

  sectionCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    marginTop: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  sectionHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sectionTitle: {
    fontFamily: "Outfit_700Bold",
    fontSize: 17,
    color: Colors.text,
  },
  sectionSubtitle: {
    fontFamily: "Outfit_400Regular",
    fontSize: 12,
    color: Colors.textMuted,
  },

  dayRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  dayCircle: {
    width: 40,
    height: 52,
    borderRadius: 10,
    backgroundColor: Colors.surfaceHighlight,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  dayCircleActive: {
    backgroundColor: Colors.primary,
  },
  dayCircleToday: {
    backgroundColor: Colors.primary,
    borderWidth: 2,
    borderColor: Colors.accent,
  },
  dayCircleCurrent: {
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderStyle: "dashed",
  },
  dayNum: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: Colors.textSecondary,
  },
  dayReward: {
    fontFamily: "Outfit_400Regular",
    fontSize: 8,
    color: Colors.textMuted,
  },

  checkinBtn: {
    borderRadius: 12,
    overflow: "hidden",
  },
  checkinBtnDisabled: {
    opacity: 0.8,
  },
  checkinGradient: {
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  checkinBtnRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  checkinBtnText: {
    fontFamily: "Outfit_700Bold",
    fontSize: 15,
    color: Colors.background,
  },
  streakBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,214,0,0.12)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  streakBadgeText: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 12,
    color: Colors.accent,
  },

  wheelContainer: {
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 8,
    position: "relative",
  },
  wheel: {
    borderRadius: 999,
    overflow: "hidden",
    position: "relative",
    borderWidth: 3,
    borderColor: Colors.surfaceHighlight,
  },
  wheelSlice: {
    position: "absolute",
    width: 0,
    height: 0,
    borderStyle: "solid",
    transformOrigin: "center bottom",
    bottom: "50%",
    left: 0,
  },
  wheelSegment: {
    position: "absolute",
    alignItems: "center",
    zIndex: 10,
  },
  segmentDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginBottom: 1,
  },
  segmentLabel: {
    fontFamily: "Outfit_700Bold",
    fontSize: 10,
    color: "#fff",
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  wheelCenter: {
    position: "absolute",
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.surface,
    borderWidth: 2,
    borderColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
    top: "50%",
    left: "50%",
    marginTop: -22,
    marginLeft: -22,
    zIndex: 20,
  },
  wheelPointer: {
    position: "absolute",
    top: -8,
    zIndex: 30,
  },
  spinBtn: {
    borderRadius: 12,
    overflow: "hidden",
    marginTop: 8,
  },
  spinBtnDisabled: {
    opacity: 0.7,
  },
  spinGradient: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  spinBtnText: {
    fontFamily: "Outfit_700Bold",
    fontSize: 16,
    color: Colors.background,
    letterSpacing: 1,
  },
  usedBadge: {
    backgroundColor: "rgba(255,82,82,0.12)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  usedBadgeText: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 11,
    color: Colors.error,
  },

  missionCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceHighlight,
  },
  missionLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: 10,
  },
  missionIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  missionInfo: {
    flex: 1,
  },
  missionTitle: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 14,
    color: Colors.text,
  },
  missionDesc: {
    fontFamily: "Outfit_400Regular",
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 1,
  },
  missionProgressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 5,
  },
  missionBarBg: {
    flex: 1,
    height: 5,
    backgroundColor: Colors.surfaceHighlight,
    borderRadius: 3,
    overflow: "hidden",
  },
  missionBarFill: {
    height: "100%",
    borderRadius: 3,
  },
  missionProgressText: {
    fontFamily: "Outfit_400Regular",
    fontSize: 10,
    color: Colors.textMuted,
    width: 30,
  },
  missionClaimBtn: {
    backgroundColor: "rgba(0,230,118,0.15)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginLeft: 8,
  },
  missionClaimText: {
    fontFamily: "Outfit_700Bold",
    fontSize: 12,
    color: Colors.primary,
  },
  missionClaimedBadge: {
    marginLeft: 8,
  },
  missionRewardText: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: Colors.textSecondary,
    marginLeft: 8,
  },

  spinRewardModal: {
    backgroundColor: Colors.surface,
    borderRadius: 24,
    padding: 32,
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
    width: SCREEN_WIDTH - 64,
    maxWidth: 340,
  },
  spinRewardTitle: {
    fontFamily: "Outfit_700Bold",
    fontSize: 24,
    color: Colors.text,
    marginTop: 16,
  },
  spinRewardAmount: {
    fontFamily: "Outfit_700Bold",
    fontSize: 40,
    color: Colors.accent,
    marginTop: 8,
  },
  spinRewardSubtext: {
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 4,
    marginBottom: 8,
  },
  claimReadyBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.primary,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
    alignSelf: "center",
    marginTop: 10,
  },
  claimReadyText: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: Colors.background,
  },

  dailyGoal: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    marginTop: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  goalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  goalTitle: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 15,
    color: Colors.text,
  },
  goalCount: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 14,
    color: Colors.textSecondary,
  },
  goalBarBg: {
    height: 8,
    backgroundColor: Colors.surfaceHighlight,
    borderRadius: 4,
    overflow: "hidden",
  },
  goalBarFill: {
    height: "100%",
    borderRadius: 4,
  },
  goalComplete: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 8,
  },
  goalCompleteText: {
    fontFamily: "Outfit_400Regular",
    fontSize: 12,
    color: Colors.primary,
  },

  adsSectionTitle: {
    fontFamily: "Outfit_700Bold",
    fontSize: 18,
    color: Colors.text,
    marginTop: 20,
    marginBottom: 12,
  },
  categoryScroll: {
    marginBottom: 12,
  },
  categoryScrollContent: {
    paddingRight: 8,
    gap: 8,
    flexDirection: "row",
  },
  categoryChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  categoryChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  categoryChipText: {
    fontFamily: "Outfit_500Medium",
    fontSize: 13,
    color: Colors.textMuted,
  },
  categoryChipTextActive: {
    color: "#000",
  },
  categoryEmptyText: {
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: "center",
    marginVertical: 20,
  },
  sponsoredCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 10,
    gap: 12,
  },
  sponsoredCardVisited: {
    opacity: 0.55,
  },
  sponsoredLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  sponsoredIconBg: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "rgba(0,230,118,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  sponsoredTitle: {
    fontFamily: "Outfit_700Bold",
    fontSize: 14,
    color: Colors.text,
    marginBottom: 3,
  },
  sponsoredDesc: {
    fontFamily: "Outfit_400Regular",
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 17,
  },
  sponsoredBy: {
    fontFamily: "Outfit_400Regular",
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 4,
  },
  sponsoredRight: {
    alignItems: "flex-end",
    gap: 4,
  },
  sponsoredReward: {
    alignItems: "flex-end",
  },
  sponsoredRewardAmt: {
    fontFamily: "Outfit_700Bold",
    fontSize: 15,
    color: Colors.primary,
  },
  sponsoredVisitBtn: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  visitedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(0,230,118,0.10)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  visitedText: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 12,
    color: Colors.primary,
  },
  adCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  adThumbnail: {
    width: 60,
    height: 60,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  adDuration: {
    position: "absolute",
    bottom: 2,
    right: 2,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  adDurationText: {
    fontFamily: "Outfit_400Regular",
    fontSize: 9,
    color: "#fff",
  },
  adInfo: {
    flex: 1,
    marginLeft: 12,
    gap: 2,
  },
  adBrand: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 15,
    color: Colors.text,
  },
  adDescription: {
    fontFamily: "Outfit_400Regular",
    fontSize: 13,
    color: Colors.textSecondary,
  },
  adReward: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  adRewardText: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: Colors.primary,
  },
  watchBtnContainer: {
    alignItems: "center",
    gap: 4,
    paddingLeft: 4,
  },
  availableAdsSection: {
    marginBottom: 20,
  },
  instantPlayBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "rgba(0,230,118,0.12)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  instantPlayDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.primary,
  },
  instantPlayText: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 9,
    color: Colors.primary,
  },
  watchBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  watchBtnReady: {
    borderWidth: 2,
    borderColor: "rgba(0,230,118,0.4)",
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderRadius: 24,
    width: "100%",
    maxWidth: 360,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  watchingThumbnail: {
    height: 200,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  watchingBrand: {
    fontFamily: "Outfit_700Bold",
    fontSize: 24,
    color: "#fff",
  },
  watchingDesc: {
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: "rgba(255,255,255,0.8)",
  },
  rewardEarned: {
    fontFamily: "Outfit_700Bold",
    fontSize: 36,
    color: Colors.accent,
    marginTop: 8,
  },
  rewardLabel: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 16,
    color: "#fff",
  },
  progressContainer: {
    height: 4,
    backgroundColor: Colors.surfaceHighlight,
  },
  progressBar: {
    height: "100%",
    backgroundColor: Colors.primary,
  },
  watchingFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 20,
  },
  timeLeftText: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 16,
    color: Colors.text,
  },
  claimButton: {
    margin: 16,
  },
  claimGradient: {
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
  },
  claimText: {
    fontFamily: "Outfit_700Bold",
    fontSize: 16,
    color: Colors.background,
  },
  adLoadingOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
  },
  adLoadingBox: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    paddingVertical: 32,
    paddingHorizontal: 40,
    alignItems: "center",
    gap: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  adLoadingText: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 16,
    color: Colors.text,
  },
});
