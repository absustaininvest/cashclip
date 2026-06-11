import React, { useState, useCallback } from "react";
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
} from "react-native";
import * as WebBrowser from "expo-web-browser";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useFonts, Outfit_400Regular, Outfit_600SemiBold, Outfit_700Bold } from "@expo-google-fonts/outfit";
import Colors from "@/constants/colors";
import Chipley from "@/components/Chipley";
import RewardSuccessModal from "@/components/RewardSuccessModal";
import { useLanguage } from "@/lib/LanguageContext";
import { t as tFn } from "@/lib/i18n";
import { completeSurvey } from "@/lib/storage";
import { getApiUrl } from "@/lib/query-client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface ExternalSurvey {
  id: string;
  provider: string;
  providerName: string;
  title: string;
  description: string;
  reward: number;
  estimatedMinutes: number;
  category: string;
  difficulty: "easy" | "medium" | "hard";
  surveyUrl: string;
}

function DifficultyBadge({ difficulty }: { difficulty: "easy" | "medium" | "hard" }) {
  const color = difficulty === "easy" ? Colors.primary : difficulty === "medium" ? Colors.accent : "#FF6B6B";
  const label = difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
  return (
    <View style={[styles.diffBadge, { backgroundColor: `${color}15` }]}>
      <Text style={[styles.diffBadgeText, { color }]}>{label}</Text>
    </View>
  );
}

function RatingSelector({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <View style={styles.ratingRow}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Pressable key={star} onPress={() => { Haptics.selectionAsync(); onChange(star); }}>
          <Ionicons
            name={star <= value ? "star" : "star-outline"}
            size={32}
            color={star <= value ? Colors.accent : Colors.textMuted}
          />
        </Pressable>
      ))}
    </View>
  );
}

function ProviderBadge({ provider }: { provider: string }) {
  const colors: Record<string, string> = {
    pollfish: "#FF6B35",
    cint: "#4A90D9",
    lucid: "#7B61FF",
    cpx: "#FF4F00",
    bitlabs: "#6C3FC5",
    internal: Colors.primary,
  };
  const color = colors[provider] || Colors.primary;
  const names: Record<string, string> = {
    pollfish: "Pollfish",
    cint: "Cint",
    lucid: "Lucid",
    cpx: "CPX Research",
    bitlabs: "BitLabs",
    internal: "CashClip",
  };
  return (
    <View style={[styles.providerBadge, { borderColor: color + "40", backgroundColor: color + "12" }]}>
      <View style={[styles.providerDot, { backgroundColor: color }]} />
      <Text style={[styles.providerBadgeText, { color }]}>{names[provider] || provider}</Text>
    </View>
  );
}

function ExternalSurveyCard({ survey, onStart }: { survey: ExternalSurvey; onStart: (s: ExternalSurvey) => void }) {
  return (
    <Pressable
      onPress={() => onStart(survey)}
      style={({ pressed }) => [styles.surveyCard, { opacity: pressed ? 0.9 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] }]}
    >
      <View style={styles.surveyHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.surveyTitle}>{survey.title}</Text>
          <Text style={styles.surveyProvider}>via {survey.providerName}</Text>
        </View>
        <DifficultyBadge difficulty={survey.difficulty} />
      </View>
      <Text style={styles.surveyDesc}>{survey.description}</Text>
      <View style={styles.surveyFooter}>
        <View style={styles.surveyMeta}>
          <Feather name="clock" size={13} color={Colors.textMuted} />
          <Text style={styles.surveyMetaText}>{survey.estimatedMinutes} min</Text>
        </View>
        <View style={styles.surveyMeta}>
          <Feather name="tag" size={13} color={Colors.textMuted} />
          <Text style={styles.surveyMetaText}>{survey.category}</Text>
        </View>
        <ProviderBadge provider={survey.provider} />
        <View style={styles.surveyReward}>
          <Text style={styles.surveyRewardText}>${survey.reward.toFixed(2)}</Text>
        </View>
      </View>
    </Pressable>
  );
}

