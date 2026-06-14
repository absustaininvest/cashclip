import React, { useEffect, useState } from "react";
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
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { requestAdsConsent } from "@/lib/admob";
import { getATTStatus, requestATT } from "@/lib/att";
import { secureGet, secureSet } from "@/lib/secure-store";

const DONE_KEY = "consent_done_v3";

type Step = "checking" | "disclosures" | "terms" | "done";

interface Props {
  children: React.ReactNode;
  onConsentDone?: () => void;
}

function openTrackingSettings() {
  Linking.openURL("App-Prefs:Privacy&path=TRACKING_USAGE").catch(() =>
    Linking.openURL("app-settings:").catch(() => {})
  );
}

export function TrackingConsentGate({ children, onConsentDone }: Props) {
  const [step, setStep] = useState<Step>("checking");

  function finish() {
    requestAdsConsent().catch(() => {});
    onConsentDone?.();
    setStep("done");
  }

  useEffect(() => {
    if (Platform.OS !== "ios") {
      // Android has no ATT dialog — always pass through immediately.
      // No need to write DONE_KEY: the Platform.OS guard re-fires on every
      // launch and skips directly to finish() without hitting SecureStore.
      finish();
      return;
    }

    (async () => {
      // ── Fast-path 1: key in SecureStore (Keychain) — survives reinstalls ───
      // Written by any build that ships this version of the gate.
      const doneSecure = await secureGet(DONE_KEY);
      if (doneSecure) { finish(); return; }

      // ── Fast-path 2: key in AsyncStorage — written by old builds (≤v39) ───
      // Migrate it to SecureStore so future reinstalls also pass through.
      const doneLegacyStorage = await AsyncStorage.getItem(DONE_KEY).catch(() => null);
      if (doneLegacyStorage) {
        await secureSet(DONE_KEY, "1").catch(() => {});
        finish();
        return;
      }

      // ── Fast-path 3: even older legacy keys — migrate + skip ────────────
      const prev1 = await AsyncStorage.getItem("consent_fully_done_v2").catch(() => null);
      const prev2 = await AsyncStorage.getItem("tracking_consent_dismissed_v1").catch(() => null);
      if (prev1 || prev2) {
        await secureSet(DONE_KEY, "1").catch(() => {});
        finish();
        return;
      }

      // Fire ATT dialog now if undetermined (iOS only shows it once ever).
      // If already denied/restricted skip the dialog — iOS won't show it again.
      const status = await getATTStatus();
      if (status === "denied" || status === "restricted") {
        // User previously denied system ATT prompt. iOS will never show it
        // again. Mark consent done so we never show the gate again either.
        await secureSet(DONE_KEY, "1").catch(() => {});
        finish();
        return;
      }
      if (status === "undetermined") {
        await requestATT();
        // Give iOS time to commit the ATT status before we read it back.
        await new Promise<void>((r) => setTimeout(r, 600));
      }

      // Read back the final status after the ATT dialog (or skip).
      // Treat authorized/granted AND denied/restricted the same: user has
      // already made their ATT choice — write the key and move on.
      // build-29 silently passed through without writing any key on this path.
      const statusAfter = await getATTStatus();
      if (
        statusAfter === "authorized" ||
        statusAfter === "granted" ||
        statusAfter === "denied" ||
        statusAfter === "restricted"
      ) {
        await secureSet(DONE_KEY, "1").catch(() => {});
        finish();
        return;
      }

      setStep("disclosures");
    })();
  }, []);

  async function acceptDisclosures() {
    setStep("terms");
  }

  function declineDisclosures() {
    Alert.alert(
      "This Will Reduce Your Earnings",
      "Without tracking, ads and offers can't be personalized to you. You'll still earn, but less.\n\nYou can enable it anytime under Settings → Privacy & Security → Tracking.",
      [
        {
          text: "Open Tracking Settings",
          onPress: openTrackingSettings,
        },
        {
          text: "Continue Without",
          style: "cancel",
          onPress: async () => {
            await secureSet(DONE_KEY, "1").catch(() => {});
            finish();
          },
        },
      ]
    );
  }

  async function acceptTerms() {
    await secureSet(DONE_KEY, "1").catch(() => {});
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

          <Text style={styles.title}>Your Privacy & Earnings</Text>
          <Text style={styles.subtitle}>
            CashClip uses tracking to personalize your ads and match you with higher-paying
            offers. Here's exactly what we access and why.
          </Text>

          <View style={styles.card}>
            <View style={styles.cardRow}>
              <Ionicons name="bar-chart-outline" size={20} color={Colors.primary} />
              <Text style={styles.cardTitle}>App Tracking (IDFA)</Text>
            </View>
            <Text style={styles.cardBody}>
              CashClip uses Apple's Advertising Identifier to link your in-app activity
              with ad networks. This lets advertisers show you relevant ads and measure
              performance — which is how you earn cash. No name, email, or contact info
              is shared with advertisers.
            </Text>
          </View>

          <View style={styles.card}>
            <View style={styles.cardRow}>
              <Ionicons name="cash-outline" size={20} color={Colors.primary} />
              <Text style={styles.cardTitle}>Ad Personalization</Text>
            </View>
            <Text style={styles.cardBody}>
              Allowing personalization matches you with the highest-paying surveys and
              offers for your profile. Declining limits you to non-personalized content
              and significantly reduces earning potential.
            </Text>
          </View>

          <View style={styles.card}>
            <View style={styles.cardRow}>
              <Ionicons name="settings-outline" size={20} color={Colors.primary} />
              <Text style={styles.cardTitle}>Your Control</Text>
            </View>
            <Text style={styles.cardBody}>
              Change your preference anytime under{" "}
              <Text style={styles.link} onPress={openTrackingSettings}>
                Settings → Privacy & Security → Tracking
              </Text>
              {" "}or inside the app under Profile → Settings.
            </Text>
          </View>

          <Text style={styles.legal}>
            By tapping "Accept & Earn More" you agree to CashClip's Privacy Policy and
            Terms of Service. Tracking is not required — you may decline and still use CashClip.
          </Text>
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity style={styles.primaryBtn} onPress={acceptDisclosures} activeOpacity={0.85}>
            <Ionicons name="checkmark-circle-outline" size={20} color="#000" style={{ marginRight: 8 }} />
            <Text style={styles.primaryBtnText}>Accept & Earn More</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={declineDisclosures} activeOpacity={0.7}>
            <Text style={styles.secondaryBtnText}>Decline</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (step === "terms") {
    return (
      <View style={styles.screen}>
        <View style={styles.termsHeader}>
          <Text style={styles.termsTitle}>Terms & Privacy</Text>
          <Text style={styles.termsSub}>Please review before entering CashClip</Text>
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
            partners (LevelPlay / ironSource, Unity Ads, and survey/offerwall providers).
            {"\n\n"}
            <Text style={styles.bold}>Advertising partners. </Text>
            When you allow tracking, your IDFA is shared with LevelPlay and our mediation
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
            <Text style={styles.primaryBtnText}>Accept & Enter CashClip</Text>
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
