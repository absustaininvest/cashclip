import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Platform,
  Alert,
  Share,
  FlatList,
  ActivityIndicator,
} from "react-native";
import { Feather, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useFonts, Outfit_400Regular, Outfit_600SemiBold, Outfit_700Bold } from "@expo-google-fonts/outfit";
import Colors from "@/constants/colors";
import Chipley from "@/components/Chipley";
import { useLanguage } from "@/lib/LanguageContext";
import {
  fetchReferralStats,
  type ReferralStats,
  type ReferralFriend,
} from "@/lib/earn-client";
import {
  cacheReferralStats,
  setWeeklyMissionProgress,
  getCurrentWeekStartMs,
  getTotalReferrals,
  getReferralEarnings,
} from "@/lib/storage";

export default function ReferralScreen() {
  const { t } = useLanguage();
  const [fontsLoaded] = useFonts({ Outfit_400Regular, Outfit_600SemiBold, Outfit_700Bold });

  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [fetchError, setFetchError] = useState<boolean>(false);

  const loadData = useCallback(async () => {
    setFetchError(false);
    const live = await fetchReferralStats();
    if (live) {
      setStats(live);
      // Mirror server-authoritative numbers into the local cache so other
      // screens (e.g. Profile) stay consistent. No balance is ever minted here.
      await cacheReferralStats(live.totalReferrals, live.referralEarnings);
      // Social Butterfly weekly mission: progress = friends who qualified
      // (cashed out $3+) THIS week, as derived from server records.
      const weekStart = getCurrentWeekStartMs();
      const qualifiedThisWeek = live.referrals.filter(
        (r) => r.qualified && r.qualifiedAt != null && r.qualifiedAt >= weekStart,
      ).length;
      if (qualifiedThisWeek > 0) {
        await setWeeklyMissionProgress("weekly_referrals", qualifiedThisWeek);
      }
      // The celebration overlay for new referral bonuses is shown on the Wallet
      // screen (useFocusEffect) so users who never visit this tab still see it.
      // The seen cursor is also advanced there, so by the time this screen loads
      // there is nothing left to surface again.
    } else {
      // Offline / unauthenticated: fall back to last cached totals so the
      // screen isn't blank, but show no friend list we can't verify.
      setFetchError(true);
      const totalRefs = await getTotalReferrals();
      const earnings = await getReferralEarnings();
      setStats((prev) =>
        prev ?? {
          code: "",
          totalReferrals: totalRefs,
          qualifiedReferrals: 0,
          pendingReferrals: 0,
          referralEarnings: earnings,
          bonusPerReferral: 0.5,
          qualifyAmount: 3,
          referrals: [],
        },
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const referralCode = stats?.code ?? "";

  const handleCopyCode = () => {
    if (!referralCode) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(
      t.referral.copyReferralCode,
      `${t.referral.yourCodeIs}\n\n${referralCode}\n\n${t.referral.copyAndShare}`,
      [{ text: "OK", onPress: () => {} }]
    );
  };

  const handleShare = async () => {
    if (!referralCode) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Smart link lands friends on cash-clip.app/r/<code>: it detects their
    // platform, points them to the store, and shows the code ready to paste.
    // The code is included inline as a fallback in case the link is stripped.
    const referralUrl = `https://cash-clip.app/r/${encodeURIComponent(referralCode)}`;
    const message = `${t.referral.joinCashClip} ${referralCode}\n${referralUrl}`;
    try {
      await Share.share({ message, title: t.referral.shareYourLink });
    } catch {
      // Sharing dismissed/unavailable — show the link so it can be copied.
      Alert.alert(t.referral.shareYourLink, message, [{ text: "OK", onPress: () => {} }]);
    }
  };

  if (!fontsLoaded) return null;

  const webTopPad = Platform.OS === "web" ? 67 : 0;

  const renderReferralItem = ({ item }: { item: ReferralFriend }) => (
    <View style={styles.referralItem}>
      <View style={styles.referralItemContent}>
        <View style={styles.referralInfo}>
          <Text style={styles.referralName}>{item.name}</Text>
          <Text style={styles.referralDate}>
            {t.referral.joined} {new Date(item.joinedAt).toLocaleDateString()}
          </Text>
        </View>
        {item.qualified ? (
          <View style={[styles.badge, styles.badgeQualified]}>
            <Feather name="check-circle" size={13} color={Colors.accent} />
            <Text style={[styles.badgeText, { color: Colors.accent }]}>{t.referral.qualified}</Text>
          </View>
        ) : (
          <View style={[styles.badge, styles.badgePending]}>
            <Feather name="clock" size={13} color={Colors.textMuted} />
            <Text style={[styles.badgeText, { color: Colors.textMuted }]}>{t.referral.pending}</Text>
          </View>
        )}
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: Colors.background }]}>
      <ScrollView
        style={[styles.scrollView, { paddingTop: webTopPad }]}
        contentContainerStyle={{ paddingBottom: Platform.OS === "web" ? 34 : 0 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.content}>
          <View style={styles.codeSection}>
            <LinearGradient
              colors={[Colors.primary, Colors.accent]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.codeCardGradient}
            >
              <View style={styles.codeCard}>
                <Text style={styles.codeLabel}>{t.referral.yourReferralCode}</Text>
                <Text style={styles.codeText}>{referralCode || "—"}</Text>
                <Pressable
                  onPress={handleCopyCode}
                  style={({ pressed }) => [styles.copyButton, { opacity: pressed ? 0.7 : 1 }]}
                >
                  <Feather name="copy" size={18} color={Colors.background} />
                  <Text style={styles.copyButtonText}>{t.referral.copy}</Text>
                </Pressable>
              </View>
            </LinearGradient>
          </View>

          <Pressable
            onPress={handleShare}
            style={({ pressed }) => [styles.shareButton, { opacity: pressed ? 0.8 : 1 }]}
          >
            <LinearGradient colors={[Colors.accent, Colors.accent]} style={styles.shareButtonGradient}>
              <Feather name="share-2" size={20} color={Colors.background} />
              <Text style={styles.shareButtonText}>{t.referral.shareReferralLink}</Text>
            </LinearGradient>
          </Pressable>

          <View style={styles.howCard}>
            <View style={styles.howIcon}>
              <Feather name="info" size={18} color={Colors.primary} />
            </View>
            <View style={styles.howContent}>
              <Text style={styles.howTitle}>{t.referral.howItWorks}</Text>
              <Text style={styles.howBody}>{t.referral.howItWorksBody}</Text>
            </View>
          </View>

          <View style={styles.statsSection}>
            <View style={styles.statCard}>
              <View style={styles.statIconContainer}>
                <MaterialCommunityIcons name="account-multiple" size={24} color={Colors.primary} />
              </View>
              <View style={styles.statContent}>
                <Text style={styles.statValue}>{stats?.totalReferrals ?? 0}</Text>
                <Text style={styles.statLabel}>{t.referral.friendsJoined}</Text>
              </View>
            </View>

            <View style={styles.statCard}>
              <View style={styles.statIconContainer}>
                <MaterialCommunityIcons name="check-decagram" size={24} color={Colors.accent} />
              </View>
              <View style={styles.statContent}>
                <Text style={styles.statValue}>{stats?.qualifiedReferrals ?? 0}</Text>
                <Text style={styles.statLabel}>{t.referral.qualifiedFriends}</Text>
              </View>
            </View>

            <View style={styles.statCard}>
              <View style={styles.statIconContainer}>
                <MaterialCommunityIcons name="cash-multiple" size={24} color={Colors.accent} />
              </View>
              <View style={styles.statContent}>
                <Text style={styles.statValue}>${(stats?.referralEarnings ?? 0).toFixed(2)}</Text>
                <Text style={styles.statLabel}>{t.referral.referralEarnings}</Text>
              </View>
            </View>
          </View>

          {fetchError && !stats?.code && (
            <View style={styles.fetchErrorCard}>
              <Chipley pose="sad" size={96} />
              <Text style={styles.fetchErrorTitle}>Couldn't Load Referrals</Text>
              <Text style={styles.fetchErrorText}>
                Something went wrong while fetching your referral data. Check your connection and try again.
              </Text>
              <Pressable
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); loadData(); }}
                style={({ pressed }) => [styles.fetchErrorRetryBtn, { opacity: pressed ? 0.8 : 1 }]}
              >
                <Feather name="refresh-cw" size={16} color={Colors.background} />
                <Text style={styles.fetchErrorRetryBtnText}>Try Again</Text>
              </Pressable>
            </View>
          )}

          <View style={styles.referralListSection}>
            <Text style={styles.sectionTitle}>{t.referral.yourReferrals}</Text>
            {loading ? (
              <View style={styles.emptyState}>
                <ActivityIndicator color={Colors.primary} />
              </View>
            ) : fetchError && (stats?.referrals.length ?? 0) === 0 ? (
              <View style={styles.emptyState}>
                <Chipley pose="sad" size={80} />
                <Text style={styles.emptyStateText}>Couldn't load your friends list. Pull down to retry.</Text>
              </View>
            ) : (stats?.referrals.length ?? 0) === 0 ? (
              <View style={styles.emptyState}>
                <Chipley pose="sleep" size={96} />
                <Text style={styles.emptyStateText}>{t.referral.noReferralsYet}</Text>
              </View>
            ) : (
              <FlatList
                data={stats?.referrals ?? []}
                renderItem={renderReferralItem}
                keyExtractor={(item, index) => `${item.name}-${item.joinedAt}-${index}`}
                scrollEnabled={false}
                ItemSeparatorComponent={() => <View style={styles.separator} />}
              />
            )}
          </View>
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
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
  },
  codeSection: {
    marginBottom: 20,
  },
  codeCardGradient: {
    borderRadius: 16,
    padding: 1,
  },
  codeCard: {
    backgroundColor: Colors.background,
    borderRadius: 15,
    padding: 20,
    alignItems: "center",
  },
  codeLabel: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  codeText: {
    fontFamily: "Outfit_700Bold",
    fontSize: 32,
    color: Colors.text,
    letterSpacing: 1,
    marginBottom: 16,
    textAlign: "center",
  },
  copyButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  copyButtonText: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 14,
    color: Colors.background,
  },
  shareButton: {
    marginBottom: 20,
    borderRadius: 12,
    overflow: "hidden",
  },
  shareButtonGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  shareButtonText: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 16,
    color: Colors.background,
  },
  howCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 24,
  },
  howIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: Colors.surfaceHighlight,
    alignItems: "center",
    justifyContent: "center",
  },
  howContent: {
    flex: 1,
  },
  howTitle: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 14,
    color: Colors.text,
    marginBottom: 4,
  },
  howBody: {
    fontFamily: "Outfit_400Regular",
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  statsSection: {
    gap: 12,
    marginBottom: 24,
  },
  statCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: Colors.surfaceHighlight,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  statContent: {
    flex: 1,
  },
  statValue: {
    fontFamily: "Outfit_700Bold",
    fontSize: 20,
    color: Colors.text,
    marginBottom: 2,
  },
  statLabel: {
    fontFamily: "Outfit_400Regular",
    fontSize: 12,
    color: Colors.textMuted,
  },
  sectionTitle: {
    fontFamily: "Outfit_700Bold",
    fontSize: 18,
    color: Colors.text,
    marginBottom: 12,
  },
  referralListSection: {
    marginBottom: 24,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 40,
  },
  emptyStateText: {
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: Colors.textMuted,
    marginTop: 12,
    textAlign: "center",
  },
  referralItem: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  referralItemContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 14,
  },
  referralInfo: {
    flex: 1,
  },
  referralName: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 15,
    color: Colors.text,
    marginBottom: 4,
  },
  referralDate: {
    fontFamily: "Outfit_400Regular",
    fontSize: 12,
    color: Colors.textMuted,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginLeft: 12,
  },
  badgeQualified: {
    backgroundColor: Colors.surfaceHighlight,
  },
  badgePending: {
    backgroundColor: Colors.surfaceHighlight,
  },
  badgeText: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 12,
  },
  separator: {
    height: 8,
  },
  fetchErrorCard: {
    alignItems: "center",
    paddingVertical: 32,
    paddingHorizontal: 16,
    gap: 10,
    marginBottom: 8,
  },
  fetchErrorTitle: {
    fontFamily: "Outfit_700Bold",
    fontSize: 18,
    color: Colors.text,
    textAlign: "center",
  },
  fetchErrorText: {
    fontFamily: "Outfit_400Regular",
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: "center",
    lineHeight: 18,
  },
  fetchErrorRetryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
    marginTop: 6,
  },
  fetchErrorRetryBtnText: {
    fontFamily: "Outfit_700Bold",
    fontSize: 14,
    color: Colors.background,
  },
});
