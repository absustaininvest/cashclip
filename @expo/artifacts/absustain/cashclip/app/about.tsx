import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Platform,
  Linking,
} from "react-native";
import Constants from "expo-constants";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useFonts, Outfit_400Regular, Outfit_600SemiBold, Outfit_700Bold } from "@expo-google-fonts/outfit";
import Colors from "@/constants/colors";
import { useLanguage } from "@/lib/LanguageContext";
import { SUPPORT_EMAIL, PRIVACY_POLICY_URL, TERMS_URL } from "@/constants/app";

function openLink(url: string) {
  Linking.openURL(url).catch(() => {});
}

function openEmail() {
  Linking.openURL(`mailto:${SUPPORT_EMAIL}`).catch(() => {});
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function LinkRow({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress(); }}
      style={({ pressed }) => [styles.linkRow, { opacity: pressed ? 0.7 : 1 }]}
    >
      <Feather name={icon as any} size={18} color={Colors.textSecondary} />
      <Text style={styles.linkLabel}>{label}</Text>
      <Feather name="external-link" size={15} color={Colors.textMuted} />
    </Pressable>
  );
}

export default function AboutScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useLanguage();

  const [fontsLoaded] = useFonts({ Outfit_400Regular, Outfit_600SemiBold, Outfit_700Bold });

  const version = Constants.expoConfig?.version ?? "—";
  const buildNumber =
    Platform.OS === "ios"
      ? (Constants.expoConfig?.ios?.buildNumber ?? "—")
      : Platform.OS === "android"
      ? String(Constants.expoConfig?.android?.versionCode ?? "—")
      : (Constants.expoConfig?.ios?.buildNumber ?? "—");

  if (!fontsLoaded) return null;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backButton, { opacity: pressed ? 0.6 : 1 }]}
          hitSlop={8}
        >
          <Feather name="chevron-left" size={26} color={Colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>{t.about.title}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.logoSection}>
          <LinearGradient colors={[Colors.primary, Colors.primaryDark]} style={styles.logoCircle}>
            <Feather name="zap" size={36} color="#0A0A0F" />
          </LinearGradient>
          <Text style={styles.appName}>CashClip</Text>
          <Text style={styles.tagline}>{t.about.tagline}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t.about.appInfo}</Text>
          <InfoRow label={t.about.version} value={version} />
          <View style={styles.divider} />
          <InfoRow label={t.about.build} value={buildNumber} />
          <View style={styles.divider} />
          <InfoRow label={t.about.platform} value={Platform.OS === "ios" ? "iOS" : Platform.OS === "android" ? "Android" : "Web"} />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t.about.supportLegal}</Text>
          <LinkRow
            icon="mail"
            label={t.about.contactSupport}
            onPress={openEmail}
          />
          <View style={styles.divider} />
          <LinkRow
            icon="shield"
            label={t.about.privacyPolicy}
            onPress={() => openLink(PRIVACY_POLICY_URL)}
          />
          <View style={styles.divider} />
          <LinkRow
            icon="file-text"
            label={t.about.termsOfService}
            onPress={() => openLink(TERMS_URL)}
          />
        </View>

        <Text style={styles.copyright}>
          {t.about.copyright.replace("{{year}}", String(new Date().getFullYear()))}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backButton: { padding: 4 },
  headerTitle: { fontFamily: "Outfit_700Bold", fontSize: 18, color: Colors.text, flex: 1, textAlign: "center" },
  headerSpacer: { width: 34 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 28 },
  logoSection: { alignItems: "center", marginBottom: 32 },
  logoCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  appName: { fontFamily: "Outfit_700Bold", fontSize: 28, color: Colors.text, marginBottom: 6 },
  tagline: { fontFamily: "Outfit_400Regular", fontSize: 14, color: Colors.textSecondary },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 16,
    overflow: "hidden",
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  cardTitle: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 12,
    color: Colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    paddingVertical: 12,
  },
  infoRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 13 },
  infoLabel: { fontFamily: "Outfit_400Regular", fontSize: 15, color: Colors.text },
  infoValue: { fontFamily: "Outfit_600SemiBold", fontSize: 15, color: Colors.textSecondary },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13 },
  linkLabel: { fontFamily: "Outfit_400Regular", fontSize: 15, color: Colors.text, flex: 1 },
  divider: { height: 1, backgroundColor: Colors.border },
  copyright: {
    fontFamily: "Outfit_400Regular",
    fontSize: 12,
    color: Colors.textMuted,
    textAlign: "center",
    marginTop: 8,
  },
});