export default function SurveysScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const [pendingExternalSurvey, setPendingExternalSurvey] = useState<ExternalSurvey | null>(null);
  const [externalSessionToken, setExternalSessionToken] = useState<string | null>(null);
  const [isLaunchingExternal, setIsLaunchingExternal] = useState(false);
  const [isClaimingReward, setIsClaimingReward] = useState(false);
  const [completedExternalIds, setCompletedExternalIds] = useState<Set<string>>(new Set());
  const [successModal, setSuccessModal] = useState<{ amount: number; title: string; subtitle?: string } | null>(null);

  const [fontsLoaded] = useFonts({ Outfit_400Regular, Outfit_600SemiBold, Outfit_700Bold });

  const { data: externalData, isLoading: externalLoading, isError: externalError, refetch: refetchExternal } = useQuery({
    queryKey: ["/api/surveys/available"],
    enabled: true,
    staleTime: 5 * 60 * 1000,
  });

  const startExternalMutation = useMutation({
    mutationFn: async (survey: ExternalSurvey) => {
      const token = await AsyncStorage_getToken();
      const url = new URL("/api/surveys/start", getApiUrl());
      const res = await fetch(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ surveyId: survey.id, provider: survey.provider, estimatedReward: survey.reward, surveyUrl: survey.surveyUrl }),
      });
      if (!res.ok) throw new Error("Failed to start survey session");
      return res.json();
    },
  });

  const completeExternalMutation = useMutation({
    mutationFn: async ({ surveyId, provider, sessionToken, transactionId }: { surveyId: string; provider: string; sessionToken: string; transactionId: string }) => {
      const token = await AsyncStorage_getToken();
      const url = new URL("/api/surveys/complete", getApiUrl());
      const res = await fetch(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ surveyId, provider, sessionToken, transactionId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || "Completion failed");
      }
      return res.json();
    },
    onSuccess: async (data, vars) => {
      const reward = data.reward as number;
      await completeSurvey(vars.surveyId, pendingExternalSurvey?.title || "External Survey");
      setCompletedExternalIds((prev) => new Set([...prev, vars.surveyId]));
      setPendingExternalSurvey(null);
      setExternalSessionToken(null);
      setIsClaimingReward(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSuccessModal({
        amount: Number.isFinite(reward) ? reward : 0,
        title: "Survey Complete!",
        subtitle: "Added to your balance.",
      });
      refetchExternal();
    },
    onError: (err: Error) => {
      setIsClaimingReward(false);
      const msg = err.message || "";
      if (msg.includes("already")) {
        setPendingExternalSurvey(null);
        setExternalSessionToken(null);
        Alert.alert("Already Claimed", "Reward for this survey was already credited to your account.");
      } else {
        Alert.alert("Could Not Verify", "We couldn't confirm your survey completion right now. If you finished, your reward will be credited within 24 hours.");
      }
    },
  });

  const handleStartExternal = useCallback(async (survey: ExternalSurvey) => {
    if (completedExternalIds.has(survey.id)) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPendingExternalSurvey(survey);
  }, [completedExternalIds]);

  const launchExternalSurvey = useCallback(async () => {
    if (!pendingExternalSurvey) return;
    setIsLaunchingExternal(true);
    try {
      const result = await startExternalMutation.mutateAsync(pendingExternalSurvey);
      const sessionTok = result.sessionToken;
      setExternalSessionToken(sessionTok);
      const rawEntryUrl: string = result.surveyEntryUrl || pendingExternalSurvey.surveyUrl;
      let entryUrl: string;
      try {
        const parsed = new URL(rawEntryUrl);
        if (parsed.protocol !== "https:") throw new Error("unsafe scheme");
        entryUrl = rawEntryUrl;
      } catch {
        setIsLaunchingExternal(false);
        Alert.alert("Error", "This survey cannot be opened because the URL is invalid or unsafe. Please try again.");
        return;
      }
      await WebBrowser.openBrowserAsync(entryUrl, {
        toolbarColor: "#0D1B2A",
        controlsColor: "#00C6A0",
        dismissButtonStyle: "done",
      });
      setIsLaunchingExternal(false);

      // All providers credit via S2S webhook — no client-side claim needed.
      // Submitting a client-fabricated transaction ID cannot be verified against
      // provider records and is rejected by the server. Wait for the provider
      // callback to land instead.
      const estReward = pendingExternalSurvey.reward;
      setPendingExternalSurvey(null);
      setExternalSessionToken(null);
      queryClient.invalidateQueries({ queryKey: ["/api/balance"] });
      refetchExternal();
      setSuccessModal({
        amount: Number.isFinite(estReward) ? estReward : 0,
        title: "Survey Submitted!",
        subtitle: "Your reward will appear in your balance within a few minutes — it's credited automatically.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/balance"] });
    } catch (err: any) {
      setIsLaunchingExternal(false);
      setIsClaimingReward(false);
      if (!err?.message?.includes("already") && !err?.message?.includes("expired")) {
        Alert.alert("Error", "Could not launch survey. Please try again.");
      }
    }
  }, [pendingExternalSurvey, queryClient]);

  if (!fontsLoaded) return null;

  const webTopPad = Platform.OS === "web" ? 67 : 0;

  const externalSurveys: ExternalSurvey[] = ((externalData as any)?.surveys || []).filter(
    (s: ExternalSurvey) => !completedExternalIds.has(s.id)
  );
  const providersList: any[] = (externalData as any)?.providers || [];
  const anyProviderConfigured = providersList.some((p) => p.configured);
  const externalTotalReward = externalSurveys.reduce((sum: number, s: ExternalSurvey) => sum + s.reward, 0);

  return (
    <View style={[styles.container, { paddingTop: webTopPad + insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={Colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>{t.surveys.surveys}</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: Platform.OS === "web" ? 34 : 16, paddingHorizontal: 16 }}
      >
        {!anyProviderConfigured ? (
            <View style={styles.noProviderCard}>
              <MaterialCommunityIcons name="connection" size={44} color={Colors.textMuted} />
              <Text style={styles.noProviderTitle}>No Survey Partners Connected</Text>
              <Text style={styles.noProviderText}>
                Connect your survey providers to access higher-paying external surveys ($0.30–$5.00 each). Add your API key to get started.
              </Text>
              <View style={styles.providerList}>
                {[
                  { name: "Pollfish", color: "#FF6B35", env: "POLLFISH_API_KEY", url: "pollfish.com/publisher" },
                  { name: "Cint", color: "#4A90D9", env: "CINT_API_KEY", url: "cint.com/for-publishers" },
                  { name: "Lucid", color: "#7B61FF", env: "LUCID_API_KEY", url: "luc.id/for-suppliers" },
                ].map((p) => (
                  <View key={p.name} style={[styles.providerSetupCard, { borderColor: p.color + "30" }]}>
                    <View style={[styles.providerSetupDot, { backgroundColor: p.color }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.providerSetupName}>{p.name}</Text>
                      <Text style={styles.providerSetupEnv}>Set {p.env} secret</Text>
                    </View>
                    <Feather name="external-link" size={14} color={Colors.textMuted} />
                  </View>
                ))}
              </View>
            </View>
          ) : externalLoading ? (
            <View style={styles.loadingCard}>
              <Chipley pose="think" size={80} />
              <ActivityIndicator color={Colors.primary} size="large" />
              <Text style={styles.loadingText}>Fetching surveys…</Text>
            </View>
          ) : externalError ? (
            <View style={styles.errorCard}>
              <Chipley pose="sad" size={96} />
              <Text style={styles.errorTitle}>Couldn't Load Surveys</Text>
              <Text style={styles.errorText}>Something went wrong while fetching surveys. Check your connection and try again.</Text>
              <Pressable
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); refetchExternal(); }}
                style={({ pressed }) => [styles.retryBtn, { opacity: pressed ? 0.8 : 1 }]}
              >
                <Feather name="refresh-cw" size={16} color={Colors.background} />
                <Text style={styles.retryBtnText}>Try Again</Text>
              </Pressable>
            </View>
          ) : externalSurveys.length === 0 ? (
            <View style={styles.allDoneCard}>
              <Chipley pose="sleep" size={96} />
              <Text style={styles.allDoneTitle}>Surveys Coming Soon</Text>
              <Text style={styles.allDoneText}>We're finishing up with survey availability. New surveys will appear here automatically — check back in a day or two.</Text>
            </View>
          ) : (
            <>
              <LinearGradient colors={["#1A1A2E", "#0D1B2A"]} style={styles.statsCard}>
                <View style={styles.statsRow}>
                  <View style={styles.statsItem}>
                    <MaterialCommunityIcons name="earth" size={22} color="#7B61FF" />
                    <Text style={styles.statsValue}>{externalSurveys.length}</Text>
                    <Text style={styles.statsLabel}>Available</Text>
                  </View>
                  <View style={styles.statsDivider} />
                  <View style={styles.statsItem}>
                    <Feather name="dollar-sign" size={22} color={Colors.accent} />
                    <Text style={styles.statsValue}>${externalTotalReward.toFixed(2)}</Text>
                    <Text style={styles.statsLabel}>Potential</Text>
                  </View>
                  <View style={styles.statsDivider} />
                  <View style={styles.statsItem}>
                    <Feather name="users" size={22} color="#4ECDC4" />
                    <Text style={styles.statsValue}>{providersList.filter((p: any) => p.configured).length}</Text>
                    <Text style={styles.statsLabel}>Partners</Text>
                  </View>
                </View>
              </LinearGradient>

              <View style={styles.infoCard}>
                <Feather name="info" size={16} color={Colors.textSecondary} />
                <Text style={styles.infoText}>
                  These surveys open right here in CashClip. Complete them and tap "I Finished the Survey" to claim your reward.
                </Text>
              </View>

              <Text style={styles.sectionTitle}>Available Surveys</Text>
              {externalSurveys.map((survey) => (
                <ExternalSurveyCard key={survey.id} survey={survey} onStart={handleStartExternal} />
              ))}
            </>
          )}
      </ScrollView>

      <Modal visible={!!pendingExternalSurvey} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHandle} />
            {pendingExternalSurvey && (
              <>
                <View style={styles.modalHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modalTitle}>{pendingExternalSurvey.title}</Text>
                    <ProviderBadge provider={pendingExternalSurvey.provider} />
                  </View>
                  {!externalSessionToken && (
                    <Pressable onPress={() => setPendingExternalSurvey(null)} hitSlop={12}>
                      <Feather name="x" size={24} color={Colors.textSecondary} />
                    </Pressable>
                  )}
                </View>

                <View style={styles.externalInfoBox}>
                  <View style={styles.externalInfoRow}>
                    <Feather name="clock" size={16} color={Colors.textSecondary} />
                    <Text style={styles.externalInfoText}>~{pendingExternalSurvey.estimatedMinutes} minutes</Text>
                  </View>
                  <View style={styles.externalInfoRow}>
                    <Feather name="tag" size={16} color={Colors.textSecondary} />
                    <Text style={styles.externalInfoText}>{pendingExternalSurvey.category}</Text>
                  </View>
                  <View style={styles.externalInfoRow}>
                    <Feather name="dollar-sign" size={16} color={Colors.primary} />
                    <Text style={[styles.externalInfoText, { color: Colors.primary, fontFamily: "Outfit_700Bold" }]}>
                      Earn ${pendingExternalSurvey.reward.toFixed(2)}
                    </Text>
                  </View>
                </View>

                {isClaimingReward ? (
                  <View style={styles.claimingCard}>
                    <ActivityIndicator color={Colors.primary} size="large" />
                    <Text style={styles.claimingText}>Crediting your reward…</Text>
                  </View>
                ) : (
                  <>
                    <Text style={styles.externalInstructionText}>
                      The survey opens right here in CashClip. Complete it fully — your reward is credited automatically when you close the browser.
                    </Text>
                    <Pressable
                      onPress={launchExternalSurvey}
                      disabled={isLaunchingExternal}
                      style={({ pressed }) => [styles.nextBtn, { opacity: pressed || isLaunchingExternal ? 0.7 : 1 }]}
                    >
                      <LinearGradient colors={[Colors.primary, Colors.primaryDark]} style={styles.nextBtnGradient}>
                        {isLaunchingExternal
                          ? <ActivityIndicator color={Colors.background} size="small" />
                          : <>
                              <Feather name="external-link" size={18} color={Colors.background} />
                              <Text style={styles.nextBtnText}>Start Survey</Text>
                            </>
                        }
                      </LinearGradient>
                    </Pressable>
                    {!isLaunchingExternal && (
                      <Pressable
                        onPress={() => { setPendingExternalSurvey(null); setExternalSessionToken(null); }}
                        style={styles.cancelBtn}
                      >
                        <Text style={styles.cancelBtnText}>Cancel</Text>
                      </Pressable>
                    )}
                  </>
                )}
              </>
            )}
          </View>
        </View>
      </Modal>

      <RewardSuccessModal
        visible={!!successModal}
        amount={successModal?.amount ?? 0}
        title={successModal?.title}
        subtitle={successModal?.subtitle}
        onClose={() => setSuccessModal(null)}
      />
    </View>
  );
}

