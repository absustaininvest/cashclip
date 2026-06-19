import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Dimensions,
  Platform,
  Modal,
  Alert,
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
import { useRouter, useFocusEffect } from "expo-router";
import Colors from "@/constants/colors";
import Chipley from "@/components/Chipley";
import SponsoredSection from "@/components/SponsoredSection";
import { useLanguage } from "@/lib/LanguageContext";
import { useAuth } from "@/lib/AuthContext";
import { useCelebration } from "@/lib/CelebrationContext";
import type { Translations } from "@/lib/i18n";
import {
  getUserStats,
  performDailyCheckin,
  getDailyCheckinInfo,
  getDailyMissions,
  getWeeklyMissions,
  markMissionClaimed,
  type UserStats,
  type DailyMission,
  type WeeklyMission,
} from "@/lib/storage";
import {
  claimMission,
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
  recordEarnAction,
  type PendingState,
  type ClaimMissionResult,
} from "@/lib/earn-client";
import {
  scheduleStreakReminder,
  cancelStreakReminder,
} from "@/lib/streak-notifications";
import { dollarsToPoints } from "@/lib/points";
import AsyncStorage from "@react-native-async-storage/async-storage";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

// ── Game-earned badge persistence ─────────────────────────────────────────────
// The badge is session-scoped: it must clear on a cold launch so a stale "+N
// pts earned" label from a previous session never reappears.  We generate a
// module-level session ID once per process; any stored badge that carries a
// different ID is treated as cold-launch stale and discarded.
export const _AD_BADGE_KEY = "earn_game_badge_v1";
export const _sessionId: string = Math.random().toString(36).slice(2) + Date.now().toString(36);

/** Read the stored badge for this session.  Returns null on cold launch (stale
 *  session ID) or when no badge has been stored yet. */
export async function _loadBadge(): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(_AD_BADGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { sessionId: string; pts: number };
    if (parsed.sessionId !== _sessionId) return null;
    return typeof parsed.pts === "number" ? parsed.pts : null;
  } catch {
    return null;
  }
}

// Explain to the user why a server-rejected mission claim didn't credit, so a
// failed claim is visible rather than silently swallowed.
function notifyMissionClaimFailed(result: ClaimMissionResult): void {
  if (result.verifiable === false) {
    Alert.alert(
      "Not claimable",
      "This mission can't be claimed for a points reward.",
    );
    return;
  }
  Alert.alert(
    "Couldn't claim yet",
    result.error ?? "This mission isn't ready to claim yet — keep going!",
  );
}

// Visual-only wheel segments — actual reward is server-issued after spin.
// Labels are intentionally "?" since the server picks the amount from its
// demand pool; showing fixed numbers would be misleading.
const WHEEL_SEGMENTS = [
  { value: 50,  label: "?", color: "#E53935" },
  { value: 80,  label: "?", color: "#FB8C00" },
  { value: 100, label: "?", color: "#FDD835" },
  { value: 150, label: "?", color: "#43A047" },
  { value: 200, label: "?", color: "#00ACC1" },
  { value: 300, label: "?", color: "#1E88E5" },
  { value: 400, label: "?", color: "#8E24AA" },
  { value: 500, label: "?", color: "#D81B60" },
];

// Fallback check-in streak ladder (pts per consecutive day). The server is
// authoritative — these values mirror CHECKIN_REWARD_LADDER in the API and are
// only shown until GET /api/earnings/checkin-status returns the live ladder.
const DAY_REWARDS_FALLBACK = [100, 120, 140, 160, 180, 200, 240];



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
            <Chipley pose="celebrate" size={92} />
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

