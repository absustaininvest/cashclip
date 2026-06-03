import React, { useState, useCallback, useEffect, useRef } from "react";
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
  ScrollView,
  TextInput,
  ActivityIndicator,
  Animated,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useFonts, Outfit_400Regular, Outfit_600SemiBold, Outfit_700Bold } from "@expo-google-fonts/outfit";
import Colors from "@/constants/colors";
import {
  getUserStats,
  getTransactions,
  getWithdrawalTiers,
  type UserStats,
  type Transaction,
  type WithdrawalTier,
} from "@/lib/storage";
import {
  refreshPendingFromServer,
  claimAllReady,
  formatPoints,
  pointsToUsd,
  type PendingState,
} from "@/lib/earn-client";
import { useLanguage } from "@/lib/LanguageContext";
import { useAuth } from "@/lib/AuthContext";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import { checkDeviceIntegrity } from "@/lib/device-integrity";
import { secureGet } from "@/lib/secure-store";
import { t as tFn, type Translations } from "@/lib/i18n";

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
  const [stats, setStats] = useState<UserStats | null>(null);
  const [serverBalance, setServerBalance] = useState<number>(0);
  const [serverTotalEarned, setServerTotalEarned] = useState<number>(0);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [selectedTier, setSelectedTier] = useState<WithdrawalTier | null>(null);
  const [tiers, setTiers] = useState<WithdrawalTier[]>([]);
  const [paypalEmail, setPaypalEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pendingState, setPendingState] = useState<PendingState | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [lockedNudgeMsg, setLockedNudgeMsg] = useState<string | null>(null);
  const nudgeOpacity = useRef(new Animated.Value(0)).current;
  const nudgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [fontsLoaded] = useFonts({ Outfit_400Regular, Outfit_600SemiBold, Outfit_700Bold });

  const fetchServerBalance = useCallback(async (): Promise<{ balance: number; totalEarned: number } | null> => {
    try {
      const authToken = await secureGet("cashclip_auth_token");
      if (!authToken) return null;
      const url = new URL("/api/balance", getApiUrl());
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) return null;
      const data = await res.json();
      return { balance: Number(data.balance) || 0, totalEarned: Number(data.totalEarned) || 0 };
    } catch {
      return null;
    }
  }, []);

  const loadData = useCallback(async () => {
    const [s, txns, srv, pending] = await Promise.all([
      getUserStats(),
      getTransactions(),
      fetchServerBalance(),
      refreshPendingFromServer(),
    ]);
    setStats(s);
    setTransactions(txns);
    if (srv) {
      setServerBalance(srv.balance);
      setServerTotalEarned(srv.totalEarned);
      setTiers(getWithdrawalTiers(srv.balance));
    } else {
      setTiers(getWithdrawalTiers(s.balance));
    }
    if (pending) setPendingState(pending);
  }, [fetchServerBalance]);

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
        );
        await loadData();
      }
    } catch {
      Alert.alert(t.common.error, t.wallet.convertError);
    } finally {
      setIsConverting(false);
    }
  }, [isConverting, pendingState, t, loadData]);

  const showLockedNudge = useCallback((amt: number) => {
    const needed = Math.max(0, amt - serverBalance);
    const msg = tFn(t, "wallet.keepEarningNudge", {
      needed: needed.toFixed(2),
      tier: amt.toFixed(2),
    });
    if (nudgeTimer.current) clearTimeout(nudgeTimer.current);
    setLockedNudgeMsg(msg);
    nudgeOpacity.setValue(0);
    Animated.timing(nudgeOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    nudgeTimer.current = setTimeout(() => {
      Animated.timing(nudgeOpacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => {
        setLockedNudgeMsg(null);
      });
    }, 2500);
  }, [serverBalance, t, nudgeOpacity]);

  useEffect(() => {
    loadData();
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, []);

  const openWithdrawModal = useCallback(async (preselectedAmount?: number) => {
    const [integrity, srv] = await Promise.all([
      checkDeviceIntegrity(),
      fetchServerBalance(),
    ]);

    if (!integrity.clean) {
      Alert.alert(t.wallet.deviceNotSupported, t.wallet.deviceNotSupportedMsg);
      return;
    }

    const effective = srv?.balance ?? 0;
    if (srv) {
      setServerBalance(srv.balance);
      setServerTotalEarned(srv.totalEarned);
    }
    if (effective < 1) {
      Alert.alert(
        t.wallet.minimumNotReached,
        srv
          ? tFn(t, "wallet.verifiedBalanceMinMsg", { amount: effective.toFixed(2) })
          : t.wallet.needAtLeast
      );
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const freshTiers = getWithdrawalTiers(effective);
    setTiers(freshTiers);
    setPaypalEmail("");
    if (preselectedAmount != null) {
      const match = freshTiers.find((tier) => tier.amount === preselectedAmount) ?? null;
      setSelectedTier(match);
    } else {
      setSelectedTier(null);
    }
    setShowWithdrawModal(true);
  }, [fetchServerBalance, t]);

  const handleWithdraw = useCallback(async () => {
    if (!selectedTier || !paypalEmail.trim()) return;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(paypalEmail.trim())) {
      Alert.alert(t.wallet.invalidEmail, t.wallet.invalidEmailMsg);
      return;
    }

    const integrity = await checkDeviceIntegrity();
    if (!integrity.clean) {
      Alert.alert(t.wallet.deviceNotSupported, t.wallet.deviceNotSupportedMsg);
      return;
    }

    setSubmitting(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    try {
      await apiRequest("POST", "/api/withdrawals", {
        amount: selectedTier.amount,
        paypalEmail: paypalEmail.trim(),
      });

      setShowWithdrawModal(false);
      Alert.alert(
        t.wallet.withdrawalSuccessful,
        tFn(t, "wallet.withdrawalSentMsg", { amount: selectedTier.totalPayout.toFixed(2), email: paypalEmail.trim() })
      );
      await loadData();
    } catch (err: unknown) {
      const fallback = t.wallet.withdrawalFailed;
      const rawMsg = err instanceof Error ? err.message : fallback;
      Alert.alert(t.common.error, extractApiErrorMessage(rawMsg, fallback));
    } finally {
      setSubmitting(false);
    }
  }, [selectedTier, paypalEmail, t, loadData]);

  if (!fontsLoaded || !stats) return null;

  const webTopPad = Platform.OS === "web" ? 67 : 0;
  const displayBalance = serverBalance;
  const progressToNext = displayBalance < 1
    ? (displayBalance / 1) * 100
    : 100;
  const nextTierAmount = displayBalance < 1 ? 1 : displayBalance < 3 ? 3 : displayBalance < 5 ? 5 : displayBalance < 7 ? 7 : null;
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
                  <Text style={styles.balanceAmount}>${(serverBalance > 0 ? serverBalance : stats.balance).toFixed(2)}</Text>
                </View>
                <View style={styles.coinIcon}>
                  <MaterialCommunityIcons name="wallet" size={28} color={Colors.primary} />
                </View>
              </View>

              <View style={styles.statsRow}>
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>${(serverTotalEarned > 0 ? serverTotalEarned : stats.totalEarned).toFixed(2)}</Text>
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
                  <Text style={styles.pointsStatLabel}>{t.wallet.holdFor3h}</Text>
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
                      ? `${t.wallet.convertNow} · $${pointsToUsd(pendingState!.claimablePoints).toFixed(2)}`
                      : t.wallet.convertNow}
                </Text>
              </Pressable>
            </View>

            {nextTierAmount && (
              <View style={styles.nextTierCard}>
                <View style={styles.nextTierHeader}>
                  <Feather name="trending-up" size={14} color={Colors.accent} />
                  <Text style={styles.nextTierTitle}>
                    {displayBalance < 1 ? t.wallet.reachToUnlock : tFn(t, "wallet.saveForBonus", { amount: nextTierAmount!, bonus: nextTierBonus })}
                  </Text>
                </View>
                <View style={styles.progressBar}>
                  <View style={[styles.progressFill, { width: `${Math.min(((displayBalance / (nextTierAmount || 1)) * 100), 100)}%` as any }]} />
                </View>
                <Text style={styles.nextTierProgress}>
                  ${displayBalance.toFixed(2)} / ${(nextTierAmount || 1).toFixed(2)}
                </Text>
              </View>
            )}

            <View style={styles.verifiedBalanceCard}>
              <View style={styles.verifiedBalanceRow}>
                <Feather name="shield" size={14} color={Colors.primary} />
                <Text style={styles.verifiedBalanceLabel}>{t.wallet.verifiedBalance}</Text>
              </View>
              <Text style={styles.verifiedBalanceAmount}>${serverBalance.toFixed(2)}</Text>
              <Text style={styles.verifiedBalanceHint}>
                {t.wallet.verifiedBalanceHint}
              </Text>
            </View>

            <Pressable
              onPress={() => openWithdrawModal()}
              style={({ pressed }) => [
                styles.withdrawButton,
                serverBalance < 1 && styles.withdrawButtonDisabled,
                { opacity: pressed ? 0.9 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
              ]}
            >
              <LinearGradient
                colors={serverBalance >= 1 ? [Colors.primary, Colors.primaryDark] : [Colors.surfaceHighlight, Colors.surface]}
                style={styles.withdrawGradient}
              >
                <Feather name="send" size={18} color={serverBalance >= 1 ? Colors.background : Colors.textMuted} />
                <Text style={[styles.withdrawText, serverBalance < 1 && { color: Colors.textMuted }]}>
                  {serverBalance >= 1 ? t.wallet.withdrawFunds : tFn(t, "wallet.moreToWithdraw", { amount: (1 - serverBalance).toFixed(2) })}
                </Text>
              </LinearGradient>
            </Pressable>


            <View style={styles.tierPreview}>
              <View style={styles.tierPreviewHeader}>
                <Text style={styles.tierPreviewTitle}>{t.wallet.withdrawalOptions}</Text>
                {tiers.length > 0 && (
                  <View style={styles.readyBadge}>
                    <Feather name="check-circle" size={11} color={Colors.background} />
                    <Text style={styles.readyBadgeText}>{t.wallet.readyToCashOut}</Text>
                  </View>
                )}
              </View>
              <Text style={styles.tierPreviewSubtitle}>
                {tiers.length > 0
                  ? tFn(t, "wallet.canWithdrawNow", { amounts: tiers.map((tier) => `$${tier.amount.toFixed(2)}`).join(", ") })
                  : tFn(t, "wallet.keepEarningNudge", { needed: Math.max(0, 1 - displayBalance).toFixed(2), tier: "1.00" })}
              </Text>
              <View style={styles.tierMiniGrid}>
                {[1, 3, 5, 7].map((amt) => {
                  const unlocked = tiers.some((t) => t.amount === amt);
                  if (unlocked) {
                    return (
                      <Pressable
                        key={amt}
                        onPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          openWithdrawModal(amt);
                        }}
                        style={({ pressed }) => [
                          styles.tierMiniItem,
                          styles.tierMiniItemUnlocked,
                          { opacity: pressed ? 0.75 : 1, transform: [{ scale: pressed ? 0.95 : 1 }] },
                        ]}
                      >
                        <Feather name="check-circle" size={13} color={Colors.primary} style={{ marginBottom: 3 }} />
                        <Text style={styles.tierMiniAmt}>${amt.toFixed(2)}</Text>
                        <Text style={[styles.tierMiniPct, { color: Colors.primary }]}>{t.wallet.available}</Text>
                      </Pressable>
                    );
                  }
                  return (
                    <Pressable
                      key={amt}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        showLockedNudge(amt);
                      }}
                      style={({ pressed }) => [
                        styles.tierMiniItem,
                        { opacity: pressed ? 0.7 : 1, transform: [{ scale: pressed ? 0.95 : 1 }] },
                      ]}
                    >
                      <Feather name="lock" size={13} color={Colors.textMuted} style={{ marginBottom: 3 }} />
                      <Text style={[styles.tierMiniAmt, { color: Colors.textMuted }]}>${amt.toFixed(2)}</Text>
                      <Text style={[styles.tierMiniPct, { color: Colors.textMuted }]}>{t.wallet.tierLocked}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {lockedNudgeMsg && (
                <Animated.View style={[styles.lockedNudge, { opacity: nudgeOpacity }]}>
                  <Feather name="trending-up" size={13} color={Colors.primary} />
                  <Text style={styles.lockedNudgeText}>{lockedNudgeMsg}</Text>
                </Animated.View>
              )}
            </View>

            <Text style={styles.sectionTitle}>{t.wallet.transactionHistory}</Text>
          </View>
        }
        renderItem={({ item }) => <TransactionItem item={item} t={t} />}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Feather name="inbox" size={40} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>{t.wallet.noTransactions}</Text>
            <Text style={styles.emptySubtitle}>{t.wallet.watchAdsToStart}</Text>
          </View>
        }
      />


      <Modal visible={showWithdrawModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t.wallet.chooseWithdrawalAmount}</Text>
              <Pressable onPress={() => setShowWithdrawModal(false)} hitSlop={12}>
                <Feather name="x" size={24} color={Colors.textSecondary} />
              </Pressable>
            </View>
            <Text style={styles.modalSubtitle}>
              {t.wallet.higherAmountsBiggerBonuses}
            </Text>
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
                    <Text style={styles.paypalLabel}>{t.wallet.paypalEmailLabel}</Text>
                  </View>
                  <View style={styles.paypalInputWrapper}>
                    <TextInput
                      style={styles.paypalInput}
                      placeholder={t.wallet.paypalEmailPlaceholder}
                      placeholderTextColor={Colors.textMuted}
                      value={paypalEmail}
                      onChangeText={setPaypalEmail}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoCorrect={false}
                      testID="withdraw-paypal-email"
                    />
                  </View>
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
                      <Text style={styles.paypalConfirmText}>{tFn(t, "wallet.viaPaypalTo", { email: paypalEmail.trim() })}</Text>
                    </View>
                  ) : null}
                </View>
              </>
            )}

            <Pressable
              onPress={handleWithdraw}
              disabled={!selectedTier || !paypalEmail.trim() || submitting}
              style={({ pressed }) => [
                styles.confirmButton,
                (!selectedTier || !paypalEmail.trim()) && styles.confirmButtonDisabled,
                { opacity: pressed ? 0.9 : 1 },
              ]}
              testID="withdraw-confirm"
            >
              <LinearGradient
                colors={selectedTier && paypalEmail.trim() ? [Colors.primary, Colors.primaryDark] : [Colors.surfaceHighlight, Colors.surface]}
                style={styles.confirmGradient}
              >
                {submitting ? (
                  <ActivityIndicator color={Colors.background} />
                ) : (
                  <>
                    <Feather name="check-circle" size={18} color={selectedTier && paypalEmail.trim() ? Colors.background : Colors.textMuted} />
                    <Text style={[styles.confirmText, (!selectedTier || !paypalEmail.trim()) && { color: Colors.textMuted }]}>
                      {selectedTier ? `${t.wallet.withdraw} $${selectedTier.totalPayout.toFixed(2)}` : t.wallet.selectAnAmount}
                    </Text>
                  </>
                )}
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </Modal>
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
  tierPreviewHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 2 },
  tierPreviewTitle: { fontFamily: "Outfit_700Bold", fontSize: 15, color: Colors.text },
  tierPreviewSubtitle: { fontFamily: "Outfit_400Regular", fontSize: 12, color: Colors.textMuted, marginBottom: 12 },
  readyBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: Colors.primary, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3,
  },
  readyBadgeText: { fontFamily: "Outfit_700Bold", fontSize: 11, color: Colors.background },
  tierMiniGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 0 },
  lockedNudge: {
    flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10,
    backgroundColor: "rgba(0,230,118,0.10)", borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 7,
    borderWidth: 1, borderColor: "rgba(0,230,118,0.25)",
  },
  lockedNudgeText: {
    fontFamily: "Outfit_600SemiBold", fontSize: 12, color: Colors.primary, flexShrink: 1,
  },
  tierMiniItem: {
    width: "20%" as any, flexGrow: 1, backgroundColor: Colors.surfaceHighlight,
    borderRadius: 10, paddingVertical: 10, alignItems: "center",
  },
  tierMiniItemUnlocked: {
    backgroundColor: "rgba(0,230,118,0.08)",
    borderWidth: 1, borderColor: "rgba(0,230,118,0.3)",
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
  paypalInput: { fontFamily: "Outfit_400Regular", fontSize: 15, color: Colors.text },
  paypalConfirmRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  paypalConfirmText: { fontFamily: "Outfit_400Regular", fontSize: 12, color: Colors.textSecondary },
  confirmButton: { marginBottom: 8 },
  confirmButtonDisabled: { opacity: 0.6 },
  confirmGradient: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 16, borderRadius: 14,
  },
  confirmText: { fontFamily: "Outfit_700Bold", fontSize: 16, color: Colors.background },
});
