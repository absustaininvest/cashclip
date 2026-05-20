import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Platform,
  Linking,
  LayoutAnimation,
  UIManager,
  TextInput,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useFonts, Outfit_400Regular, Outfit_600SemiBold, Outfit_700Bold } from "@expo-google-fonts/outfit";
import Colors from "@/constants/colors";
import { useLanguage } from "@/lib/LanguageContext";
import { SUPPORT_EMAIL } from "@/constants/app";
import { apiRequest } from "@/lib/query-client";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

function openEmail() {
  Linking.openURL(`mailto:${SUPPORT_EMAIL}`).catch(() => {});
}

function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [expanded, setExpanded] = useState(false);

  function toggle() {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpanded((v) => !v);
  }

  return (
    <Pressable
      onPress={toggle}
      style={({ pressed }) => [styles.faqItem, { opacity: pressed ? 0.8 : 1 }]}
    >
      <View style={styles.faqHeader}>
        <Text style={styles.faqQuestion}>{question}</Text>
        <Feather
          name={expanded ? "chevron-up" : "chevron-down"}
          size={18}
          color={Colors.textMuted}
        />
      </View>
      {expanded && <Text style={styles.faqAnswer}>{answer}</Text>}
    </Pressable>
  );
}

export default function HelpScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useLanguage();

  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [subjectError, setSubjectError] = useState("");
  const [messageError, setMessageError] = useState("");

  const [fontsLoaded] = useFonts({ Outfit_400Regular, Outfit_600SemiBold, Outfit_700Bold });

  if (!fontsLoaded) return null;

  const faqs = t.help.faqs;

  function validateForm(): boolean {
    let valid = true;
    if (!subject.trim()) {
      setSubjectError(t.help.subjectRequired);
      valid = false;
    } else {
      setSubjectError("");
    }
    if (!message.trim()) {
      setMessageError(t.help.messageRequired);
      valid = false;
    } else {
      setMessageError("");
    }
    return valid;
  }

  async function handleSubmit() {
    if (!validateForm()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSubmitting(true);
    try {
      await apiRequest("POST", "/api/support/tickets", {
        subject: subject.trim(),
        message: message.trim(),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSubmitted(true);
      setSubject("");
      setMessage("");
    } catch {
      Alert.alert(t.help.errorTitle, t.help.errorMessage);
    } finally {
      setSubmitting(false);
    }
  }

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
        <Text style={styles.headerTitle}>{t.help.title}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.sectionLabel}>{t.help.faqLabel}</Text>
        <View style={styles.card}>
          {faqs.map((faq, i) => (
            <React.Fragment key={i}>
              {i > 0 && <View style={styles.divider} />}
              <FaqItem question={faq.q} answer={faq.a} />
            </React.Fragment>
          ))}
        </View>

        <Text style={styles.sectionLabel}>{t.help.contactLabel}</Text>
        <View style={styles.card}>
          <Pressable
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); openEmail(); }}
            style={({ pressed }) => [styles.contactRow, { opacity: pressed ? 0.7 : 1 }]}
          >
            <View style={styles.contactIcon}>
              <Feather name="mail" size={20} color={Colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.contactTitle}>{t.help.emailSupport}</Text>
              <Text style={styles.contactSubtitle}>{SUPPORT_EMAIL}</Text>
            </View>
            <Feather name="external-link" size={16} color={Colors.textMuted} />
          </Pressable>
        </View>

        <Text style={styles.sectionLabel}>{t.help.submitRequestLabel}</Text>
        <View style={styles.card}>
          {submitted ? (
            <View style={styles.successContainer}>
              <View style={styles.successIcon}>
                <Feather name="check-circle" size={32} color={Colors.primary} />
              </View>
              <Text style={styles.successTitle}>{t.help.successTitle}</Text>
              <Text style={styles.successMessage}>{t.help.successMessage}</Text>
              <Pressable
                onPress={() => setSubmitted(false)}
                style={({ pressed }) => [styles.newRequestBtn, { opacity: pressed ? 0.7 : 1 }]}
              >
                <Text style={styles.newRequestBtnText}>{t.help.submitRequestLabel}</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.formContainer}>
              <Text style={styles.formDesc}>{t.help.submitRequestDesc}</Text>

              <View style={styles.fieldGroup}>
                <TextInput
                  style={[styles.input, subjectError ? styles.inputError : null]}
                  placeholder={t.help.subjectPlaceholder}
                  placeholderTextColor={Colors.textMuted}
                  value={subject}
                  onChangeText={(v) => { setSubject(v); if (subjectError) setSubjectError(""); }}
                  maxLength={200}
                  returnKeyType="next"
                  editable={!submitting}
                />
                {!!subjectError && <Text style={styles.fieldError}>{subjectError}</Text>}
              </View>

              <View style={styles.fieldGroup}>
                <TextInput
                  style={[styles.input, styles.textArea, messageError ? styles.inputError : null]}
                  placeholder={t.help.messagePlaceholder}
                  placeholderTextColor={Colors.textMuted}
                  value={message}
                  onChangeText={(v) => { setMessage(v); if (messageError) setMessageError(""); }}
                  maxLength={5000}
                  multiline
                  numberOfLines={5}
                  textAlignVertical="top"
                  editable={!submitting}
                />
                {!!messageError && <Text style={styles.fieldError}>{messageError}</Text>}
              </View>

              <Pressable
                onPress={handleSubmit}
                disabled={submitting}
                style={({ pressed }) => [styles.submitBtn, { opacity: pressed || submitting ? 0.7 : 1 }]}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <View style={styles.submitBtnInner}>
                    <Feather name="send" size={16} color="#000" />
                    <Text style={styles.submitBtnText}>{submitting ? t.help.submitting : t.help.submit}</Text>
                  </View>
                )}
              </Pressable>
            </View>
          )}
        </View>

        <Text style={styles.responseNote}>{t.help.responseNote}</Text>
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
  scrollContent: { paddingHorizontal: 16, paddingTop: 24 },
  sectionLabel: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 12,
    color: Colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 8,
    marginTop: 4,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 24,
    overflow: "hidden",
  },
  divider: { height: 1, backgroundColor: Colors.border, marginHorizontal: 16 },
  faqItem: { paddingHorizontal: 16, paddingVertical: 14 },
  faqHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  faqQuestion: { fontFamily: "Outfit_600SemiBold", fontSize: 15, color: Colors.text, flex: 1 },
  faqAnswer: {
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 21,
    marginTop: 10,
  },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
  },
  contactIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: `${Colors.primary}18`,
    alignItems: "center",
    justifyContent: "center",
  },
  contactTitle: { fontFamily: "Outfit_600SemiBold", fontSize: 15, color: Colors.text },
  contactSubtitle: { fontFamily: "Outfit_400Regular", fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  responseNote: {
    fontFamily: "Outfit_400Regular",
    fontSize: 12,
    color: Colors.textMuted,
    textAlign: "center",
    marginTop: -8,
  },
  formContainer: { padding: 16, gap: 12 },
  formDesc: {
    fontFamily: "Outfit_400Regular",
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 19,
    marginBottom: 4,
  },
  fieldGroup: { gap: 4 },
  input: {
    backgroundColor: Colors.surfaceLight,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: "Outfit_400Regular",
    fontSize: 15,
    color: Colors.text,
  },
  inputError: { borderColor: Colors.error },
  textArea: { minHeight: 120, paddingTop: 12 },
  fieldError: {
    fontFamily: "Outfit_400Regular",
    fontSize: 12,
    color: Colors.error,
    marginLeft: 4,
  },
  submitBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  submitBtnInner: { flexDirection: "row", alignItems: "center", gap: 8 },
  submitBtnText: { fontFamily: "Outfit_700Bold", fontSize: 15, color: "#000" },
  successContainer: { padding: 24, alignItems: "center", gap: 12 },
  successIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: `${Colors.primary}18`,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  successTitle: { fontFamily: "Outfit_700Bold", fontSize: 18, color: Colors.text },
  successMessage: {
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },
  newRequestBtn: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  newRequestBtnText: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: Colors.primary },
});