async function AsyncStorage_getToken(): Promise<string | null> {
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
  tabBar: {
    flexDirection: "row", paddingHorizontal: 16, paddingBottom: 12, gap: 8,
  },
  tabBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 10, borderRadius: 12,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
  },
  tabBtnActive: {
    backgroundColor: Colors.primary + "15", borderColor: Colors.primary,
  },
  tabBtnText: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: Colors.textMuted },
  tabBtnTextActive: { color: Colors.primary },
  liveIndicator: {
    width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.primary,
  },
  statsCard: { borderRadius: 16, padding: 20, marginBottom: 12, borderWidth: 1, borderColor: Colors.border },
  statsRow: { flexDirection: "row", alignItems: "center" },
  statsItem: { flex: 1, alignItems: "center", gap: 4 },
  statsValue: { fontFamily: "Outfit_700Bold", fontSize: 20, color: Colors.text },
  statsLabel: { fontFamily: "Outfit_400Regular", fontSize: 11, color: Colors.textMuted },
  statsDivider: { width: 1, height: 36, backgroundColor: Colors.border },
  infoCard: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    backgroundColor: Colors.surface, borderRadius: 12, padding: 14, marginBottom: 16,
    borderWidth: 1, borderColor: Colors.border,
  },
  infoText: { fontFamily: "Outfit_400Regular", fontSize: 13, color: Colors.textSecondary, flex: 1, lineHeight: 18 },
  sectionTitle: { fontFamily: "Outfit_700Bold", fontSize: 18, color: Colors.text, marginBottom: 12, marginTop: 4 },
  surveyCard: {
    backgroundColor: Colors.surface, borderRadius: 14, padding: 16, marginBottom: 10,
    borderWidth: 1, borderColor: Colors.border,
  },
  surveyCardCompleted: { opacity: 0.6 },
  surveyHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 6 },
  surveyTitle: { fontFamily: "Outfit_700Bold", fontSize: 16, color: Colors.text },
  surveyProvider: { fontFamily: "Outfit_400Regular", fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  surveyDesc: { fontFamily: "Outfit_400Regular", fontSize: 13, color: Colors.textSecondary, marginBottom: 12, lineHeight: 18 },
  surveyFooter: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  surveyMeta: { flexDirection: "row", alignItems: "center", gap: 4 },
  surveyMetaText: { fontFamily: "Outfit_400Regular", fontSize: 12, color: Colors.textMuted },
  surveyReward: {
    marginLeft: "auto",
    backgroundColor: "rgba(0,230,118,0.1)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4,
  },
  surveyRewardText: { fontFamily: "Outfit_700Bold", fontSize: 14, color: Colors.primary },
  diffBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  diffBadgeText: { fontFamily: "Outfit_600SemiBold", fontSize: 11 },
  completedBadge: { flexDirection: "row", alignItems: "center", gap: 4 },
  completedBadgeText: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: Colors.primary },
  errorCard: { alignItems: "center", paddingVertical: 40, gap: 10 },
  errorTitle: { fontFamily: "Outfit_700Bold", fontSize: 18, color: Colors.text },
  errorText: { fontFamily: "Outfit_400Regular", fontSize: 13, color: Colors.textMuted, textAlign: "center" },
  retryBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: Colors.primary, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12, marginTop: 6,
  },
  retryBtnText: { fontFamily: "Outfit_700Bold", fontSize: 14, color: Colors.background },
  allDoneCard: { alignItems: "center", paddingVertical: 40, gap: 8 },
  allDoneTitle: { fontFamily: "Outfit_700Bold", fontSize: 18, color: Colors.text },
  allDoneText: { fontFamily: "Outfit_400Regular", fontSize: 13, color: Colors.textMuted, textAlign: "center" },
  modalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: "flex-end" },
  modalContent: {
    backgroundColor: Colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingBottom: Platform.OS === "web" ? 34 : 32,
  },
  modalHandle: { width: 36, height: 4, backgroundColor: Colors.border, borderRadius: 2, alignSelf: "center", marginTop: 12, marginBottom: 16 },
  modalHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 },
  modalTitle: { fontFamily: "Outfit_700Bold", fontSize: 20, color: Colors.text },
  modalProvider: { fontFamily: "Outfit_400Regular", fontSize: 13, color: Colors.textMuted, marginTop: 2 },
  progressContainer: { marginBottom: 24 },
  progressBarBg: { height: 6, backgroundColor: Colors.surfaceHighlight, borderRadius: 3, overflow: "hidden", marginBottom: 6 },
  progressBarFill: { height: "100%", backgroundColor: Colors.primary, borderRadius: 3 },
  progressText: { fontFamily: "Outfit_400Regular", fontSize: 12, color: Colors.textMuted, textAlign: "right" },
  questionContainer: { marginBottom: 24, minHeight: 200 },
  questionText: { fontFamily: "Outfit_600SemiBold", fontSize: 18, color: Colors.text, marginBottom: 20, lineHeight: 26 },
  optionsContainer: { gap: 10 },
  optionBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: Colors.surface, borderRadius: 12, padding: 16,
    borderWidth: 1.5, borderColor: Colors.border,
  },
  optionBtnSelected: { borderColor: Colors.primary, backgroundColor: "rgba(0,230,118,0.05)" },
  optionText: { fontFamily: "Outfit_600SemiBold", fontSize: 15, color: Colors.text, flex: 1 },
  optionTextSelected: { color: Colors.primary },
  optionRadio: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2,
    borderColor: Colors.border, alignItems: "center", justifyContent: "center",
  },
  optionRadioSelected: { borderColor: Colors.primary },
  optionRadioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: Colors.primary },
  yesNoContainer: { flexDirection: "row", gap: 12 },
  yesNoBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: Colors.surface, borderRadius: 14, paddingVertical: 18,
    borderWidth: 1.5, borderColor: Colors.border,
  },
  yesNoBtnYes: { borderColor: Colors.primary, backgroundColor: Colors.primary },
  yesNoBtnNo: { borderColor: Colors.error, backgroundColor: Colors.error },
  yesNoText: { fontFamily: "Outfit_700Bold", fontSize: 16, color: Colors.textSecondary },
  sponsorsSection: { marginBottom: 16 },
  sponsorsLabel: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: Colors.textMuted, marginBottom: 8 },
  sponsorsRow: { gap: 8 },
  sponsorChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: Colors.surface, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1,
  },
  sponsorDot: { width: 8, height: 8, borderRadius: 4 },
  sponsorName: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: Colors.text },
  ratingRow: { flexDirection: "row", justifyContent: "center", gap: 12, paddingVertical: 16 },
  nextBtn: { marginTop: 8 },
  nextBtnGradient: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 16, borderRadius: 14,
  },
  nextBtnText: { fontFamily: "Outfit_700Bold", fontSize: 16, color: Colors.background },
  providerBadge: {
    flexDirection: "row", alignItems: "center", gap: 5,
    borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, marginTop: 4,
  },
  providerDot: { width: 6, height: 6, borderRadius: 3 },
  providerBadgeText: { fontFamily: "Outfit_600SemiBold", fontSize: 11 },
  noProviderCard: {
    alignItems: "center", paddingVertical: 32, paddingHorizontal: 16, gap: 12,
  },
  noProviderTitle: { fontFamily: "Outfit_700Bold", fontSize: 18, color: Colors.text, textAlign: "center" },
  noProviderText: { fontFamily: "Outfit_400Regular", fontSize: 14, color: Colors.textSecondary, textAlign: "center", lineHeight: 20 },
  providerList: { width: "100%", gap: 8, marginTop: 8 },
  providerSetupCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: Colors.surface, borderRadius: 12, padding: 14,
    borderWidth: 1,
  },
  providerSetupDot: { width: 10, height: 10, borderRadius: 5 },
  providerSetupName: { fontFamily: "Outfit_700Bold", fontSize: 14, color: Colors.text },
  providerSetupEnv: { fontFamily: "Outfit_400Regular", fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  loadingCard: { alignItems: "center", paddingVertical: 60, gap: 16 },
  loadingText: { fontFamily: "Outfit_400Regular", fontSize: 14, color: Colors.textMuted },
  externalInfoBox: {
    backgroundColor: Colors.surface, borderRadius: 12, padding: 16, marginBottom: 16,
    borderWidth: 1, borderColor: Colors.border, gap: 10,
  },
  externalInfoRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  externalInfoText: { fontFamily: "Outfit_400Regular", fontSize: 14, color: Colors.textSecondary },
  externalInstructionText: {
    fontFamily: "Outfit_400Regular", fontSize: 13, color: Colors.textSecondary,
    lineHeight: 20, marginBottom: 16, textAlign: "center",
  },
  claimingCard: {
    alignItems: "center", justifyContent: "center", gap: 16,
    paddingVertical: 32,
  },
  claimingText: {
    fontFamily: "Outfit_600SemiBold", fontSize: 15, color: Colors.textSecondary,
  },
  cancelBtn: { alignItems: "center", paddingVertical: 14, marginTop: 8 },
  cancelBtnText: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: Colors.textMuted },
});
