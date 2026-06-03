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
} from "react-native";
import Constants from "expo-constants";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useFonts, Outfit_400Regular, Outfit_600SemiBold, Outfit_700Bold } from "@expo-google-fonts/outfit";
import Colors from "@/constants/colors";
import { getUserStats, getReferralEarnings, getTotalReferrals, getUnreadNotificationCount, type UserStats } from "@/lib/storage";
import { useLanguage } from "@/lib/LanguageContext";
import { useAuth } from "@/lib/AuthContext";
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

function getAchievements(stats: UserStats & { totalReferrals: number }, t: Translations): Achievement[] {
  return [
    { id: "first_ad", title: t.profile.firstStep, description: t.profile.watchFirstAd, icon: "play", iconSet: "feather", unlocked: stats.adsWatched >= 1, color: "#4ECDC4" },
    { id: "ten_ads", title: t.profile.gettingStarted, description: t.profile.watch10Ads, icon: "zap", iconSet: "feather", unlocked: stats.adsWatched >= 10, color: "#FFD600" },
    { id: "fifty_ads", title: t.profile.adExpert, description: t.profile.watch50Ads, icon: "award", iconSet: "feather", unlocked: stats.adsWatched >= 50, color: "#FF6B6B" },
    { id: "hundred_ads", title: t.profile.adChampion, description: t.profile.watch100Ads, icon: "trophy", iconSet: "ionicons", unlocked: stats.adsWatched >= 100, color: "#E040FB" },
    { id: "streak_3", title: t.profile.consistency, description: t.profile.threeDayStreak, icon: "flame", iconSet: "ionicons", unlocked: stats.streak >= 3, color: "#FF7043" },
    { id: "streak_7", title: t.profile.weeklyWarrior, description: t.profile.sevenDayStreak, icon: "fire", iconSet: "material", unlocked: stats.streak >= 7, color: "#F44336" },
    { id: "earn_1", title: t.profile.firstDollar, description: t.profile.earnFirst1, icon: "dollar-sign", iconSet: "feather", unlocked: stats.totalEarned >= 1, color: "#00E676" },
    { id: "earn_10", title: t.profile.moneyMaker, description: t.profile.earn10Total, icon: "cash-multiple", iconSet: "material", unlocked: stats.totalEarned >= 10, color: "#00BCD4" },
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
  const { user, isAdmin, logout } = useAuth();
  const [stats, setStats] = useState<(UserStats & { totalReferrals: number; referralEarnings: number; unreadNotifs: number }) | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [fontsLoaded] = useFonts({ Outfit_400Regular, Outfit_600SemiBold, Outfit_700Bold });

  const loadStats = useCallback(async () => {
    const [s, refEarnings, totalRefs, unread] = await Promise.all([
      getUserStats(),
      getReferralEarnings(),
      getTotalReferrals(),
      getUnreadNotificationCount(),
    ]);
    setStats({ ...s, totalReferrals: totalRefs, referralEarnings: refEarnings, unreadNotifs: unread });
  }, []);

  useEffect(() => { loadStats(); }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadStats();
    setRefreshing(false);
  }, []);

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
      languageBadge: lang === "en" ? "EN" : lang === "es" ? "ES" : "PT",
      action: () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        setLang(lang === "en" ? "es" : lang === "es" ? "pt" : "en");
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
            <Text style={styles.levelText}>{t.profile.level} {Math.floor(stats.adsWatched / 10) + 1}</Text>
          </View>
        </View>

        <View style={styles.statsGrid}>
          <View style={styles.gridItem}>
            <Text style={styles.gridValue}>${stats.totalEarned.toFixed(2)}</Text>
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
});
