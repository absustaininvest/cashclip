import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  AppState,
  AppStateStatus,
  ScrollView,
  Linking,
  ActivityIndicator,
  Alert,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { requestAdsConsent } from "@/lib/admob";

// Permanent key — once set, gate never re-fires on any launch.
const CONSENT_DONE_KEY = "consent_fully_done_v2";

type ConsentState = "checking" | "disclosures" | "terms" | "done";

interface Props {
  children: React.ReactNode;
  onConsentDone?: () => void;
}

async function getATTStatus(): Promise<string> {
  try {
    const { getTrackingPermissionsAsync } = require("expo-tracking-transparency");
    const timeout = new Promise<{ status: string }>((resolve) =>
      setTimeout(() => resolve({ status: "unavailable" }), 3000)
    );
    const { status } = await Promise.race([getTrackingPermissionsAsync(), timeout]);
    return status;
  } catch {
    return "unavailable";
  }
}

async function requestATTPermission(): Promise<string> {
  try {
    const { requestTrackingPermissionsAsync } = require("expo-tracking-transparency");
    const { status } = await requestTrackingPermissionsAsync();
    return status;
  } catch {
    return "denied";
  }
}

// Opens Settings → Privacy & Security → Tracking directly (iOS 14+).
// Falls back to the app-specific settings page if the deep link is unavailable.
function openTrackingSettings() {
  if (Platform.OS !== "ios") return;
  Linking.openURL("App-Prefs:Privacy&path=TRACKING_USAGE").catch(() =>
    Linking.openURL("app-settings:").catch(() => {})
  );
}

// ─── Disclosures Screen ───────────────────────────────────────────────────────

function DisclosuresScreen({
  onAccept,
  onDecline,
}: {
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerIconWrap}>
          <Ionicons name="shield-checkmark-outline" size={52} color={Colors.primary} />
        </View>

        <Text style={styles.title}>Your Privacy & Earnings</Text>
        <Text style={styles.subtitle}>
          CashClip uses tracking to personalize your ads and match you with higher-paying
          offers. Here's exactly what we access and why.
        </Text>

        <View style={styles.subtab}>
          <View style={styles.subtabHeader}>
            <Ionicons name="bar-chart-outline" size={20} color={Colors.primary} />
            <Text style={styles.subtabTitle}>App Tracking (IDFA)</Text>
          </View>
          <Text style={styles.subtabBody}>
            CashClip uses Apple's Advertising Identifier to link your in-app activity
            with ad networks. This enables advertisers to show you relevant ads and
            measure their performance — which is how you earn cash. No name, email, or
            personal contact info is shared with advertisers.
          </Text>
        </View>

        <View style={styles.subtab}>
          <View style={styles.subtabHeader}>
            <Ionicons name="cash-outline" size={20} color={Colors.primary} />
            <Text style={styles.subtabTitle}>Ad Personalization</Text>
          </View>
          <Text style={styles.subtabBody}>
            Allowing ad personalization matches you with the highest-paying surveys and
            offers available for your profile through our ad network partners. Declining
            limits you to non-personalized content and significantly reduces your earning
            potential.
          </Text>
        </View>

        <View style={styles.subtab}>
          <View style={styles.subtabHeader}>
            <Ionicons name="settings-outline" size={20} color={Colors.primary} />
            <Text style={styles.subtabTitle}>Your Control</Text>
          </View>
          <Text style={styles.subtabBody}>
            You can change your tracking preference at any time under{" "}
            <Text style={styles.inlineLink} onPress={openTrackingSettings}>
              Settings → Privacy & Security → Tracking
            </Text>
            {" "}or inside the app under Profile → Settings.
          </Text>
        </View>

        <Text style={styles.legalNote}>
          By tapping "Accept & Earn More" you agree to CashClip's Privacy Policy and
          Terms of Service. Tracking is not required — you may decline and still use
          CashClip.
        </Text>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.primaryButton} onPress={onAccept} activeOpacity={0.85}>
          <Ionicons name="checkmark-circle-outline" size={20} color="#000" style={{ marginRight: 8 }} />
          <Text style={styles.primaryButtonText}>Accept & Earn More</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryButton} onPress={onDecline} activeOpacity={0.7}>
          <Text style={styles.secondaryButtonText}>Decline</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Terms & Conditions Screen ────────────────────────────────────────────────

