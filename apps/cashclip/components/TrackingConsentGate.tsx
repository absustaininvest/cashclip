import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ScrollView,
  ActivityIndicator,
  Alert,
  AppState,
  AppStateStatus,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { requestAdsConsent } from "@/lib/admob";
import { getATTStatus, requestATT } from "@/lib/att";
import { useLanguage } from "@/lib/LanguageContext";
import * as Linking from "expo-linking";

// Only terms acceptance is persisted — the disclosure screen shows every launch.
// Lives in AsyncStorage (wiped on app deletion) so every fresh install triggers
// the full consent flow regardless of any Keychain state.
const TERMS_KEY = "terms_done_v1";

// Legacy AsyncStorage keys from previous consent implementations.
// Promoted to TERMS_KEY if found, then deleted.
const LEGACY_AS_KEYS = [
  "consent_done_v3",
  "consent_fully_done_v2",
  "tracking_consent_dismissed_v1",
] as const;

/**
 * One-time migration: promote any legacy consent key to TERMS_KEY then delete
 * the old keys. Deletion is gated on a successful TERMS_KEY write so the
 * migration retries on the next launch if the write fails. Non-fatal.
 */
async function migrateLegacyConsent(): Promise<void> {
  try {
    const values = await Promise.all(
      LEGACY_AS_KEYS.map((k) => AsyncStorage.getItem(k)),
    );
    if (values.some((v) => v !== null)) {
      const alreadySet = await AsyncStorage.getItem(TERMS_KEY);
      if (!alreadySet) {
        await AsyncStorage.setItem(TERMS_KEY, "1");
      }
      await AsyncStorage.multiRemove([...LEGACY_AS_KEYS]);
    }
  } catch {
    // Non-fatal — legacy keys remain for retry next launch.
  }
}

function openTrackingSettings() {
  Linking.openURL("App-Prefs:Privacy&path=TRACKING_USAGE").catch(() =>
    Linking.openURL("app-settings:").catch(() => {})
  );
}

type Step = "checking" | "disclosures" | "terms" | "done";

interface Props {
  children: React.ReactNode;
  onConsentDone?: () => void;
  onConsentRevoked?: () => void;
}

