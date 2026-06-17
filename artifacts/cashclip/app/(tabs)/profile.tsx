import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Platform,
  RefreshControl,
  Alert,
  TextInput,
  ActivityIndicator,
} from "react-native";
import Constants from "expo-constants";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useFonts, Outfit_400Regular, Outfit_600SemiBold, Outfit_700Bold } from "@expo-google-fonts/outfit";
import Colors from "@/constants/colors";
import { getUserStats, getReferralEarnings, getTotalReferrals, getUnreadNotificationCount, PAYPAL_EMAIL_CACHE_KEY, type UserStats } from "@/lib/storage";
import { secureGet, secureSet } from "@/lib/secure-store";
import { apiRequest } from "@/lib/query-client";
import { getDisplayPointsPerDollar } from "@/lib/points";
import { fetchServerBalance, fetchConversionRate } from "@/lib/earn-client";
import { useLanguage } from "@/lib/LanguageContext";
import { useAuth } from "@/lib/AuthContext";
import { isPlausiblePayPalDomain, INVALID_PAYPAL_EMAIL_MESSAGE } from "@workspace/validation";
import type { Translations } from "@/lib/i18n";

interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  iconSet: "feather" | "ionicons" | "material";
  unlocked: boolean;
  color: string;
}

// Levels are driven by total lifetime POINTS earned (simple cumulative).
// Owner display model: 10,000 pts = $1 (DISPLAY_POINTS_PER_DOLLAR, imported from
// the single source of truth). "Money Maker" unlocks at 50,000 pts ($5).
const LEVEL_THRESHOLDS = [1000, 4000, 6000, 10000, 15000];

function computeLevel(lifetimePoints: number): number {
  let level = 1;
  for (const threshold of LEVEL_THRESHOLDS) {
    if (lifetimePoints >= threshold) level++;
  }
  return level;
}

function getAchievements(stats: UserStats & { totalReferrals: number; lifetimePoints: number }, t: Translations): Achievement[] {
  return [
    { id: "first_ad", title: t.profile.firstStep, description: t.profile.watchFirstAd, icon: "play", iconSet: "feather", unlocked: stats.adsWatched >= 1, color: "#4ECDC4" },
    { id: "ten_ads", title: t.profile.gettingStarted, description: t.profile.watch10Ads, icon: "zap", iconSet: "feather", unlocked: stats.adsWatched >= 10, color: "#FFD600" },
    { id: "fifty_ads", title: t.profile.adExpert, description: t.profile.watch50Ads, icon: "award", iconSet: "feather", unlocked: stats.adsWatched >= 50, color: "#FF6B6B" },
    { id: "hundred_ads", title: t.profile.adChampion, description: t.profile.watch100Ads, icon: "trophy", iconSet: "ionicons", unlocked: stats.adsWatched >= 100, color: "#E040FB" },
    { id: "streak_3", title: t.profile.consistency, description: t.profile.threeDayStreak, icon: "flame", iconSet: "ionicons", unlocked: stats.streak >= 3, color: "#FF7043" },
    { id: "streak_7", title: t.profile.weeklyWarrior, description: t.profile.sevenDayStreak, icon: "fire", iconSet: "material", unlocked: stats.streak >= 7, color: "#F44336" },
    { id: "earn_1", title: t.profile.firstDollar, description: t.profile.earnFirst1, icon: "dollar-sign", iconSet: "feather", unlocked: stats.lifetimePoints >= 10000, color: "#00E676" },
    { id: "earn_10", title: t.profile.moneyMaker, description: t.profile.earn10Total, icon: "cash-multiple", iconSet: "material", unlocked: stats.lifetimePoints >= 50000, color: "#00BCD4" },
    { id: "referral_1", title: t.profile.connector, description: t.profile.invite1Friend, icon: "user-plus", iconSet: "feather", unlocked: stats.totalReferrals >= 1, color: "#7C4DFF" },
    { id: "referral_5", title: t.profile.influencer, description: t.profile.invite5Friends, icon: "users", iconSet: "feather", unlocked: stats.totalReferrals >= 5, color: "#E91E63" },
  ];
}