function MilestoneRewardModal({
  visible,
  streak,
  bonus,
  totalPts,
  onClose,
  t,
}: {
  visible: boolean;
  streak: number;
  bonus: number;
  totalPts: number;
  onClose: () => void;
  t: Translations;
}) {
  const celebScale = useSharedValue(0);
  const flameRotate = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      celebScale.value = 0;
      celebScale.value = withSpring(1, { damping: 6, stiffness: 100 });
      flameRotate.value = withRepeat(
        withSequence(
          withTiming(-12, { duration: 280, easing: Easing.inOut(Easing.ease) }),
          withTiming(12, { duration: 280, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        true,
      );
    } else {
      flameRotate.value = 0;
    }
  }, [visible]);

  const celebStyle = useAnimatedStyle(() => ({
    transform: [{ scale: celebScale.value }],
  }));
  const flameStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${flameRotate.value}deg` }],
  }));

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View style={styles.modalOverlay}>
        <Animated.View style={celebStyle}>
          <View style={styles.milestoneModal}>
            <Animated.View style={flameStyle}>
              <Chipley pose="celebrate" size={92} />
            </Animated.View>
            <Text style={styles.milestoneTitle}>
              {t.earn.milestoneTitle.replace("{{days}}", String(streak))}
            </Text>
            <Text style={styles.milestoneTotalPts}>
              +{totalPts} {t.earn.milestoneTotalEarned}
            </Text>
            <Text style={styles.milestoneAmount}>
              +{bonus} {t.earn.milestoneBonusLabel}
            </Text>
            <Text style={styles.milestoneSubtext}>{t.earn.milestoneSubtext}</Text>
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
  const { celebrate } = useCelebration();
  const [stats, setStats] = useState<UserStats | null>(null);
  const [checkedInToday, setCheckedInToday] = useState(false);
  const [checkinStreak, setCheckinStreak] = useState(0);
  const [dayRewards, setDayRewards] = useState<number[]>(DAY_REWARDS_FALLBACK);
  const [milestoneEvery, setMilestoneEvery] = useState(0);
  const [showMilestone, setShowMilestone] = useState(false);
  const [milestoneCelebration, setMilestoneCelebration] = useState({ streak: 0, bonus: 0, totalPts: 0 });
  const [spinAvailable, setSpinAvailable] = useState(false);
  const [isSpinning, setIsSpinning] = useState(false);
  const [spinReward, setSpinReward] = useState(0); // pts from server
  const [showSpinReward, setShowSpinReward] = useState(false);
  // Only celebrate when the spin reward was server-confirmed — a network/DB blip
  // can fall back to a local display value, which is NOT a genuine win.
  const [spinWasGenuine, setSpinWasGenuine] = useState(false);
  const [spinRetryNotice, setSpinRetryNotice] = useState(false); // gentle "try again in a moment" after a transient 503
  const [checkinSyncError, setCheckinSyncError] = useState(false); // server sync failed after optimistic check-in
  const [dailyMissions, setDailyMissions] = useState<DailyMission[]>([]);
  const [weeklyMissions, setWeeklyMissions] = useState<WeeklyMission[]>([]);
  const [pendingState, setPendingState] = useState<PendingState | null>(null);
  const [nextSpinTime, setNextSpinTime] = useState<number | null>(null);
  const [isClaiming, setIsClaiming] = useState(false);
  const [lastGameEarnedPts, setLastGameEarnedPts] = useState<number | null>(null);
  const [lastCheckinEarnedPts, setLastCheckinEarnedPts] = useState<number | null>(null);
  const pendingPtsBeforeGamesRef = useRef<number | null>(null);
  const checkGameEarnedRef = useRef(false);

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
      setMilestoneEvery(checkinServer.milestoneEvery);
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
    // Hydrate the game-earned badge from storage on mount. The badge is only
    // restored when the stored session ID matches this process's _sessionId —
    // a mismatch means we are on a cold launch and the badge is stale.
    _loadBadge().then((pts) => {
      if (pts != null) setLastGameEarnedPts(pts);
    }).catch(() => {});
  }, []);


  // Schedule (or clear) the streak-break reminder whenever the check-in state
  // is known. Uses the already-translated strings so the notification matches
  // the user's chosen language. Fully fail-open — a scheduling error never
  // breaks the earn screen.
  useEffect(() => {
    if (checkinStreak > 0 && !checkedInToday) {
      const title = t.earn.streakWarningTitle.replace(
        "{{days}}",
        String(checkinStreak),
      );
      const body = t.earn.streakWarningSubtext;
      scheduleStreakReminder(checkinStreak, title, body).catch(() => {});
    } else {
      cancelStreakReminder().catch(() => {});
    }
  }, [checkinStreak, checkedInToday]);

  // Reload when the screen regains focus. If the user navigated away to play a
  // game, compare pending pts before/after to compute what was earned this session.
  useFocusEffect(
    useCallback(() => {
      if (checkGameEarnedRef.current) {
        loadAll();
      }
    }, [loadAll])
  );

  // After a game session, detect newly-added pending points and surface them on
  // the game card badge. Runs whenever pendingState updates post-navigation.
  useEffect(() => {
    if (!checkGameEarnedRef.current) return;
    if (pendingPtsBeforeGamesRef.current == null) return;
    const total = (pendingState?.pendingPoints ?? 0) + (pendingState?.claimablePoints ?? 0);
    const diff = total - pendingPtsBeforeGamesRef.current;
    if (diff > 0) {
      setLastGameEarnedPts(diff);
      // Persist so a warm-resume (focus return, not cold launch) can re-show
      // the badge.  Uses this session's ID so a cold relaunch always clears it.
      AsyncStorage.setItem(_AD_BADGE_KEY, JSON.stringify({ sessionId: _sessionId, pts: diff })).catch(() => {});
    }
    checkGameEarnedRef.current = false;
    pendingPtsBeforeGamesRef.current = null;
  }, [pendingState]);

  const syncCheckin = useCallback(async () => {
    setCheckinSyncError(false);
    const server = await recordCheckin();
    if (server) {
      setCheckinStreak(server.checkinStreak);
      setLastCheckinEarnedPts(server.points);
      if (server.milestoneBonus > 0) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setMilestoneCelebration({ streak: server.checkinStreak, bonus: server.milestoneBonus, totalPts: server.points });
        setShowMilestone(true);
      }
    } else {
      setCheckinSyncError(true);
    }
  }, []);

  const handleCheckin = useCallback(async () => {
    if (checkedInToday) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setCheckinSyncError(false);
    // Optimistic local UI (also keeps the offline streak cache warm).
    await performDailyCheckin();
    setCheckedInToday(true);
    // Server is authoritative: it advances the streak and returns the scaled
    // reward. Reflect the real streak it reports before the full refresh.
    await syncCheckin();
    balancePulse.value = withSequence(
      withSpring(1.1, { damping: 4 }),
      withSpring(1, { damping: 8 })
    );
    await loadAll();
  }, [checkedInToday, syncCheckin]);

  const handleSpin = useCallback(async () => {
    if (!spinAvailable || isSpinning) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setSpinRetryNotice(false);
    setIsSpinning(true);

    // Begin spin challenge BEFORE animation — challenge has 60s TTL.
    // beginSpin() quietly retries a transient (retryable) 503 a couple of times.
    const begin = await beginSpin();
    if (!begin.ok && begin.retryable) {
      // Momentary DB blip while starting the spin — show a gentle "try again in
      // a moment" state instead of a hard error, and don't lock the spin timer
      // so the user can simply tap again.
      setIsSpinning(false);
      setSpinRetryNotice(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    const challengeToken = begin.ok ? begin.challengeToken : null;

    // Find the wheel segment that matches the server-predetermined prize.
    // Falls back to a random segment only if the server didn't return points
    // (e.g. legacy challenge during a brief deploy transition).
    const serverPoints = begin.ok ? begin.points : null;
    const serverSegmentIndex = serverPoints != null
      ? WHEEL_SEGMENTS.findIndex(s => s.value === serverPoints)
      : -1;
    const segmentIndex = serverSegmentIndex >= 0
      ? serverSegmentIndex
      : Math.floor(Math.random() * WHEEL_SEGMENTS.length);
    const segmentAngle = (segmentIndex * 360) / WHEEL_SEGMENTS.length;
    const targetRotation = 360 * 5 + (360 - segmentAngle);

    wheelRotation.value = withTiming(
      wheelRotation.value + targetRotation,
      { duration: 4000, easing: Easing.out(Easing.cubic) },
    );

    setTimeout(async () => {
      // Complete spin with the server-issued challenge token.
      // completeSpin() also quietly retries a transient (retryable) 503.
      const result = challengeToken ? await completeSpin(challengeToken) : null;
      if (result && !result.ok && result.retryable) {
        // Transient failure after the wheel stopped — gentle retry state, and
        // keep the spin available so the user can try again in a moment.
        setIsSpinning(false);
        setSpinRetryNotice(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return;
      }
      // Lock spin timer client-side now that we have a final result
      await recordSpinTimestamp();
      setSpinAvailable(false);
      setNextSpinTime(Date.now() + 2 * 60 * 60 * 1000);
      const token = result && result.ok ? result.token : null;
      const pts = token?.points ?? WHEEL_SEGMENTS[segmentIndex].value;
      setSpinReward(pts);
      setSpinWasGenuine(!!token);
      setIsSpinning(false);
      setShowSpinReward(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await loadAll();
    }, 4200);
  }, [spinAvailable, isSpinning, wheelRotation]);



  const handleClaimDaily = useCallback(
    async (id: string) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      // Real credit is server-verified: the API recomputes completion from trusted
      // records and issues a pending earn token (or rejects it). Only flip the card
      // to "claimed" when the server accepts the claim — never optimistically — so a
      // rejected claim stays claimable and the user sees why.
      const result = await claimMission(id);
      if (result.ok) {
        await markMissionClaimed(id, false);
        const reward = dailyMissions.find((m) => m.id === id)?.reward ?? 0;
        celebrate({
          tier: reward >= 1000 ? "epic" : "nice",
          label: `+${reward.toLocaleString()} pts`,
          title: "Mission Complete!",
        });
      } else {
        notifyMissionClaimFailed(result);
      }
      await loadAll();
      balancePulse.value = withSequence(
        withSpring(1.1, { damping: 4 }),
        withSpring(1, { damping: 8 })
      );
    },
    [dailyMissions, celebrate]
  );

  const handleClaimWeekly = useCallback(
    async (id: string) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      // Real credit is server-verified: the API recomputes completion from trusted
      // records and issues a pending earn token (or rejects it). Only flip the card
      // to "claimed" when the server accepts the claim — never optimistically — so a
      // rejected claim stays claimable and the user sees why.
      const result = await claimMission(id);
      if (result.ok) {
        await markMissionClaimed(id, true);
        const reward = weeklyMissions.find((m) => m.id === id)?.reward ?? 0;
        celebrate({
          tier: "epic",
          label: `+${reward.toLocaleString()} pts`,
          title: "Weekly Goal!",
        });
      } else {
        notifyMissionClaimFailed(result);
      }
      await loadAll();
      balancePulse.value = withSequence(
        withSpring(1.1, { damping: 4 }),
        withSpring(1, { damping: 8 })
      );
    },
    [weeklyMissions, celebrate]
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
        `$${result.creditedUsd.toFixed(2)} has been added to your verified balance.`,
        [
          {
            text: "OK",
            onPress: () =>
              celebrate({
                tier: result.creditedUsd >= 1 ? "epic" : "nice",
                label: `+$${result.creditedUsd.toFixed(2)}`,
                title: "Earnings Claimed!",
              }),
          },
        ],
      );
      await loadAll();
      balancePulse.value = withSequence(
        withSpring(1.15, { damping: 4 }),
        withSpring(1, { damping: 8 })
      );
    } finally {
      setIsClaiming(false);
    }
  }, [isClaiming, loadAll, celebrate]);

  const balanceStyle = useAnimatedStyle(() => ({
    transform: [{ scale: balancePulse.value }],
  }));

  const wheelStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${wheelRotation.value}deg` }],
  }));

  if (!fontsLoaded || !stats) return null;

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
              const isMilestone = milestoneEvery > 0 && dayNum % milestoneEvery === 0;
              return (
                <View key={i} style={{ alignItems: "center" }}>
                  <View
                    style={[
                      styles.dayCircle,
                      isActive && styles.dayCircleActive,
                      isToday && styles.dayCircleToday,
                      isCurrent && styles.dayCircleCurrent,
                      isMilestone && styles.dayCircleMilestone,
                    ]}
                  >
                    {isMilestone && (
                      <View style={styles.dayMilestoneBadge}>
                        <Ionicons name="star" size={9} color={Colors.background} />
                      </View>
                    )}
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
                          isMilestone && { color: Colors.accent },
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
                        isMilestone && !isActive && { color: Colors.accent },
                      ]}
                    >
                      {reward} pts
                    </Text>
                  </View>
                  {isToday && lastCheckinEarnedPts != null && (
                    <View style={styles.checkinEarnedBadge}>
                      <Feather name="check" size={8} color={Colors.primary} />
                      <Text style={styles.checkinEarnedText}>+{lastCheckinEarnedPts}</Text>
                    </View>
                  )}
                </View>
              );
            })}
          </View>

          {checkinStreak > 0 && !checkedInToday && (
            <View style={styles.streakWarning}>
              <Ionicons name="alert-circle" size={18} color={Colors.accent} />
              <View style={styles.streakWarningTextWrap}>
                <Text style={styles.streakWarningTitle}>
                  {t.earn.streakWarningTitle.replace("{{days}}", String(checkinStreak))}
                </Text>
                <Text style={styles.streakWarningSubtext}>
                  {t.earn.streakWarningSubtext}
                </Text>
              </View>
            </View>
          )}

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

          {checkinSyncError && (
            <View style={styles.checkinErrorCard}>
              <Chipley pose="sad" size={60} />
              <Text style={styles.checkinErrorText}>
                Couldn't sync your check-in. Your streak is saved locally — tap to retry.
              </Text>
              <Pressable
                onPress={syncCheckin}
                style={({ pressed }) => [styles.spinErrorRetryBtn, { opacity: pressed ? 0.8 : 1 }]}
              >
                <Feather name="refresh-cw" size={14} color={Colors.background} />
                <Text style={styles.spinErrorRetryBtnText}>Retry Sync</Text>
              </Pressable>
            </View>
          )}
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

          {spinRetryNotice && (
            <View style={styles.spinErrorCard}>
              <Chipley pose="sad" size={72} />
              <Text style={styles.spinErrorText}>{t.earn.spinRetry}</Text>
              <Pressable
                onPress={() => { setSpinRetryNotice(false); handleSpin(); }}
                style={({ pressed }) => [styles.spinErrorRetryBtn, { opacity: pressed ? 0.8 : 1 }]}
              >
                <Feather name="refresh-cw" size={14} color={Colors.background} />
                <Text style={styles.spinErrorRetryBtnText}>Try Again</Text>
              </Pressable>
            </View>
          )}
        </View>

        {/* Play Games */}
        <Pressable
          testID="play-games-card"
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            pendingPtsBeforeGamesRef.current = (pendingState?.pendingPoints ?? 0) + (pendingState?.claimablePoints ?? 0);
            checkGameEarnedRef.current = true;
            setLastGameEarnedPts(null);
            setLastCheckinEarnedPts(null);
            AsyncStorage.removeItem(_AD_BADGE_KEY).catch(() => {});
            router.push("/games");
          }}
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
            {lastGameEarnedPts != null ? (
              <View style={styles.gameEarnedBadge}>
                <Feather name="check" size={12} color="#E040FB" />
                <Text style={styles.gameEarnedText}>+{lastGameEarnedPts} pts earned</Text>
              </View>
            ) : (
              <Ionicons name="chevron-forward" size={20} color={Colors.textMuted} />
            )}
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

        {/* Sponsored Campaigns */}
        <SponsoredSection />

        <View style={{ height: 48 }} />
      </ScrollView>

      <SpinRewardModal
        visible={showSpinReward}
        reward={spinReward}
        onClose={() => {
          setShowSpinReward(false);
          if (spinWasGenuine) {
            celebrate({
              tier: spinReward >= 200 ? "epic" : "nice",
              label: `+${formatPoints(spinReward)}`,
              title: "You Won!",
            });
          }
        }}
        t={t}
      />

      <MilestoneRewardModal
        visible={showMilestone}
        streak={milestoneCelebration.streak}
        bonus={milestoneCelebration.bonus}
        totalPts={milestoneCelebration.totalPts}
        onClose={() => {
          setShowMilestone(false);
          celebrate({
            tier: "epic",
            label: `+${formatPoints(milestoneCelebration.bonus)}`,
            title: `${milestoneCelebration.streak}-Day Streak!`,
          });
        }}
        t={t}
      />

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
  dayCircleMilestone: {
    borderWidth: 1.5,
    borderColor: Colors.accent,
  },
  dayMilestoneBadge: {
    position: "absolute",
    top: -6,
    right: -4,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
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
  streakWarning: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: "rgba(255, 214, 0, 0.10)",
    borderWidth: 1,
    borderColor: "rgba(255, 214, 0, 0.25)",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  streakWarningTextWrap: {
    flex: 1,
  },
  streakWarningTitle: {
    fontFamily: "Outfit_700Bold",
    fontSize: 14,
    color: Colors.accent,
    marginBottom: 2,
  },
  streakWarningSubtext: {
    fontFamily: "Outfit_400Regular",
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 16,
  },
  spinErrorCard: {
    alignItems: "center",
    paddingVertical: 16,
    gap: 8,
    marginTop: 8,
  },
  spinErrorText: {
    fontFamily: "Outfit_400Regular",
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: "center",
    paddingHorizontal: 8,
  },
  spinErrorRetryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginTop: 4,
  },
  spinErrorRetryBtnText: {
    fontFamily: "Outfit_700Bold",
    fontSize: 13,
    color: Colors.background,
  },
  checkinErrorCard: {
    alignItems: "center",
    paddingVertical: 12,
    gap: 6,
    marginTop: 8,
  },
  checkinErrorText: {
    fontFamily: "Outfit_400Regular",
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: "center",
    paddingHorizontal: 8,
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
  milestoneModal: {
    backgroundColor: Colors.surface,
    borderRadius: 24,
    padding: 32,
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.accent,
    width: SCREEN_WIDTH - 64,
    maxWidth: 340,
  },
  milestoneTitle: {
    fontFamily: "Outfit_700Bold",
    fontSize: 24,
    color: Colors.text,
    marginTop: 16,
    textAlign: "center",
  },
  milestoneTotalPts: {
    fontFamily: "Outfit_700Bold",
    fontSize: 36,
    color: Colors.primary,
    marginTop: 10,
  },
  milestoneAmount: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 20,
    color: Colors.accent,
    marginTop: 4,
  },
  milestoneSubtext: {
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 4,
    marginBottom: 8,
    textAlign: "center",
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
  availableAdsSection: {
    marginBottom: 20,
  },
  gameEarnedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(224,64,251,0.10)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  gameEarnedText: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 11,
    color: "#E040FB",
  },
  checkinEarnedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    backgroundColor: "rgba(0,230,118,0.12)",
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 6,
    marginTop: 4,
  },
  checkinEarnedText: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 8,
    color: Colors.primary,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
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
});