export function TrackingConsentGate({ children, onConsentDone, onConsentRevoked }: Props) {
  const [step, setStep] = useState<Step>("checking");
  const [disclosuresBusy, setDisclosuresBusy] = useState(false);
  const { t } = useLanguage();
  const c = t.consent;

  // True once consent is granted — guards the revocation AppState listener so
  // it only fires onConsentRevoked when there was something to revoke.
  const consentGrantedRef = useRef(false);

  // Set to true when the user taps any "Open Settings" link on the disclosures
  // screen. Guards the return-from-settings AppState listener so it only
  // auto-proceeds when the user intentionally navigated to iOS Settings.
  const didOpenSettingsRef = useRef(false);

  // Prevents concurrent calls to acceptDisclosures() — rapid taps or an
  // AppState event racing the button would otherwise queue multiple ATT dialogs.
  const processingRef = useRef(false);

  function finish() {
    requestAdsConsent().catch(() => {});
    consentGrantedRef.current = true;
    onConsentDone?.();
    setStep("done");
  }

  function goToSettings() {
    didOpenSettingsRef.current = true;
    openTrackingSettings();
  }

  // Detect ATT revocation: user went to iOS Settings and toggled tracking OFF
  // after already granting consent. Fire onConsentRevoked so callers can tear
  // down tracking-dependent callbacks (e.g. ad-fill handler).
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next !== "active" || !consentGrantedRef.current) return;
      getATTStatus().then((status) => {
        if (status === "denied" || status === "restricted") {
          consentGrantedRef.current = false;
          onConsentRevoked?.();
        }
      }).catch(() => {});
    });
    return () => sub.remove();
  }, [onConsentRevoked]);

  // Detect return from Settings while on the disclosures screen: if the user
  // toggled tracking ON (or made any ATT decision), auto-proceed so they never
  // have to tap again after coming back from Settings.
  useEffect(() => {
    if (Platform.OS !== "ios" || step !== "disclosures") return;
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next !== "active" || !didOpenSettingsRef.current) return;
      didOpenSettingsRef.current = false;
      getATTStatus().then((status) => {
        if (status === "authorized" || status === "denied" || status === "restricted") {
          acceptDisclosures();
        }
      }).catch(() => {});
    });
    return () => sub.remove();
  }, [step]);

  // Initial gate: Android skips straight through (no ATT); iOS shows disclosures.
  useEffect(() => {
    if (Platform.OS !== "ios") {
      migrateLegacyConsent().finally(() => finish());
      return;
    }
    migrateLegacyConsent().finally(() => setStep("disclosures"));
  }, []);

  async function acceptDisclosures() {
    if (processingRef.current) return;
    processingRef.current = true;
    setDisclosuresBusy(true);
    try {
      const status = await getATTStatus();
      if (status === "undetermined") {
        await requestATT();
        // Give iOS a moment to commit the ATT decision before reading it back.
        await new Promise<void>((r) => setTimeout(r, 600));
      }
      const termsDone = await AsyncStorage.getItem(TERMS_KEY);
      if (termsDone) {
        finish();
      } else {
        setStep("terms");
      }
    } finally {
      processingRef.current = false;
      setDisclosuresBusy(false);
    }
  }

  function declineDisclosures() {
    Alert.alert(c.declineTitle, c.declineMessage, [
      { text: c.openSettings, onPress: goToSettings },
      { text: c.continueWithout, style: "cancel", onPress: finish },
    ]);
  }

  async function acceptTerms() {
    await AsyncStorage.setItem(TERMS_KEY, "1").catch(() => {});
    finish();
  }

  if (step === "checking") {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (step === "disclosures") {
    return (
      <View style={styles.screen}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.iconWrap}>
            <Ionicons name="shield-checkmark-outline" size={52} color={Colors.primary} />
          </View>

          <Text style={styles.title}>{c.title}</Text>
          <Text style={styles.subtitle}>{c.subtitle}</Text>

          <View style={styles.card}>
            <View style={styles.cardRow}>
              <Ionicons name="bar-chart-outline" size={20} color={Colors.primary} />
              <Text style={styles.cardTitle}>{c.card1Title}</Text>
            </View>
            <Text style={styles.cardBody}>{c.card1Body}</Text>
          </View>

          <View style={styles.card}>
            <View style={styles.cardRow}>
              <Ionicons name="cash-outline" size={20} color={Colors.primary} />
              <Text style={styles.cardTitle}>{c.card2Title}</Text>
            </View>
            <Text style={styles.cardBody}>{c.card2Body}</Text>
          </View>

          <View style={styles.card}>
            <View style={styles.cardRow}>
              <Ionicons name="settings-outline" size={20} color={Colors.primary} />
              <Text style={styles.cardTitle}>{c.card3Title}</Text>
            </View>
            <Text style={styles.cardBody}>{c.card3Body}</Text>
            <TouchableOpacity style={styles.settingsLink} onPress={goToSettings} activeOpacity={0.7}>
              <Ionicons name="open-outline" size={14} color={Colors.primary} />
              <Text style={styles.settingsLinkText}>{c.openSettings}</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.legal}>{c.legal}</Text>
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.primaryBtn, disclosuresBusy && styles.primaryBtnDisabled]}
            onPress={acceptDisclosures}
            activeOpacity={0.85}
            disabled={disclosuresBusy}
          >
            {disclosuresBusy
              ? <ActivityIndicator size="small" color="#000" style={{ marginRight: 8 }} />
              : <Ionicons name="checkmark-circle-outline" size={20} color="#000" style={{ marginRight: 8 }} />
            }
            <Text style={styles.primaryBtnText}>{c.continueBtn}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={declineDisclosures} activeOpacity={0.7}>
            <Text style={styles.secondaryBtnText}>{c.declineBtn}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (step === "terms") {
    return (
      <View style={styles.screen}>
        <View style={styles.termsHeader}>
          <Text style={styles.termsTitle}>{c.termsTitle}</Text>
          <Text style={styles.termsSub}>{c.termsSub}</Text>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.termsContent} showsVerticalScrollIndicator>
          <Text style={styles.sectionTitle}>Terms of Service</Text>
          <Text style={styles.termsBody}>
            <Text style={styles.bold}>Eligibility. </Text>
            You must be at least 18 years old and a legal resident of a supported country
            to earn and withdraw funds. One account per person; creating multiple accounts
            to exploit rewards is prohibited and results in permanent suspension.
            {"\n\n"}
            <Text style={styles.bold}>Earning Rules. </Text>
            Rewards are credited when CashClip receives verified confirmation from our ad
            and survey partners. Client-side claims without server verification are not
            credited. Fraudulent activity — including VPNs to spoof location, bot usage,
            or automated clicks — results in balance forfeiture and account termination.
            {"\n\n"}
            <Text style={styles.bold}>Withdrawals. </Text>
            Minimum withdrawal is $3.00 via PayPal. New accounts are subject to a 3-day
            hold on the first withdrawal. CashClip reviews transactions for fraud before
            processing. Withdrawals may take up to 5 business days.
            {"\n\n"}
            <Text style={styles.bold}>Account Termination. </Text>
            CashClip may suspend or terminate accounts at its sole discretion for
            violation of these terms, fraudulent activity, or platform abuse. Forfeited
            balances from terminated accounts are not reimbursable.
            {"\n\n"}
            <Text style={styles.bold}>Modifications. </Text>
            CashClip may update these Terms at any time. Continued use of the app
            constitutes acceptance of the revised Terms.
          </Text>

          <View style={styles.divider} />

          <Text style={styles.sectionTitle}>Privacy Policy</Text>
          <Text style={styles.termsBody}>
            <Text style={styles.bold}>What we collect. </Text>
            CashClip collects your username, email address, device identifiers (IDFA when
            permitted), IP address, and in-app activity (surveys completed, ads watched,
            offers redeemed, withdrawal history).
            {"\n\n"}
            <Text style={styles.bold}>How we use it. </Text>
            Your data is used to operate your account, credit earnings, verify payouts,
            detect fraud, and deliver personalized advertising through our ad network
            partners (Google AdMob, Unity Ads, ironSource, Pangle, Chartboost, and
            survey/offerwall providers).
            {"\n\n"}
            <Text style={styles.bold}>Advertising partners. </Text>
            When you allow tracking, your IDFA is shared with Google AdMob and our mediation
            partners to personalize ads and measure campaign performance. No name, phone
            number, or email is shared with advertisers.
            {"\n\n"}
            <Text style={styles.bold}>Data retention. </Text>
            Account data is retained while your account is active. You may request
            deletion by contacting support@cash-clip.app. Fraud-related records may be
            retained longer as required by law.
            {"\n\n"}
            <Text style={styles.bold}>Security. </Text>
            Passwords are hashed; tokens are signed and expire. PayPal payouts are
            processed with two-factor verification. We do not store payment credentials
            on our servers.
            {"\n\n"}
            <Text style={styles.bold}>Contact. </Text>
            Questions or deletion requests: support@cash-clip.app
          </Text>

          <View style={{ height: 24 }} />
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity style={styles.primaryBtn} onPress={acceptTerms} activeOpacity={0.85}>
            <Text style={styles.primaryBtnText}>{c.acceptBtn}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#0A0A0F",
  },
  center: {
    flex: 1,
    backgroundColor: "#0A0A0F",
    alignItems: "center",
    justifyContent: "center",
  },
  scrollContent: {
    paddingTop: 64,
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  iconWrap: {
    alignItems: "center",
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontFamily: "Outfit_700Bold",
    color: "#FFFFFF",
    textAlign: "center",
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 15,
    fontFamily: "Outfit_400Regular",
    color: "#A0A0B0",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 28,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
  },
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  cardTitle: {
    fontSize: 15,
    fontFamily: "Outfit_600SemiBold",
    color: "#0A0A0F",
  },
  cardBody: {
    fontSize: 13,
    fontFamily: "Outfit_400Regular",
    color: "#3A3A4A",
    lineHeight: 20,
  },
  settingsLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 10,
  },
  settingsLinkText: {
    fontSize: 13,
    fontFamily: "Outfit_600SemiBold",
    color: Colors.primary,
  },
  legal: {
    fontSize: 12,
    fontFamily: "Outfit_400Regular",
    color: "#606070",
    textAlign: "center",
    lineHeight: 18,
    marginTop: 20,
    paddingHorizontal: 8,
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 48,
    paddingTop: 12,
    backgroundColor: "#0A0A0F",
    gap: 12,
  },
  primaryBtn: {
    backgroundColor: Colors.primary,
    borderRadius: Colors.radius.lg,
    paddingVertical: 18,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
  },
  primaryBtnDisabled: {
    opacity: 0.6,
  },
  primaryBtnText: {
    fontSize: 17,
    fontFamily: "Outfit_700Bold",
    color: "#000000",
  },
  secondaryBtn: {
    paddingVertical: 14,
    alignItems: "center",
  },
  secondaryBtnText: {
    fontSize: 15,
    fontFamily: "Outfit_600SemiBold",
    color: "#606070",
  },
  termsHeader: {
    paddingTop: 64,
    paddingHorizontal: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#1E1E2E",
  },
  termsTitle: {
    fontSize: 24,
    fontFamily: "Outfit_700Bold",
    color: "#FFFFFF",
    marginBottom: 4,
  },
  termsSub: {
    fontSize: 13,
    fontFamily: "Outfit_400Regular",
    color: "#606070",
  },
  termsContent: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 16,
  },
  sectionTitle: {
    fontSize: 17,
    fontFamily: "Outfit_700Bold",
    color: "#FFFFFF",
    marginBottom: 12,
  },
  termsBody: {
    fontSize: 13,
    fontFamily: "Outfit_400Regular",
    color: "#A0A0B0",
    lineHeight: 21,
  },
  bold: {
    fontFamily: "Outfit_600SemiBold",
    color: "#CCCCCC",
  },
  divider: {
    height: 1,
    backgroundColor: "#1E1E2E",
    marginVertical: 24,
  },
});
