import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
  Modal,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import { useAuth } from "@/lib/AuthContext";
import { useLanguage } from "@/lib/LanguageContext";
import { getApiUrl } from "@/lib/query-client";
import LanguageToggle from "@/components/LanguageToggle";

type ForgotStep = "username" | "code" | "success";

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { login } = useAuth();
  const { t } = useLanguage();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [showForgot, setShowForgot] = useState(false);
  const [forgotStep, setForgotStep] = useState<ForgotStep>("username");
  const [forgotUsername, setForgotUsername] = useState("");
  const [forgotCode, setForgotCode] = useState("");
  const [forgotNewPassword, setForgotNewPassword] = useState("");
  const [forgotConfirm, setForgotConfirm] = useState("");
  const [forgotShowPw, setForgotShowPw] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState("");

  const webTopPad = Platform.OS === "web" ? 67 : 0;

  function openForgot() {
    setForgotStep("username");
    setForgotUsername("");
    setForgotCode("");
    setForgotNewPassword("");
    setForgotConfirm("");
    setForgotShowPw(false);
    setForgotLoading(false);
    setForgotError("");
    setShowForgot(true);
  }

  function closeForgot() {
    setShowForgot(false);
  }

  async function handleLogin() {
    if (!username.trim() || !password) return;
    setError("");
    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const result = await login(username.trim(), password);
    setLoading(false);
    if (!result.success) {
      setError(result.error || "Login failed");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }

  async function handleSendCode() {
    if (!forgotUsername.trim()) return;
    setForgotLoading(true);
    setForgotError("");
    try {
      const baseUrl = getApiUrl();
      await fetch(new URL("/api/auth/forgot-password", baseUrl).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: forgotUsername.trim() }),
      });
      setForgotStep("code");
    } catch {
      setForgotError("Network error. Please try again.");
    }
    setForgotLoading(false);
  }

  async function handleResetPassword() {
    if (!forgotNewPassword || forgotNewPassword !== forgotConfirm) {
      setForgotError(t.auth.passwordsDontMatch);
      return;
    }
    if (forgotNewPassword.length < 8) {
      setForgotError("Password must be at least 8 characters");
      return;
    }
    setForgotLoading(true);
    setForgotError("");
    try {
      const baseUrl = getApiUrl();
      const res = await fetch(new URL("/api/auth/reset-password", baseUrl).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: forgotUsername.trim(),
          code: forgotCode.trim(),
          newPassword: forgotNewPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setForgotError(data.error || "Invalid or expired code");
        setForgotLoading(false);
        return;
      }
      setForgotStep("success");
    } catch {
      setForgotError("Network error. Please try again.");
    }
    setForgotLoading(false);
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: webTopPad + insets.top }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      testID="login-screen"
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.logoSection}>
          <LinearGradient colors={[Colors.primary, Colors.accent]} style={styles.logoCircle}>
            <Feather name="dollar-sign" size={40} color="#0A0A0F" />
          </LinearGradient>
          <Text style={styles.appName}>CashClip</Text>
          <Text style={styles.tagline}>{t.auth.welcomeBack}</Text>
          <View style={{ marginTop: 16 }}>
            <LanguageToggle />
          </View>
        </View>

        <View style={styles.form}>
          {error ? (
            <View style={styles.errorBox}>
              <Feather name="alert-circle" size={16} color={Colors.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <View style={styles.inputWrapper}>
            <Feather name="user" size={18} color={Colors.textMuted} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder={t.auth.username}
              placeholderTextColor={Colors.textMuted}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              testID="login-username"
            />
          </View>

          <View style={styles.inputWrapper}>
            <Feather name="lock" size={18} color={Colors.textMuted} style={styles.inputIcon} />
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder={t.auth.password}
              placeholderTextColor={Colors.textMuted}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              testID="login-password"
            />
            <Pressable onPress={() => setShowPassword(!showPassword)} hitSlop={12}>
              <Feather name={showPassword ? "eye-off" : "eye"} size={18} color={Colors.textMuted} />
            </Pressable>
          </View>

          <Pressable
            onPress={handleLogin}
            disabled={loading || !username.trim() || !password}
            style={({ pressed }) => [
              styles.primaryBtn,
              { opacity: loading || !username.trim() || !password ? 0.5 : pressed ? 0.85 : 1 },
            ]}
            testID="login-submit"
          >
            <LinearGradient colors={[Colors.primary, "#00C853"]} style={styles.primaryBtnGradient}>
              {loading ? (
                <ActivityIndicator color="#0A0A0F" />
              ) : (
                <Text style={styles.primaryBtnText}>{t.auth.signIn}</Text>
              )}
            </LinearGradient>
          </Pressable>

          <Pressable
            onPress={openForgot}
            style={styles.forgotBtn}
            testID="login-forgot-password"
          >
            <Text style={styles.forgotText}>{t.auth.forgotPassword}</Text>
          </Pressable>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>{t.auth.dontHaveAccount}</Text>
          <Pressable onPress={() => router.replace("/(auth)/register")} testID="login-go-register">
            <Text style={styles.footerLink}>{t.auth.signUp}</Text>
          </Pressable>
        </View>

        <Modal
          visible={showForgot}
          transparent
          animationType="fade"
          onRequestClose={closeForgot}
        >
          <Pressable style={styles.modalOverlay} onPress={closeForgot}>
            <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>

              {forgotStep === "username" && (
                <>
                  <View style={styles.modalIconRow}>
                    <View style={styles.modalIconCircle}>
                      <Feather name="lock" size={24} color={Colors.primary} />
                    </View>
                  </View>
                  <Text style={styles.modalTitle}>{t.auth.forgotPasswordTitle}</Text>
                  <Text style={styles.modalDesc}>{t.auth.forgotPasswordDesc}</Text>
                  {forgotError ? (
                    <View style={styles.forgotErrorBox}>
                      <Text style={styles.forgotErrorText}>{forgotError}</Text>
                    </View>
                  ) : null}
                  <View style={[styles.inputWrapper, { width: "100%", marginBottom: 12 }]}>
                    <Feather name="user" size={16} color={Colors.textMuted} style={styles.inputIcon} />
                    <TextInput
                      style={styles.input}
                      placeholder={t.auth.username}
                      placeholderTextColor={Colors.textMuted}
                      value={forgotUsername}
                      onChangeText={setForgotUsername}
                      autoCapitalize="none"
                      autoCorrect={false}
                      testID="forgot-username-input"
                    />
                  </View>
                  <Pressable
                    style={({ pressed }) => [
                      styles.primaryModalBtn,
                      { opacity: forgotLoading || !forgotUsername.trim() ? 0.5 : pressed ? 0.85 : 1 },
                    ]}
                    onPress={handleSendCode}
                    disabled={forgotLoading || !forgotUsername.trim()}
                    testID="forgot-send-code"
                  >
                    {forgotLoading ? (
                      <ActivityIndicator color="#0A0A0F" />
                    ) : (
                      <Text style={styles.primaryModalBtnText}>{t.auth.sendCode}</Text>
                    )}
                  </Pressable>
                  <Pressable onPress={closeForgot} style={styles.backBtn} testID="forgot-back">
                    <Text style={styles.backBtnText}>{t.auth.backToLogin}</Text>
                  </Pressable>
                </>
              )}

              {forgotStep === "code" && (
                <>
                  <View style={styles.modalIconRow}>
                    <View style={styles.modalIconCircle}>
                      <Feather name="mail" size={24} color={Colors.primary} />
                    </View>
                  </View>
                  <Text style={styles.modalTitle}>{t.auth.checkEmailTitle}</Text>
                  <Text style={styles.modalDesc}>{t.auth.checkEmailDesc}</Text>
                  {forgotError ? (
                    <View style={styles.forgotErrorBox}>
                      <Text style={styles.forgotErrorText}>{forgotError}</Text>
                    </View>
                  ) : null}
                  <View style={[styles.inputWrapper, { width: "100%", marginBottom: 10 }]}>
                    <Feather name="hash" size={16} color={Colors.textMuted} style={styles.inputIcon} />
                    <TextInput
                      style={styles.input}
                      placeholder={t.auth.resetCode}
                      placeholderTextColor={Colors.textMuted}
                      value={forgotCode}
                      onChangeText={setForgotCode}
                      keyboardType="number-pad"
                      maxLength={6}
                      testID="forgot-code-input"
                    />
                  </View>
                  <View style={[styles.inputWrapper, { width: "100%", marginBottom: 10 }]}>
                    <Feather name="lock" size={16} color={Colors.textMuted} style={styles.inputIcon} />
                    <TextInput
                      style={[styles.input, { flex: 1 }]}
                      placeholder={t.auth.newPassword}
                      placeholderTextColor={Colors.textMuted}
                      value={forgotNewPassword}
                      onChangeText={setForgotNewPassword}
                      secureTextEntry={!forgotShowPw}
                      testID="forgot-new-password-input"
                    />
                    <Pressable onPress={() => setForgotShowPw(!forgotShowPw)} hitSlop={12}>
                      <Feather name={forgotShowPw ? "eye-off" : "eye"} size={16} color={Colors.textMuted} />
                    </Pressable>
                  </View>
                  <View style={[styles.inputWrapper, { width: "100%", marginBottom: 12 }]}>
                    <Feather name="lock" size={16} color={Colors.textMuted} style={styles.inputIcon} />
                    <TextInput
                      style={styles.input}
                      placeholder={t.auth.confirmPassword}
                      placeholderTextColor={Colors.textMuted}
                      value={forgotConfirm}
                      onChangeText={setForgotConfirm}
                      secureTextEntry={!forgotShowPw}
                      testID="forgot-confirm-password-input"
                    />
                  </View>
                  <Pressable
                    style={({ pressed }) => [
                      styles.primaryModalBtn,
                      { opacity: forgotLoading || !forgotCode.trim() || !forgotNewPassword ? 0.5 : pressed ? 0.85 : 1 },
                    ]}
                    onPress={handleResetPassword}
                    disabled={forgotLoading || !forgotCode.trim() || !forgotNewPassword}
                    testID="forgot-reset-submit"
                  >
                    {forgotLoading ? (
                      <ActivityIndicator color="#0A0A0F" />
                    ) : (
                      <Text style={styles.primaryModalBtnText}>{t.auth.resetPassword}</Text>
                    )}
                  </Pressable>
                  <Pressable onPress={() => { setForgotStep("username"); setForgotError(""); }} style={styles.backBtn}>
                    <Text style={styles.backBtnText}>{t.auth.backToLogin}</Text>
                  </Pressable>
                </>
              )}

              {forgotStep === "success" && (
                <>
                  <View style={styles.modalIconRow}>
                    <View style={[styles.modalIconCircle, { backgroundColor: "rgba(0,230,118,0.15)" }]}>
                      <Feather name="check-circle" size={28} color={Colors.primary} />
                    </View>
                  </View>
                  <Text style={styles.modalTitle}>{t.auth.resetSuccessTitle}</Text>
                  <Text style={styles.modalDesc}>{t.auth.resetSuccessDesc}</Text>
                  <Pressable
                    style={({ pressed }) => [styles.primaryModalBtn, { opacity: pressed ? 0.85 : 1 }]}
                    onPress={() => { closeForgot(); setUsername(forgotUsername); }}
                    testID="forgot-success-signin"
                  >
                    <Text style={styles.primaryModalBtnText}>{t.auth.signIn}</Text>
                  </Pressable>
                </>
              )}

            </Pressable>
          </Pressable>
        </Modal>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 24, paddingBottom: 40 },
  logoSection: { alignItems: "center", marginBottom: 40 },
  logoCircle: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  appName: { fontFamily: "Outfit_700Bold", fontSize: 32, color: Colors.text, marginBottom: 4 },
  tagline: { fontFamily: "Outfit_400Regular", fontSize: 16, color: Colors.textSecondary },
  form: { gap: 14 },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(244,67,54,0.12)", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "rgba(244,67,54,0.3)" },
  errorText: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: Colors.error, flex: 1 },
  inputWrapper: { flexDirection: "row", alignItems: "center", backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 14, height: 52 },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, fontFamily: "Outfit_400Regular", fontSize: 15, color: Colors.text, height: "100%" as any },
  primaryBtn: { borderRadius: 14, overflow: "hidden", marginTop: 4 },
  primaryBtnGradient: { height: 52, alignItems: "center", justifyContent: "center", borderRadius: 14 },
  primaryBtnText: { fontFamily: "Outfit_700Bold", fontSize: 16, color: "#0A0A0F" },
  forgotBtn: { alignSelf: "center", marginTop: 4, paddingVertical: 8 },
  forgotText: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: Colors.primary },
  footer: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, marginTop: 32 },
  footerText: { fontFamily: "Outfit_400Regular", fontSize: 14, color: Colors.textSecondary },
  footerLink: { fontFamily: "Outfit_700Bold", fontSize: 14, color: Colors.primary },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", alignItems: "center", padding: 24 },
  modalContent: { backgroundColor: Colors.surface, borderRadius: 24, padding: 28, width: "100%", maxWidth: 360, alignItems: "center", borderWidth: 1, borderColor: Colors.border },
  modalIconRow: { marginBottom: 16 },
  modalIconCircle: { width: 56, height: 56, borderRadius: 28, backgroundColor: "rgba(0,230,118,0.1)", alignItems: "center", justifyContent: "center" },
  modalTitle: { fontFamily: "Outfit_700Bold", fontSize: 20, color: Colors.text, marginBottom: 10, textAlign: "center" },
  modalDesc: { fontFamily: "Outfit_400Regular", fontSize: 14, color: Colors.textSecondary, textAlign: "center", lineHeight: 21, marginBottom: 18, width: "100%" },
  forgotErrorBox: { backgroundColor: "rgba(244,67,54,0.12)", borderRadius: 10, padding: 10, marginBottom: 10, width: "100%", borderWidth: 1, borderColor: "rgba(244,67,54,0.3)" },
  forgotErrorText: { fontFamily: "Outfit_400Regular", fontSize: 13, color: Colors.error, textAlign: "center" },
  primaryModalBtn: { backgroundColor: Colors.primary, borderRadius: 14, height: 50, alignItems: "center", justifyContent: "center", width: "100%" },
  primaryModalBtnText: { fontFamily: "Outfit_700Bold", fontSize: 15, color: "#0A0A0F" },
  backBtn: { marginTop: 14, paddingVertical: 8 },
  backBtnText: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: Colors.textSecondary },
});
