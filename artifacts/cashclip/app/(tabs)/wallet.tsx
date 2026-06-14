import React, { useState, useCallback, useEffect } from "react";
import { useFocusEffect } from "expo-router";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Platform,
  Alert,
  RefreshControl,
  Modal,
  KeyboardAvoidingView,
  ScrollView,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useFonts, Outfit_400Regular, Outfit_600SemiBold, Outfit_700Bold } from "@expo-google-fonts/outfit";
import Colors from "@/constants/colors";
import Chipley from "@/components/Chipley";
import RewardSuccessModal from "@/components/RewardSuccessModal";
import {
  getUserStats,
  getTransactions,
  getWithdrawalTiers,
  getSeenQualifiedReferrals,
  setSeenQualifiedReferrals,
  canWithdraw,
  recordWithdrawalAttempt,
  type UserStats,
  type Transaction,
  type WithdrawalTier,
} from "@/lib/storage";
import {
  refreshPendingFromServer,
  claimAllReady,
  fetchServerBalance,
  fetchReferralStats,
  formatPoints,
  formatCountdown,
  pointsToUsd,
  type PendingState,
} from "@/lib/earn-client";
import { useLanguage } from "@/lib/LanguageContext";
import { useAuth } from "@/lib/AuthContext";
import { useCelebration } from "@/lib/CelebrationContext";
import { apiRequest } from "@/lib/query-client";
import { checkDeviceIntegrity } from "@/lib/device-integrity";
import { t as tFn, type Translations } from "@/lib/i18n";

const PAYPAL_DISPOSABLE_DOMAINS = new Set([
  "mailinator.com","guerrillamail.com","guerrillamail.info","guerrillamail.biz",
  "guerrillamail.de","guerrillamail.net","guerrillamail.org","guerrillamailblock.com",
  "grr.la","sharklasers.com","spam4.me","maildrop.cc","dispostable.com",
  "fakeinbox.com","tempmail.com","temp-mail.org","throwaway.email","getnada.com",
  "mailnull.com","spamgourmet.com","trashmail.at","trashmail.io","trashmail.me",
  "trashmail.net","trashmail.xyz","wegwerfmail.de","wegwerfmail.net","wegwerfmail.org",
  "10minutemail.com","10minutemail.net","mailnesia.com","discard.email","filzmail.com",
  "boun.cr","trbvm.com","yopmail.com","throwam.com",
]);

const SHORT_SLD_TRUSTED_TLDS = new Set([
  "com","net","org","gov","edu","mil","int","io","app","dev",
]);

function isPlausiblePayPalDomain(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  const atIndex = normalized.lastIndexOf("@");
  if (atIndex < 0) return false;
  const domain = normalized.slice(atIndex + 1);
  if (!domain) return false;
  const labels = domain.split(".");
  if (labels.length < 2) return false;
  if (labels.some((l) => l.length < 2)) return false;
  if (labels.length === 2) {
    const sld = labels[0]!;
    const tld = labels[1]!;
    if (sld.length <= 3 && !SHORT_SLD_TRUSTED_TLDS.has(tld)) return false;
  }
  if (PAYPAL_DISPOSABLE_DOMAINS.has(domain)) return false;
  return true;
}

function extractApiErrorMessage(rawMsg: string, fallback: string): string {
  const colonIdx = rawMsg.indexOf(":");
  if (colonIdx === -1) return rawMsg || fallback;
  const tail = rawMsg.slice(colonIdx + 1).trim();
  if (!tail.startsWith("{")) return rawMsg;
  try {
    const parsed = JSON.parse(tail) as { error?: unknown };
    if (parsed && typeof parsed.error === "string") return parsed.error;
  } catch (parseErr) {
    console.warn("[wallet] failed to parse API error payload:", parseErr);
  }
  return rawMsg;
}

function extractApiErrorCode(rawMsg: string): string | null {
  const colonIdx = rawMsg.indexOf(":");
  if (colonIdx === -1) return null;
  const tail = rawMsg.slice(colonIdx + 1).trim();
  if (!tail.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(tail) as { code?: unknown };
    if (parsed && typeof parsed.code === "string") return parsed.code;
  } catch {
    /* ignore */
  }
  return null;
}

function TransactionItem({ item, t }: { item: Transaction; t: Translations }) {
  const isPositive = item.amount > 0;
  const iconName =
    item.type === "withdrawn" ? "arrow-up-right" :
    item.type === "bonus" ? "gift" :
    item.type === "referral" ? "user-plus" :
    item.type === "checkin" ? "check-circle" :
    item.type === "spin" ? "rotate-cw" :
    item.type === "mission" ? "target" :
    "dollar-sign";
  const iconColor = item.type === "withdrawn" ? Colors.error : item.type === "bonus" ? Colors.accent : Colors.primary;

  const date = new Date(item.timestamp);
  const timeStr = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dateStr = date.toLocaleDateString([], { month: "short", day: "numeric" });

  return (
    <View style={styles.txItem}>
      <View style={[styles.txIcon, { backgroundColor: `${iconColor}15` }]}>
        <Feather name={iconName as any} size={18} color={iconColor} />
      </View>
      <View style={styles.txInfo}>
        <Text style={styles.txDesc}>{item.description}</Text>
        <Text style={styles.txDate}>{dateStr} {t.wallet.at} {timeStr}</Text>
      </View>
      <Text style={[styles.txAmount, { color: isPositive ? Colors.primary : Colors.error }]}>
        {isPositive ? "+" : ""}${Math.abs(item.amount).toFixed(2)}
      </Text>
    </View>
  );
}

