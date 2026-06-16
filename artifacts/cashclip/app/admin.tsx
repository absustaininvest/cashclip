import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Platform,
  RefreshControl,
  TextInput,
  Modal,
  Alert,
  Linking,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as LocalAuthentication from "expo-local-authentication";
import { router } from "expo-router";
import { useFonts, Outfit_400Regular, Outfit_600SemiBold, Outfit_700Bold } from "@expo-google-fonts/outfit";
import Colors from "@/constants/colors";
import { useLanguage } from "@/lib/LanguageContext";
import { useAuth } from "@/lib/AuthContext";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import { secureGet } from "@/lib/secure-store";
import { getSponsorBrands, addSponsorBrand, removeSponsorBrand, SponsorBrand } from "@/lib/storage";

interface WithdrawalRecord {
  id: string;
  userId: string;
  username: string;
  amount: string;
  bonusPercent: string;
  bonusAmount: string;
  totalPayout: string;
  paypalEmail: string;
  status: string;
  adminNote: string | null;
  createdAt: string;
  processedAt: string | null;
}

function StatCard({ label, value, icon, iconColor, trend }: { label: string; value: string; icon: string; iconColor: string; trend?: string }) {
  return (
    <View style={styles.statCard}>
      <View style={styles.statCardTop}>
        <View style={[styles.statIconBg, { backgroundColor: iconColor + "18" }]}>
          <Feather name={icon as any} size={18} color={iconColor} />
        </View>
        {trend && (
          <View style={styles.trendBadge}>
            <Ionicons name="trending-up" size={10} color={Colors.primary} />
            <Text style={styles.trendText}>{trend}</Text>
          </View>
        )}
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const BRAND_TYPE_OPTIONS: Array<{ key: "ads" | "surveys" | "games"; icon: string }> = [
  { key: "ads", icon: "play-circle" },
  { key: "surveys", icon: "clipboard" },
  { key: "games", icon: "game-controller-outline" },
];

function getTimeAgo(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diff = now - date;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export default function AdminScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const { isAdmin, isLoading: authLoading, token } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [fontsLoaded] = useFonts({ Outfit_400Regular, Outfit_600SemiBold, Outfit_700Bold });

  useEffect(() => {
    if (!authLoading && !isAdmin) {
      router.back();
    }
  }, [isAdmin, authLoading]);

  const [biometricUnlocked, setBiometricUnlocked] = useState(Platform.OS === "web");
  const [biometricChecking, setBiometricChecking] = useState(Platform.OS !== "web");

  useEffect(() => {
    if (Platform.OS === "web" || !isAdmin) return;
    let cancelled = false;
    (async () => {
      try {
        const compatible = await LocalAuthentication.hasHardwareAsync();
        const enrolled = await LocalAuthentication.isEnrolledAsync();
        if (!compatible || !enrolled) {
          if (!cancelled) {
            setBiometricUnlocked(true);
            setBiometricChecking(false);
          }
          return;
        }
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: "Unlock Admin Panel",
          cancelLabel: "Cancel",
          disableDeviceFallback: false,
        });
        if (cancelled) return;
        if (result.success) {
          setBiometricUnlocked(true);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } else {
          router.back();
        }
      } catch {
        if (!cancelled) setBiometricUnlocked(true);
      } finally {
        if (!cancelled) setBiometricChecking(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isAdmin]);

  const [brands, setBrands] = useState<SponsorBrand[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newBrandName, setNewBrandName] = useState("");
  const [newBrandType, setNewBrandType] = useState<"ads" | "surveys" | "games">("ads");
  const [withdrawals, setWithdrawals] = useState<WithdrawalRecord[]>([]);
  const [loadingWithdrawals, setLoadingWithdrawals] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [paypalConfigured, setPaypalConfigured] = useState(false);
  const [paypalMode, setPaypalMode] = useState("sandbox");
  const [selectedWithdrawal, setSelectedWithdrawal] = useState<WithdrawalRecord | null>(null);
  const [withdrawalFilter, setWithdrawalFilter] = useState<string>("all");
  const [webhookAlertSummary, setWebhookAlertSummary] = useState<{
    totalRejections: number;
    totalAlerts: number;
    windowMs: number;
    threshold: number;
    notifyConfigured: boolean;
    topOffenders: Array<{ ip: string; provider: string; count: number; lastSeenAt: string }>;
  } | null>(null);
  const [recentWebhookAlerts, setRecentWebhookAlerts] = useState<Array<{
    id: string;
    ip: string;
    provider: string;
    count: number;
    sampleReason: string;
    lastSeenAt: string;
  }>>([]);
  const [webhookAuditEntries, setWebhookAuditEntries] = useState<Array<{
    id: string;
    provider: string;
    reason: string;
    ip: string;
    method: string;
    path: string;
    hasSignatureHeader: boolean;
    secretConfigured: boolean;
    createdAt: string;
  }>>([]);
  const [webhookAuditOffenders, setWebhookAuditOffenders] = useState<Array<{
    ip: string;
    provider: string;
    count: number;
    lastSeenAt: string;
  }>>([]);
  const [webhookAuditProviders, setWebhookAuditProviders] = useState<string[]>([]);
  const [webhookAuditProviderFilter, setWebhookAuditProviderFilter] = useState<string>("all");
  const [webhookAuditIpFilter, setWebhookAuditIpFilter] = useState<string>("");
  const [webhookAuditAppliedIp, setWebhookAuditAppliedIp] = useState<string>("");
  const [webhookAuditRangeMs, setWebhookAuditRangeMs] = useState<number | null>(null);
  const [webhookAuditLoading, setWebhookAuditLoading] = useState(true);

  const [adjustUsername, setAdjustUsername] = useState("");
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustNote, setAdjustNote] = useState("");
  const [adjustLoading, setAdjustLoading] = useState(false);
  const [userSearch, setUserSearch] = useState("");

  const [userList, setUserList] = useState<Array<{ id: string; username: string; email?: string; emailVerified?: boolean; role: string; balance: string; totalEarned: string; createdAt: string; isPublisher?: boolean; adCredits?: string; country?: string | null; profileComplete?: boolean }>>([]);
  const [userTotal, setUserTotal] = useState(0);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersLoadingMore, setUsersLoadingMore] = useState(false);
  const [appliedSearch, setAppliedSearch] = useState("");
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [resetPasswordMap, setResetPasswordMap] = useState<Record<string, string>>({});
  const [resetLoadingId, setResetLoadingId] = useState<string | null>(null);
  const [publisherLoadingId, setPublisherLoadingId] = useState<string | null>(null);
  const [verifyEmailLoadingId, setVerifyEmailLoadingId] = useState<string | null>(null);
  const [stats, setStats] = useState<{
    totalUsers: number;
    activeToday: number;
    pendingPayouts: { count: number; amount: number };
    admob: { today: number; last7d: number; last30d: number; currency: string; lastSyncedAt: string | null } | null;
  } | null>(null);

  const loadBrands = useCallback(async () => {
    const b = await getSponsorBrands();
    setBrands(b);
  }, []);

  const fetchUsersPage = useCallback(async (offset: number, search: string) => {
    const savedToken = await secureGet("cashclip_auth_token");
    if (!savedToken) return null;
    const qs = `?limit=100&offset=${offset}${search ? `&search=${encodeURIComponent(search)}` : ""}`;
    const res = await globalThis.fetch(
      new URL(`/api/admin/users${qs}`, getApiUrl()).toString(),
      { headers: { Authorization: `Bearer ${savedToken}` } },
    );
    if (!res.ok) throw new Error(`${res.status}`);
    return await res.json();
  }, []);

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const data = await fetchUsersPage(0, appliedSearch);
      if (data) {
        setUserList(data.users ?? []);
        setUserTotal(typeof data.total === "number" ? data.total : (data.users?.length ?? 0));
      }
    } catch (err: any) {
      console.error("Failed to load users:", err?.message);
    } finally {
      setUsersLoading(false);
    }
  }, [fetchUsersPage, appliedSearch]);

  const loadMoreUsers = useCallback(async () => {
    if (usersLoadingMore || usersLoading) return;
    setUsersLoadingMore(true);
    try {
      const data = await fetchUsersPage(userList.length, appliedSearch);
      if (data) {
        setUserList((prev) => [...prev, ...(data.users ?? [])]);
        if (typeof data.total === "number") setUserTotal(data.total);
      }
    } catch (err: any) {
      console.error("Failed to load more users:", err?.message);
    } finally {
      setUsersLoadingMore(false);
    }
  }, [fetchUsersPage, appliedSearch, userList.length, usersLoadingMore, usersLoading]);

  const runUserSearch = useCallback(async () => {
    const term = userSearch.trim();
    setAppliedSearch(term);
    setUsersLoading(true);
    try {
      const data = await fetchUsersPage(0, term);
      if (data) {
        setUserList(data.users ?? []);
        setUserTotal(typeof data.total === "number" ? data.total : (data.users?.length ?? 0));
      }
    } catch (err: any) {
      console.error("Failed to search users:", err?.message);
    } finally {
      setUsersLoading(false);
    }
  }, [userSearch, fetchUsersPage]);

  const handleGrantPublisher = useCallback(async (userId: string, grant: boolean) => {
    setPublisherLoadingId(userId);
    try {
      const savedToken = await secureGet("cashclip_auth_token");
      const res = await globalThis.fetch(
        new URL(`/api/admin/users/${userId}/publisher`, getApiUrl()).toString(),
        {
          method: "PATCH",
          headers: { Authorization: `Bearer ${savedToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ grant }),
        },
      );
      const data = await res.json();
      if (!res.ok) { Alert.alert("Error", data.error || "Failed"); return; }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        grant ? "Publisher Granted" : "Publisher Revoked",
        grant
          ? `Publisher access granted. $5.00 ad credits gifted.`
          : `Publisher access revoked.`,
      );
      await loadUsers();
    } catch {
      Alert.alert("Error", "Failed to update publisher status");
    } finally {
      setPublisherLoadingId(null);
    }
  }, [loadUsers]);

  const handleVerifyEmail = useCallback(async (userId: string) => {
    setVerifyEmailLoadingId(userId);
    try {
      const savedToken = await secureGet("cashclip_auth_token");
      const res = await globalThis.fetch(
        new URL(`/api/admin/users/${userId}/verify-email`, getApiUrl()).toString(),
        { method: "POST", headers: { Authorization: `Bearer ${savedToken}` } },
      );
      const data = await res.json();
      if (!res.ok) { Alert.alert("Error", data.error || "Failed"); return; }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Verified", `Email verified for ${data.username}`);
      await loadUsers();
    } catch {
      Alert.alert("Error", "Failed to verify email");
    } finally {
      setVerifyEmailLoadingId(null);
    }
  }, [loadUsers]);

  const handleResetPassword = useCallback(async (userId: string) => {
    const pwd = resetPasswordMap[userId] ?? "";
    if (pwd.length < 8) { Alert.alert("Error", "Password must be at least 8 characters"); return; }
    setResetLoadingId(userId);
    try {
      const savedToken = await secureGet("cashclip_auth_token");
      const res = await globalThis.fetch(
        new URL(`/api/admin/users/${userId}/reset-password`, getApiUrl()).toString(),
        {
          method: "POST",
          headers: { Authorization: `Bearer ${savedToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ newPassword: pwd }),
        },
      );
      const data = await res.json();
      if (!res.ok) { Alert.alert("Error", data.error || "Failed"); return; }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Done", `Password reset for ${data.username}`);
      setResetPasswordMap(prev => { const n = { ...prev }; delete n[userId]; return n; });
      setExpandedUserId(null);
    } catch {
      Alert.alert("Error", "Failed to reset password");
    } finally {
      setResetLoadingId(null);
    }
  }, [resetPasswordMap]);


  const handleAdjustPayout = useCallback(async () => {
    const amt = parseFloat(adjustAmount);
    if (!adjustUsername.trim()) { Alert.alert("Error", "Enter a username"); return; }
    if (!Number.isFinite(amt) || amt <= 0 || amt > 1000) { Alert.alert("Error", "Enter a valid amount (0–$1000)"); return; }
    setAdjustLoading(true);
    try {
      const savedToken = await secureGet("cashclip_auth_token");
      if (!savedToken) {
        Alert.alert("Session Error", "No auth token found. Log out and log back in with your admin account.");
        setAdjustLoading(false);
        return;
      }
      const baseUrl = getApiUrl();
      const res = await globalThis.fetch(new URL("/api/admin/credit-balance", baseUrl).toString(), {
        method: "POST",
        headers: { Authorization: `Bearer ${savedToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ username: adjustUsername.trim(), amount: amt, description: adjustNote.trim() || "Admin manual credit" }),
      });
      const data = await res.json();
      if (res.status === 403) { Alert.alert("Access Denied", "Log out and sign in with your admin account."); return; }
      if (!res.ok) { Alert.alert("Error", data.error || "Failed to credit"); return; }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Done", `Credited $${amt.toFixed(2)} to ${data.username}. New balance: $${Number(data.balance).toFixed(2)}`);
      setAdjustUsername(""); setAdjustAmount(""); setAdjustNote("");
    } catch {
      Alert.alert("Error", "Failed to credit balance");
    } finally {
      setAdjustLoading(false);
    }
  }, [adjustUsername, adjustAmount, adjustNote]);


  const loadWithdrawals = useCallback(async () => {
    try {
      const savedToken = await secureGet("cashclip_auth_token");
      if (!savedToken) return;
      const baseUrl = getApiUrl();
      const statusParam = withdrawalFilter !== "all" ? `?status=${withdrawalFilter}` : "";
      const res = await globalThis.fetch(new URL(`/api/admin/withdrawals${statusParam}`, baseUrl).toString(), {
        headers: { Authorization: `Bearer ${savedToken}` },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setWithdrawals(data.withdrawals || []);
    } catch (err: any) {
      console.error("Failed to load withdrawals:", err?.message || err?.toString() || JSON.stringify(err));
    } finally {
      setLoadingWithdrawals(false);
    }
  }, [withdrawalFilter]);

  const loadWebhookAlerts = useCallback(async () => {
    try {
      const savedToken = await secureGet("cashclip_auth_token");
      if (!savedToken) return;
      const baseUrl = getApiUrl();
      const res = await globalThis.fetch(new URL("/api/admin/webhook-alerts?limit=10&rejectionLimit=1", baseUrl).toString(), {
        headers: { Authorization: `Bearer ${savedToken}` },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setWebhookAlertSummary(data.summary ?? null);
      setRecentWebhookAlerts(data.alerts ?? []);
    } catch (err: any) {
      console.error("Failed to load webhook alerts:", err?.message || err?.toString() || JSON.stringify(err));
    }
  }, []);

  const loadWebhookAudit = useCallback(async (overrides?: { provider?: string; ip?: string; rangeMs?: number | null }) => {
    setWebhookAuditLoading(true);
    try {
      const savedToken = await secureGet("cashclip_auth_token");
      if (!savedToken) return;
      const baseUrl = getApiUrl();
      const params = new URLSearchParams({ limit: "100" });
      const provider = overrides?.provider ?? webhookAuditProviderFilter;
      const ipRaw = overrides?.ip ?? webhookAuditAppliedIp;
      const rangeMs = overrides?.rangeMs !== undefined ? overrides.rangeMs : webhookAuditRangeMs;
      if (provider !== "all") params.set("provider", provider);
      const ip = ipRaw.trim();
      if (ip) params.set("ip", ip);
      if (rangeMs && rangeMs > 0) params.set("sinceMs", String(rangeMs));
      const res = await globalThis.fetch(
        new URL(`/api/admin/webhook-audit?${params.toString()}`, baseUrl).toString(),
        { headers: { Authorization: `Bearer ${savedToken}` } },
      );
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setWebhookAuditEntries(data.entries ?? []);
      setWebhookAuditOffenders(data.offenders ?? []);
      setWebhookAuditProviders(data.knownProviders ?? []);
    } catch (err: any) {
      console.error("Failed to load webhook audit:", err?.message || err?.toString() || JSON.stringify(err));
    } finally {
      setWebhookAuditLoading(false);
    }
  }, [webhookAuditProviderFilter, webhookAuditAppliedIp, webhookAuditRangeMs]);

  const exportWebhookAuditCsv = useCallback(async () => {
    if (Platform.OS !== "web") return;
    try {
      const savedToken = await secureGet("cashclip_auth_token");
      if (!savedToken) return;
      const baseUrl = getApiUrl();
      const params = new URLSearchParams({ limit: "10000" });
      if (webhookAuditProviderFilter !== "all") params.set("provider", webhookAuditProviderFilter);
      const ip = webhookAuditAppliedIp.trim();
      if (ip) params.set("ip", ip);
      if (webhookAuditRangeMs && webhookAuditRangeMs > 0) {
        params.set("sinceMs", String(webhookAuditRangeMs));
      }
      const url = new URL(`/api/admin/webhook-audit.csv?${params.toString()}`, baseUrl).toString();
      const res = await globalThis.fetch(url, {
        headers: { Authorization: `Bearer ${savedToken}` },
      });
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `webhook-rejections-${stamp}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (err: any) {
      Alert.alert("Export failed", err?.message || "Could not export CSV");
    }
  }, [webhookAuditProviderFilter, webhookAuditAppliedIp, webhookAuditRangeMs]);

  const loadPaypalStatus = useCallback(async () => {
    try {
      const savedToken = await secureGet("cashclip_auth_token");
      if (!savedToken) return;
      const baseUrl = getApiUrl();
      const res = await globalThis.fetch(new URL("/api/admin/paypal-status", baseUrl).toString(), {
        headers: { Authorization: `Bearer ${savedToken}` },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setPaypalConfigured(data.configured);
      setPaypalMode(data.mode);
    } catch (err: any) {
      console.error("Failed to check PayPal status:", err?.message || err?.toString() || JSON.stringify(err));
    }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const savedToken = await secureGet("cashclip_auth_token");
      if (!savedToken) return;
      const res = await globalThis.fetch(new URL("/api/admin/stats", getApiUrl()).toString(), {
        headers: { Authorization: `Bearer ${savedToken}` },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setStats(data);
    } catch (err: any) {
      console.error("Failed to load admin stats:", err?.message || err?.toString() || JSON.stringify(err));
    }
  }, []);

  useEffect(() => {
    loadBrands();
    if (token) {
      loadStats();
      loadWithdrawals();
      loadPaypalStatus();
      loadWebhookAlerts();
      loadWebhookAudit();
      loadUsers();
    }
  }, [token]);

  useEffect(() => {
    if (token) {
      loadWithdrawals();
    }
  }, [withdrawalFilter, token]);

  useEffect(() => {
    if (token) {
      loadWebhookAudit();
    }
  }, [webhookAuditProviderFilter, webhookAuditRangeMs, token]);

  const handleWithdrawalAction = useCallback(async (id: string, action: "approved" | "rejected") => {
    setProcessingId(id);
    try {
      await apiRequest("PATCH", `/api/admin/withdrawals/${id}`, { status: action });
      Haptics.notificationAsync(
        action === "approved"
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Warning
      );
      await loadWithdrawals();
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to update withdrawal");
    } finally {
      setProcessingId(null);
    }
  }, [loadWithdrawals]);

  const handlePayPalPayout = useCallback(async (withdrawal: WithdrawalRecord) => {
    if (!paypalConfigured) {
      Alert.alert("PayPal Not Configured", "Set PAYPAL_CLIENT_ID and PAYPAL_SECRET environment variables to enable payouts.");
      return;
    }
    const baseAmt = Number(withdrawal.amount);
    const bonusPct = Number(withdrawal.bonusPercent);
    const bonusAmt = parseFloat(((baseAmt * bonusPct) / 100).toFixed(2));
    const trustedTotal = parseFloat((baseAmt + bonusAmt).toFixed(2));
    const bonusLine = bonusPct > 0 ? ` + ${bonusPct}% bonus ($${bonusAmt.toFixed(2)})` : "";
    Alert.alert(
      "Send PayPal Payout",
      `Authorize payout to ${withdrawal.paypalEmail}?\n\nBase: $${baseAmt.toFixed(2)}${bonusLine}\nServer-authorized total: $${trustedTotal.toFixed(2)}\n\nThe backend will validate and recompute the payout from the canonical tier before sending.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Send Payout",
          style: "default",
          onPress: async () => {
            setProcessingId(withdrawal.id);
            try {
              const res = await apiRequest("POST", `/api/admin/withdrawals/${withdrawal.id}/payout`);
              const data = await res.json();
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              Alert.alert("Payout Sent", `PayPal batch ID: ${data.batchId}`);
              await loadWithdrawals();
            } catch (err: any) {
              Alert.alert("Payout Failed", err.message || "Failed to send PayPal payout");
            } finally {
              setProcessingId(null);
            }
          },
        },
      ]
    );
  }, [paypalConfigured, loadWithdrawals]);

  const handleAddBrand = useCallback(async () => {
    const name = newBrandName.trim();
    if (!name) return;
    await addSponsorBrand(name, newBrandType);
    await loadBrands();
    setNewBrandName("");
    setNewBrandType("ads");
    setShowAddModal(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [newBrandName, newBrandType]);

  const handleRemoveBrand = useCallback(async (id: string) => {
    await removeSponsorBrand(id);
    await loadBrands();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadStats(), loadBrands(), loadWithdrawals(), loadPaypalStatus(), loadWebhookAlerts(), loadWebhookAudit(), loadUsers()]);
    await new Promise((r) => setTimeout(r, 300));
    setRefreshing(false);
  }, [loadStats, loadWithdrawals, loadUsers]);

  if (!fontsLoaded) return null;

  if (biometricChecking || !biometricUnlocked) {
    return (
      <View style={[styles.container, { justifyContent: "center", alignItems: "center", paddingHorizontal: 32 }]}>
        <Ionicons name="lock-closed" size={56} color={Colors.primary} />
        <Text style={{ color: Colors.text, marginTop: 20, fontFamily: "Outfit_700Bold", fontSize: 20 }}>
          Admin Locked
        </Text>
        <Text style={{ color: Colors.textMuted, marginTop: 8, fontFamily: "Outfit_400Regular", fontSize: 14, textAlign: "center" }}>
          {biometricChecking ? "Authenticating with Face ID..." : "Authentication required"}
        </Text>
        {biometricChecking && <ActivityIndicator size="small" color={Colors.primary} style={{ marginTop: 20 }} />}
      </View>
    );
  }

  const webTopPad = Platform.OS === "web" ? 67 : 0;
  const fmtMoney = (n: number) =>
    `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <View style={{ flex: 1 }}>
    <ScrollView
      style={[styles.container, { paddingTop: webTopPad + insets.top }]}
      contentContainerStyle={{ paddingBottom: Platform.OS === "web" ? 34 : 32 }}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
    >
      <View style={styles.content}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
            <Feather name="arrow-left" size={22} color={Colors.text} />
          </Pressable>
          <Text style={styles.title}>{t.admin.title}</Text>
          <View style={{ width: 36 }} />
        </View>

        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            Linking.openURL("https://mail.zoho.com");
          }}
          style={styles.emailBtn}
          testID="admin-email-btn"
        >
          <View style={[styles.statIconBg, { backgroundColor: "rgba(66,165,245,0.15)" }]}>
            <Feather name="mail" size={18} color="#42A5F5" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.emailBtnTitle}>Business Email</Text>
            <Text style={styles.emailBtnSub}>jorge.ballen@cash-clip.app</Text>
          </View>
          <Feather name="external-link" size={16} color={Colors.textMuted} />
        </Pressable>

        <View style={styles.bizInfoCard}>
          <View style={styles.bizInfoRow}>
            <View style={[styles.statIconBg, { backgroundColor: "rgba(0,230,118,0.15)" }]}>
              <Feather name="briefcase" size={18} color={Colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.emailBtnTitle}>AB Sustainability Investments LLC</Text>
              <Text style={styles.emailBtnSub}>D-U-N-S Certified</Text>
            </View>
          </View>
          <View style={styles.bizInfoRow}>
            <View style={[styles.statIconBg, { backgroundColor: "rgba(255,214,0,0.15)" }]}>
              <Feather name="globe" size={18} color={Colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.emailBtnTitle}>cash-clip.app</Text>
              <Text style={styles.emailBtnSub}>Domain &amp; Landing Page</Text>
            </View>
          </View>
        </View>

        <Text style={styles.sectionTitle}>{t.admin.overview}</Text>
        <View style={styles.statsGrid}>
          <StatCard label={t.admin.totalUsers} value={stats ? stats.totalUsers.toLocaleString() : "—"} icon="users" iconColor="#42A5F5" />
          <StatCard label={t.admin.activeToday} value={stats ? stats.activeToday.toLocaleString() : "—"} icon="activity" iconColor={Colors.primary} />
          <StatCard label={t.admin.monthlyRevenue} value={stats?.admob ? fmtMoney(stats.admob.last30d) : "—"} icon="dollar-sign" iconColor="#FFD600" />
          <StatCard label={t.admin.pendingPayouts} value={stats ? fmtMoney(stats.pendingPayouts.amount) : "—"} icon="send" iconColor="#FF7043" />
        </View>

        <Text style={styles.sectionTitle}>{t.admin.adRevenue}</Text>
        <View style={styles.adRevCard}>
          <View style={styles.adRevRow}>
            <View style={styles.adRevItem}>
              <Text style={styles.adRevLabel}>{t.admin.adRevToday}</Text>
              <Text style={styles.adRevValue}>{stats?.admob ? fmtMoney(stats.admob.today) : "—"}</Text>
            </View>
            <View style={styles.adRevItemDivider} />
            <View style={styles.adRevItem}>
              <Text style={styles.adRevLabel}>{t.admin.adRev7d}</Text>
              <Text style={styles.adRevValue}>{stats?.admob ? fmtMoney(stats.admob.last7d) : "—"}</Text>
            </View>
            <View style={styles.adRevItemDivider} />
            <View style={styles.adRevItem}>
              <Text style={styles.adRevLabel}>{t.admin.adRev30d}</Text>
              <Text style={styles.adRevValue}>{stats?.admob ? fmtMoney(stats.admob.last30d) : "—"}</Text>
            </View>
          </View>
          {!stats?.admob && (
            <Text style={styles.adRevHint}>{t.admin.adRevNotConnected}</Text>
          )}
        </View>

        <Text style={styles.sectionTitle}>{t.admin.integrationStatus}</Text>
        <Pressable
          testID="open-setup-wizard"
          style={({ pressed }) => [styles.setupWizardBtn, { opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] }]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push({ pathname: "/setup-wizard" });
          }}
        >
          <View style={styles.setupWizardLeft}>
            <View style={[styles.statIconBg, { backgroundColor: "rgba(0,230,118,0.15)" }]}>
              <Feather name="settings" size={18} color={Colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.emailBtnTitle}>{t.admin.setupWizard}</Text>
              <Text style={styles.emailBtnSub}>{t.admin.setupWizardDesc}</Text>
            </View>
          </View>
          <Feather name="chevron-right" size={18} color={Colors.textMuted} />
        </Pressable>

        <View style={styles.paypalStatusRow}>
          <Text style={styles.sectionTitle}>Withdrawal Requests</Text>
          <View style={[styles.paypalBadge, paypalConfigured ? styles.paypalBadgeOk : styles.paypalBadgeWarn]}>
            <Feather name={paypalConfigured ? "check-circle" : "alert-circle"} size={12} color={paypalConfigured ? Colors.primary : Colors.accent} />
            <Text style={[styles.paypalBadgeText, { color: paypalConfigured ? Colors.primary : Colors.accent }]}>
              PayPal {paypalConfigured ? `(${paypalMode})` : "Not Set"}
            </Text>
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow} contentContainerStyle={{ gap: 8, paddingBottom: 12 }}>
          {["all", "pending", "approved", "paid", "rejected"].map((f) => (
            <Pressable
              key={f}
              onPress={() => setWithdrawalFilter(f)}
              style={[styles.filterChip, withdrawalFilter === f && styles.filterChipActive]}
            >
              <Text style={[styles.filterChipText, withdrawalFilter === f && styles.filterChipTextActive]}>
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.withdrawalsCard}>
          {loadingWithdrawals ? (
            <View style={{ padding: 32, alignItems: "center" }}>
              <ActivityIndicator color={Colors.primary} />
            </View>
          ) : withdrawals.length === 0 ? (
            <View style={{ padding: 32, alignItems: "center", gap: 8 }}>
              <Feather name="inbox" size={28} color={Colors.textMuted} />
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: Colors.textMuted }}>No withdrawal requests</Text>
            </View>
          ) : (
            withdrawals.map((w, i) => {
              const timeAgo = getTimeAgo(w.createdAt);
              const isProcessing = processingId === w.id;
              return (
                <Pressable
                  key={w.id}
                  style={[styles.withdrawalRow, i < withdrawals.length - 1 && styles.withdrawalRowBorder]}
                  onPress={() => setSelectedWithdrawal(w)}
                  testID={`withdrawal-${w.id}`}
                >
                  <View style={[styles.withdrawalCell, { flex: 1.5 }]}>
                    <View style={styles.userAvatar}>
                      <Feather name="user" size={12} color={Colors.textMuted} />
                    </View>
                    <View>
                      <Text style={styles.withdrawalUser}>{w.username}</Text>
                      <Text style={styles.withdrawalTime}>{timeAgo}</Text>
                    </View>
                  </View>
                  <Text style={[styles.withdrawalAmount, { flex: 0.8 }]}>${Number(w.totalPayout).toFixed(2)}</Text>
                  <View style={{ flex: 1.2, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                    {isProcessing ? (
                      <ActivityIndicator size="small" color={Colors.primary} />
                    ) : w.status === "pending" ? (
                      <>
                        <Pressable
                          testID={`approve-${w.id}`}
                          onPress={() => handleWithdrawalAction(w.id, "approved")}
                          style={[styles.actionBtn, styles.approveBtn]}
                        >
                          <Feather name="check" size={14} color={Colors.primary} />
                        </Pressable>
                        <Pressable
                          testID={`reject-${w.id}`}
                          onPress={() => handleWithdrawalAction(w.id, "rejected")}
                          style={[styles.actionBtn, styles.rejectBtn]}
                        >
                          <Feather name="x" size={14} color="#FF5252" />
                        </Pressable>
                      </>
                    ) : w.status === "approved" ? (
                      <Pressable
                        testID={`pay-${w.id}`}
                        onPress={() => handlePayPalPayout(w)}
                        style={[styles.actionBtn, styles.payBtn]}
                      >
                        <Feather name="dollar-sign" size={12} color="#FFF" />
                        <Text style={styles.payBtnText}>Pay</Text>
                      </Pressable>
                    ) : (
                      <View style={[styles.statusBadge, w.status === "paid" ? styles.statusPaid : styles.statusRejected]}>
                        <Text style={[styles.statusText, w.status === "paid" ? styles.statusPaidText : styles.statusRejectedText]}>
                          {w.status === "paid" ? "Paid" : "Rejected"}
                        </Text>
                      </View>
                    )}
                  </View>
                </Pressable>
              );
            })
          )}
        </View>

        <Text style={styles.sectionTitle}>Credit User Balance</Text>
        <View style={[styles.withdrawalsCard, { marginBottom: 16 }]}>
          <View style={{ padding: 14, gap: 10 }}>
            <TextInput
              style={styles.inlineInput}
              placeholder="Username"
              placeholderTextColor={Colors.textMuted}
              value={adjustUsername}
              onChangeText={setAdjustUsername}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TextInput
              style={styles.inlineInput}
              placeholder="Amount (e.g. 1.50)"
              placeholderTextColor={Colors.textMuted}
              value={adjustAmount}
              onChangeText={setAdjustAmount}
              keyboardType="decimal-pad"
            />
            <TextInput
              style={styles.inlineInput}
              placeholder="Note (optional)"
              placeholderTextColor={Colors.textMuted}
              value={adjustNote}
              onChangeText={setAdjustNote}
            />
            <Pressable
              style={[styles.modalAddBtn, { alignSelf: "flex-end", paddingHorizontal: 20 }, adjustLoading && { opacity: 0.6 }]}
              onPress={handleAdjustPayout}
              disabled={adjustLoading}
            >
              {adjustLoading
                ? <ActivityIndicator size="small" color={Colors.background} />
                : <Text style={styles.modalAddText}>Credit Balance</Text>}
            </Pressable>
          </View>
        </View>

        <View style={styles.sponsorHeader}>
          <Text style={styles.sectionTitle}>{t.admin.sponsorBrands}</Text>
          <Pressable
            testID="add-brand-button"
            style={({ pressed }) => [styles.addBrandBtn, { opacity: pressed ? 0.8 : 1 }]}
            onPress={() => setShowAddModal(true)}
          >
            <Ionicons name="add" size={18} color={Colors.background} />
            <Text style={styles.addBrandBtnText}>{t.admin.addBrand}</Text>
          </Pressable>
        </View>
        <View style={styles.brandsCard}>
          {brands.length === 0 ? (
            <View style={styles.noBrandsContainer}>
              <Ionicons name="business-outline" size={32} color={Colors.textMuted} />
              <Text style={styles.noBrandsText}>{t.admin.noBrands}</Text>
            </View>
          ) : (
            brands.map((brand, i) => {
              const typeLabel = t.admin[brand.type] || brand.type;
              const typeIcon = brand.type === "ads" ? "play-circle" : brand.type === "surveys" ? "clipboard" : "game-controller-outline";
              return (
                <View key={brand.id} style={[styles.brandRow, i < brands.length - 1 && styles.brandRowBorder]}>
                  <View style={styles.brandLeft}>
                    <View style={[styles.brandIcon, { backgroundColor: brand.color + "20" }]}>
                      <Text style={[styles.brandInitial, { color: brand.color }]}>
                        {brand.name.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={styles.brandInfo}>
                      <Text style={styles.brandName}>{brand.name}</Text>
                      <View style={styles.brandTypeRow}>
                        <Ionicons name={typeIcon as any} size={11} color={Colors.textMuted} />
                        <Text style={styles.brandTypeText}>{typeLabel}</Text>
                      </View>
                    </View>
                  </View>
                  <Pressable
                    testID={`remove-brand-${brand.id}`}
                    onPress={() => handleRemoveBrand(brand.id)}
                    hitSlop={8}
                    style={({ pressed }) => [styles.removeBrandBtn, { opacity: pressed ? 0.6 : 1 }]}
                  >
                    <Ionicons name="trash-outline" size={16} color="#FF5252" />
                  </Pressable>
                </View>
              );
            })
          )}
        </View>

        <Text style={styles.sectionTitle}>Webhook Security</Text>
        <View style={styles.withdrawalsCard} testID="webhook-security-card">
          {webhookAlertSummary ? (
            <>
              <View style={[styles.withdrawalRow, styles.withdrawalRowBorder]}>
                <View style={[styles.withdrawalCell, { flex: 1.5 }]}>
                  <View style={[styles.statIconBg, { backgroundColor: (recentWebhookAlerts.length > 0 ? "#FF5252" : Colors.primary) + "22" }]}>
                    <Feather
                      name={recentWebhookAlerts.length > 0 ? "alert-triangle" : "shield"}
                      size={14}
                      color={recentWebhookAlerts.length > 0 ? "#FF5252" : Colors.primary}
                    />
                  </View>
                  <View>
                    <Text style={styles.withdrawalUser}>
                      {recentWebhookAlerts.length > 0 ? `${recentWebhookAlerts.length} active alert${recentWebhookAlerts.length === 1 ? "" : "s"}` : "No active alerts"}
                    </Text>
                    <Text style={styles.withdrawalTime}>
                      {webhookAlertSummary.totalRejections} rejected callbacks tracked · threshold {webhookAlertSummary.threshold}/{Math.round(webhookAlertSummary.windowMs / 60000)}m
                    </Text>
                  </View>
                </View>
                <View style={[styles.paypalBadge, webhookAlertSummary.notifyConfigured ? styles.paypalBadgeOk : styles.paypalBadgeWarn]}>
                  <Feather name={webhookAlertSummary.notifyConfigured ? "bell" : "bell-off"} size={11} color={webhookAlertSummary.notifyConfigured ? Colors.primary : Colors.accent} />
                  <Text style={[styles.paypalBadgeText, { color: webhookAlertSummary.notifyConfigured ? Colors.primary : Colors.accent }]}>
                    {webhookAlertSummary.notifyConfigured ? "Notify on" : "Notify off"}
                  </Text>
                </View>
              </View>

              {recentWebhookAlerts.length === 0 && webhookAlertSummary.topOffenders.length === 0 ? (
                <View style={{ padding: 16, alignItems: "center" }}>
                  <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: Colors.textMuted }}>
                    No suspicious webhook activity detected
                  </Text>
                </View>
              ) : (
                (recentWebhookAlerts.length > 0 ? recentWebhookAlerts : webhookAlertSummary.topOffenders.map((o) => ({
                  id: `${o.ip}-${o.provider}`,
                  ip: o.ip,
                  provider: o.provider,
                  count: o.count,
                  sampleReason: "below threshold",
                  lastSeenAt: o.lastSeenAt,
                }))).slice(0, 5).map((a, i, arr) => (
                  <View
                    key={a.id}
                    testID={`webhook-alert-${a.id}`}
                    style={[styles.withdrawalRow, i < arr.length - 1 && styles.withdrawalRowBorder]}
                  >
                    <View style={[styles.withdrawalCell, { flex: 2 }]}>
                      <View>
                        <Text style={styles.withdrawalUser}>{a.provider} · {a.ip}</Text>
                        <Text style={styles.withdrawalTime} numberOfLines={1}>{a.sampleReason}</Text>
                      </View>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={styles.withdrawalAmount}>{a.count}×</Text>
                      <Text style={styles.withdrawalTime}>{getTimeAgo(a.lastSeenAt)}</Text>
                    </View>
                  </View>
                ))
              )}
            </>
          ) : (
            <View style={{ padding: 24, alignItems: "center" }}>
              <ActivityIndicator color={Colors.primary} />
            </View>
          )}
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={styles.sectionTitle}>Rejected Webhook Audit</Text>
          {Platform.OS === "web" && (
            <Pressable
              testID="webhook-audit-export-csv"
              onPress={exportWebhookAuditCsv}
              style={[styles.filterChip, styles.filterChipActive, { paddingHorizontal: 12, flexDirection: "row", gap: 6, alignItems: "center" }]}
            >
              <Feather name="download" size={14} color={Colors.background} />
              <Text style={[styles.filterChipText, styles.filterChipTextActive]}>Export CSV</Text>
            </Pressable>
          )}
        </View>
        <View style={{ marginBottom: 8, gap: 8 }}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.filterRow}
            contentContainerStyle={{ gap: 8, paddingBottom: 8 }}
          >
            {([
              { label: "All time", ms: null },
              { label: "Last hour", ms: 60 * 60 * 1000 },
              { label: "Last 24h", ms: 24 * 60 * 60 * 1000 },
              { label: "Last 7d", ms: 7 * 24 * 60 * 60 * 1000 },
              { label: "Last 30d", ms: 30 * 24 * 60 * 60 * 1000 },
            ]).map((r) => {
              const active = webhookAuditRangeMs === r.ms;
              return (
                <Pressable
                  key={r.label}
                  testID={`webhook-audit-range-${r.ms ?? "all"}`}
                  onPress={() => setWebhookAuditRangeMs(r.ms)}
                  style={[styles.filterChip, active && styles.filterChipActive]}
                >
                  <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                    {r.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.filterRow}
            contentContainerStyle={{ gap: 8, paddingBottom: 8 }}
          >
            {(["all", ...webhookAuditProviders]).map((p) => (
              <Pressable
                key={p}
                testID={`webhook-audit-provider-${p}`}
                onPress={() => setWebhookAuditProviderFilter(p)}
                style={[styles.filterChip, webhookAuditProviderFilter === p && styles.filterChipActive]}
              >
                <Text style={[styles.filterChipText, webhookAuditProviderFilter === p && styles.filterChipTextActive]}>
                  {p === "all" ? "All" : p.charAt(0).toUpperCase() + p.slice(1)}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TextInput
              testID="webhook-audit-ip-filter"
              style={[styles.modalInput, { flex: 1, marginBottom: 0 }]}
              value={webhookAuditIpFilter}
              onChangeText={setWebhookAuditIpFilter}
              placeholder="Filter by IP (exact)"
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={() => {
                setWebhookAuditAppliedIp(webhookAuditIpFilter);
                loadWebhookAudit({ ip: webhookAuditIpFilter });
              }}
              returnKeyType="search"
            />
            <Pressable
              testID="webhook-audit-apply-ip"
              onPress={() => {
                setWebhookAuditAppliedIp(webhookAuditIpFilter);
                loadWebhookAudit({ ip: webhookAuditIpFilter });
              }}
              style={[styles.filterChip, styles.filterChipActive, { paddingHorizontal: 16, justifyContent: "center" }]}
            >
              <Text style={[styles.filterChipText, styles.filterChipTextActive]}>Apply</Text>
            </Pressable>
            {(webhookAuditIpFilter.length > 0 || webhookAuditAppliedIp.length > 0) && (
              <Pressable
                testID="webhook-audit-clear-ip"
                onPress={() => {
                  setWebhookAuditIpFilter("");
                  setWebhookAuditAppliedIp("");
                  loadWebhookAudit({ ip: "" });
                }}
                style={[styles.filterChip, { paddingHorizontal: 12, justifyContent: "center" }]}
              >
                <Feather name="x" size={14} color={Colors.textMuted} />
              </Pressable>
            )}
          </View>
        </View>

        {webhookAuditOffenders.length > 0 && (
          <View style={[styles.withdrawalsCard, { marginBottom: 12 }]} testID="webhook-audit-offenders">
            <View style={[styles.withdrawalRow, styles.withdrawalRowBorder]}>
              <Text style={[styles.withdrawalUser, { flex: 1 }]}>Top offenders (grouped by IP)</Text>
            </View>
            {webhookAuditOffenders.slice(0, 5).map((o, i, arr) => (
              <Pressable
                key={`${o.ip}-${o.provider}`}
                testID={`webhook-audit-offender-${o.ip}-${o.provider}`}
                onPress={() => {
                  setWebhookAuditIpFilter(o.ip);
                  setWebhookAuditAppliedIp(o.ip);
                  setWebhookAuditProviderFilter(o.provider);
                  loadWebhookAudit({ ip: o.ip, provider: o.provider });
                }}
                style={[styles.withdrawalRow, i < arr.length - 1 && styles.withdrawalRowBorder]}
              >
                <View style={[styles.withdrawalCell, { flex: 2 }]}>
                  <View>
                    <Text style={styles.withdrawalUser}>{o.ip}</Text>
                    <Text style={styles.withdrawalTime}>{o.provider}</Text>
                  </View>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={styles.withdrawalAmount}>{o.count}×</Text>
                  <Text style={styles.withdrawalTime}>{getTimeAgo(o.lastSeenAt)}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}

        <View style={styles.withdrawalsCard} testID="webhook-audit-list">
          {webhookAuditLoading ? (
            <View style={{ padding: 24, alignItems: "center" }}>
              <ActivityIndicator color={Colors.primary} />
            </View>
          ) : webhookAuditEntries.length === 0 ? (
            <View style={{ padding: 24, alignItems: "center", gap: 6 }}>
              <Feather name="shield" size={22} color={Colors.textMuted} />
                <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: Colors.textMuted }}>
                No rejected webhooks recorded
              </Text>
            </View>
          ) : (
            webhookAuditEntries.slice(0, 50).map((e, i, arr) => (
              <View
                key={e.id}
                testID={`webhook-audit-entry-${e.id}`}
                style={[styles.withdrawalRow, i < arr.length - 1 && styles.withdrawalRowBorder]}
              >
                <View style={[styles.withdrawalCell, { flex: 2 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.withdrawalUser}>{e.provider} · {e.ip}</Text>
                    <Text style={styles.withdrawalTime} numberOfLines={2}>{e.reason}</Text>
                    <Text style={[styles.withdrawalTime, { fontSize: 10, opacity: 0.7 }]} numberOfLines={1}>
                      {e.method} {e.path}
                      {e.hasSignatureHeader ? " · sig" : " · no-sig"}
                      {e.secretConfigured ? "" : " · secret missing"}
                    </Text>
                  </View>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={styles.withdrawalTime}>{getTimeAgo(e.createdAt)}</Text>
                </View>
              </View>
            ))
          )}
        </View>

        <Text style={styles.sectionTitle}>{t.admin.quickActions}</Text>
        <View style={styles.actionsGrid}>
          {[
            { icon: "send", label: t.admin.pushNotification, desc: t.admin.sendToAllUsers, color: "#42A5F5" },
            { icon: "bar-chart-2", label: t.admin.viewAnalytics, desc: t.admin.detailedReports, color: "#E040FB", onPress: () => router.push("/ad-analytics") },
          ].map((action, i) => (
            <Pressable
              key={i}
              style={({ pressed }) => [styles.actionCard, { opacity: pressed ? 0.8 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] }]}
              onPress={() => {
                try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
                action.onPress?.();
              }}
            >
              <View style={[styles.actionIconBg, { backgroundColor: action.color + "18" }]}>
                <Feather name={action.icon as any} size={20} color={action.color} />
              </View>
              <Text style={styles.actionLabel}>{action.label}</Text>
              <Text style={styles.actionDesc}>{action.desc}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.usersPanel}>
          <View style={styles.usersHeaderRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.usersTitle}>CashClip Users</Text>
              <Text style={styles.usersSubtitle}>{appliedSearch ? `${userTotal} match "${appliedSearch}"` : `${userTotal} total registered users`}</Text>
            </View>
            <View style={styles.usersHeaderActions}>
              <Pressable onPress={loadUsers} style={styles.usersRefreshBtn}>
                <Feather name="refresh-cw" size={16} color={Colors.textMuted} />
              </Pressable>
              <View style={styles.usersTitleIcon}>
                <Feather name="users" size={18} color={Colors.primary} />
              </View>
            </View>
          </View>
          <View style={styles.usersSearchRow}>
            <View style={styles.usersSearchInputWrap}>
              <Feather name="search" size={14} color={Colors.textMuted} />
              <TextInput
                style={styles.usersSearchInput}
                placeholder="Search by username or email..."
                placeholderTextColor={Colors.textMuted}
                value={userSearch}
                onChangeText={setUserSearch}
                onSubmitEditing={runUserSearch}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
              />
            </View>
            <Pressable style={styles.usersSearchBtn} onPress={runUserSearch}>
              <Text style={styles.usersSearchBtnText}>Search</Text>
            </Pressable>
          </View>
          <View style={styles.withdrawalLimitsCard}>
            <View style={styles.withdrawalLimitsHeader}>
              <View style={styles.withdrawalLimitsHeaderLeft}>
                <Feather name="bar-chart-2" size={16} color="#FFD36A" />
                <Text style={styles.withdrawalLimitsTitle}>Withdrawal Limits</Text>
              </View>
            </View>
            <Text style={styles.withdrawalLimitsNote}>Enforced server-side at withdrawal request time</Text>
              <View style={styles.limitGrid}>
              <View style={styles.limitField}>
                <Text style={styles.limitLabel}>Max single withdrawal ($)</Text>
                <TextInput style={styles.limitInput} value="7" editable={false} />
              </View>
              <View style={styles.limitField}>
                <Text style={styles.limitLabel}>Min balance to withdraw ($)</Text>
                <TextInput style={styles.limitInput} value="5" editable={false} />
              </View>
              <View style={styles.limitField}>
                <Text style={styles.limitLabel}>Max per-user daily earnings ($)</Text>
                <TextInput style={styles.limitInput} value="7" editable={false} />
              </View>
            </View>
            <View style={styles.withdrawalLimitsFooter}>
              <Pressable style={styles.withdrawalLimitsBtn}>
                <Text style={styles.withdrawalLimitsBtnText}>Save Limits</Text>
              </Pressable>
              <Text style={styles.withdrawalLimitsFooterText}>These values will be enforced when users request withdrawals.</Text>
            </View>
          </View>
          <View style={[styles.withdrawalsCard, styles.usersTableCard, { marginBottom: 16 }]}>
            {usersLoading ? (
              <View style={{ padding: 24, alignItems: "center" }}>
                <ActivityIndicator color={Colors.primary} />
              </View>
            ) : userList.length === 0 ? (
              <View style={{ padding: 24, alignItems: "center" }}>
                <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: Colors.textMuted }}>No users found</Text>
              </View>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.usersTableScroll}>
                <View style={styles.usersTableWrap}>
                  <View style={styles.usersTableHeader}>
                    <Text style={[styles.usersTableHead, { width: 160 }]}>USERNAME</Text>
                    <Text style={[styles.usersTableHead, { width: 190 }]}>EMAIL</Text>
                    <Text style={[styles.usersTableHead, { width: 90, textAlign: "right" }]}>BALANCE</Text>
                    <Text style={[styles.usersTableHead, { width: 90, textAlign: "right" }]}>EARNED</Text>
                    <Text style={[styles.usersTableHead, { width: 90, textAlign: "right" }]}>COUNTRY</Text>
                    <Text style={[styles.usersTableHead, { width: 90, textAlign: "right" }]}>JOINED</Text>
                    <View style={{ width: 22 }} />
                  </View>
                  {userList
                    .map((u, i) => (
                      <View key={u.id}>
                        <Pressable
                          onPress={() => setExpandedUserId(expandedUserId === u.id ? null : u.id)}
                          style={({ pressed }) => [styles.userRow, i < userList.length - 1 && styles.withdrawalRowBorder, { opacity: pressed ? 0.7 : 1 }]}
                        >
                          <View style={[styles.userCell, { width: 160 }]}>
                            <View style={styles.userAvatar}>
                              <Text style={styles.userAvatarText}>{u.username.charAt(0).toUpperCase()}</Text>
                            </View>
                            <View>
                              <Text style={styles.withdrawalUser}>{u.username}</Text>
                              <Text style={styles.userStatusPill}>{u.profileComplete ? "Complete" : "Incomplete"}</Text>
                            </View>
                          </View>
                          <Text style={[styles.userCellText, { width: 190 }]} numberOfLines={1}>{(u as any).email || "—"}</Text>
                          <Text style={[styles.userCellText, { width: 90, textAlign: "right" }]}>${Number(u.balance).toFixed(2)}</Text>
                          <Text style={[styles.userCellText, { width: 90, textAlign: "right" }]}>${Number(u.totalEarned).toFixed(2)}</Text>
                          <Text style={[styles.userCellText, { width: 90, textAlign: "right" }]}>{u.country || "—"}</Text>
                          <Text style={[styles.userCellText, { width: 90, textAlign: "right" }]}>{getTimeAgo(u.createdAt)}</Text>
                          <Feather name={expandedUserId === u.id ? "chevron-up" : "chevron-down"} size={14} color={Colors.textMuted} style={{ marginLeft: 8 }} />
                        </Pressable>
                        {expandedUserId === u.id && (
                          <View style={styles.userExpandedPanel}>
                            {/* Email verification */}
                            {!u.emailVerified && (
                              <View style={[styles.publisherRow, { marginBottom: 8 }]}>
                                <View style={{ flex: 1 }}>
                                  <Text style={styles.publisherLabel}>Email Unverified</Text>
                                  <Text style={styles.publisherSub}>User cannot withdraw until verified</Text>
                                </View>
                                {verifyEmailLoadingId === u.id ? (
                                  <ActivityIndicator size="small" color={Colors.primary} />
                                ) : (
                                  <Pressable
                                    style={[styles.publisherGrantBtn, { backgroundColor: "#4CAF50" }]}
                                    onPress={() => handleVerifyEmail(u.id)}
                                  >
                                    <Feather name="check-circle" size={13} color="#fff" />
                                    <Text style={styles.publisherGrantBtnText}>Verify Email</Text>
                                  </Pressable>
                                )}
                              </View>
                            )}
                            {/* Publisher toggle */}
                            <View style={styles.publisherRow}>
                              <View style={{ flex: 1 }}>
                                <Text style={styles.publisherLabel}>
                                  {u.isPublisher ? "✓ Publisher" : "Publisher Access"}
                                </Text>
                                {u.isPublisher && (
                                  <Text style={styles.publisherSub}>
                                    Ad credits: ${Number(u.adCredits ?? 0).toFixed(2)}
                                  </Text>
                                )}
                              </View>
                              {publisherLoadingId === u.id ? (
                                <ActivityIndicator size="small" color={Colors.primary} />
                              ) : u.isPublisher ? (
                                <Pressable
                                  style={styles.publisherRevokeBtn}
                                  onPress={() => handleGrantPublisher(u.id, false)}
                                >
                                  <Text style={styles.publisherRevokeBtnText}>Revoke</Text>
                                </Pressable>
                              ) : (
                                <Pressable
                                  style={styles.publisherGrantBtn}
                                  onPress={() => handleGrantPublisher(u.id, true)}
                                >
                                  <Feather name="award" size={13} color={Colors.background} />
                                  <Text style={styles.publisherGrantBtnText}>Grant + $5 Credits</Text>
                                </Pressable>
                              )}
                            </View>
                            {/* Password reset */}
                            <TextInput
                              style={styles.inlineInput}
                              placeholder="New password (min 8 chars)"
                              placeholderTextColor={Colors.textMuted}
                              value={resetPasswordMap[u.id] ?? ""}
                              onChangeText={(v) => setResetPasswordMap(prev => ({ ...prev, [u.id]: v }))}
                              secureTextEntry
                            />
                            <Pressable
                              style={[styles.modalAddBtn, { backgroundColor: "#FF5252", alignSelf: "flex-end", paddingHorizontal: 20 }, resetLoadingId === u.id && { opacity: 0.6 }]}
                              onPress={() => handleResetPassword(u.id)}
                              disabled={resetLoadingId === u.id}
                            >
                              {resetLoadingId === u.id
                                ? <ActivityIndicator size="small" color="#fff" />
                                : <Text style={styles.modalAddText}>Reset Password</Text>}
                            </Pressable>
                          </View>
                        )}
                      </View>
                    ))}
                </View>
              </ScrollView>
            )}
          </View>
          {userList.length < userTotal && (
            <Pressable
              onPress={loadMoreUsers}
              disabled={usersLoadingMore}
              style={({ pressed }) => [{
                marginTop: 8,
                marginBottom: 16,
                paddingVertical: 12,
                borderRadius: 12,
                alignItems: "center" as const,
                borderWidth: 1,
                borderColor: Colors.primary,
                opacity: pressed ? 0.7 : 1,
              }]}
            >
              {usersLoadingMore
                ? <ActivityIndicator size="small" color={Colors.primary} />
                : <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 13, color: Colors.primary }}>Load more — showing {userList.length} of {userTotal}</Text>}
            </Pressable>
          )}
        </View>
      </View>

    </ScrollView>

      <Modal visible={!!selectedWithdrawal} transparent animationType="fade" presentationStyle="overFullScreen" onRequestClose={() => setSelectedWithdrawal(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setSelectedWithdrawal(null)}>
          <Pressable style={[styles.modalCard, { maxWidth: 380 }]} onPress={() => {}}>
            {selectedWithdrawal && (
              <>
                <Text style={styles.modalTitle}>Withdrawal Details</Text>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>User</Text>
                  <Text style={styles.detailValue}>{selectedWithdrawal.username}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>PayPal Email</Text>
                  <Text style={[styles.detailValue, { fontSize: 13 }]}>{selectedWithdrawal.paypalEmail}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Amount</Text>
                  <Text style={styles.detailValue}>${Number(selectedWithdrawal.amount).toFixed(2)}</Text>
                </View>
                {Number(selectedWithdrawal.bonusPercent) > 0 && (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Bonus ({selectedWithdrawal.bonusPercent}%)</Text>
                    <Text style={[styles.detailValue, { color: Colors.primary }]}>+${Number(selectedWithdrawal.bonusAmount).toFixed(2)}</Text>
                  </View>
                )}
                <View style={styles.detailRow}>
                  <Text style={[styles.detailLabel, { fontFamily: "Outfit_700Bold" }]}>Total Payout</Text>
                  <Text style={[styles.detailValue, { fontFamily: "Outfit_700Bold", color: Colors.primary }]}>${Number(selectedWithdrawal.totalPayout).toFixed(2)}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Status</Text>
                  <Text style={[styles.detailValue, {
                    color: selectedWithdrawal.status === "paid" ? Colors.primary
                      : selectedWithdrawal.status === "rejected" ? "#FF5252"
                      : selectedWithdrawal.status === "approved" ? "#42A5F5"
                      : Colors.accent,
                  }]}>
                    {selectedWithdrawal.status.charAt(0).toUpperCase() + selectedWithdrawal.status.slice(1)}
                  </Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Requested</Text>
                  <Text style={styles.detailValue}>{new Date(selectedWithdrawal.createdAt).toLocaleString()}</Text>
                </View>
                {selectedWithdrawal.adminNote && (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Note</Text>
                    <Text style={[styles.detailValue, { fontSize: 12 }]}>{selectedWithdrawal.adminNote}</Text>
                  </View>
                )}

                <View style={[styles.modalActions, { marginTop: 16 }]}>
                  {selectedWithdrawal.status === "pending" && (
                    <>
                      <Pressable
                        style={[styles.modalCancelBtn, { borderColor: "#FF5252" }]}
                        onPress={() => {
                          handleWithdrawalAction(selectedWithdrawal.id, "rejected");
                          setSelectedWithdrawal(null);
                        }}
                      >
                        <Text style={[styles.modalCancelText, { color: "#FF5252" }]}>Reject</Text>
                      </Pressable>
                      <Pressable
                        style={styles.modalAddBtn}
                        onPress={() => {
                          handleWithdrawalAction(selectedWithdrawal.id, "approved");
                          setSelectedWithdrawal(null);
                        }}
                      >
                        <Feather name="check" size={14} color={Colors.background} />
                        <Text style={styles.modalAddText}>Approve</Text>
                      </Pressable>
                    </>
                  )}
                  {selectedWithdrawal.status === "approved" && (
                    <Pressable
                      style={[styles.modalAddBtn, { flex: 1, backgroundColor: "#0070BA" }]}
                      onPress={() => {
                        handlePayPalPayout(selectedWithdrawal);
                        setSelectedWithdrawal(null);
                      }}
                    >
                      <Feather name="dollar-sign" size={14} color="#FFF" />
                      <Text style={[styles.modalAddText, { color: "#FFF" }]}>Send PayPal Payout</Text>
                    </Pressable>
                  )}
                  {(selectedWithdrawal.status === "paid" || selectedWithdrawal.status === "rejected") && (
                    <Pressable
                      style={[styles.modalCancelBtn, { flex: 1 }]}
                      onPress={() => setSelectedWithdrawal(null)}
                    >
                      <Text style={styles.modalCancelText}>Close</Text>
                    </Pressable>
                  )}
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={showAddModal} transparent animationType="fade" presentationStyle="overFullScreen" onRequestClose={() => setShowAddModal(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowAddModal(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>{t.admin.addBrand}</Text>

            <Text style={styles.modalLabel}>{t.admin.brandName}</Text>
            <TextInput
              testID="brand-name-input"
              style={styles.modalInput}
              value={newBrandName}
              onChangeText={setNewBrandName}
              placeholder="e.g. Google, Nike, Amazon..."
              placeholderTextColor={Colors.textMuted}
              autoFocus
            />

            <Text style={styles.modalLabel}>{t.admin.brandType}</Text>
            <View style={styles.typeSelector}>
              {BRAND_TYPE_OPTIONS.map((opt) => {
                const selected = newBrandType === opt.key;
                return (
                  <Pressable
                    key={opt.key}
                    testID={`type-${opt.key}`}
                    onPress={() => setNewBrandType(opt.key)}
                    style={[styles.typeOption, selected && styles.typeOptionSelected]}
                  >
                    <Ionicons name={opt.icon as any} size={16} color={selected ? Colors.primary : Colors.textMuted} />
                    <Text style={[styles.typeOptionText, selected && styles.typeOptionTextSelected]}>
                      {t.admin[opt.key]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.modalActions}>
              <Pressable
                testID="cancel-add-brand"
                style={styles.modalCancelBtn}
                onPress={() => { setShowAddModal(false); setNewBrandName(""); }}
              >
                <Text style={styles.modalCancelText}>{t.admin.cancel}</Text>
              </Pressable>
              <Pressable
                testID="confirm-add-brand"
                style={[styles.modalAddBtn, !newBrandName.trim() && { opacity: 0.5 }]}
                onPress={handleAddBrand}
              >
                <Ionicons name="add" size={16} color={Colors.background} />
                <Text style={styles.modalAddText}>{t.admin.add}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { paddingHorizontal: 16, paddingTop: 12 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.surface, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: "Outfit_700Bold", fontSize: 22, color: Colors.text },
  emailBtn: {
    flexDirection: "row" as const, alignItems: "center" as const, gap: 12,
    backgroundColor: Colors.surface, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: Colors.border, marginBottom: 16,
  },
  emailBtnTitle: { fontFamily: "Outfit_700Bold", fontSize: 15, color: Colors.text },
  emailBtnSub: { fontFamily: "Outfit_400Regular", fontSize: 12, color: Colors.textMuted, marginTop: 1 },
  bizInfoCard: {
    backgroundColor: Colors.surface, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: Colors.border, marginBottom: 16, gap: 12,
  },
  bizInfoRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 12 },
  sectionTitle: { fontFamily: "Outfit_700Bold", fontSize: 17, color: Colors.text, marginBottom: 12, marginTop: 20 },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 8 },
  statCard: { width: "48%" as any, flexGrow: 1, backgroundColor: Colors.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.border },
  statCardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  statIconBg: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  trendBadge: { flexDirection: "row", alignItems: "center", gap: 2, backgroundColor: "rgba(0,230,118,0.1)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  trendText: { fontFamily: "Outfit_600SemiBold", fontSize: 10, color: Colors.primary },
  statValue: { fontFamily: "Outfit_700Bold", fontSize: 22, color: Colors.text, marginBottom: 2 },
  statLabel: { fontFamily: "Outfit_400Regular", fontSize: 12, color: Colors.textMuted },

  healthCard: { borderRadius: 16, padding: 18, borderWidth: 1, borderColor: "rgba(0,230,118,0.15)", marginBottom: 8 },
  healthHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  healthBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(0,230,118,0.12)", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  healthBadgeText: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: Colors.primary },
  marginValue: { fontFamily: "Outfit_700Bold", fontSize: 36, color: Colors.primary },
  marginLabel: { fontFamily: "Outfit_400Regular", fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  healthDivider: { height: 1, backgroundColor: "rgba(255,255,255,0.06)", marginVertical: 14 },
  healthRow: { flexDirection: "row", alignItems: "center" },
  healthItem: { flex: 1, alignItems: "center" },
  healthItemDivider: { width: 1, height: 30, backgroundColor: "rgba(255,255,255,0.06)" },
  healthItemLabel: { fontFamily: "Outfit_400Regular", fontSize: 11, color: Colors.textMuted, marginBottom: 4 },
  healthItemValue: { fontFamily: "Outfit_700Bold", fontSize: 15, color: Colors.text },

  adRevCard: { backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, padding: 16, marginBottom: 8 },
  adRevRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  adRevItem: { flex: 1, alignItems: "center" },
  adRevItemDivider: { width: 1, height: 34, backgroundColor: "rgba(255,255,255,0.06)" },
  adRevLabel: { fontFamily: "Outfit_400Regular", fontSize: 11, color: Colors.textMuted, marginBottom: 4 },
  adRevValue: { fontFamily: "Outfit_700Bold", fontSize: 16, color: Colors.text },
  adRevHint: { fontFamily: "Outfit_400Regular", fontSize: 12, color: Colors.textMuted, marginTop: 12, textAlign: "center" },
  revenueCard: { backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, overflow: "hidden", marginBottom: 8 },
  revenueRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 14 },
  revenueRowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.border },
  revenueLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  revenueDot: { width: 10, height: 10, borderRadius: 5 },
  revenueName: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: Colors.text },
  revenueRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  revenueAmount: { fontFamily: "Outfit_700Bold", fontSize: 14, color: Colors.text, width: 70, textAlign: "right" },
  revenueBarBg: { width: 60, height: 6, borderRadius: 3, backgroundColor: Colors.surfaceHighlight, overflow: "hidden" },
  revenueBar: { height: 6, borderRadius: 3 },
  revenuePercent: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: Colors.textMuted, width: 30, textAlign: "right" },

  setupWizardBtn: {
    flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const,
    backgroundColor: Colors.surface, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: Colors.border, marginBottom: 8,
  },
  setupWizardLeft: { flexDirection: "row" as const, alignItems: "center" as const, gap: 12, flex: 1 },

  withdrawalsCard: { backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, overflow: "hidden", marginBottom: 8 },
  usersTableCard: { overflow: "hidden", borderRadius: 14, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  usersTableScroll: { paddingBottom: 4 },
  usersTableWrap: { minWidth: 640 },
  withdrawalHeader: { flexDirection: "row", padding: 12, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: Colors.border },
  withdrawalColHead: { fontFamily: "Outfit_600SemiBold", fontSize: 11, color: Colors.textMuted, textTransform: "uppercase" },
  withdrawalRow: { flexDirection: "row", alignItems: "center", padding: 12 },
  withdrawalRowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.border },
  userRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, paddingHorizontal: 12, backgroundColor: Colors.background },
  userExpandedPanel: { padding: 14, borderTopWidth: 1, borderTopColor: Colors.border, gap: 8, backgroundColor: Colors.surfaceHighlight },
  withdrawalCell: { flexDirection: "row", alignItems: "center", gap: 8 },
  userAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.surfaceHighlight, alignItems: "center", justifyContent: "center" },
  withdrawalUser: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: Colors.text },
  withdrawalTime: { fontFamily: "Outfit_400Regular", fontSize: 11, color: Colors.textMuted },
  withdrawalAmount: { fontFamily: "Outfit_700Bold", fontSize: 14, color: Colors.text },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusApproved: { backgroundColor: "rgba(0,230,118,0.12)" },
  statusProcessing: { backgroundColor: "rgba(255,214,0,0.12)" },
  statusPaid: { backgroundColor: "rgba(0,230,118,0.12)" },
  statusRejected: { backgroundColor: "rgba(255,82,82,0.12)" },
  statusText: { fontFamily: "Outfit_600SemiBold", fontSize: 11 },
  statusApprovedText: { color: Colors.primary },
  statusProcessingText: { color: Colors.accent },
  statusPaidText: { color: Colors.primary },
  statusRejectedText: { color: "#FF5252" },

  paypalStatusRow: { flexDirection: "row" as const, justifyContent: "space-between" as const, alignItems: "center" as const, marginTop: 8 },
  paypalBadge: { flexDirection: "row" as const, alignItems: "center" as const, gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  paypalBadgeOk: { backgroundColor: "rgba(0,230,118,0.12)" },
  paypalBadgeWarn: { backgroundColor: "rgba(255,214,0,0.12)" },
  paypalBadgeText: { fontFamily: "Outfit_600SemiBold", fontSize: 11 },

  filterRow: { marginBottom: 0 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  filterChipActive: { backgroundColor: "rgba(0,230,118,0.12)", borderColor: Colors.primary },
  filterChipText: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: Colors.textMuted },
  filterChipTextActive: { color: Colors.primary },

  actionBtn: { width: 32, height: 32, borderRadius: 8, alignItems: "center" as const, justifyContent: "center" as const },
  approveBtn: { backgroundColor: "rgba(0,230,118,0.12)" },
  rejectBtn: { backgroundColor: "rgba(255,82,82,0.1)" },
  payBtn: { backgroundColor: "#0070BA", flexDirection: "row" as const, gap: 4, width: "auto" as any, paddingHorizontal: 12 },
  payBtnText: { fontFamily: "Outfit_700Bold", fontSize: 12, color: "#FFF" },

  detailRow: { flexDirection: "row" as const, justifyContent: "space-between" as const, alignItems: "center" as const, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.border },
  detailLabel: { fontFamily: "Outfit_400Regular", fontSize: 13, color: Colors.textMuted },
  detailValue: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: Colors.text, maxWidth: "55%" as any, textAlign: "right" as const },

  actionsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 },
  actionCard: { width: "48%" as any, flexGrow: 1, backgroundColor: Colors.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: Colors.border },
  actionIconBg: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  actionLabel: { fontFamily: "Outfit_700Bold", fontSize: 14, color: Colors.text, marginBottom: 2 },
  actionDesc: { fontFamily: "Outfit_400Regular", fontSize: 11, color: Colors.textMuted },

  sponsorHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8, marginBottom: 12 },
  addBrandBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: Colors.primary, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10 },
  addBrandBtnText: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: Colors.background },
  brandsCard: { backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, overflow: "hidden", marginBottom: 8 },
  noBrandsContainer: { alignItems: "center", justifyContent: "center", padding: 32, gap: 8 },
  noBrandsText: { fontFamily: "Outfit_400Regular", fontSize: 13, color: Colors.textMuted, textAlign: "center" },
  brandRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 14 },
  brandRowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.border },
  brandLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  brandIcon: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  brandInitial: { fontFamily: "Outfit_700Bold", fontSize: 17 },
  brandInfo: { flex: 1 },
  brandName: { fontFamily: "Outfit_600SemiBold", fontSize: 15, color: Colors.text },
  brandTypeRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  brandTypeText: { fontFamily: "Outfit_400Regular", fontSize: 11, color: Colors.textMuted },
  removeBrandBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: "rgba(255,82,82,0.1)", alignItems: "center", justifyContent: "center" },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
  modalCard: { backgroundColor: Colors.surface, borderRadius: 20, padding: 24, width: "85%" as any, maxWidth: 360, borderWidth: 1, borderColor: Colors.border },
  modalTitle: { fontFamily: "Outfit_700Bold", fontSize: 20, color: Colors.text, marginBottom: 20, textAlign: "center" },
  modalLabel: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: Colors.textSecondary, marginBottom: 6 },
  modalInput: { fontFamily: "Outfit_400Regular", fontSize: 15, color: Colors.text, backgroundColor: Colors.surfaceHighlight, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: Colors.border, marginBottom: 16 },
  inlineInput: { fontFamily: "Outfit_400Regular", fontSize: 14, color: Colors.text, backgroundColor: Colors.background, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, borderWidth: 1, borderColor: Colors.border },
  typeSelector: { flexDirection: "row", gap: 8, marginBottom: 24 },
  typeOption: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surfaceHighlight },
  typeOptionSelected: { borderColor: Colors.primary, backgroundColor: "rgba(0,230,118,0.08)" },
  typeOptionText: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: Colors.textMuted },
  typeOptionTextSelected: { color: Colors.primary },
  modalActions: { flexDirection: "row", gap: 10 },
  modalCancelBtn: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: Colors.border },
  modalCancelText: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: Colors.textSecondary },
  modalAddBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 12, borderRadius: 10, backgroundColor: Colors.primary },
  modalAddText: { fontFamily: "Outfit_700Bold", fontSize: 14, color: Colors.background },

  publisherRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "rgba(0,230,118,0.06)", borderRadius: 10, padding: 10, borderWidth: 1, borderColor: "rgba(0,230,118,0.15)" },
  publisherLabel: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: Colors.text },
  publisherSub: { fontFamily: "Outfit_400Regular", fontSize: 11, color: Colors.primary, marginTop: 2 },
  publisherGrantBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: Colors.primary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  publisherGrantBtnText: { fontFamily: "Outfit_700Bold", fontSize: 12, color: Colors.background },
  publisherRevokeBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: "#FF5252" },
  publisherRevokeBtnText: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: "#FF5252" },

  usersPanel: { marginBottom: 16 },
  usersHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  usersTitle: { fontFamily: "Outfit_700Bold", fontSize: 16, color: Colors.text },
  usersSubtitle: { fontFamily: "Outfit_400Regular", fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  usersHeaderActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  usersRefreshBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, alignItems: "center", justifyContent: "center" },
  usersTitleIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: "rgba(0,230,118,0.12)", alignItems: "center", justifyContent: "center" },

  usersSearchRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  usersSearchInputWrap: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: Colors.surface, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12, paddingVertical: 10 },
  usersSearchInput: { flex: 1, fontFamily: "Outfit_400Regular", fontSize: 14, color: Colors.text },
  usersSearchBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: Colors.primary, justifyContent: "center" },
  usersSearchBtnText: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: Colors.background },

  withdrawalLimitsCard: { backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, padding: 14, marginBottom: 12 },
  withdrawalLimitsHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  withdrawalLimitsHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  withdrawalLimitsTitle: { fontFamily: "Outfit_700Bold", fontSize: 14, color: Colors.text },
  withdrawalLimitsNote: { fontFamily: "Outfit_400Regular", fontSize: 11, color: Colors.textMuted, marginBottom: 12 },
  limitGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 12 },
  limitField: { flex: 1, minWidth: "45%" as any },
  limitLabel: { fontFamily: "Outfit_400Regular", fontSize: 11, color: Colors.textMuted, marginBottom: 4 },
  limitInput: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: Colors.text, backgroundColor: Colors.surfaceHighlight, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderColor: Colors.border },
  withdrawalLimitsFooter: { flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 4 },
  withdrawalLimitsBtn: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10, backgroundColor: Colors.primary },
  withdrawalLimitsBtnText: { fontFamily: "Outfit_700Bold", fontSize: 13, color: Colors.background },
  withdrawalLimitsFooterText: { flex: 1, fontFamily: "Outfit_400Regular", fontSize: 11, color: Colors.textMuted },

  usersTableHeader: { flexDirection: "row", alignItems: "center", paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.surfaceHighlight },
  usersTableHead: { fontFamily: "Outfit_600SemiBold", fontSize: 11, color: Colors.textMuted, textTransform: "uppercase" as const, letterSpacing: 0.5 },
  userCell: { flexDirection: "row", alignItems: "center", gap: 8 },
  userCellText: { fontFamily: "Outfit_400Regular", fontSize: 13, color: Colors.text },
  userAvatarText: { fontFamily: "Outfit_700Bold", fontSize: 12, color: Colors.primary },
  userStatusPill: { fontFamily: "Outfit_400Regular", fontSize: 10, color: Colors.textMuted, marginTop: 1 },
});
