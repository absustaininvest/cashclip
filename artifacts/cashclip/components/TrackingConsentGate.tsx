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
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { requestAdsConsent } from "@/lib/admob";

const TRACKING_DISMISSED_KEY = "tracking_consent_dismissed_v1";

type ConsentState = "checking" | "needed" | "denied" | "done";

interface Props {
  children: React.ReactNode;
  onConsentDone?: () => void;
}

async function getTrackingStatus(): Promise<string> {
  try {
    const { getTrackingPermissionsAsync } = require("expo-tracking-transparency");
    const { status } = await getTrackingPermissionsAsync();
    return status;
  } catch {
    return "unavailable";
  }
}

async function requestATT(): Promise<string> {
  try {
    const { requestTrackingPermissionsAsync } = require("expo-tracking-transparency");
    const { status } = await requestTrackingPermissionsAsync();
    return status;
  } catch (e) {
    console.warn("ATT request failed:", e);
    return "denied";
  }
}


function waitForActive(settleMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    if (AppState.currentState === "active") {
      setTimeout(resolve, settleMs);
      return;
    }
    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active") {
        sub.remove();
        setTimeout(resolve, settleMs);
      }
    });
  });
}

function LearnMoreSection() {
  const [expanded, setExpanded] = useState(false);

  return (
    <View style={styles.learnMoreContainer}>
      <TouchableOpacity onPress={() => setExpanded((v) => !v)} activeOpacity={0.7}>
        <Text style={styles.learnMoreLink}>Learn More{expanded ? " ▲" : "..."}</Text>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.learnMoreBody}>
          <Text style={styles.learnMoreHeading}>What is tracked</Text>
          <Text style={styles.learnMoreText}>
            CashClip uses Apple's Advertising Identifier (IDFA) — a device-level identifier — to link your in-app activity with ad networks. This lets advertisers show you ads relevant to your interests and measure how well their ads perform.
          </Text>

          <Text style={styles.learnMoreHeading}>How it is tracked</Text>
          <Text style={styles.learnMoreText}>
            When you allow tracking, CashClip shares your IDFA with Google AdMob and our offer partners. AdMob uses it to deliver personalized ads and attribute conversions. No personal information such as your name, email, or phone number is shared.
          </Text>

          <Text style={styles.learnMoreHeading}>What happens if you don't allow</Text>
          <Text style={styles.learnMoreText}>
            Ads will still appear but will be non-personalized, and some offerwall and survey providers may not be able to match you with available offers. You can change your choice at any time in Settings → Privacy & Security → Tracking.
          </Text>

          <TouchableOpacity
            onPress={() => {
              if (Platform.OS !== "web") {
                Linking.openURL("app-settings:");
              }
            }}
            style={styles.settingsLink}
            activeOpacity={0.7}
          >
            <Ionicons name="settings-outline" size={14} color={Colors.primary} />
            <Text style={styles.settingsLinkText}>Open Privacy Settings</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

export function TrackingConsentGate({ children, onConsentDone }: Props) {
  const [consentState, setConsentState] = useState<ConsentState>("checking");
  const handledRef = useRef(false);

  useEffect(() => {
    if (Platform.OS === "web") {
      setConsentState("done");
      onConsentDone?.();
      return;
    }

    if (Platform.OS !== "ios") {
      setConsentState("done");
      onConsentDone?.();
      return;
    }

    async function check() {
      const [dismissed, status] = await Promise.all([
        AsyncStorage.getItem(TRACKING_DISMISSED_KEY).catch(() => null),
        getTrackingStatus(),
      ]);

      if (status === "authorized" || status === "unavailable") {
        setConsentState("done");
        onConsentDone?.();
        return;
      }

      if (status === "undetermined") {
        setConsentState(dismissed === "1" ? "denied" : "needed");
      } else {
        setConsentState("denied");
      }
    }

    check();
  }, []);

  async function handleContinue() {
    if (handledRef.current) return;
    handledRef.current = true;

    await waitForActive(2000);
    await requestATT();
    await requestAdsConsent();

    await AsyncStorage.setItem(TRACKING_DISMISSED_KEY, "1").catch(() => {});
    setConsentState("done");
    onConsentDone?.();
  }

  async function handleContinueAnyway() {
    await AsyncStorage.setItem(TRACKING_DISMISSED_KEY, "1").catch(() => {});
    setConsentState("done");
    onConsentDone?.();
  }

  if (consentState === "checking") {
    return null;
  }

  if (consentState === "needed") {
    return (
      <View style={styles.screen}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>Permissions Needed</Text>

          <Text style={styles.subtitle}>
            By allowing the following, CashClip can deliver personalized rewards and maximize your cash earnings.
          </Text>

          <LearnMoreSection />

          <View style={styles.divider} />

          <View style={styles.permissionRow}>
            <View style={styles.iconCircle}>
              <Ionicons name="bar-chart-outline" size={22} color="#fff" />
            </View>
            <View style={styles.permissionText}>
              <Text style={styles.permissionTitle}>App Tracking</Text>
              <Text style={styles.permissionDesc}>
                By allowing CashClip to track your activity across other companies' apps and websites, you will receive personalized ads that reward you with real cash. CashClip requires this to create and deliver relevant ad campaigns and measure earnings.
              </Text>
            </View>
          </View>

          <View style={styles.permissionRow}>
            <View style={styles.iconCircle}>
              <Ionicons name="cash-outline" size={22} color="#fff" />
            </View>
            <View style={styles.permissionText}>
              <Text style={styles.permissionTitle}>Ad Personalization</Text>
              <Text style={styles.permissionDesc}>
                By allowing ad personalization, CashClip also requires access to match you with the highest-paying surveys and offers available for your profile.
              </Text>
            </View>
          </View>

          <View style={styles.divider} />

          <Text style={styles.noGatingNote}>
            You can change this at any time in{" "}
            <Text
              style={styles.settingsInlineLink}
              onPress={() => {
                if (Platform.OS !== "web") {
                  Linking.openURL("app-settings:");
                }
              }}
            >
              Settings → Privacy & Security → Tracking
            </Text>
            . Allowing tracking helps maximize your earnings but is not required to use CashClip.
          </Text>
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity style={styles.button} onPress={handleContinue} activeOpacity={0.85}>
            <Text style={styles.buttonText}>Continue</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (consentState === "denied") {
    return (
      <View style={styles.screen}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.deniedIconWrap}>
            <Ionicons name="eye-off-outline" size={48} color="#606070" />
          </View>

          <Text style={styles.title}>Tracking is Off</Text>

          <Text style={styles.subtitle}>
            CashClip's tracking permission is currently turned off. Some offerwall and survey providers require tracking to match you with available offers and rewards.
          </Text>

          <View style={styles.divider} />

          <View style={styles.permissionRow}>
            <View style={styles.iconCircle}>
              <Ionicons name="bar-chart-outline" size={22} color="#fff" />
            </View>
            <View style={styles.permissionText}>
              <Text style={styles.permissionTitle}>What you may be missing</Text>
              <Text style={styles.permissionDesc}>
                Personalized ads, higher-paying survey matches, and offerwall campaigns that use your device's ad identifier to qualify you for rewards.
              </Text>
            </View>
          </View>

          <View style={styles.permissionRow}>
            <View style={styles.iconCircle}>
              <Ionicons name="settings-outline" size={22} color="#fff" />
            </View>
            <View style={styles.permissionText}>
              <Text style={styles.permissionTitle}>How to enable it</Text>
              <Text style={styles.permissionDesc}>
                Go to{" "}
                <Text
                  style={styles.settingsInlineLink}
                  onPress={() => {
                    if (Platform.OS !== "web") {
                      Linking.openURL("app-settings:");
                    }
                  }}
                >
                  Settings → Privacy & Security → Tracking
                </Text>
                , find CashClip, and tap Allow.
              </Text>
            </View>
          </View>

          <View style={styles.divider} />

          <Text style={styles.noGatingNote}>
            You can change this at any time. Tracking is not required — you can still use CashClip without it.
          </Text>
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            style={styles.button}
            onPress={() => {
              if (Platform.OS !== "web") {
                Linking.openURL("app-settings:");
              }
            }}
            activeOpacity={0.85}
          >
            <Ionicons name="settings-outline" size={18} color="#000" style={{ marginRight: 8 }} />
            <Text style={styles.buttonText}>Open Settings</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryButton} onPress={handleContinueAnyway} activeOpacity={0.7}>
            <Text style={styles.secondaryButtonText}>Continue Without Tracking</Text>
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
  scrollContent: {
    paddingTop: 72,
    paddingHorizontal: 28,
    paddingBottom: 24,
  },
  deniedIconWrap: {
    alignItems: "center",
    marginBottom: 20,
  },
  title: {
    fontSize: 30,
    fontFamily: "Outfit_700Bold",
    color: "#FFFFFF",
    marginBottom: 12,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 15,
    fontFamily: "Outfit_400Regular",
    color: "#A0A0B0",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 8,
  },
  learnMoreContainer: {
    alignItems: "center",
    marginBottom: 24,
  },
  learnMoreLink: {
    fontSize: 14,
    fontFamily: "Outfit_600SemiBold",
    color: Colors.primary,
  },
  learnMoreBody: {
    marginTop: 16,
    backgroundColor: "#141420",
    borderRadius: 12,
    padding: 16,
    width: "100%",
  },
  learnMoreHeading: {
    fontSize: 13,
    fontFamily: "Outfit_700Bold",
    color: "#FFFFFF",
    marginTop: 12,
    marginBottom: 4,
  },
  learnMoreText: {
    fontSize: 13,
    fontFamily: "Outfit_400Regular",
    color: "#A0A0B0",
    lineHeight: 20,
  },
  settingsLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 16,
  },
  settingsLinkText: {
    fontSize: 13,
    fontFamily: "Outfit_600SemiBold",
    color: Colors.primary,
  },
  divider: {
    height: 1,
    backgroundColor: "#1E1E2E",
    marginVertical: 20,
  },
  permissionRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 24,
    gap: 14,
  },
  iconCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "#1E1E2E",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 2,
  },
  permissionText: {
    flex: 1,
  },
  permissionTitle: {
    fontSize: 16,
    fontFamily: "Outfit_600SemiBold",
    color: "#FFFFFF",
    marginBottom: 4,
  },
  permissionDesc: {
    fontSize: 13,
    fontFamily: "Outfit_400Regular",
    color: "#A0A0B0",
    lineHeight: 20,
  },
  noGatingNote: {
    fontSize: 13,
    fontFamily: "Outfit_400Regular",
    color: "#606070",
    lineHeight: 20,
    textAlign: "center",
  },
  settingsInlineLink: {
    color: Colors.primary,
    fontFamily: "Outfit_600SemiBold",
  },
  footer: {
    paddingHorizontal: 28,
    paddingBottom: 48,
    paddingTop: 12,
    backgroundColor: "#0A0A0F",
    gap: 12,
  },
  button: {
    backgroundColor: Colors.primary,
    borderRadius: Colors.radius.lg,
    paddingVertical: 18,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
  },
  buttonText: {
    fontSize: 18,
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
});