import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ScrollView,
  Linking,
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

// Only the terms acceptance is persisted — the disclosure screen shows every launch.
const TERMS_KEY = "terms_done_v1";

// Legacy AsyncStorage keys from previous consent implementations.
// These are promoted to SecureStore (TERMS_KEY) if present, then removed.
const LEGACY_AS_KEYS = [
  "consent_done_v3",
  "consent_fully_done_v2",
  "tracking_consent_dismissed_v1",
] as const;

/**
 * One-time migration: read stale consent keys from AsyncStorage and promote to
 * TERMS_KEY (also AsyncStorage) if not already set, then delete the old keys.
 *
 * Deletion is gated on a successful TERMS_KEY write so the migration retries
 * on the next launch if the write fails. When TERMS_KEY is already set no
 * write is needed and deletion always proceeds.
 *
 * Non-fatal — a failure here does not block the consent flow.
 * TERMS_KEY lives in AsyncStorage (wiped on app deletion) so every fresh
 * install triggers the full terms flow regardless of Keychain state.
 */
async function migrateLegacyConsent(): Promise<void> {
  try {
    const values = await Promise.all(
      LEGACY_AS_KEYS.map((k) => AsyncStorage.getItem(k)),
    );
    const anyFound = values.some((v) => v !== null);
    if (anyFound) {
      const alreadySet = await AsyncStorage.getItem(TERMS_KEY);
      if (!alreadySet) {
        await AsyncStorage.setItem(TERMS_KEY, "1");
      }
      await AsyncStorage.multiRemove([...LEGACY_AS_KEYS]);
    }
  } catch {
    // Migration failure is non-fatal; legacy keys remain for retry next launch.
  }
}

type Step = "checking" | "disclosures" | "terms" | "done";

interface Props {
  children: React.ReactNode;
  onConsentDone?: () => void;
  onConsentRevoked?: () => void;
}

function openTrackingSettings() {
  Linking.openURL("App-Prefs:Privacy&path=TRACKING_USAGE").catch(() =>
    Linking.openURL("app-settings:").catch(() => {})
  );
}

export function TrackingConsentGate({ children, onConsentDone, onConsentRevoked }: Props) {
  const [step, setStep] = useState<Step>("checking");
  const { t } = useLanguage();
  const c = t.consent;

  // Track whether consent was ever granted in this session so the AppState
  // listener only fires onConsentRevoked when there was something to revoke.
  const consentGrantedRef = useRef(false);

  function finish() {
    requestAdsConsent().catch(() => {});
    consentGrantedRef.current = true;
    onConsentDone?.();
    setStep("done");
  }

  // Called when a user's ATT is found to be denied/restricted while the app
  // is in the foreground (they revoked tracking via iOS Settings).
  // Renders children normally but fires onConsentRevoked so callers never
  // register the fill-change callback for a non-consented session.
  function revoke() {
    onConsentRevoked?.();
    setStep("done");
  }

  // Detect iOS ATT revocation via iOS Settings → Privacy → Tracking.
  // When the user returns the app to the foreground after revoking tracking,
  // AppState fires "active". If ATT is now denied/restricted and we had
  // previously granted consent, call onConsentRevoked so callers can tear
  // down any tracking-dependent callbacks (e.g. ad-fill change handler).
  useEffect(() => {
    if (Platform.OS !== "ios") return;

    const subscription = AppState.addEventListener(
      "change",
      (nextState: AppStateStatus) => {
        if (nextState !== "active") return;
        if (!consentGrantedRef.current) return;
        getATTStatus().then((status) => {
          if (status === "denied" || status === "restricted") {
            consentGrantedRef.current = false;
            onConsentRevoked?.();
          }
        }).catch(() => {});
      },
    );

    return () => subscription.remove();
  }, [onConsentRevoked]);

  useEffect(() => {
    if (Platform.OS !== "ios") {
      // Android has no ATT dialog — always pass through immediately.
      // Run migration first so stale keys are cleaned up on Android too.
      migrateLegacyConsent().finally(() => finish());
      return;
    }

    // iOS: always show the disclosure screen on every cold launch.
    // No storage key can skip it. Run migration, then show disclosures.
    migrateLegacyConsent().finally(() => setStep("disclosures"));
  }, []);

  async function acceptDisclosures() {
    // Request ATT now (after the user has read the explanation).
    // iOS only ever shows the system dialog when status is "undetermined".
    const status = await getATTStatus();
    if (status === "undetermined") {
      await requestATT();
      // Give iOS time to commit the ATT status before we read it back.
      await new Promise<void>((r) => setTimeout(r, 600));
    }

    // If the user has already accepted the terms, skip straight to done.
    const termsDone = await AsyncStorage.getItem(TERMS_KEY);
    if (termsDone) {
      finish();
    } else {
      setStep("terms");
    }
  }

  function declineDisclosures() {
    Alert.alert(
      c.declineTitle,
      c.declineMessage,
      [
        {
          text: c.openSettings,
          onPress: openTrackingSettings,
        },
        {
          text: c.continueWithout,
          style: "cancel",
          onPress: () => {
            finish();
          },
        },
      ]
    );
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
            <Text style={styles.cardBody}>
              {c.card3Body.split("Settings → Privacy & Security → Tracking").length > 1 ? (
                <>
                  {c.card3Body.split("Settings → Privacy & Security → Tracking")[0]}
                  <Text style={styles.link} onPress={openTrackingSettings}>
                    Settings → Privacy & Security → Tracking
                  </Text>
                  {c.card3Body.split("Settings → Privacy & Security → Tracking")[1]}
                </>
              ) : c.card3Body.split("Ajustes → Privacidad y Seguridad → Seguimiento").length > 1 ? (
                <>
                  {c.card3Body.split("Ajustes → Privacidad y Seguridad → Seguimiento")[0]}
                  <Text style={styles.link} onPress={openTrackingSettings}>
                    Ajustes → Privacidad y Seguridad → Seguimiento
                  </Text>
                  {c.card3Body.split("Ajustes → Privacidad y Seguridad → Seguimiento")[1]}
                </>
              ) : (
                c.card3Body
              )}
            </Text>
          </View>

          <Text style={styles.legal}>{c.legal}</Text>
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity style={styles.primaryBtn} onPress={acceptDisclosures} activeOpacity={0.85}>
            <Ionicons name="checkmark-circle-outline" size={20} color="#000" style={{ marginRight: 8 }} />
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
  link: {
    color: Colors.primary,
    fontFamily: "Outfit_600SemiBold",
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