function TermsScreen({ onAccept }: { onAccept: () => void }) {
  return (
    <View style={styles.screen}>
      <View style={styles.termsHeader}>
        <Text style={styles.termsHeaderTitle}>Terms & Privacy</Text>
        <Text style={styles.termsHeaderSub}>Please review before entering CashClip</Text>
      </View>

      <ScrollView
        style={styles.termsScroll}
        contentContainerStyle={styles.termsContent}
        showsVerticalScrollIndicator
      >
        <Text style={styles.termsSectionTitle}>Terms of Service</Text>
        <Text style={styles.termsBody}>
          <Text style={styles.termsBold}>Eligibility. </Text>
          You must be at least 18 years old and a legal resident of a supported country
          to earn and withdraw funds. One account per person; creating multiple accounts
          to exploit rewards is prohibited and results in permanent suspension.
          {"\n\n"}
          <Text style={styles.termsBold}>Earning Rules. </Text>
          Rewards are credited when CashClip receives verified confirmation from our ad
          and survey partners. Client-side claims without server verification are not
          credited. Fraudulent activity — including VPNs to spoof location, bot usage,
          or automated clicks — results in balance forfeiture and account termination.
          {"\n\n"}
          <Text style={styles.termsBold}>Withdrawals. </Text>
          Minimum withdrawal is $3.00 via PayPal. New accounts are subject to a 3-day
          hold on the first withdrawal. CashClip reviews transactions for fraud before
          processing. Withdrawals may take up to 5 business days.
          {"\n\n"}
          <Text style={styles.termsBold}>Account Termination. </Text>
          CashClip may suspend or terminate accounts at its sole discretion for
          violation of these terms, fraudulent activity, or platform abuse. Forfeited
          balances from terminated accounts are not reimbursable.
          {"\n\n"}
          <Text style={styles.termsBold}>Modifications. </Text>
          CashClip may update these Terms at any time. Continued use of the app
          constitutes acceptance of the revised Terms.
        </Text>

        <View style={styles.termsDivider} />

        <Text style={styles.termsSectionTitle}>Privacy Policy</Text>
        <Text style={styles.termsBody}>
          <Text style={styles.termsBold}>What we collect. </Text>
          CashClip collects your username, email address, device identifiers (IDFA when
          permitted), IP address, and in-app activity (surveys completed, ads watched,
          offers redeemed, withdrawal history).
          {"\n\n"}
          <Text style={styles.termsBold}>How we use it. </Text>
          Your data is used to operate your account, credit earnings, verify payouts,
          detect fraud, and deliver personalized advertising through our ad network
          partners (LevelPlay / ironSource, Unity Ads, and survey/offerwall providers).
          {"\n\n"}
          <Text style={styles.termsBold}>Advertising partners. </Text>
          When you allow tracking, your IDFA is shared with LevelPlay and our mediation
          partners to personalize ads and measure campaign performance. No name, phone
          number, or email is shared with advertisers.
          {"\n\n"}
          <Text style={styles.termsBold}>Data retention. </Text>
          Account data is retained while your account is active. You may request
          deletion by contacting support@cash-clip.app. Fraud-related records may be
          retained longer as required by law.
          {"\n\n"}
          <Text style={styles.termsBold}>Security. </Text>
          Passwords are hashed; tokens are signed and expire. PayPal payouts are
          processed with two-factor verification. We do not store payment credentials
          on our servers.
          {"\n\n"}
          <Text style={styles.termsBold}>Contact. </Text>
          Questions or deletion requests: support@cash-clip.app
        </Text>

        <View style={{ height: 24 }} />
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.primaryButton} onPress={onAccept} activeOpacity={0.85}>
          <Text style={styles.primaryButtonText}>Accept & Enter CashClip</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Gate ─────────────────────────────────────────────────────────────────────

export function TrackingConsentGate({ children, onConsentDone }: Props) {
  const [state, setState] = useState<ConsentState>("checking");
  const doneFiredRef = useRef(false);
  const doneRef = useRef(false);
  const initDoneRef = useRef(false);

  function markDone() {
    doneRef.current = true;
    setState("done");
    if (!doneFiredRef.current) {
      doneFiredRef.current = true;
      requestAdsConsent().catch(() => {});
      onConsentDone?.();
    }
  }

  useEffect(() => {
    // Non-iOS platforms skip the gate entirely.
    if (Platform.OS === "web") { markDone(); return; }
    if (Platform.OS !== "ios") {
      requestAdsConsent().catch(() => {});
      markDone();
      return;
    }

    async function initialize() {
      if (initDoneRef.current) return;
      initDoneRef.current = true;

      // ① Permanent done key — if set, never show any consent screen again.
      const done = await AsyncStorage.getItem(CONSENT_DONE_KEY).catch(() => null);
      if (done) {
        markDone();
        return;
      }

      // ② Fire ATT native dialog NOW (while spinner is visible) if undetermined.
      //    If ATT was previously denied/authorized iOS just returns immediately —
      //    no dialog, no delay.
      const status = await getATTStatus();
      if (status === "undetermined") {
        await requestATTPermission();
      }

      // ③ Always show disclosures regardless of ATT result.
      setState("disclosures");
    }

    initialize();

    // ④ Detect user returning from Settings with tracking enabled.
    //    A 1 200 ms settle delay is required — iOS does not commit the new ATT
    //    status to the keychain instantly; reading it immediately after the app
    //    becomes active can still return the old "denied" value.
    const sub = AppState.addEventListener("change", async (nextState: AppStateStatus) => {
      if (nextState !== "active") return;
      if (doneRef.current) return;

      const done = await AsyncStorage.getItem(CONSENT_DONE_KEY).catch(() => null);
      if (done) { markDone(); return; }

      await new Promise<void>((r) => setTimeout(r, 1200));
      const attStatus = await getATTStatus();
      if (attStatus === "authorized") {
        setState("terms");
      }
    });

    return () => sub.remove();
  }, []);

  function handleDecline() {
    Alert.alert(
      "This Will Reduce Your Earnings",
      "Tracking determines which ads and offers you're matched with. Without it you'll receive non-personalized content and may earn significantly less.\n\nYou can re-enable it anytime under Profile → Settings.",
      [
        {
          text: "Open Tracking Settings",
          onPress: openTrackingSettings,
        },
        {
          text: "Continue Without",
          style: "cancel",
          onPress: () => {
            // Permanently mark done so this never re-fires.
            AsyncStorage.setItem(CONSENT_DONE_KEY, "1").catch(() => {});
            markDone();
          },
        },
      ]
    );
  }

  async function handleTermsAccept() {
    await AsyncStorage.setItem(CONSENT_DONE_KEY, "1").catch(() => {});
    markDone();
  }

  if (state === "checking") {
    return (
      <View style={[styles.screen, styles.checkingCenter]}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (state === "disclosures") {
    return (
      <DisclosuresScreen
        onAccept={() => setState("terms")}
        onDecline={handleDecline}
      />
    );
  }

  if (state === "terms") {
    return <TermsScreen onAccept={handleTermsAccept} />;
  }

  return <>{children}</>;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#0A0A0F",
  },
  checkingCenter: {
    alignItems: "center",
    justifyContent: "center",
  },
  scrollContent: {
    paddingTop: 64,
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  headerIconWrap: {
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
  // White subtab cards
  subtab: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
  },
  subtabHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  subtabTitle: {
    fontSize: 15,
    fontFamily: "Outfit_600SemiBold",
    color: "#0A0A0F",
  },
  subtabBody: {
    fontSize: 13,
    fontFamily: "Outfit_400Regular",
    color: "#3A3A4A",
    lineHeight: 20,
  },
  inlineLink: {
    color: Colors.primary,
    fontFamily: "Outfit_600SemiBold",
  },
  legalNote: {
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
  primaryButton: {
    backgroundColor: Colors.primary,
    borderRadius: Colors.radius.lg,
    paddingVertical: 18,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
  },
  primaryButtonText: {
    fontSize: 17,
    fontFamily: "Outfit_700Bold",
    color: "#000000",
  },
  secondaryButton: {
    paddingVertical: 14,
    alignItems: "center",
  },
  secondaryButtonText: {
    fontSize: 15,
    fontFamily: "Outfit_600SemiBold",
    color: "#606070",
  },
  // Terms screen
  termsHeader: {
    paddingTop: 64,
    paddingHorizontal: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#1E1E2E",
  },
  termsHeaderTitle: {
    fontSize: 24,
    fontFamily: "Outfit_700Bold",
    color: "#FFFFFF",
    marginBottom: 4,
  },
  termsHeaderSub: {
    fontSize: 13,
    fontFamily: "Outfit_400Regular",
    color: "#606070",
  },
  termsScroll: {
    flex: 1,
  },
  termsContent: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 16,
  },
  termsSectionTitle: {
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
  termsBold: {
    fontFamily: "Outfit_600SemiBold",
    color: "#CCCCCC",
  },
  termsDivider: {
    height: 1,
    backgroundColor: "#1E1E2E",
    marginVertical: 24,
  },
});
