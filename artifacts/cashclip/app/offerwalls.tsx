import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Platform,
  Modal,
  Alert,
  ActivityIndicator,
  TextInput,
} from "react-native";
import * as WebBrowser from "expo-web-browser";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useFonts, Outfit_400Regular, Outfit_600SemiBold, Outfit_700Bold } from "@expo-google-fonts/outfit";
import Colors from "@/constants/colors";
import { addEarnings } from "@/lib/storage";
import { getApiUrl } from "@/lib/query-client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

type OfferType = "app_install" | "signup" | "purchase" | "survey" | "video" | "task";
type ProviderKey = "tapjoy" | "adgate" | "offertoro" | "lootably" | "adjoe" | "adgem" | "ayet" | "notik" | "revlum" | "monlix" | "paymentwall";
type Difficulty = "easy" | "medium" | "hard";

interface Offer {
  id: string;
  provider: ProviderKey;
  providerName: string;
  title: string;
  description: string;
  reward: number;
  type: OfferType;
  difficulty: Difficulty;
  requiresPayment: boolean;
  offerUrl: string;
  brand?: string;
}

const PROVIDER_COLORS: Record<string, string> = {
  tapjoy:      "#FF6B35",
  adgate:      "#00C853",
  offertoro:   "#2979FF",
  lootably:    "#9C27B0",
  adjoe:       "#F44336",
  adgem:       "#0EA5E9",
  ayet:        "#F59E0B",
  notik:       "#10B981",
  revlum:      "#8B5CF6",
  monlix:      "#EC4899",
  paymentwall: "#1D4ED8",
};

const TYPE_ICONS: Record<OfferType, string> = {
  app_install: "smartphone",
  signup: "user-plus",
  purchase: "shopping-bag",
  survey: "clipboard",
  video: "play-circle",
  task: "check-square",
};

const TYPE_LABELS: Record<OfferType, string> = {
  app_install: "App Install",
  signup: "Sign Up",
  purchase: "Purchase",
  survey: "Survey",
  video: "Watch Video",
  task: "Complete Task",
};

function ProviderBadge({ provider, name }: { provider: string; name: string }) {
  const color = PROVIDER_COLORS[provider] || Colors.primary;
  return (
    <View style={[styles.providerBadge, { borderColor: color + "40", backgroundColor: color + "12" }]}>
      <View style={[styles.providerDot, { backgroundColor: color }]} />
      <Text style={[styles.providerBadgeText, { color }]}>{name}</Text>
    </View>
  );
}

function DifficultyBadge({ difficulty }: { difficulty: Difficulty }) {
  const color = difficulty === "easy" ? Colors.primary : difficulty === "medium" ? Colors.accent : "#FF6B6B";
  const label = difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
  return (
    <View style={[styles.diffBadge, { backgroundColor: color + "15" }]}>
      <Text style={[styles.diffBadgeText, { color }]}>{label}</Text>
    </View>
  );
}

function OfferCard({ offer, onStart, completed }: { offer: Offer; onStart: (o: Offer) => void; completed: boolean }) {
  return (
    <Pressable
      onPress={() => !completed && onStart(offer)}
      style={({ pressed }) => [
        styles.offerCard,
        completed && styles.offerCardCompleted,
        { opacity: pressed && !completed ? 0.9 : 1, transform: [{ scale: pressed && !completed ? 0.98 : 1 }] },
      ]}
    >
      <View style={styles.offerHeader}>
        <View style={[styles.offerTypeIcon, { backgroundColor: (PROVIDER_COLORS[offer.provider] || Colors.primary) + "15" }]}>
          <Feather name={TYPE_ICONS[offer.type] as any} size={18} color={PROVIDER_COLORS[offer.provider] || Colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.offerTitle, completed && { color: Colors.textMuted }]} numberOfLines={2}>
            {offer.title}
          </Text>
          {offer.brand && (
            <Text style={styles.offerBrand}>{offer.brand}</Text>
          )}
        </View>
        {completed ? (
          <View style={styles.completedBadge}>
            <Ionicons name="checkmark-circle" size={20} color={Colors.primary} />
          </View>
        ) : (
          <View style={styles.rewardBadge}>
            <Text style={styles.rewardBadgeText}>${offer.reward.toFixed(2)}</Text>
          </View>
        )}
      </View>

      <Text style={styles.offerDesc} numberOfLines={2}>{offer.description}</Text>

      <View style={styles.offerFooter}>
        <View style={styles.offerTag}>
          <Feather name={TYPE_ICONS[offer.type] as any} size={11} color={Colors.textMuted} />
          <Text style={styles.offerTagText}>{TYPE_LABELS[offer.type]}</Text>
        </View>
        {offer.requiresPayment && (
          <View style={[styles.offerTag, { backgroundColor: "#FF6B6B15" }]}>
            <Feather name="credit-card" size={11} color="#FF6B6B" />
            <Text style={[styles.offerTagText, { color: "#FF6B6B" }]}>Requires Purchase</Text>
          </View>
        )}
        <DifficultyBadge difficulty={offer.difficulty} />
        <ProviderBadge provider={offer.provider} name={offer.providerName} />
      </View>
    </Pressable>
  );
}