const TIER_TAG_KEYS: Record<string, keyof Translations["wallet"]> = {
  Minimum: "tierMinimum",
  Smart: "tierSmart",
  Popular: "tierPopular",
  "Best Value": "tierBestValue",
  VIP: "tierVIP",
  Elite: "tierElite",
};

function TierCard({
  tier,
  selected,
  onSelect,
  t,
}: {
  tier: WithdrawalTier;
  selected: boolean;
  onSelect: () => void;
  t: Translations;
}) {
  const isPopular = tier.tag === "Popular" || tier.tag === "Best Value";
  const translatedTag = t.wallet[TIER_TAG_KEYS[tier.tag] || "tierMinimum"] as string;
  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onSelect();
      }}
      style={({ pressed }) => [
        styles.tierCard,
        selected && styles.tierCardSelected,
        { opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] },
      ]}
    >
      {isPopular && (
        <View style={styles.tierPopularBadge}>
          <Ionicons name="star" size={10} color="#000" />
          <Text style={styles.tierPopularText}>{translatedTag}</Text>
        </View>
      )}
      {!isPopular && tier.tag !== "Minimum" && (
        <View style={[styles.tierPopularBadge, { backgroundColor: "rgba(0,230,118,0.15)" }]}>
          <Text style={[styles.tierPopularText, { color: Colors.primary }]}>{translatedTag}</Text>
        </View>
      )}

      <Text style={[styles.tierAmount, selected && styles.tierAmountSelected]}>
        ${tier.amount.toFixed(2)}
      </Text>

      {tier.bonusPercent > 0 ? (
        <View style={styles.tierBonusRow}>
          <Feather name="trending-up" size={12} color={Colors.accent} />
          <Text style={styles.tierBonusText}>+{tier.bonusPercent}% {t.wallet.bonus}</Text>
        </View>
      ) : (
        <Text style={styles.tierNoBonusText}>{t.wallet.noBonusLabel}</Text>
      )}

      {tier.bonusPercent > 0 && (
        <Text style={styles.tierPayoutText}>
          {t.wallet.youGet} ${tier.totalPayout.toFixed(2)}
        </Text>
      )}

      <View style={[styles.tierRadio, selected && styles.tierRadioSelected]}>
        {selected && <View style={styles.tierRadioDot} />}
      </View>
    </Pressable>
  );
}

