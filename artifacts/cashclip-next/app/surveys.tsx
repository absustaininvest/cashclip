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
import { completeSurvey } from "@/lib/storage";
import { getApiUrl } from "@/lib/query-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";

// Only CPX Research and BitLabs are active, verified survey partners.
// Any provider returned by the server outside this list is silently excluded
// from the UI — no dead placeholder cards, no internal test ranges.
const ACTIVE_PROVIDERS: ReadonlySet<string> = new Set(["cpx", "bitlabs"]);

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

async function getAuthToken(): Promise<string | null> {
  try {
    const { secureGet } = require("@/lib/secure-store");
    return await secureGet("cashclip_auth_token");
  } catch {
    return null;
  }
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
    cpx: "#FF4F00",
    bitlabs: "#6C3FC5",
  };
  const color = colors[provider] || Colors.primary;
  const names: Record<string, string> = {
    cpx: "CPX Research",
    bitlabs: "BitLabs",
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

function formatProviderList(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

export default function SurveysScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const [pendingExternalSurvey, setPendingExternalSurvey] = useState<ExternalSurvey | null>(null);
  const [isLaunchingExternal, setIsLaunchingExternal] = useState(false);
  const [completedExternalIds, setCompletedExternalIds] = useState<Set<string>>(new Set());
  const [successModal, setSuccessModal] = useState<{ amount: number; title: string; subtitle?: string } | null>(null);

  const [fontsLoaded] = useFonts({ Outfit_400Regular, Outfit_600SemiBold, Outfit_700Bold });

  const { data: externalData, isLoading: externalLoading, isError: externalError, refetch: refetchExternal } = useQuery({
    queryKey: ["/api/surveys/available"],
    enabled: true,
    staleTime: 5 * 60 * 1000,
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
      const token = await getAuthToken();
      const url = new URL("/api/surveys/start", getApiUrl());
      const res = await fetch(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          surveyId: pendingExternalSurvey.id,
          provider: pendingExternalSurvey.provider,
          estimatedReward: pendingExternalSurvey.reward,
          surveyUrl: pendingExternalSurvey.surveyUrl,
        }),
      });
      if (!res.ok) throw new Error("Failed to start survey session");
      const result = await res.json();

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

      await WebBrowser.openAuthSessionAsync(entryUrl, "cashclip://surveys");
      setIsLaunchingExternal(false);

      // All providers credit via S2S webhook — no client-side claim needed.
      const estReward = pendingExternalSurvey.reward;
      const surveyId = pendingExternalSurvey.id;
      const surveyTitle = pendingExternalSurvey.title;
      setPendingExternalSurvey(null);
      setCompletedExternalIds((prev) => new Set([...prev, surveyId]));
      await completeSurvey(surveyId, surveyTitle);
      queryClient.invalidateQueries({ queryKey: ["/api/balance"] });
      refetchExternal();
      setSuccessModal({
        amount: Number.isFinite(estReward) ? estReward : 0,
        title: "Survey Submitted!",
        subtitle: "Your reward will appear in your balance within a few minutes — it's credited automatically.",
      });
    } catch (err: any) {
      setIsLaunchingExternal(false);
      if (!err?.message?.includes("already") && !err?.message?.includes("expired")) {
        Alert.alert("Error", "Could not launch survey. Please try again.");
      }
    }
  }, [pendingExternalSurvey, queryClient, refetchExternal]);

  if (!fontsLoaded) return null;

  const webTopPad = Platform.OS === "web" ? 67 : 0;

  // Filter to only active, verified providers
  const allSurveys: ExternalSurvey[] = ((externalData as any)?.surveys || []).filter(
    (s: ExternalSurvey) => ACTIVE_PROVIDERS.has(s.provider)
  );
  const externalSurveys = allSurveys.filter((s) => !completedExternalIds.has(s.id));
  const providersList: any[] = ((externalData as any)?.providers || []).filter(
    (p: any) => ACTIVE_PROVIDERS.has(p.id ?? p.provider ?? "")
  );
  const anyProviderConfigured = providersList.some((p) => p.configured);
  const degradedProviders: string[] = ((externalData as any)?.degradedProviders || []).filter(
    (name: string) => {
      const lower = name.toLowerCase();
      return lower.includes("cpx") || lower.includes("bitlabs");
    }
  );
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
          <View style={styles.emptyCard}>
            <Chipley pose="sleep" size={96} />
            <Text style={styles.emptyTitle}>Surveys Coming Soon</Text>
            <Text style={styles.emptyText}>
              Survey partners are being set up. New surveys will appear here automatically — check back soon.
            </Text>
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
          <View style={styles.emptyCard}>
            <Chipley pose="sleep" size={96} />
            {degradedProviders.length > 0 && degradedProviders.length === providersList.filter((p) => p.configured).length ? (
              <>
                <Text style={styles.emptyTitle}>Surveys Temporarily Unavailable</Text>
                <Text style={styles.emptyText}>
                  {formatProviderList(degradedProviders)} {degradedProviders.length === 1 ? "is" : "are"} temporarily unavailable. Surveys will reappear automatically once {degradedProviders.length === 1 ? "it recovers" : "they recover"}.
                </Text>
                <Pressable
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); refetchExternal(); }}
                  style={({ pressed }) => [styles.retryBtn, { opacity: pressed ? 0.8 : 1, marginTop: 12 }]}
                >
                  <Feather name="refresh-cw" size={16} color={Colors.background} />
                  <Text style={styles.retryBtnText}>Check Again</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.emptyTitle}>No Surveys Right Now</Text>
                <Text style={styles.emptyText}>New surveys from CPX Research and BitLabs will appear here automatically. Check back soon.</Text>
                {degradedProviders.length > 0 && (
                  <View style={[styles.degradedBanner, { marginTop: 12 }]}>
                    <Feather name="alert-triangle" size={15} color="#F5A623" />
                    <Text style={styles.degradedBannerText}>
                      {formatProviderList(degradedProviders)} {degradedProviders.length === 1 ? "is" : "are"} temporarily unavailable, which may be reducing the number of surveys right now.
                    </Text>
                  </View>
                )}
              </>
            )}
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

            {degradedProviders.length > 0 && (
              <View style={styles.degradedBanner}>
                <Feather name="alert-triangle" size={15} color="#F5A623" />
                <Text style={styles.degradedBannerText}>
                  {formatProviderList(degradedProviders)} {degradedProviders.length === 1 ? "is" : "are"} temporarily unavailable. The surveys shown below are still active.
                </Text>
              </View>
            )}

            <View style={styles.infoCard}>
              <Feather name="info" size={16} color={Colors.textSecondary} />
              <Text style={styles.infoText}>
                These surveys open right here in CashClip. Your reward is credited automatically when you complete them.
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
                  {!isLaunchingExternal && (
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
                    onPress={() => setPendingExternalSurvey(null)}
                    style={styles.cancelBtn}
                  >
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </Pressable>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 14,
  },
  backBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontFamily: "Outfit_700Bold", color: Colors.text },

  emptyCard: {
    alignItems: "center", paddingVertical: 48, paddingHorizontal: 24,
    backgroundColor: Colors.surface, borderRadius: 16, marginTop: 16,
  },
  emptyTitle: { fontSize: 18, fontFamily: "Outfit_700Bold", color: Colors.text, marginTop: 16, textAlign: "center" },
  emptyText: { fontSize: 14, fontFamily: "Outfit_400Regular", color: Colors.textSecondary, marginTop: 8, textAlign: "center", lineHeight: 20 },

  loadingCard: { alignItems: "center", paddingVertical: 48, gap: 16 },
  loadingText: { fontSize: 15, fontFamily: "Outfit_400Regular", color: Colors.textSecondary },

  errorCard: { alignItems: "center", paddingVertical: 48, paddingHorizontal: 24, gap: 12 },
  errorTitle: { fontSize: 18, fontFamily: "Outfit_700Bold", color: Colors.text },
  errorText: { fontSize: 14, fontFamily: "Outfit_400Regular", color: Colors.textSecondary, textAlign: "center", lineHeight: 20 },

  retryBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: Colors.primary, paddingVertical: 10, paddingHorizontal: 20,
    borderRadius: 20,
  },
  retryBtnText: { fontSize: 14, fontFamily: "Outfit_600SemiBold", color: Colors.background },

  statsCard: { borderRadius: 16, padding: 20, marginBottom: 12 },
  statsRow: { flexDirection: "row", alignItems: "center" },
  statsItem: { flex: 1, alignItems: "center", gap: 4 },
  statsValue: { fontSize: 20, fontFamily: "Outfit_700Bold", color: Colors.text },
  statsLabel: { fontSize: 11, fontFamily: "Outfit_400Regular", color: Colors.textMuted },
  statsDivider: { width: 1, height: 40, backgroundColor: Colors.border },

  degradedBanner: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    backgroundColor: "#F5A62318", borderRadius: 10, padding: 12, marginBottom: 12,
  },
  degradedBannerText: { flex: 1, fontSize: 13, fontFamily: "Outfit_400Regular", color: "#F5A623", lineHeight: 18 },

  infoCard: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    backgroundColor: Colors.surface, borderRadius: 10, padding: 12, marginBottom: 16,
  },
  infoText: { flex: 1, fontSize: 13, fontFamily: "Outfit_400Regular", color: Colors.textSecondary, lineHeight: 18 },

  sectionTitle: { fontSize: 16, fontFamily: "Outfit_700Bold", color: Colors.text, marginBottom: 10 },

  surveyCard: {
    backgroundColor: Colors.surface, borderRadius: 14, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: Colors.border,
  },
  surveyHeader: { flexDirection: "row", alignItems: "flex-start", marginBottom: 8, gap: 8 },
  surveyTitle: { fontSize: 15, fontFamily: "Outfit_600SemiBold", color: Colors.text, marginBottom: 2 },
  surveyProvider: { fontSize: 12, fontFamily: "Outfit_400Regular", color: Colors.textMuted },
  surveyDesc: { fontSize: 13, fontFamily: "Outfit_400Regular", color: Colors.textSecondary, lineHeight: 18, marginBottom: 12 },
  surveyFooter: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  surveyMeta: { flexDirection: "row", alignItems: "center", gap: 4 },
  surveyMetaText: { fontSize: 12, fontFamily: "Outfit_400Regular", color: Colors.textMuted },
  surveyReward: {
    marginLeft: "auto" as any, backgroundColor: Colors.primary + "18",
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20,
  },
  surveyRewardText: { fontSize: 14, fontFamily: "Outfit_700Bold", color: Colors.primary },

  diffBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  diffBadgeText: { fontSize: 11, fontFamily: "Outfit_600SemiBold" },

  providerBadge: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1,
  },
  providerDot: { width: 6, height: 6, borderRadius: 3 },
  providerBadgeText: { fontSize: 11, fontFamily: "Outfit_600SemiBold" },

  ratingRow: { flexDirection: "row", gap: 8, justifyContent: "center", paddingVertical: 8 },

  modalOverlay: {
    flex: 1, justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  modalContent: {
    backgroundColor: Colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 40,
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: Colors.border, alignSelf: "center", marginBottom: 20,
  },
  modalHeader: { flexDirection: "row", alignItems: "flex-start", marginBottom: 16, gap: 12 },
  modalTitle: { fontSize: 17, fontFamily: "Outfit_700Bold", color: Colors.text, marginBottom: 6 },

  externalInfoBox: {
    backgroundColor: Colors.background, borderRadius: 12, padding: 14, marginBottom: 16, gap: 10,
  },
  externalInfoRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  externalInfoText: { fontSize: 14, fontFamily: "Outfit_400Regular", color: Colors.textSecondary },

  externalInstructionText: {
    fontSize: 13, fontFamily: "Outfit_400Regular", color: Colors.textSecondary,
    lineHeight: 18, marginBottom: 16, textAlign: "center",
  },

  nextBtn: { borderRadius: 14, overflow: "hidden", marginBottom: 10 },
  nextBtnGradient: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    paddingVertical: 14, gap: 8,
  },
  nextBtnText: { fontSize: 16, fontFamily: "Outfit_700Bold", color: Colors.background },

  cancelBtn: { alignItems: "center", paddingVertical: 10 },
  cancelBtnText: { fontSize: 14, fontFamily: "Outfit_400Regular", color: Colors.textMuted },
});