export default function OfferwallsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [pendingOffer, setPendingOffer] = useState<Offer | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [offerTxnId, setOfferTxnId] = useState<string>("");
  const [isLaunching, setIsLaunching] = useState(false);
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  const [selectedFilter, setSelectedFilter] = useState<"all" | OfferType>("all");

  const [fontsLoaded] = useFonts({ Outfit_400Regular, Outfit_600SemiBold, Outfit_700Bold });

  const { data: offersData, isLoading } = useQuery({
    queryKey: ["/api/offerwalls/available"],
    staleTime: 5 * 60 * 1000,
  });

  const { data: providersData } = useQuery({
    queryKey: ["/api/offerwalls/providers"],
    staleTime: 60 * 1000,
  });

  const startMutation = useMutation({
    mutationFn: async (offer: Offer) => {
      const token = await getAuthToken();
      const url = new URL("/api/offerwalls/start", getApiUrl());
      const res = await fetch(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ offerId: offer.id, provider: offer.provider, estimatedReward: offer.reward }),
      });
      if (!res.ok) throw new Error("Failed to start offer session");
      return res.json();
    },
  });

  const completeMutation = useMutation({
    mutationFn: async ({ offerId, provider, token, transactionId }: { offerId: string; provider: string; token: string; transactionId: string }) => {
      const authToken = await getAuthToken();
      const url = new URL("/api/offerwalls/complete", getApiUrl());
      const res = await fetch(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ offerId, provider, sessionToken: token, transactionId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || "Completion failed");
      }
      return res.json();
    },
    onSuccess: async (data, vars) => {
      const reward = data.reward as number;
      await addEarnings(reward, `Offer: ${pendingOffer?.title || "Offerwall"}`, "earned");
      setCompletedIds((prev) => new Set([...prev, vars.offerId]));
      setPendingOffer(null);
      setSessionToken(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Offer Complete!", `You earned $${reward.toFixed(2)}! It has been added to your balance.`);
    },
    onError: (err: Error) => {
      Alert.alert("Error", err.message || "Could not verify offer completion.");
    },
  });

  const handleStartOffer = useCallback((offer: Offer) => {
    if (completedIds.has(offer.id)) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPendingOffer(offer);
  }, [completedIds]);

  const handleLaunchOffer = useCallback(async () => {
    if (!pendingOffer) return;
    setIsLaunching(true);
    try {
      const result = await startMutation.mutateAsync(pendingOffer);
      setSessionToken(result.sessionToken);
      await WebBrowser.openBrowserAsync(pendingOffer.offerUrl, {
        toolbarColor: "#0D1B2A",
        controlsColor: "#00C6A0",
        dismissButtonStyle: "done",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/balance"] });
    } catch {
      Alert.alert("Error", "Could not launch offer. Please try again.");
    } finally {
      setIsLaunching(false);
    }
  }, [pendingOffer, queryClient]);

  const handleClaimReward = useCallback(async () => {
    if (!pendingOffer || !sessionToken) return;
    if (!offerTxnId || offerTxnId.trim().length === 0) {
      Alert.alert("Verification needed", "Enter the provider transaction ID from the offer completion page.");
      return;
    }
    await completeMutation.mutateAsync({
      offerId: pendingOffer.id,
      provider: pendingOffer.provider,
      token: sessionToken,
      transactionId: offerTxnId.trim(),
    });
  }, [pendingOffer, sessionToken, offerTxnId]);

  if (!fontsLoaded) return null;

  const webTopPad = Platform.OS === "web" ? 67 : 0;
  const allOffers: Offer[] = ((offersData as any)?.offers || []);
  const anyConfigured = (providersData as any)?.anyConfigured ?? false;

  const availableOffers = allOffers.filter((o) => !completedIds.has(o.id));
  const completedOffers = allOffers.filter((o) => completedIds.has(o.id));

  const filterTypes: { key: "all" | OfferType; label: string }[] = [
    { key: "all", label: "All" },
    { key: "app_install", label: "Apps" },
    { key: "signup", label: "Sign Ups" },
    { key: "video", label: "Videos" },
    { key: "task", label: "Tasks" },
  ];

  const filteredAvailable = selectedFilter === "all"
    ? availableOffers
    : availableOffers.filter((o) => o.type === selectedFilter);

  const totalPotential = availableOffers.reduce((s, o) => s + o.reward, 0);
  const configuredCount = ((providersData as any)?.providers || []).filter((p: any) => p.configured).length;

  return (
    <View style={[styles.container, { paddingTop: webTopPad + insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={Colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Offerwalls</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: Platform.OS === "web" ? 34 : 16, paddingHorizontal: 16 }}
      >
        {!anyConfigured ? (
          <>
            <View style={styles.heroCard}>
              <LinearGradient colors={["#1A1A2E", "#0D1B2A"]} style={styles.heroGradient}>
                <MaterialCommunityIcons name="gift-outline" size={48} color={Colors.accent} />
                <Text style={styles.heroTitle}>Earn More with Offers</Text>
                <Text style={styles.heroSubtitle}>
                  Complete app installs, sign-ups, and tasks from top brands to earn $0.25–$5.00 per offer.
                </Text>
              </LinearGradient>
            </View>

            <Text style={styles.sectionTitle}>Connect a Provider</Text>
            {[
              { key: "tapjoy", name: "Tapjoy", color: "#FF6B35", env: "TAPJOY_SDK_KEY", desc: "Leading offerwall — app installs & sign-ups", url: "dev.tapjoy.com" },
              { key: "adgate", name: "AdGate Media", color: "#00C853", env: "ADGATE_API_KEY", desc: "Diverse offers: apps, videos, quizzes & more", url: "wall.adgaterewards.com" },
              { key: "offertoro", name: "OfferToro", color: "#2979FF", env: "OFFERTORO_API_KEY", desc: "Global offers from 200+ advertisers", url: "offertoro.com/publishers" },
              { key: "lootably", name: "Lootably", color: "#9C27B0", env: "LOOTABLY_API_KEY", desc: "Self-serve offerwall — instant approval, strong US iOS fill", url: "lootably.com" },
              { key: "adjoe", name: "Adjoe", color: "#F44336", env: "ADJOE_SDK_KEY + ADJOE_APP_ID", desc: "Playtime-based offers — highest eCPM offerwall", url: "adjoe.io" },
            ].map((p) => (
              <View key={p.key} style={[styles.setupCard, { borderColor: p.color + "30" }]}>
                <View style={[styles.setupDot, { backgroundColor: p.color }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.setupName}>{p.name}</Text>
                  <Text style={styles.setupDesc}>{p.desc}</Text>
                  <Text style={styles.setupEnv}>Set {p.env} secret → {p.url}</Text>
                </View>
                <Feather name="external-link" size={14} color={Colors.textMuted} />
              </View>
            ))}
          </>
        ) : isLoading ? (
          <View style={styles.loadingCard}>
            <ActivityIndicator color={Colors.primary} size="large" />
            <Text style={styles.loadingText}>Loading offers…</Text>
          </View>
        ) : (
          <>
            <LinearGradient colors={["#1A1A2E", "#0D1B2A"]} style={styles.statsCard}>
              <View style={styles.statsRow}>
                <View style={styles.statsItem}>
                  <MaterialCommunityIcons name="gift-open-outline" size={22} color={Colors.accent} />
                  <Text style={styles.statsValue}>{availableOffers.length}</Text>
                  <Text style={styles.statsLabel}>Available</Text>
                </View>
                <View style={styles.statsDivider} />
                <View style={styles.statsItem}>
                  <Feather name="dollar-sign" size={22} color={Colors.primary} />
                  <Text style={styles.statsValue}>${totalPotential.toFixed(2)}</Text>
                  <Text style={styles.statsLabel}>Potential</Text>
                </View>
                <View style={styles.statsDivider} />
                <View style={styles.statsItem}>
                  <Ionicons name="checkmark-done-circle-outline" size={22} color="#4ECDC4" />
                  <Text style={styles.statsValue}>{completedOffers.length}</Text>
                  <Text style={styles.statsLabel}>Completed</Text>
                </View>
              </View>
            </LinearGradient>

            <View style={styles.infoCard}>
              <Feather name="info" size={16} color={Colors.textSecondary} />
                <Text style={styles.infoText}>
                Tap an offer to open it. Complete the required action, then return here and tap "I Completed This" to claim your reward.
              </Text>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow} contentContainerStyle={{ gap: 8, paddingRight: 4 }}>
              {filterTypes.map((f) => (
                <Pressable
                  key={f.key}
                  onPress={() => setSelectedFilter(f.key)}
                  style={[styles.filterChip, selectedFilter === f.key && styles.filterChipActive]}
                >
                  <Text style={[styles.filterChipText, selectedFilter === f.key && styles.filterChipTextActive]}>
                    {f.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            {filteredAvailable.length > 0 ? (
              <>
                <Text style={styles.sectionTitle}>Available Offers</Text>
                {filteredAvailable.map((offer) => (
                  <OfferCard key={offer.id} offer={offer} onStart={handleStartOffer} completed={false} />
                ))}
              </>
            ) : (
              <View style={styles.emptyCard}>
                <Feather name="inbox" size={36} color={Colors.textMuted} />
                <Text style={styles.emptyText}>No offers match this filter</Text>
              </View>
            )}

            {completedOffers.length > 0 && (
              <>
                <Text style={[styles.sectionTitle, { marginTop: 8 }]}>Completed</Text>
                {completedOffers.map((offer) => (
                  <OfferCard key={offer.id} offer={offer} onStart={() => {}} completed={true} />
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>

      <Modal visible={!!pendingOffer} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHandle} />
            {pendingOffer && (
              <>
                <View style={styles.modalHeader}>
                  <View style={[styles.modalTypeIcon, { backgroundColor: (PROVIDER_COLORS[pendingOffer.provider] || Colors.primary) + "15" }]}>
                    <Feather name={TYPE_ICONS[pendingOffer.type] as any} size={22} color={PROVIDER_COLORS[pendingOffer.provider] || Colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modalTitle} numberOfLines={2}>{pendingOffer.title}</Text>
                    <ProviderBadge provider={pendingOffer.provider} name={pendingOffer.providerName} />
                  </View>
                  {!sessionToken && (
                    <Pressable onPress={() => setPendingOffer(null)} hitSlop={12}>
                      <Feather name="x" size={24} color={Colors.textSecondary} />
                    </Pressable>
                  )}
                </View>

                <Text style={styles.modalDesc}>{pendingOffer.description}</Text>

                <View style={styles.modalInfoBox}>
                  <View style={styles.modalInfoRow}>
                    <Feather name="dollar-sign" size={16} color={Colors.primary} />
                    <Text style={[styles.modalInfoText, { color: Colors.primary, fontFamily: "Outfit_700Bold" }]}>
                      Earn ${pendingOffer.reward.toFixed(2)}
                    </Text>
                  </View>
                  <View style={styles.modalInfoRow}>
                    <Feather name={TYPE_ICONS[pendingOffer.type] as any} size={16} color={Colors.textSecondary} />
                    <Text style={styles.modalInfoText}>{TYPE_LABELS[pendingOffer.type]}</Text>
                  </View>
                  {pendingOffer.requiresPayment && (
                    <View style={styles.modalInfoRow}>
                      <Feather name="alert-circle" size={16} color="#FF6B6B" />
                      <Text style={[styles.modalInfoText, { color: "#FF6B6B" }]}>This offer requires a purchase</Text>
                    </View>
                  )}
                </View>

                {!sessionToken ? (
                  <>
                    <Text style={styles.modalInstruction}>
                      This offer opens inside CashClip. Complete the required action fully, then tap "I Completed This" to claim your reward.
                    </Text>
                    <Pressable
                      onPress={handleLaunchOffer}
                      disabled={isLaunching}
                      style={({ pressed }) => [styles.actionBtn, { opacity: pressed || isLaunching ? 0.75 : 1 }]}
                    >
                      <LinearGradient colors={[Colors.accent, "#FFC107"]} style={styles.actionBtnGradient}>
                        {isLaunching
                          ? <ActivityIndicator color={Colors.background} size="small" />
                          : <>
                              <Feather name="external-link" size={18} color={Colors.background} />
                              <Text style={styles.actionBtnText}>Open Offer</Text>
                            </>
                        }
                      </LinearGradient>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <View style={styles.inProgressCard}>
                      <MaterialCommunityIcons name="timer-outline" size={26} color={Colors.accent} />
                      <Text style={styles.inProgressText}>Offer is open — complete it and come back here!</Text>
                    </View>
                    <Text style={styles.modalInstruction}>
                      Paste the transaction ID shown by the offer provider after completion. This proves you finished the offer.
                    </Text>
                    <TextInput
                      value={offerTxnId}
                      onChangeText={setOfferTxnId}
                      placeholder="Provider transaction ID"
                      placeholderTextColor={Colors.textMuted}
                      autoCapitalize="none"
                      autoCorrect={false}
                      style={styles.txnInput}
                    />
                    <Pressable
                      onPress={handleClaimReward}
                      disabled={completeMutation.isPending || offerTxnId.trim().length === 0}
                      style={({ pressed }) => [styles.actionBtn, { opacity: pressed || completeMutation.isPending || offerTxnId.trim().length === 0 ? 0.5 : 1 }]}
                    >
                      <LinearGradient colors={[Colors.primary, Colors.primaryDark]} style={styles.actionBtnGradient}>
                        {completeMutation.isPending
                          ? <ActivityIndicator color={Colors.background} size="small" />
                          : <>
                              <Feather name="check-circle" size={18} color={Colors.background} />
                              <Text style={styles.actionBtnText}>I Completed This</Text>
                            </>
                        }
                      </LinearGradient>
                    </Pressable>
                    <Pressable
                      onPress={() => { setPendingOffer(null); setSessionToken(null); }}
                      style={styles.cancelBtn}
                    >
                      <Text style={styles.cancelBtnText}>Cancel</Text>
                    </Pressable>
                  </>
                )}
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

async function getAuthToken(): Promise<string | null> {
  try {
    const { secureGet } = require("@/lib/secure-store");
    return await secureGet("cashclip_auth_token");
  } catch {
    return null;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 14,
  },
  backBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontFamily: "Outfit_700Bold", fontSize: 18, color: Colors.text },
  heroCard: { borderRadius: 16, overflow: "hidden", marginBottom: 20, borderWidth: 1, borderColor: Colors.border },
  heroGradient: { padding: 24, alignItems: "center", gap: 10 },
  heroTitle: { fontFamily: "Outfit_700Bold", fontSize: 22, color: Colors.text, textAlign: "center" },
  heroSubtitle: { fontFamily: "Outfit_400Regular", fontSize: 14, color: Colors.textSecondary, textAlign: "center", lineHeight: 20 },
  sectionTitle: { fontFamily: "Outfit_700Bold", fontSize: 17, color: Colors.text, marginBottom: 10 },
  setupCard: {
    flexDirection: "row", alignItems: "flex-start", gap: 12,
    backgroundColor: Colors.surface, borderRadius: 14, padding: 14, marginBottom: 10,
    borderWidth: 1,
  },
  setupDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  setupName: { fontFamily: "Outfit_700Bold", fontSize: 14, color: Colors.text },
  setupDesc: { fontFamily: "Outfit_400Regular", fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  setupEnv: { fontFamily: "Outfit_400Regular", fontSize: 11, color: Colors.textMuted, marginTop: 4 },
  statsCard: { borderRadius: 16, padding: 20, marginBottom: 12, borderWidth: 1, borderColor: Colors.border },
  statsRow: { flexDirection: "row", alignItems: "center" },
  statsItem: { flex: 1, alignItems: "center", gap: 4 },
  statsValue: { fontFamily: "Outfit_700Bold", fontSize: 20, color: Colors.text },
  statsLabel: { fontFamily: "Outfit_400Regular", fontSize: 11, color: Colors.textMuted },
  statsDivider: { width: 1, height: 36, backgroundColor: Colors.border },
  infoCard: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    backgroundColor: Colors.surface, borderRadius: 12, padding: 14, marginBottom: 12,
    borderWidth: 1, borderColor: Colors.border,
  },
  infoText: { fontFamily: "Outfit_400Regular", fontSize: 13, color: Colors.textSecondary, flex: 1, lineHeight: 18 },
  filterRow: { marginBottom: 14 },
  filterChip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
  },
  filterChipActive: { backgroundColor: Colors.primary + "15", borderColor: Colors.primary },
  filterChipText: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: Colors.textMuted },
  filterChipTextActive: { color: Colors.primary },
  offerCard: {
    backgroundColor: Colors.surface, borderRadius: 14, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: Colors.border,
  },
  offerCardCompleted: { opacity: 0.55 },
  offerHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 8 },
  offerTypeIcon: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  offerTitle: { fontFamily: "Outfit_700Bold", fontSize: 15, color: Colors.text, flex: 1 },
  offerBrand: { fontFamily: "Outfit_400Regular", fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  rewardBadge: {
    backgroundColor: "rgba(0,230,118,0.1)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4,
    alignSelf: "flex-start",
  },
  rewardBadgeText: { fontFamily: "Outfit_700Bold", fontSize: 14, color: Colors.primary },
  completedBadge: { alignSelf: "flex-start" },
  offerDesc: { fontFamily: "Outfit_400Regular", fontSize: 13, color: Colors.textSecondary, marginBottom: 10, lineHeight: 18 },
  offerFooter: { flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" },
  offerTag: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: Colors.surfaceHighlight, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3,
  },
  offerTagText: { fontFamily: "Outfit_400Regular", fontSize: 11, color: Colors.textMuted },
  providerBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1,
  },
  providerDot: { width: 6, height: 6, borderRadius: 3 },
  providerBadgeText: { fontFamily: "Outfit_600SemiBold", fontSize: 11 },
  diffBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  diffBadgeText: { fontFamily: "Outfit_600SemiBold", fontSize: 11 },
  loadingCard: { alignItems: "center", paddingVertical: 60, gap: 16 },
  loadingText: { fontFamily: "Outfit_400Regular", fontSize: 14, color: Colors.textMuted },
  emptyCard: { alignItems: "center", paddingVertical: 40, gap: 10 },
  emptyText: { fontFamily: "Outfit_400Regular", fontSize: 14, color: Colors.textMuted },
  modalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: "flex-end" },
  modalContent: {
    backgroundColor: Colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingBottom: Platform.OS === "web" ? 34 : 32,
  },
  modalHandle: { width: 36, height: 4, backgroundColor: Colors.border, borderRadius: 2, alignSelf: "center", marginTop: 12, marginBottom: 16 },
  modalHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 12 },
  modalTypeIcon: { width: 48, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  modalTitle: { fontFamily: "Outfit_700Bold", fontSize: 18, color: Colors.text, flex: 1 },
  modalDesc: { fontFamily: "Outfit_400Regular", fontSize: 14, color: Colors.textSecondary, lineHeight: 20, marginBottom: 14 },
  modalInfoBox: {
    backgroundColor: Colors.surface, borderRadius: 12, padding: 14, marginBottom: 14,
    borderWidth: 1, borderColor: Colors.border, gap: 10,
  },
  modalInfoRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  modalInfoText: { fontFamily: "Outfit_400Regular", fontSize: 14, color: Colors.textSecondary },
  modalInstruction: {
    fontFamily: "Outfit_400Regular", fontSize: 13, color: Colors.textSecondary,
    lineHeight: 20, marginBottom: 16, textAlign: "center",
  },
  txnInput: {
    backgroundColor: Colors.surface, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14,
    borderWidth: 1, borderColor: Colors.border, color: Colors.text,
    fontFamily: "Outfit_400Regular", fontSize: 14, marginBottom: 14,
  },
  actionBtn: { marginTop: 4 },
  actionBtnGradient: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 16, borderRadius: 14,
  },
  actionBtnText: { fontFamily: "Outfit_700Bold", fontSize: 16, color: Colors.background },
  inProgressCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: Colors.accent + "12", borderRadius: 12, padding: 14, marginBottom: 14,
    borderWidth: 1, borderColor: Colors.accent + "30",
  },
  inProgressText: { fontFamily: "Outfit_400Regular", fontSize: 13, color: Colors.textSecondary, flex: 1, lineHeight: 18 },
  cancelBtn: { alignItems: "center", paddingVertical: 14 },
  cancelBtnText: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: Colors.textMuted },
});