export default function WalletScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const { token } = useAuth();
  const { celebrate } = useCelebration();
  const [stats, setStats] = useState<UserStats | null>(null);
  const [serverBalance, setServerBalance] = useState<number>(0);
  const [serverTotalEarned, setServerTotalEarned] = useState<number>(0);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [selectedTier, setSelectedTier] = useState<WithdrawalTier | null>(null);
  const [tiers, setTiers] = useState<WithdrawalTier[]>([]);
  const [paypalEmail, setPaypalEmail] = useState("");
  const [paypalEmailError, setPaypalEmailError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawErrorCode, setWithdrawErrorCode] = useState<string | null>(null);
  const [withdrawSuccessVisible, setWithdrawSuccessVisible] = useState(false);
  const [withdrawSuccessAmount, setWithdrawSuccessAmount] = useState(0);
  const [pendingState, setPendingState] = useState<PendingState | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [isFocused, setIsFocused] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [referralBonusVisible, setReferralBonusVisible] = useState(false);
  const [referralBonusAmount, setReferralBonusAmount] = useState(0);
  const [referralBonusCount, setReferralBonusCount] = useState(0);
  const [serverError, setServerError] = useState(false);
  const [savedEmailWarning, setSavedEmailWarning] = useState(false);

  const [fontsLoaded] = useFonts({ Outfit_400Regular, Outfit_600SemiBold, Outfit_700Bold });

  const loadData = useCallback(async () => {
    setLoadError(false);
    setServerError(false);

    // Step 1: local reads — always populate the UI, even if server calls fail.
    try {
      const [s, txns] = await Promise.all([getUserStats(), getTransactions()]);
      setStats(s);
      setTransactions(txns);
    } catch {
      // Local storage failed entirely — nothing to show.
      setLoadError(true);
      setTransactions([]);
      return;
    }

    // Step 2: server calls — failure shows a warning banner, not the sad mascot.
    // Both fetchServerBalance and refreshPendingFromServer catch internally and
    // return null on failure rather than throwing, so each null return counts as
    // a partial server failure and must set serverError.
    try {
      const [srv, pending] = await Promise.all([
        fetchServerBalance(),
        refreshPendingFromServer(),
      ]);

      if (srv) {
        setServerBalance(srv.balance);
        setServerTotalEarned(srv.totalEarned);
        setTiers(getWithdrawalTiers(srv.balance));
      }

      if (pending) {
        setPendingState(pending);
      }

      // Either call returning null means at least one server piece failed.
      if (!srv || !pending) {
        setServerError(true);
      }

      // Check for newly qualified referrals and celebrate on the Wallet screen
      // so users who never navigate to the Referral tab still see the bonus.
      // The cursor is advanced on every check so the same bonus is never shown
      // twice — but new qualifications on later focus events still fire.
      if (!referralBonusVisible) {
        const [prevSeen, live] = await Promise.all([
          getSeenQualifiedReferrals(),
          fetchReferralStats(),
        ]);
        if (live) {
          const newlyQualified = live.qualifiedReferrals - prevSeen;
          if (newlyQualified > 0) {
            const bonus = newlyQualified * live.bonusPerReferral;
            setReferralBonusCount(newlyQualified);
            setReferralBonusAmount(bonus);
            setReferralBonusVisible(true);
          }
          // Always advance the seen cursor so the Referral screen doesn't re-fire.
          await setSeenQualifiedReferrals(live.qualifiedReferrals);
        }
      }
    } catch {
      // Unexpected throw — keep whatever local data we have and show banner.
      setServerError(true);
    }
  }, []);

  const handleConvertNow = useCallback(async () => {
    if (isConverting || (pendingState?.claimablePoints ?? 0) === 0) return;
    setIsConverting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const result = await claimAllReady();
      if (result && result.claimed > 0) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert(
          t.wallet.pointsConverted,
          t.wallet.pointsConvertedMsg
            .replace("{{pts}}", String(Math.round(result.creditedUsd * 1000)))
            .replace("{{usd}}", result.creditedUsd.toFixed(2)),
          [
            {
              text: "OK",
              onPress: () =>
                celebrate({
                  tier: result.creditedUsd >= 1 ? "epic" : "nice",
                  label: `+$${result.creditedUsd.toFixed(2)}`,
                  title: "Points Converted!",
                }),
            },
          ],
        );
        await loadData();
      }
    } catch {
      Alert.alert("Error", "Could not convert points. Please try again.");
    } finally {
      setIsConverting(false);
    }
  }, [isConverting, pendingState, t, loadData, celebrate]);

  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      loadData();
      return () => setIsFocused(false);
    }, [loadData]),
  );

  useEffect(() => {
    const pend = pendingState?.pending ?? [];
    const nextAt = pend.length > 0 ? Math.min(...pend.map((tk) => tk.claimableAt)) : null;
    if (!isFocused || nextAt == null || nextAt <= Date.now()) return;
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isFocused, pendingState]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, []);

  const openWithdrawModal = useCallback(async () => {
    const [integrity, srv, eligibility] = await Promise.all([
      checkDeviceIntegrity(),
      fetchServerBalance(),
      // Client-side UX pre-check (advisory only — server enforces authoritatively).
      // The daily-cap branch is reliable; the hold branch may be stale after a
      // reinstall. Either way the server will catch any ineligible request.
      canWithdraw(),
    ]);

    if (!integrity.clean) {
      Alert.alert(
        "Device Not Supported",
        "Withdrawals are not available on rooted or jailbroken devices. Please contact support if you believe this is an error."
      );
      return;
    }

    // Fast local hint for daily cap — skip for hold_period since the local
    // ACCOUNT_CREATED timestamp resets on reinstall and may be unreliable.
    if (!eligibility.allowed && eligibility.reason === "daily_limit") {
      Alert.alert(
        "Daily Limit Reached",
        "You've already made your maximum withdrawals for today. Come back tomorrow!"
      );
      return;
    }

    const effective = srv?.balance ?? 0;
    if (srv) {
      setServerBalance(srv.balance);
      setServerTotalEarned(srv.totalEarned);
    }
    if (effective < 3) {
      Alert.alert(
        t.wallet.minimumNotReached,
        srv
          ? `Your verified balance is $${effective.toFixed(2)}. Complete surveys or offers to reach the $3.00 minimum.`
          : t.wallet.needAtLeast
      );
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setTiers(getWithdrawalTiers(effective));
    setSelectedTier(null);
    const storedEmail = srv?.lastPaypalEmail ?? null;
    setPaypalEmail(storedEmail ?? "");
    // Run inline domain validation immediately on the pre-filled value so a
    // suspicious stored email shows the field-level error alongside the banner.
    const prefilledTrimmed = storedEmail?.trim() ?? "";
    const prefilledEmailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (
      prefilledTrimmed &&
      prefilledEmailRegex.test(prefilledTrimmed) &&
      !isPlausiblePayPalDomain(prefilledTrimmed)
    ) {
      setPaypalEmailError(
        "This email domain isn't accepted for PayPal payouts. Please use the email address linked to your real PayPal account."
      );
    } else {
      setPaypalEmailError(null);
    }
    setWithdrawError(null);
    setWithdrawErrorCode(null);
    setSavedEmailWarning(
      !!storedEmail && !isPlausiblePayPalDomain(storedEmail)
    );
    setShowWithdrawModal(true);
  }, [t]);

  const handlePaypalEmailChange = useCallback((value: string) => {
    setPaypalEmail(value);
    const trimmed = value.trim();
    if (!trimmed) {
      setPaypalEmailError(null);
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmed)) {
      setPaypalEmailError(null);
      return;
    }
    if (!isPlausiblePayPalDomain(trimmed)) {
      setPaypalEmailError(
        "This email domain isn't accepted for PayPal payouts. Please use the email address linked to your real PayPal account."
      );
    } else {
      setPaypalEmailError(null);
    }
  }, []);

  const handleWithdraw = useCallback(async () => {
    if (!selectedTier || !paypalEmail.trim()) return;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(paypalEmail.trim())) {
      Alert.alert("Invalid Email", "Please enter a valid PayPal email address.");
      return;
    }
    if (!isPlausiblePayPalDomain(paypalEmail.trim())) {
      setPaypalEmailError(
        "This email domain isn't accepted for PayPal payouts. Please use the email address linked to your real PayPal account."
      );
      return;
    }

    const integrity = await checkDeviceIntegrity();
    if (!integrity.clean) {
      Alert.alert(
        "Device Not Supported",
        "Withdrawals are not available on rooted or jailbroken devices. Please contact support if you believe this is an error."
      );
      return;
    }

    setSubmitting(true);
    setWithdrawError(null);
    setWithdrawErrorCode(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    try {
      await apiRequest("POST", "/api/withdrawals", {
        amount: selectedTier.amount,
        paypalEmail: paypalEmail.trim(),
      });

      // Keep the local daily-count hint in sync so canWithdraw() can give
      // accurate feedback before the next open. Fire-and-forget — the server
      // is the authoritative enforcer and a failure here is harmless.
      recordWithdrawalAttempt().catch(() => {});

      setShowWithdrawModal(false);
      const payout = selectedTier.totalPayout;
      setWithdrawSuccessAmount(payout);
      setWithdrawSuccessVisible(true);
      await loadData();
    } catch (err: unknown) {
      const fallback = "Failed to submit withdrawal request";
      const rawMsg = err instanceof Error ? err.message : fallback;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setWithdrawError(extractApiErrorMessage(rawMsg, fallback));
      setWithdrawErrorCode(extractApiErrorCode(rawMsg));
    } finally {
      setSubmitting(false);
    }
  }, [selectedTier, paypalEmail, t, loadData, celebrate]);

  if (!fontsLoaded) return null;
  if (!stats && loadError) {
    return (
      <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 67 : 0, alignItems: "center", justifyContent: "center" }]}>
        <Chipley pose="sad" size={112} />
        <Text style={[styles.emptyTitle, { marginTop: 16 }]}>{t.wallet.walletLoadError}</Text>
        <Text style={[styles.emptySubtitle, { textAlign: "center", paddingHorizontal: 32 }]}>{t.wallet.walletLoadErrorSub}</Text>
        <Pressable
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); loadData(); }}
          style={({ pressed }) => [styles.retryBtn, { opacity: pressed ? 0.8 : 1, marginTop: 20 }]}
        >
          <Feather name="refresh-cw" size={16} color={Colors.background} />
          <Text style={styles.retryBtnText}>{t.wallet.tryAgain}</Text>
        </Pressable>
      </View>
    );
  }
  if (!stats) return null;

  const webTopPad = Platform.OS === "web" ? 67 : 0;
  const displayBalance = serverBalance;
  const pendingTokens = pendingState?.pending ?? [];
  const nextUnlockAt =
    pendingTokens.length > 0
      ? Math.min(...pendingTokens.map((tk) => tk.claimableAt))
      : null;
  const hasPendingHold = (pendingState?.pendingPoints ?? 0) > 0 && nextUnlockAt != null;
  const countdownReady = nextUnlockAt != null && nowMs >= nextUnlockAt;
  const progressToNext = displayBalance < 3
    ? (displayBalance / 3) * 100
    : 100;
  const nextTierBonus = 0;

  return (
    <View style={[styles.container, { paddingTop: webTopPad }]}>
      <FlatList
        data={transactions}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: Platform.OS === "web" ? 34 : 16, paddingHorizontal: 16 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <LinearGradient
              colors={["#0D2818", "#0A1F14"]}
              style={styles.balanceCard}
            >
              <View style={styles.balanceRow}>
                <View>
                  <Text style={styles.balanceLabel}>{t.wallet.totalBalance}</Text>
                  <Text style={styles.balanceAmount}>${serverBalance.toFixed(2)}</Text>
                </View>
                <View style={styles.coinIcon}>
                  <MaterialCommunityIcons name="wallet" size={28} color={Colors.primary} />
                </View>
              </View>

              <View style={styles.statsRow}>
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>${serverTotalEarned.toFixed(2)}</Text>
                  <Text style={styles.statLabel}>{t.wallet.totalEarned}</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{stats.adsWatched}</Text>
                  <Text style={styles.statLabel}>{t.wallet.adsWatched}</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{stats.streak}</Text>
                  <Text style={styles.statLabel}>{t.wallet.dayStreak}</Text>
                </View>
              </View>
            </LinearGradient>

            {/* Points Card */}
            <View style={styles.pointsCard}>
              <View style={styles.pointsCardHeader}>
                <MaterialCommunityIcons name="star-four-points" size={14} color={Colors.primary} />
                <Text style={styles.pointsCardTitle}>{t.wallet.pendingPoints}</Text>
                <Text style={styles.pointsAutoNote}>{t.wallet.autoConverts}</Text>
              </View>
              <View style={styles.pointsStatsRow}>
                <View style={styles.pointsStat}>
                  <Text style={styles.pointsValue}>{formatPoints(pendingState?.pendingPoints ?? 0)}</Text>
                  <Text style={styles.pointsStatLabel}>
                    {hasPendingHold
                      ? countdownReady
                        ? t.wallet.readyToConvert
                        : tFn(t, "wallet.readyIn", { time: formatCountdown(nextUnlockAt!, nowMs) })
                      : t.wallet.holdFor3h}
                  </Text>
                </View>
                <View style={styles.pointsDivider} />
                <View style={styles.pointsStat}>
                  <Text style={[styles.pointsValue, (pendingState?.claimablePoints ?? 0) > 0 && { color: Colors.primary }]}>
                    {formatPoints(pendingState?.claimablePoints ?? 0)}
                  </Text>
                  <Text style={styles.pointsStatLabel}>{t.wallet.convertiblePoints}</Text>
                </View>
              </View>
              <Pressable
                onPress={handleConvertNow}
                disabled={isConverting || (pendingState?.claimablePoints ?? 0) === 0}
                style={({ pressed }) => [
                  styles.convertButton,
                  (pendingState?.claimablePoints ?? 0) === 0 && styles.convertButtonDisabled,
                  { opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <MaterialCommunityIcons
                  name="swap-horizontal"
                  size={15}
                  color={(pendingState?.claimablePoints ?? 0) > 0 ? Colors.background : Colors.textMuted}
                />
                <Text style={[styles.convertText, (pendingState?.claimablePoints ?? 0) === 0 && { color: Colors.textMuted }]}>
                  {isConverting
                    ? t.wallet.converting
                    : (pendingState?.claimablePoints ?? 0) > 0
                      ? `${t.wallet.convertNow} · $${(
                          (pendingState?.claimableUsd ?? 0) > 0
                            ? pendingState!.claimableUsd
                            : pointsToUsd(pendingState!.claimablePoints)
                        ).toFixed(2)}`
                      : t.wallet.convertNow}
                </Text>
              </Pressable>
              <Text style={styles.pointsAutoNote}>{t.wallet.valueGrowsWithRevenue}</Text>
            </View>

            {nextTierBonus > 0 && displayBalance < 7 && (
              <View style={styles.nextTierCard}>
                <View style={styles.nextTierHeader}>
                  <Feather name="trending-up" size={14} color={Colors.accent} />
                  <Text style={styles.nextTierTitle}>
                    {tFn(t, "wallet.saveForBonus", { amount: displayBalance < 3 ? 3 : displayBalance < 5 ? 5 : 7, bonus: nextTierBonus })}
                  </Text>
                </View>
                <View style={styles.progressBar}>
                  <View style={[styles.progressFill, { width: `${Math.min(((displayBalance / (displayBalance < 3 ? 3 : displayBalance < 5 ? 5 : 7)) * 100), 100)}%` as any }]} />
                </View>
                <Text style={styles.nextTierProgress}>
                  ${displayBalance.toFixed(2)} / ${(displayBalance < 3 ? 3 : displayBalance < 5 ? 5 : 7).toFixed(2)}
                </Text>
              </View>
            )}

            <View style={styles.verifiedBalanceCard}>
              <View style={styles.verifiedBalanceRow}>
                <Feather name="shield" size={14} color={Colors.primary} />
                <Text style={styles.verifiedBalanceLabel}>Verified withdrawable balance</Text>
              </View>
              <Text style={styles.verifiedBalanceAmount}>${serverBalance.toFixed(2)}</Text>
              <Text style={styles.verifiedBalanceHint}>
                Only earnings verified by survey and offer providers can be withdrawn.
              </Text>
            </View>

            <Pressable
              onPress={openWithdrawModal}
              style={({ pressed }) => [
                styles.withdrawButton,
                serverBalance < 3 && styles.withdrawButtonDisabled,
                { opacity: pressed ? 0.9 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
              ]}
            >
              <LinearGradient
                colors={serverBalance >= 3 ? [Colors.primary, Colors.primaryDark] : [Colors.surfaceHighlight, Colors.surface]}
                style={styles.withdrawGradient}
              >
                <Feather name="send" size={18} color={serverBalance >= 3 ? Colors.background : Colors.textMuted} />
                <Text style={[styles.withdrawText, serverBalance < 3 && { color: Colors.textMuted }]}>
                  {serverBalance >= 3 ? t.wallet.withdrawFunds : tFn(t, "wallet.moreToWithdraw", { amount: (3 - serverBalance).toFixed(2) })}
                </Text>
              </LinearGradient>
            </Pressable>


            <View style={styles.tierPreview}>
              <Text style={styles.tierPreviewTitle}>Payout Limits</Text>
              <View style={styles.tierMiniGrid}>
                {[
                  { label: "Minimum", value: "$3.00" },
                  { label: "Daily Max", value: "$7.00" },
                  { label: "Processing", value: "Minutes" },
                ].map((item) => (
                  <View key={item.label} style={[styles.tierMiniItem, { minWidth: "30%" }]}>
                    <Text style={styles.tierMiniAmt}>{item.value}</Text>
                    <Text style={[styles.tierMiniPct, { color: Colors.textMuted }]}>{item.label}</Text>
                  </View>
                ))}
              </View>
            </View>

            {serverError && (
              <View style={styles.serverWarningBanner}>
                <Feather name="wifi-off" size={14} color="#F5A623" />
                <Text style={styles.serverWarningText}>
                  Balance couldn't refresh — showing last known data. Pull down to retry.
                </Text>
              </View>
            )}

            <Text style={styles.sectionTitle}>{t.wallet.transactionHistory}</Text>
          </View>
        }
        renderItem={({ item }) => <TransactionItem item={item} t={t} />}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          loadError ? (
            <View style={styles.emptyState}>
              <Chipley pose="sad" size={96} />
              <Text style={styles.emptyTitle}>Couldn't load wallet</Text>
              <Text style={styles.emptySubtitle}>Check your connection and try again.</Text>
              <Pressable
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); loadData(); }}
                style={({ pressed }) => [styles.retryBtn, { opacity: pressed ? 0.8 : 1, marginTop: 8 }]}
              >
                <Feather name="refresh-cw" size={16} color={Colors.background} />
                <Text style={styles.retryBtnText}>Try Again</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Chipley pose="sleep" size={96} />
              <Text style={styles.emptyTitle}>{t.wallet.noTransactions}</Text>
              <Text style={styles.emptySubtitle}>{t.wallet.watchAdsToStart}</Text>
            </View>
          )
        }
      />


      <Modal visible={showWithdrawModal} animationType="slide" transparent>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t.wallet.chooseWithdrawalAmount}</Text>
              <Pressable onPress={() => setShowWithdrawModal(false)} hitSlop={12}>
                <Feather name="x" size={24} color={Colors.textSecondary} />
              </Pressable>
            </View>

            {withdrawError ? (
              <View style={styles.withdrawErrorState}>
                <Chipley pose="sad" size={96} />
                <Text style={styles.withdrawErrorTitle}>
                  {withdrawErrorCode === "PAYPAL_NOT_CONFIGURED" ? "Payouts Unavailable" : "Withdrawal Failed"}
                </Text>
                <Text style={styles.withdrawErrorText}>{withdrawError}</Text>
                <Pressable
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setWithdrawError(null); setWithdrawErrorCode(null); }}
                  style={({ pressed }) => [styles.retryBtn, { opacity: pressed ? 0.8 : 1 }]}
                >
                  {withdrawErrorCode !== "PAYPAL_NOT_CONFIGURED" && (
                    <Feather name="refresh-cw" size={16} color={Colors.background} />
                  )}
                  <Text style={styles.retryBtnText}>
                    {withdrawErrorCode === "PAYPAL_NOT_CONFIGURED" ? "Close" : "Try Again"}
                  </Text>
                </Pressable>
              </View>
            ) : (
            <>
            {savedEmailWarning && (
              <View style={styles.savedEmailWarningBanner}>
                <Feather name="alert-triangle" size={15} color="#F59E0B" />
                <Text style={styles.savedEmailWarningText}>
                  Your saved PayPal email may not be accepted — please update it before submitting.
                </Text>
              </View>
            )}
            <Text style={styles.modalBalance}>
              {t.wallet.available}: ${serverBalance.toFixed(2)}
            </Text>

            <ScrollView
              style={styles.tiersScroll}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 16 }}
            >
              {tiers.map((tier) => (
                <TierCard
                  key={tier.amount}
                  tier={tier}
                  selected={selectedTier?.amount === tier.amount}
                  onSelect={() => setSelectedTier(tier)}
                  t={t}
                />
              ))}
            </ScrollView>

            {selectedTier && (
              <>
                <View style={styles.paypalSection}>
                  <View style={styles.paypalHeader}>
                    <MaterialCommunityIcons name="email-outline" size={18} color={Colors.primary} />
                    <Text style={styles.paypalLabel}>PayPal Email</Text>
                  </View>
                  <View style={[styles.paypalInputWrapper, !!paypalEmailError && styles.paypalInputWrapperError]}>
                    <TextInput
                      style={styles.paypalInput}
                      placeholder="your@email.com"
                      placeholderTextColor={Colors.textMuted}
                      value={paypalEmail}
                      onChangeText={handlePaypalEmailChange}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoCorrect={false}
                      testID="withdraw-paypal-email"
                    />
                  </View>
                  {!!paypalEmailError && (
                    <View style={styles.paypalEmailErrorRow}>
                      <Feather name="alert-circle" size={13} color={Colors.error} />
                      <Text style={styles.paypalEmailErrorText}>{paypalEmailError}</Text>
                    </View>
                  )}
                </View>

                <View style={styles.summaryCard}>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>{t.wallet.withdrawal}</Text>
                    <Text style={styles.summaryValue}>${selectedTier.amount.toFixed(2)}</Text>
                  </View>
                  {selectedTier.bonusPercent > 0 && (
                    <View style={styles.summaryRow}>
                      <Text style={[styles.summaryLabel, { color: Colors.accent }]}>{t.wallet.bonus} (+{selectedTier.bonusPercent}%)</Text>
                      <Text style={[styles.summaryValue, { color: Colors.accent }]}>+${selectedTier.bonusAmount.toFixed(2)}</Text>
                    </View>
                  )}
                  <View style={[styles.summaryRow, styles.summaryTotal]}>
                    <Text style={styles.summaryTotalLabel}>{t.wallet.youReceive}</Text>
                    <Text style={styles.summaryTotalValue}>${selectedTier.totalPayout.toFixed(2)}</Text>
                  </View>
                  {paypalEmail.trim() ? (
                    <View style={styles.paypalConfirmRow}>
                      <Feather name="send" size={12} color={Colors.textSecondary} />
                      <Text style={styles.paypalConfirmText}>via PayPal to {paypalEmail.trim()}</Text>
                    </View>
                  ) : null}
                </View>
              </>
            )}

            <Pressable
              onPress={handleWithdraw}
              disabled={!selectedTier || !paypalEmail.trim() || !!paypalEmailError || submitting}
              style={({ pressed }) => [
                styles.confirmButton,
                (!selectedTier || !paypalEmail.trim() || !!paypalEmailError) && styles.confirmButtonDisabled,
                { opacity: pressed ? 0.9 : 1 },
              ]}
              testID="withdraw-confirm"
            >
              <LinearGradient
                colors={selectedTier && paypalEmail.trim() && !paypalEmailError ? [Colors.primary, Colors.primaryDark] : [Colors.surfaceHighlight, Colors.surface]}
                style={styles.confirmGradient}
              >
                {submitting ? (
                  <ActivityIndicator color={Colors.background} />
                ) : (
                  <>
                    <Feather name="check-circle" size={18} color={selectedTier && paypalEmail.trim() && !paypalEmailError ? Colors.background : Colors.textMuted} />
                    <Text style={[styles.confirmText, (!selectedTier || !paypalEmail.trim() || !!paypalEmailError) && { color: Colors.textMuted }]}>
                      {selectedTier ? `${t.wallet.withdraw} $${selectedTier.totalPayout.toFixed(2)}` : t.wallet.selectAnAmount}
                    </Text>
                  </>
                )}
              </LinearGradient>
            </Pressable>
            </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <RewardSuccessModal
        visible={withdrawSuccessVisible}
        amount={withdrawSuccessAmount}
        title="Cash Out Submitted!"
        subtitle="Your payout is on its way via PayPal."
        buttonLabel="Awesome!"
        onClose={() => {
          setWithdrawSuccessVisible(false);
          celebrate({
            tier: "epic",
            label: `$${withdrawSuccessAmount.toFixed(2)}`,
            title: "Cashing Out!",
          });
        }}
      />

      <RewardSuccessModal
        visible={referralBonusVisible}
        amount={referralBonusAmount}
        title="Referral Bonus!"
        subtitle={`${referralBonusCount} friend${referralBonusCount > 1 ? "s" : ""} cashed out — your bonus is in your wallet!`}
        buttonLabel="Awesome!"
        onClose={() => {
          setReferralBonusVisible(false);
          celebrate({
            tier: referralBonusAmount >= 1 ? "epic" : "nice",
            label: `+$${referralBonusAmount.toFixed(2)}`,
            title: "Referral Bonus!",
          });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { paddingTop: 12, paddingBottom: 8 },
  balanceCard: {
    borderRadius: 20, padding: 24, marginBottom: 12,
    borderWidth: 1, borderColor: "rgba(0, 230, 118, 0.15)",
  },
  balanceRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 },
  balanceLabel: { fontFamily: "Outfit_400Regular", fontSize: 14, color: Colors.textSecondary, marginBottom: 4 },
  balanceAmount: { fontFamily: "Outfit_700Bold", fontSize: 40, color: Colors.text, letterSpacing: -1 },
  coinIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: "rgba(0, 230, 118, 0.1)", alignItems: "center", justifyContent: "center" },
  statsRow: { flexDirection: "row", alignItems: "center" },
  statItem: { flex: 1, alignItems: "center" },
  statValue: { fontFamily: "Outfit_700Bold", fontSize: 18, color: Colors.text, marginBottom: 2 },
  statLabel: { fontFamily: "Outfit_400Regular", fontSize: 11, color: Colors.textMuted },
  statDivider: { width: 1, height: 28, backgroundColor: Colors.border },
  pointsCard: {
    backgroundColor: Colors.surface, borderRadius: 14, padding: 14, marginBottom: 12,
    borderWidth: 1, borderColor: "rgba(0, 230, 118, 0.12)",
  },
  pointsCardHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 },
  pointsCardTitle: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: Colors.text, flex: 1 },
  pointsAutoNote: { fontFamily: "Outfit_400Regular", fontSize: 11, color: Colors.textMuted },
  pointsStatsRow: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  pointsStat: { flex: 1, alignItems: "center" },
  pointsValue: { fontFamily: "Outfit_700Bold", fontSize: 18, color: Colors.textSecondary, marginBottom: 2 },
  pointsStatLabel: { fontFamily: "Outfit_400Regular", fontSize: 11, color: Colors.textMuted, textAlign: "center" },
  pointsDivider: { width: 1, height: 32, backgroundColor: Colors.border, marginHorizontal: 8 },
  convertButton: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 10,
  },
  convertButtonDisabled: { backgroundColor: Colors.surfaceHighlight },
  convertText: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: Colors.background },
  nextTierCard: {
    backgroundColor: Colors.surface, borderRadius: 14, padding: 14, marginBottom: 12,
    borderWidth: 1, borderColor: "rgba(255, 214, 0, 0.15)",
  },
  nextTierHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  nextTierTitle: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: Colors.accent },
  progressBar: { height: 6, backgroundColor: Colors.surfaceHighlight, borderRadius: 3, overflow: "hidden", marginBottom: 6 },
  progressFill: { height: "100%", backgroundColor: Colors.accent, borderRadius: 3 },
  nextTierProgress: { fontFamily: "Outfit_400Regular", fontSize: 11, color: Colors.textMuted, textAlign: "right" },
  verifiedBalanceCard: {
    backgroundColor: "rgba(0,230,118,0.08)",
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(0,230,118,0.25)",
  },
  verifiedBalanceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },
  verifiedBalanceLabel: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 12,
    color: Colors.textSecondary,
  },
  verifiedBalanceAmount: {
    fontFamily: "Outfit_700Bold",
    fontSize: 26,
    color: Colors.primary,
    marginTop: 2,
  },
  verifiedBalanceHint: {
    fontFamily: "Outfit_400Regular",
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 4,
  },
  withdrawButton: { marginBottom: 10 },
  withdrawButtonDisabled: { opacity: 0.7 },
  withdrawGradient: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 16, borderRadius: 14 },
  withdrawText: { fontFamily: "Outfit_700Bold", fontSize: 16, color: Colors.background },
  tierPreview: {
    backgroundColor: Colors.surface, borderRadius: 14, padding: 16, marginBottom: 20,
    borderWidth: 1, borderColor: Colors.border,
  },
  tierPreviewTitle: { fontFamily: "Outfit_700Bold", fontSize: 15, color: Colors.text, marginBottom: 2 },
  tierPreviewSubtitle: { fontFamily: "Outfit_400Regular", fontSize: 12, color: Colors.textMuted, marginBottom: 12 },
  tierMiniGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tierMiniItem: {
    width: "30%" as any, flexGrow: 1, backgroundColor: Colors.surfaceHighlight,
    borderRadius: 10, paddingVertical: 10, alignItems: "center",
  },
  tierMiniAmt: { fontFamily: "Outfit_700Bold", fontSize: 14, color: Colors.text, marginBottom: 2 },
  tierMiniPct: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: Colors.primary },
  sectionTitle: { fontFamily: "Outfit_700Bold", fontSize: 18, color: Colors.text, marginBottom: 12 },
  txItem: { flexDirection: "row", alignItems: "center", paddingVertical: 12 },
  txIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  txInfo: { flex: 1, marginLeft: 12, gap: 2 },
  txDesc: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: Colors.text },
  txDate: { fontFamily: "Outfit_400Regular", fontSize: 12, color: Colors.textMuted },
  txAmount: { fontFamily: "Outfit_700Bold", fontSize: 15 },
  separator: { height: 1, backgroundColor: Colors.border },
  emptyState: { alignItems: "center", paddingVertical: 48, gap: 8 },
  emptyTitle: { fontFamily: "Outfit_600SemiBold", fontSize: 16, color: Colors.textSecondary },
  emptySubtitle: { fontFamily: "Outfit_400Regular", fontSize: 13, color: Colors.textMuted },
  withdrawErrorState: { alignItems: "center", paddingVertical: 24, gap: 10 },
  withdrawErrorTitle: { fontFamily: "Outfit_700Bold", fontSize: 18, color: Colors.text },
  withdrawErrorText: { fontFamily: "Outfit_400Regular", fontSize: 13, color: Colors.textMuted, textAlign: "center", paddingHorizontal: 12 },
  retryBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: Colors.primary, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12, marginTop: 6,
  },
  retryBtnText: { fontFamily: "Outfit_700Bold", fontSize: 14, color: Colors.background },
  modalOverlay: {
    flex: 1, backgroundColor: Colors.overlay,
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: Colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingBottom: Platform.OS === "web" ? 34 : 32,
    maxHeight: "85%",
  },
  modalHandle: {
    width: 36, height: 4, backgroundColor: Colors.border, borderRadius: 2,
    alignSelf: "center", marginTop: 12, marginBottom: 16,
  },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  modalTitle: { fontFamily: "Outfit_700Bold", fontSize: 20, color: Colors.text },
  modalSubtitle: { fontFamily: "Outfit_400Regular", fontSize: 13, color: Colors.textSecondary, marginBottom: 4 },
  modalBalance: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: Colors.primary, marginBottom: 16 },
  tiersScroll: { maxHeight: 320 },
  tierCard: {
    backgroundColor: Colors.surface, borderRadius: 14, padding: 16, marginBottom: 10,
    borderWidth: 1.5, borderColor: Colors.border, alignItems: "center", position: "relative",
  },
  tierCardSelected: { borderColor: Colors.primary, backgroundColor: "rgba(0, 230, 118, 0.05)" },
  tierPopularBadge: {
    position: "absolute", top: -8, right: 12,
    backgroundColor: Colors.accent, borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 2,
    flexDirection: "row", alignItems: "center", gap: 3,
  },
  tierPopularText: { fontFamily: "Outfit_700Bold", fontSize: 10, color: "#000" },
  tierAmount: { fontFamily: "Outfit_700Bold", fontSize: 26, color: Colors.text, marginBottom: 4 },
  tierAmountSelected: { color: Colors.primary },
  tierBonusRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 2 },
  tierBonusText: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: Colors.accent },
  tierNoBonusText: { fontFamily: "Outfit_400Regular", fontSize: 13, color: Colors.textMuted, marginBottom: 2 },
  tierPayoutText: { fontFamily: "Outfit_400Regular", fontSize: 12, color: Colors.textSecondary },
  tierRadio: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 2,
    borderColor: Colors.border, alignItems: "center", justifyContent: "center",
    marginTop: 8,
  },
  tierRadioSelected: { borderColor: Colors.primary },
  tierRadioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.primary },
  summaryCard: {
    backgroundColor: Colors.surface, borderRadius: 14, padding: 16, marginBottom: 16,
    borderWidth: 1, borderColor: Colors.border,
  },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  summaryLabel: { fontFamily: "Outfit_400Regular", fontSize: 14, color: Colors.textSecondary },
  summaryValue: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: Colors.text },
  summaryTotal: {
    borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: 10, marginBottom: 0,
  },
  summaryTotalLabel: { fontFamily: "Outfit_700Bold", fontSize: 16, color: Colors.text },
  summaryTotalValue: { fontFamily: "Outfit_700Bold", fontSize: 18, color: Colors.primary },
  paypalSection: { marginBottom: 12 },
  paypalHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  paypalLabel: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: Colors.text },
  paypalInputWrapper: {
    backgroundColor: Colors.surface, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 14, height: 48, justifyContent: "center",
  },
  paypalInputWrapperError: { borderColor: Colors.error },
  paypalInput: { fontFamily: "Outfit_400Regular", fontSize: 15, color: Colors.text },
  paypalEmailErrorRow: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 6 },
  paypalEmailErrorText: { fontFamily: "Outfit_400Regular", fontSize: 12, color: Colors.error, flex: 1 },
  paypalConfirmRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  paypalConfirmText: { fontFamily: "Outfit_400Regular", fontSize: 12, color: Colors.textSecondary },
  confirmButton: { marginBottom: 8 },
  confirmButtonDisabled: { opacity: 0.6 },
  confirmGradient: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 16, borderRadius: 14,
  },
  confirmText: { fontFamily: "Outfit_700Bold", fontSize: 16, color: Colors.background },
  serverWarningBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(245, 166, 35, 0.12)",
    borderWidth: 1, borderColor: "rgba(245, 166, 35, 0.3)",
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    marginBottom: 16,
  },
  serverWarningText: {
    fontFamily: "Outfit_400Regular", fontSize: 12,
    color: "#F5A623", flex: 1,
  },
  savedEmailWarningBanner: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    backgroundColor: "rgba(245, 158, 11, 0.12)",
    borderWidth: 1, borderColor: "rgba(245, 158, 11, 0.35)",
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    marginBottom: 12,
  },
  savedEmailWarningText: {
    fontFamily: "Outfit_400Regular", fontSize: 12,
    color: "#F59E0B", flex: 1, lineHeight: 18,
  },
});