function AchievementCard({ achievement }: { achievement: Achievement }) {
  const renderIcon = () => {
    const color = achievement.unlocked ? achievement.color : Colors.textMuted;
    const size = 22;
    if (achievement.iconSet === "feather") return <Feather name={achievement.icon as any} size={size} color={color} />;
    if (achievement.iconSet === "ionicons") return <Ionicons name={achievement.icon as any} size={size} color={color} />;
    return <MaterialCommunityIcons name={achievement.icon as any} size={size} color={color} />;
  };

  return (
    <View style={[styles.achievementCard, !achievement.unlocked && styles.achievementLocked]}>
      <View style={[styles.achievementIcon, { backgroundColor: achievement.unlocked ? `${achievement.color}20` : Colors.surfaceHighlight }]}>
        {renderIcon()}
      </View>
      <Text style={[styles.achievementTitle, !achievement.unlocked && styles.lockedText]}>{achievement.title}</Text>
      <Text style={[styles.achievementDesc, !achievement.unlocked && styles.lockedText]}>{achievement.description}</Text>
      {achievement.unlocked && <Ionicons name="checkmark-circle" size={14} color={Colors.primary} style={{ marginTop: 4 }} />}
    </View>
  );
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { lang, t, setLang } = useLanguage();
  const { user, isAdmin, logout, token, refreshUser } = useAuth();
  const [stats, setStats] = useState<(UserStats & { totalReferrals: number; referralEarnings: number; unreadNotifs: number; lifetimePoints: number }) | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [paypalInput, setPaypalInput] = useState("");
  const [paypalSaving, setPaypalSaving] = useState(false);
  const [paypalError, setPaypalError] = useState<string | null>(null);

  const [fontsLoaded] = useFonts({ Outfit_400Regular, Outfit_600SemiBold, Outfit_700Bold });

  const loadStats = useCallback(async () => {
    const [s, refEarnings, totalRefs, unread, serverBal] = await Promise.all([
      getUserStats(),
      getReferralEarnings(),
      getTotalReferrals(),
      getUnreadNotificationCount(),
      fetchServerBalance(),
      // Refresh the server-provided display rate (applied as a side-effect) so
      // lifetime points and levels reflect the latest owner-tuned value.
      fetchConversionRate(),
    ]);
    // Lifetime points come from the server-authoritative totalEarned (real cash
    // earned), translated into the server-provided display model (default
    // 10,000 pts = $1) via getDisplayPointsPerDollar().
    const lifetimePoints = Math.round((serverBal?.totalEarned ?? 0) * getDisplayPointsPerDollar());
    setStats({ ...s, totalReferrals: totalRefs, referralEarnings: refEarnings, unreadNotifs: unread, lifetimePoints });
  }, []);

  useEffect(() => { loadStats(); }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadStats(), refreshUser()]);
    setRefreshing(false);
  }, [refreshUser]);

  const handleSavePaypal = useCallback(async () => {
    const trimmed = paypalInput.trim().toLowerCase();
    if (!trimmed) { setPaypalError("Please enter your PayPal email."); return; }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmed)) { setPaypalError("Enter a valid email address."); return; }
    // The PayPal email is write-once. Run the same disposable/implausible-domain
    // check the wallet uses at withdrawal time so a user can't lock in an address
    // they'll never be able to cash out to (which would strand their balance).
    if (!isPlausiblePayPalDomain(trimmed)) {
      setPaypalError(INVALID_PAYPAL_EMAIL_MESSAGE);
      return;
    }
    setPaypalSaving(true);
    setPaypalError(null);
    try {
      await apiRequest("POST", "/api/profile/paypal-email", { email: trimmed });
      // Keep the local cache in sync with what we just saved, even if the value
      // was pre-filled from cache and saved without being re-typed (which would
      // otherwise skip handlePaypalInputChange). Fire-and-forget — the server
      // value still takes precedence on the next load.
      secureSet(PAYPAL_EMAIL_CACHE_KEY, trimmed).catch(() => {});
      await refreshUser();
      setPaypalInput("");
      Alert.alert("PayPal email saved", `${trimmed} has been linked to your account. This cannot be changed later.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save.";
      if (msg.includes("INVALID_PAYPAL_EMAIL")) {
        setPaypalError(INVALID_PAYPAL_EMAIL_MESSAGE);
      } else if (msg.includes("CONFLICT")) {
        setPaypalError("This PayPal email is already linked to another account.");
      } else if (msg.includes("ALREADY_SET")) {
        setPaypalError("PayPal email has already been set.");
        await refreshUser();
      } else {
        setPaypalError(msg || "Failed to save.");
      }
    } finally {
      setPaypalSaving(false);
    }
  }, [paypalInput, refreshUser]);

  const handlePaypalInputChange = useCallback((value: string) => {
    setPaypalInput(value);
    // Persist a valid typed email locally so the field survives navigating away
    // before saving (and app restarts). Fire-and-forget — a storage failure
    // just means we don't pre-fill next time. The server value still wins.
    const trimmed = value.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (emailRegex.test(trimmed)) {
      secureSet(PAYPAL_EMAIL_CACHE_KEY, trimmed).catch(() => {});
    }
    // Live warning as the user types — mirror the wallet withdrawal modal so the
    // disposable/implausible-domain feedback appears before they commit the
    // write-once email, not only after they tap Save. Only flag a syntactically
    // complete email so we don't warn mid-typing.
    if (!trimmed || !emailRegex.test(trimmed)) {
      setPaypalError(null);
      return;
    }
    if (!isPlausiblePayPalDomain(trimmed)) {
      setPaypalError(
        "This email domain isn't accepted for PayPal payouts. Please use the email address linked to your real PayPal account."
      );
    } else {
      setPaypalError(null);
    }
  }, []);

  // Pre-fill the input from the locally cached email when the user hasn't yet
  // saved one to the server. The server-locked email (rendered separately)
  // always takes precedence, so we only read the cache when it's absent.
  useEffect(() => {
    if (user?.paypalEmail) return;
    let active = true;
    secureGet(PAYPAL_EMAIL_CACHE_KEY).then((cached) => {
      if (active && cached) {
        setPaypalInput((prev) => (prev ? prev : cached));
      }
    });
    return () => { active = false; };
  }, [user?.paypalEmail]);

  if (!fontsLoaded || !stats) return null;

  const achievements = getAchievements(stats, t);
  const unlockedCount = achievements.filter((a) => a.unlocked).length;
  const webTopPad = Platform.OS === "web" ? 67 : 0;

  function handleLogout() {
    Alert.alert(t.auth.logout, t.auth.logoutConfirm, [
      { text: t.auth.cancel, style: "cancel" },
      { text: t.auth.logout, style: "destructive", onPress: () => logout() },
    ]);
  }

  const menuItems = [
    { icon: "bell", label: t.profile.notifications, badge: stats.unreadNotifs, action: () => router.push("/notifications") },
    { icon: "users", label: t.profile.referralProgram, action: () => router.push("/referral") },
    { icon: "radio", label: "Publisher Program", action: () => router.push("/publisher") },
    { icon: "sliders", label: "Survey Profile", action: () => router.push("/survey-profile") },
    {
      icon: "globe",
      label: t.profile.language,
      languageBadge: lang === "en" ? "EN" : "ES",
      action: () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        setLang(lang === "en" ? "es" : "en");
      },
    },
    ...(isAdmin ? [{ icon: "settings", label: t.admin.title, action: () => router.push("/admin") }] : []),
    { icon: "shield", label: t.profile.privacySecurity, action: () => router.push("/security") },
    { icon: "help-circle", label: t.profile.helpSupport, action: () => router.push("/help") },
    { icon: "info", label: t.profile.aboutCashClip, action: () => router.push("/about") },
    { icon: "log-out", label: t.auth.logout, action: handleLogout },
  ];

  return (
    <ScrollView
      style={[styles.container, { paddingTop: webTopPad }]}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingBottom: Platform.OS === "web" ? 34 : 16 }}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
    >
      <View style={styles.content}>
        <View style={styles.avatarSection}>
          <LinearGradient colors={[Colors.primary, Colors.accent]} style={styles.avatarRing}>
            <View style={styles.avatarInner}>
              <Feather name="user" size={32} color={Colors.text} />
            </View>
          </LinearGradient>
          <Text style={styles.username}>{user?.username || t.profile.defaultUsername}</Text>
          <View style={styles.levelBadge}>
            <Ionicons name="star" size={12} color={Colors.accent} />
            <Text style={styles.levelText}>{t.profile.level} {computeLevel(stats.lifetimePoints)}</Text>
          </View>
        </View>

        <View style={styles.statsGrid}>
          <View style={styles.gridItem}>
            <Text style={styles.gridValue}>{stats.lifetimePoints.toLocaleString()}</Text>
            <Text style={styles.gridLabel}>{t.profile.lifetimeEarnings}</Text>
          </View>
          <View style={styles.gridItem}>
            <Text style={styles.gridValue}>{stats.adsWatched}</Text>
            <Text style={styles.gridLabel}>{t.profile.adsWatched}</Text>
          </View>
          <View style={styles.gridItem}>
            <Text style={styles.gridValue}>{stats.totalReferrals}</Text>
            <Text style={styles.gridLabel}>{t.profile.referrals}</Text>
          </View>
          <View style={styles.gridItem}>
            <Text style={styles.gridValue}>{stats.streak}</Text>
            <Text style={styles.gridLabel}>{t.profile.bestStreak}</Text>
          </View>
        </View>

        {/* PayPal Payout Email Section */}
        <View style={styles.paypalSection}>
          <View style={styles.paypalHeader}>
            <MaterialCommunityIcons name="email-outline" size={18} color={Colors.primary} />
            <Text style={styles.paypalSectionTitle}>PayPal Payout Email</Text>
          </View>
          {user?.paypalEmail ? (
            <View style={styles.paypalLocked}>
              <Ionicons name="checkmark-circle" size={18} color={Colors.primary} />
              <Text style={styles.paypalLockedEmail}>{user.paypalEmail}</Text>
              <View style={styles.paypalLockedBadge}>
                <Text style={styles.paypalLockedBadgeText}>Verified</Text>
              </View>
            </View>
          ) : (
            <>
              <Text style={styles.paypalHint}>
                Set your PayPal email to enable withdrawals. This can only be set once.
              </Text>
              <View style={[styles.paypalInputRow, !!paypalError && styles.paypalInputRowError]}>
                <TextInput
                  style={styles.paypalInput}
                  placeholder="your@paypal.com"
                  placeholderTextColor={Colors.textMuted}
                  value={paypalInput}
                  onChangeText={handlePaypalInputChange}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!paypalSaving}
                />
                <Pressable
                  onPress={handleSavePaypal}
                  disabled={paypalSaving || !paypalInput.trim()}
                  style={({ pressed }) => [
                    styles.paypalSaveBtn,
                    (paypalSaving || !paypalInput.trim()) && { opacity: 0.4 },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  {paypalSaving
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={styles.paypalSaveBtnText}>Save</Text>
                  }
                </Pressable>
              </View>
              {!!paypalError && (
                <View style={styles.paypalErrorRow}>
                  <Feather name="alert-circle" size={13} color={Colors.error} />
                  <Text style={styles.paypalErrorText}>{paypalError}</Text>
                </View>
              )}
            </>
          )}
        </View>

        <Pressable
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/referral"); }}
          style={({ pressed }) => [styles.promoCard, { opacity: pressed ? 0.9 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] }]}
        >
          <LinearGradient colors={["#1A2E1A", "#0D1F14"]} style={styles.promoGradient}>
            <View style={styles.promoLeft}>
              <View style={styles.promoIconBg}>
                <Feather name="gift" size={20} color={Colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.promoTitle}>{t.profile.referralProgram}</Text>
                <Text style={styles.promoSubtitle}>{t.profile.earnPerFriend}</Text>
              </View>
            </View>
            <Feather name="chevron-right" size={20} color={Colors.primary} />
          </LinearGradient>
        </Pressable>

        <View style={styles.achievementsSection}>
          <View style={styles.achievementsHeader}>
            <Text style={styles.sectionTitle}>{t.profile.achievements}</Text>
            <Text style={styles.achievementCount}>{unlockedCount}/{achievements.length}</Text>
          </View>
          <View style={styles.achievementsGrid}>
            {achievements.map((a) => <AchievementCard key={a.id} achievement={a} />)}
          </View>
        </View>

        <View style={styles.menuSection}>
          {menuItems.map((item, index) => (
            <Pressable
              key={index}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); item.action(); }}
              style={({ pressed }) => [
                styles.menuItem,
                { opacity: pressed ? 0.7 : 1 },
                index === 0 && styles.menuItemFirst,
                index === menuItems.length - 1 && styles.menuItemLast,
              ]}
            >
              <Feather name={item.icon as any} size={20} color={Colors.textSecondary} />
              <Text style={styles.menuLabel}>{item.label}</Text>
              {item.badge && item.badge > 0 ? (
                <View style={styles.notifBadge}>
                  <Text style={styles.notifBadgeText}>{item.badge}</Text>
                </View>
              ) : null}
              {item.languageBadge ? (
                <View style={styles.langBadge}>
                  <Text style={styles.langBadgeText}>{item.languageBadge}</Text>
                </View>
              ) : null}
              <Feather name="chevron-right" size={18} color={Colors.textMuted} />
            </Pressable>
          ))}
        </View>

        <View style={styles.buildInfo}>
          <Text style={styles.buildInfoText}>
            Version {Constants.expoConfig?.version ?? "—"}
            {" · Build "}
            {Platform.OS === "ios"
              ? (Constants.expoConfig?.ios?.buildNumber ?? "—")
              : Platform.OS === "android"
              ? (Constants.expoConfig?.android?.versionCode ?? "—")
              : (Constants.expoConfig?.ios?.buildNumber ?? "—")}
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { paddingHorizontal: 16, paddingTop: 16 },
  avatarSection: { alignItems: "center", marginBottom: 24 },
  avatarRing: { width: 88, height: 88, borderRadius: 44, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  avatarInner: { width: 80, height: 80, borderRadius: 40, backgroundColor: Colors.surface, alignItems: "center", justifyContent: "center" },
  username: { fontFamily: "Outfit_700Bold", fontSize: 22, color: Colors.text, marginBottom: 6 },
  levelBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(255, 214, 0, 0.12)", paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  levelText: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: Colors.accent },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 },
  gridItem: { width: "48%" as any, flexGrow: 1, backgroundColor: Colors.surface, borderRadius: 14, padding: 16, alignItems: "center", borderWidth: 1, borderColor: Colors.border },
  gridValue: { fontFamily: "Outfit_700Bold", fontSize: 22, color: Colors.text, marginBottom: 2 },
  gridLabel: { fontFamily: "Outfit_400Regular", fontSize: 12, color: Colors.textMuted },
  promoCard: { marginBottom: 20 },
  promoGradient: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: "rgba(0,230,118,0.2)" },
  promoLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  promoIconBg: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(0,230,118,0.12)", alignItems: "center", justifyContent: "center" },
  promoTitle: { fontFamily: "Outfit_700Bold", fontSize: 16, color: Colors.text },
  promoSubtitle: { fontFamily: "Outfit_400Regular", fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  achievementsSection: { marginBottom: 20 },
  achievementsHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  sectionTitle: { fontFamily: "Outfit_700Bold", fontSize: 18, color: Colors.text },
  achievementCount: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: Colors.textSecondary },
  achievementsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  achievementCard: { width: "48%" as any, flexGrow: 1, backgroundColor: Colors.surface, borderRadius: 14, padding: 14, alignItems: "center", borderWidth: 1, borderColor: Colors.border },
  achievementLocked: { opacity: 0.5 },
  achievementIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  achievementTitle: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: Colors.text, textAlign: "center" },
  achievementDesc: { fontFamily: "Outfit_400Regular", fontSize: 11, color: Colors.textMuted, textAlign: "center" },
  lockedText: { color: Colors.textMuted },
  menuSection: { backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, marginBottom: 32, overflow: "hidden" },
  menuItem: { flexDirection: "row", alignItems: "center", padding: 16, gap: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  menuItemFirst: { borderTopLeftRadius: 14, borderTopRightRadius: 14 },
  menuItemLast: { borderBottomWidth: 0, borderBottomLeftRadius: 14, borderBottomRightRadius: 14 },
  menuLabel: { fontFamily: "Outfit_600SemiBold", fontSize: 15, color: Colors.text, flex: 1 },
  notifBadge: { backgroundColor: Colors.error, borderRadius: 10, minWidth: 20, height: 20, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  notifBadgeText: { fontFamily: "Outfit_700Bold", fontSize: 11, color: "#fff" },
  langBadge: { backgroundColor: Colors.primary + "20", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  langBadgeText: { fontFamily: "Outfit_700Bold", fontSize: 12, color: Colors.primary },
  buildInfo: { alignItems: "center", marginBottom: 16 },
  buildInfoText: { fontFamily: "Outfit_400Regular", fontSize: 12, color: Colors.textMuted },
  paypalSection: { backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, padding: 16, marginBottom: 16 },
  paypalHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  paypalSectionTitle: { fontFamily: "Outfit_700Bold", fontSize: 15, color: Colors.text },
  paypalLocked: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(0,230,118,0.07)", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  paypalLockedEmail: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: Colors.text, flex: 1 },
  paypalLockedBadge: { backgroundColor: "rgba(0,230,118,0.15)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  paypalLockedBadgeText: { fontFamily: "Outfit_700Bold", fontSize: 11, color: Colors.primary },
  paypalHint: { fontFamily: "Outfit_400Regular", fontSize: 12, color: Colors.textSecondary, marginBottom: 10, lineHeight: 17 },
  paypalInputRow: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 4, backgroundColor: Colors.background },
  paypalInputRowError: { borderColor: Colors.error },
  paypalInput: { flex: 1, fontFamily: "Outfit_400Regular", fontSize: 14, color: Colors.text, paddingVertical: 8 },
  paypalSaveBtn: { backgroundColor: Colors.primary, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  paypalSaveBtnText: { fontFamily: "Outfit_700Bold", fontSize: 13, color: "#000" },
  paypalErrorRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  paypalErrorText: { fontFamily: "Outfit_400Regular", fontSize: 12, color: Colors.error, flex: 1 },
});
