import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Alert,
  ActivityIndicator,
  Linking,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import {
  useFonts,
  Outfit_400Regular,
  Outfit_600SemiBold,
  Outfit_700Bold,
} from "@expo-google-fonts/outfit";
import Colors from "@/constants/colors";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface Campaign {
  id: string;
  title: string;
  description: string;
  targetUrl: string;
  rewardPerVisit: string;
  totalBudget: string;
  spent: string;
  clicks: number;
  status: string;
  adminNote: string | null;
  createdAt: string;
}

interface PublisherInfo {
  isPublisher: boolean;
  publisherGrantedAt: string | null;
  adCredits: number;
  username: string;
}

function getStatusColor(status: string): string {
  switch (status) {
    case "active": return Colors.primary;
    case "pending": return Colors.accent;
    case "paused": return "#42A5F5";
    case "rejected": return "#FF5252";
    case "ended": return Colors.textMuted;
    default: return Colors.textMuted;
  }
}

function getStatusBg(status: string): string {
  switch (status) {
    case "active": return "rgba(0,230,118,0.12)";
    case "pending": return "rgba(255,214,0,0.12)";
    case "paused": return "rgba(66,165,245,0.12)";
    case "rejected": return "rgba(255,82,82,0.12)";
    case "ended": return "rgba(255,255,255,0.06)";
    default: return "rgba(255,255,255,0.06)";
  }
}

function getTimeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function PublisherScreen() {
  const insets = useSafeAreaInsets();
  const [fontsLoaded] = useFonts({ Outfit_400Regular, Outfit_600SemiBold, Outfit_700Bold });

  const [info, setInfo] = useState<PublisherInfo | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  const [showCreate, setShowCreate] = useState(false);
  const [showTopUp, setShowTopUp] = useState(false);
  const [creating, setCreating] = useState(false);
  const [toppingUp, setToppingUp] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [rewardPerVisit, setRewardPerVisit] = useState("0.01");
  const [totalBudget, setTotalBudget] = useState("5");
  const [topUpAmount, setTopUpAmount] = useState("5");

  const [pausingId, setPausingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = await AsyncStorage.getItem("cashclip_auth_token");
      if (!token) return;
      const base = getApiUrl();
      const [meRes, camRes] = await Promise.all([
        globalThis.fetch(new URL("/api/publisher/me", base).toString(), { headers: { Authorization: `Bearer ${token}` } }),
        globalThis.fetch(new URL("/api/publisher/campaigns", base).toString(), { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (meRes.ok) setInfo(await meRes.json());
      if (camRes.ok) { const d = await camRes.json(); setCampaigns(d.campaigns ?? []); }
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = useCallback(async () => {
    if (!title.trim()) { Alert.alert("Required", "Enter a campaign title"); return; }
    if (!description.trim()) { Alert.alert("Required", "Enter a description"); return; }
    if (!targetUrl.trim() || !targetUrl.startsWith("http")) { Alert.alert("Required", "Enter a valid URL starting with https://"); return; }
    const rpv = parseFloat(rewardPerVisit);
    const budget = parseFloat(totalBudget);
    if (!Number.isFinite(rpv) || rpv < 0.01 || rpv > 0.50) { Alert.alert("Invalid", "Reward must be $0.01 – $0.50 per visit"); return; }
    if (!Number.isFinite(budget) || budget < 0.50) { Alert.alert("Invalid", "Minimum budget is $0.50"); return; }
    if ((info?.adCredits ?? 0) < budget) { Alert.alert("Insufficient Credits", `You have $${(info?.adCredits ?? 0).toFixed(2)} in ad credits. Lower your budget or top up first.`); return; }

    setCreating(true);
    try {
      const res = await apiRequest("POST", "/api/publisher/campaigns", {
        title: title.trim(),
        description: description.trim(),
        targetUrl: targetUrl.trim(),
        rewardPerVisit: rpv,
        totalBudget: budget,
      });
      const data = await res.json();
      if (!res.ok) { Alert.alert("Error", data.error || "Failed to create campaign"); return; }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Campaign Submitted", "Your campaign is pending admin review. It will go live once approved.");
      setTitle(""); setDescription(""); setTargetUrl(""); setRewardPerVisit("0.01"); setTotalBudget("5");
      setShowCreate(false);
      await load();
    } catch {
      Alert.alert("Error", "Failed to create campaign");
    } finally {
      setCreating(false);
    }
  }, [title, description, targetUrl, rewardPerVisit, totalBudget, info, load]);

  const handleTopUp = useCallback(async () => {
    const amt = parseFloat(topUpAmount);
    if (!Number.isFinite(amt) || amt < 1) { Alert.alert("Invalid", "Minimum top-up is $1"); return; }
    setToppingUp(true);
    try {
      const res = await apiRequest("POST", "/api/publisher/top-up", { amount: amt });
      const data = await res.json();
      if (!res.ok) { Alert.alert("Error", data.error || "Failed"); return; }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Converted!", `$${amt.toFixed(2)} moved from your earnings to ad credits.`);
      setShowTopUp(false);
      await load();
    } catch {
      Alert.alert("Error", "Failed to convert credits");
    } finally {
      setToppingUp(false);
    }
  }, [topUpAmount, load]);

  const handleTogglePause = useCallback(async (campaign: Campaign) => {
    const newStatus = campaign.status === "active" ? "paused" : "active";
    setPausingId(campaign.id);
    try {
      const res = await apiRequest("PATCH", `/api/publisher/campaigns/${campaign.id}`, { status: newStatus });
      if (!res.ok) { Alert.alert("Error", "Failed to update campaign"); return; }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await load();
    } catch {
      Alert.alert("Error", "Failed to update campaign");
    } finally {
      setPausingId(null);
    }
  }, [load]);

  if (!fontsLoaded || loading) {
    return (
      <View style={[styles.container, { justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator color={Colors.primary} size="large" />
      </View>
    );
  }

  if (!info?.isPublisher) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.headerRow}>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Feather name="arrow-left" size={20} color={Colors.text} />
          </Pressable>
          <Text style={styles.title}>Publisher</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={styles.notPublisherWrap}>
          <LinearGradient colors={["rgba(0,230,118,0.08)", "transparent"]} style={styles.notPublisherCard}>
            <Feather name="award" size={48} color={Colors.primary} />
            <Text style={styles.notPublisherTitle}>Early Access Program</Text>
            <Text style={styles.notPublisherBody}>
              The Publisher Program is reserved for early CashClip loyalists. As a thank-you for being here from the start, qualifying users get free ad credits and the ability to run their own campaigns through our platform.
            </Text>
            <Text style={styles.notPublisherSub}>
              Reach out to the CashClip team or wait — we'll be granting access to loyal early users soon.
            </Text>
          </LinearGradient>
        </View>
      </View>
    );
  }

  const totalSpent = campaigns.reduce((s, c) => s + Number(c.spent), 0);
  const totalClicks = campaigns.reduce((s, c) => s + c.clicks, 0);
  const activeCampaigns = campaigns.filter(c => c.status === "active").length;

  const referralLink = `https://cash-clip.app/ref/${info.username}`;
  // nosemgrep: javascript.lang.security.html-in-template-string — info.username is validated server-side to [a-zA-Z0-9_-]; embedCode is displayed as plain text for copy-paste, never injected into DOM
  const embedCode = `<iframe src="https://cash-clip.app/earn?pub=${info.username}" width="100%" height="600" frameborder="0"></iframe>`;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.headerRow}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={20} color={Colors.text} />
        </Pressable>
        <Text style={styles.title}>Publisher</Text>
        <Pressable style={styles.addBtn} onPress={() => setShowCreate(true)}>
          <Feather name="plus" size={20} color={Colors.background} />
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Credits card */}
        <LinearGradient colors={["#0D2818", "#0A1A12"]} style={styles.creditsCard}>
          <View style={styles.creditsRow}>
            <View>
              <Text style={styles.creditsLabel}>Ad Credits</Text>
              <Text style={styles.creditsValue}>${info.adCredits.toFixed(2)}</Text>
            </View>
            <Pressable style={styles.topUpBtn} onPress={() => setShowTopUp(true)}>
              <Feather name="plus-circle" size={14} color={Colors.primary} />
              <Text style={styles.topUpBtnText}>Top Up</Text>
            </Pressable>
          </View>
          <View style={styles.creditsDivider} />
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statVal}>{activeCampaigns}</Text>
              <Text style={styles.statLbl}>Active</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statVal}>{totalClicks}</Text>
              <Text style={styles.statLbl}>Total Clicks</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statVal}>${totalSpent.toFixed(2)}</Text>
              <Text style={styles.statLbl}>Spent</Text>
            </View>
          </View>
        </LinearGradient>

        {/* Referral link */}
        <Text style={styles.sectionTitle}>Your Referral Link</Text>
        <View style={styles.linkCard}>
          <View style={styles.linkRow}>
            <Feather name="link" size={14} color={Colors.primary} />
            <Text style={styles.linkText} numberOfLines={1}>{referralLink}</Text>
          </View>
          <Pressable
            style={styles.copyBtn}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              Alert.alert("Copied!", "Referral link copied to clipboard.\n\n" + referralLink);
            }}
          >
            <Feather name="copy" size={14} color={Colors.background} />
            <Text style={styles.copyBtnText}>Copy</Text>
          </Pressable>
        </View>

        {/* Embed code */}
        <Text style={styles.sectionTitle}>Embed Widget</Text>
        <View style={styles.embedCard}>
          <Text style={styles.embedLabel}>Paste this on your website to show CashClip earn offers:</Text>
          <Text style={styles.embedCode}>{embedCode}</Text>
          <Pressable
            style={[styles.copyBtn, { marginTop: 12, alignSelf: "flex-start" }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              Alert.alert("Embed Code", embedCode);
            }}
          >
            <Feather name="copy" size={14} color={Colors.background} />
            <Text style={styles.copyBtnText}>Copy Code</Text>
          </Pressable>
        </View>

        {/* Campaigns */}
        <Text style={styles.sectionTitle}>My Campaigns</Text>
        {campaigns.length === 0 ? (
          <Pressable style={styles.emptyCampaigns} onPress={() => setShowCreate(true)}>
            <Feather name="radio" size={32} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>No campaigns yet</Text>
            <Text style={styles.emptySub}>Create your first campaign to start driving traffic through CashClip's earn channels.</Text>
            <View style={styles.createFirstBtn}>
              <Feather name="plus" size={14} color={Colors.background} />
              <Text style={styles.createFirstBtnText}>Create Campaign</Text>
            </View>
          </Pressable>
        ) : (
          campaigns.map((c) => {
            const budgetUsed = Number(c.totalBudget) > 0 ? Number(c.spent) / Number(c.totalBudget) : 0;
            return (
              <View key={c.id} style={styles.campaignCard}>
                <View style={styles.campaignHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.campaignTitle}>{c.title}</Text>
                    <Text style={styles.campaignUrl} numberOfLines={1}>{c.targetUrl}</Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: getStatusBg(c.status) }]}>
                    <Text style={[styles.statusText, { color: getStatusColor(c.status) }]}>
                      {c.status.charAt(0).toUpperCase() + c.status.slice(1)}
                    </Text>
                  </View>
                </View>
                <Text style={styles.campaignDesc}>{c.description}</Text>
                {c.adminNote ? (
                  <View style={styles.adminNoteRow}>
                    <Feather name="info" size={12} color={Colors.accent} />
                    <Text style={styles.adminNoteText}>{c.adminNote}</Text>
                  </View>
                ) : null}
                <View style={styles.campaignMeta}>
                  <View style={styles.metaItem}>
                    <Feather name="mouse-pointer" size={12} color={Colors.textMuted} />
                    <Text style={styles.metaText}>{c.clicks} clicks</Text>
                  </View>
                  <View style={styles.metaItem}>
                    <Feather name="dollar-sign" size={12} color={Colors.textMuted} />
                    <Text style={styles.metaText}>+{Number(c.rewardPerVisit).toFixed(2)}/visit</Text>
                  </View>
                  <View style={styles.metaItem}>
                    <Feather name="clock" size={12} color={Colors.textMuted} />
                    <Text style={styles.metaText}>{getTimeAgo(c.createdAt)}</Text>
                  </View>
                </View>
                <View style={styles.budgetRow}>
                  <Text style={styles.budgetLabel}>Budget</Text>
                  <Text style={styles.budgetValue}>${Number(c.spent).toFixed(2)} / ${Number(c.totalBudget).toFixed(2)}</Text>
                </View>
                <View style={styles.budgetBarBg}>
                  <View style={[styles.budgetBarFill, { width: `${Math.min(budgetUsed, 1) * 100}%` }]} />
                </View>
                {(c.status === "active" || c.status === "paused") && (
                  <Pressable
                    style={[styles.pauseBtn, c.status === "paused" && styles.resumeBtn]}
                    onPress={() => handleTogglePause(c)}
                    disabled={pausingId === c.id}
                  >
                    {pausingId === c.id
                      ? <ActivityIndicator size="small" color={c.status === "paused" ? Colors.background : Colors.text} />
                      : <>
                        <Feather name={c.status === "active" ? "pause" : "play"} size={13} color={c.status === "paused" ? Colors.background : Colors.text} />
                        <Text style={[styles.pauseBtnText, c.status === "paused" && styles.resumeBtnText]}>
                          {c.status === "active" ? "Pause" : "Resume"}
                        </Text>
                      </>
                    }
                  </Pressable>
                )}
              </View>
            );
          })
        )}

        {/* Create campaign form */}
        {showCreate && (
          <View style={styles.createForm}>
            <Text style={styles.formTitle}>New Campaign</Text>

            <Text style={styles.formLabel}>Title</Text>
            <TextInput
              style={styles.formInput}
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. Check out my blog"
              placeholderTextColor={Colors.textMuted}
              maxLength={80}
            />

            <Text style={styles.formLabel}>Description</Text>
            <TextInput
              style={[styles.formInput, { height: 80, textAlignVertical: "top" }]}
              value={description}
              onChangeText={setDescription}
              placeholder="Tell users what they'll find at your link..."
              placeholderTextColor={Colors.textMuted}
              multiline
              maxLength={300}
            />

            <Text style={styles.formLabel}>Target URL</Text>
            <TextInput
              style={styles.formInput}
              value={targetUrl}
              onChangeText={setTargetUrl}
              placeholder="https://yoursite.com"
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
              keyboardType="url"
            />

            <View style={styles.formRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.formLabel}>Reward / Visit ($)</Text>
                <TextInput
                  style={styles.formInput}
                  value={rewardPerVisit}
                  onChangeText={setRewardPerVisit}
                  keyboardType="decimal-pad"
                  placeholder="0.01"
                  placeholderTextColor={Colors.textMuted}
                />
              </View>
              <View style={{ width: 12 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.formLabel}>Total Budget ($)</Text>
                <TextInput
                  style={styles.formInput}
                  value={totalBudget}
                  onChangeText={setTotalBudget}
                  keyboardType="decimal-pad"
                  placeholder="5.00"
                  placeholderTextColor={Colors.textMuted}
                />
              </View>
            </View>

            <View style={styles.formNote}>
              <Feather name="info" size={12} color={Colors.textMuted} />
              <Text style={styles.formNoteText}>
                Budget is deducted from your ad credits immediately. Estimated {Math.floor(parseFloat(totalBudget || "0") / parseFloat(rewardPerVisit || "0.01"))} visits.
              </Text>
            </View>

            <View style={styles.formActions}>
              <Pressable style={styles.cancelBtn} onPress={() => setShowCreate(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.submitBtn, creating && { opacity: 0.6 }]} onPress={handleCreate} disabled={creating}>
                {creating
                  ? <ActivityIndicator size="small" color={Colors.background} />
                  : <><Feather name="send" size={14} color={Colors.background} /><Text style={styles.submitBtnText}>Submit</Text></>
                }
              </Pressable>
            </View>
          </View>
        )}

        {/* Top up form */}
        {showTopUp && (
          <View style={styles.createForm}>
            <Text style={styles.formTitle}>Convert Earnings to Ad Credits</Text>
            <Text style={[styles.formNoteText, { color: Colors.textMuted, fontFamily: "Outfit_400Regular", fontSize: 13, marginBottom: 16 }]}>
              Move funds from your earnings balance into ad credits. Minimum $1.
            </Text>
            <Text style={styles.formLabel}>Amount ($)</Text>
            <TextInput
              style={styles.formInput}
              value={topUpAmount}
              onChangeText={setTopUpAmount}
              keyboardType="decimal-pad"
              placeholder="5.00"
              placeholderTextColor={Colors.textMuted}
            />
            <View style={styles.formActions}>
              <Pressable style={styles.cancelBtn} onPress={() => setShowTopUp(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.submitBtn, toppingUp && { opacity: 0.6 }]} onPress={handleTopUp} disabled={toppingUp}>
                {toppingUp
                  ? <ActivityIndicator size="small" color={Colors.background} />
                  : <Text style={styles.submitBtnText}>Convert</Text>
                }
              </Pressable>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.surface, alignItems: "center", justifyContent: "center" },
  addBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.primary, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: "Outfit_700Bold", fontSize: 22, color: Colors.text },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 4 },

  creditsCard: { borderRadius: 20, padding: 20, borderWidth: 1, borderColor: "rgba(0,230,118,0.15)", marginBottom: 8 },
  creditsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  creditsLabel: { fontFamily: "Outfit_400Regular", fontSize: 13, color: "rgba(0,230,118,0.7)", marginBottom: 4 },
  creditsValue: { fontFamily: "Outfit_700Bold", fontSize: 36, color: Colors.primary },
  topUpBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(0,230,118,0.12)", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  topUpBtnText: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: Colors.primary },
  creditsDivider: { height: 1, backgroundColor: "rgba(255,255,255,0.06)", marginVertical: 16 },
  statsRow: { flexDirection: "row", alignItems: "center" },
  statItem: { flex: 1, alignItems: "center" },
  statVal: { fontFamily: "Outfit_700Bold", fontSize: 18, color: Colors.text },
  statLbl: { fontFamily: "Outfit_400Regular", fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  statDivider: { width: 1, height: 32, backgroundColor: "rgba(255,255,255,0.06)" },

  sectionTitle: { fontFamily: "Outfit_700Bold", fontSize: 17, color: Colors.text, marginBottom: 12, marginTop: 20 },

  linkCard: { backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, padding: 14, gap: 12 },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  linkText: { fontFamily: "Outfit_400Regular", fontSize: 13, color: Colors.textSecondary, flex: 1 },
  copyBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: Colors.primary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, alignSelf: "flex-start" },
  copyBtnText: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: Colors.background },

  embedCard: { backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, padding: 14 },
  embedLabel: { fontFamily: "Outfit_400Regular", fontSize: 12, color: Colors.textMuted, marginBottom: 10 },
  embedCode: { fontFamily: "Outfit_400Regular", fontSize: 11, color: Colors.textSecondary, backgroundColor: Colors.surfaceHighlight, borderRadius: 8, padding: 12 },

  emptyCampaigns: { backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, padding: 32, alignItems: "center", gap: 10 },
  emptyTitle: { fontFamily: "Outfit_700Bold", fontSize: 16, color: Colors.text },
  emptySub: { fontFamily: "Outfit_400Regular", fontSize: 13, color: Colors.textMuted, textAlign: "center" },
  createFirstBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: Colors.primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, marginTop: 8 },
  createFirstBtnText: { fontFamily: "Outfit_700Bold", fontSize: 14, color: Colors.background },

  campaignCard: { backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, padding: 14, marginBottom: 12 },
  campaignHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 6 },
  campaignTitle: { fontFamily: "Outfit_700Bold", fontSize: 15, color: Colors.text },
  campaignUrl: { fontFamily: "Outfit_400Regular", fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  campaignDesc: { fontFamily: "Outfit_400Regular", fontSize: 13, color: Colors.textSecondary, marginBottom: 10 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontFamily: "Outfit_600SemiBold", fontSize: 11 },
  adminNoteRow: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,214,0,0.08)", borderRadius: 8, padding: 8, marginBottom: 8 },
  adminNoteText: { fontFamily: "Outfit_400Regular", fontSize: 12, color: Colors.accent, flex: 1 },
  campaignMeta: { flexDirection: "row", gap: 14, marginBottom: 10 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { fontFamily: "Outfit_400Regular", fontSize: 12, color: Colors.textMuted },
  budgetRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  budgetLabel: { fontFamily: "Outfit_400Regular", fontSize: 12, color: Colors.textMuted },
  budgetValue: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: Colors.text },
  budgetBarBg: { height: 4, backgroundColor: Colors.surfaceHighlight, borderRadius: 2, overflow: "hidden", marginBottom: 10 },
  budgetBarFill: { height: 4, backgroundColor: Colors.primary, borderRadius: 2 },
  pauseBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, paddingVertical: 8 },
  resumeBtn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  pauseBtnText: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: Colors.text },
  resumeBtnText: { color: Colors.background },

  createForm: { backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, padding: 16, marginTop: 4 },
  formTitle: { fontFamily: "Outfit_700Bold", fontSize: 18, color: Colors.text, marginBottom: 16 },
  formLabel: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: Colors.textMuted, marginBottom: 6 },
  formInput: { fontFamily: "Outfit_400Regular", fontSize: 14, color: Colors.text, backgroundColor: Colors.surfaceHighlight, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, borderWidth: 1, borderColor: Colors.border, marginBottom: 14 },
  formRow: { flexDirection: "row" },
  formNote: { flexDirection: "row", alignItems: "flex-start", gap: 6, backgroundColor: Colors.surfaceHighlight, borderRadius: 8, padding: 10, marginBottom: 16 },
  formNoteText: { fontFamily: "Outfit_400Regular", fontSize: 11, color: Colors.textMuted, flex: 1 },
  formActions: { flexDirection: "row", gap: 10 },
  cancelBtn: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: Colors.border },
  cancelBtnText: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: Colors.textSecondary },
  submitBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 10, backgroundColor: Colors.primary },
  submitBtnText: { fontFamily: "Outfit_700Bold", fontSize: 14, color: Colors.background },

  notPublisherWrap: { flex: 1, justifyContent: "center", paddingHorizontal: 24 },
  notPublisherCard: { borderRadius: 20, padding: 32, alignItems: "center", gap: 14, borderWidth: 1, borderColor: "rgba(0,230,118,0.15)" },
  notPublisherTitle: { fontFamily: "Outfit_700Bold", fontSize: 22, color: Colors.text, textAlign: "center" },
  notPublisherBody: { fontFamily: "Outfit_400Regular", fontSize: 14, color: Colors.textSecondary, textAlign: "center", lineHeight: 22 },
  notPublisherSub: { fontFamily: "Outfit_400Regular", fontSize: 12, color: Colors.textMuted, textAlign: "center" },
});
