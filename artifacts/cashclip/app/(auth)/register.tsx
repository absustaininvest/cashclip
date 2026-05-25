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
  Linking,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import { useAuth } from "@/lib/AuthContext";
import { useLanguage } from "@/lib/LanguageContext";
import { addNotification } from "@/lib/storage";
import LanguageToggle from "@/components/LanguageToggle";

const PERKS = [
  { icon: "dollar-sign", label: "Earn Real Cash" },
  { icon: "zap",         label: "Free to Join"  },
  { icon: "send",        label: "Fast Payouts"  },
];

export default function RegisterScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { register } = useAuth();
  const { t } = useLanguage();

  const [username, setUsername]           = useState("");
  const [email, setEmail]                 = useState("");
  const [password, setPassword]           = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [referralCode, setReferralCode]   = useState("");
  const [showPassword, setShowPassword]   = useState(false);
  const [showReferral, setShowReferral]   = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [loading, setLoading]             = useState(false);
  const [error, setError]                 = useState("");

  const webTopPad = Platform.OS === "web" ? 67 : 0;

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const usernameCharValid = username.trim().length === 0 || /^[a-zA-Z0-9_-]+$/.test(username.trim());
  const isValid =
    username.trim().length >= 3 &&
    username.trim().length <= 30 &&
    usernameCharValid &&
    email.trim().length > 0 &&
    emailValid &&
    password.length >= 8 &&
    password.length <= 72 &&
    confirmPassword.length > 0 &&
    agreedToTerms;

  async function handleRegister() {
    if (!isValid) return;
    if (password !== confirmPassword) {
      setError(t.auth.passwordsDontMatch);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    setError("");
    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const result = await register(
      username.trim(),
      password,
      email.trim(),
      referralCode.trim() || undefined,
    );
    setLoading(false);
    if (!result.success) {
      setError(result.error || "Registration failed");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await addNotification({
        title: "Welcome to CashClip! 🎉",
        message:
          "You're all set! Complete surveys, watch videos, play games, and refer friends to start earning real cash. Withdraw anytime via PayPal.",
        type: "promo",
      });
    }
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: webTopPad + insets.top }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      testID="register-screen"
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Logo ── */}
        <View style={styles.logoSection}>
          <LinearGradient colors={[Colors.primary, Colors.accent]} style={styles.logoCircle}>
            <Feather name="user-plus" size={34} color="#0A0A0F" />
          </LinearGradient>
          <Text style={styles.appName}>CashClip</Text>
          <Text style={styles.tagline}>{t.auth.createAccount}</Text>
        </View>

        {/* ── Language toggle ── */}
        <View style={{ marginBottom: 16 }}>
          <LanguageToggle />
        </View>

        {/* ── Perk pills ── */}
        <View style={styles.perksRow}>
          {PERKS.map((p) => (
            <View key={p.label} style={styles.perkPill}>
              <Feather name={p.icon as any} size={13} color={Colors.primary} />
              <Text style={styles.perkText}>{p.label}</Text>
            </View>
          ))}
        </View>

        {/* ── Form ── */}
        <View style={styles.form}>
          {error ? (
            <View style={styles.errorBox}>
              <Feather name="alert-circle" size={16} color={Colors.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* Username */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Username <Text style={styles.required}>*</Text></Text>
            <View style={[styles.inputWrapper, username.trim().length > 0 && (!usernameCharValid || username.trim().length < 3 || username.trim().length > 30) && styles.inputError]}>
              <Feather name="user" size={17} color={Colors.textMuted} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="3–30 chars, letters/numbers/_/-"
                placeholderTextColor={Colors.textMuted}
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={30}
                testID="register-username"
              />
              {username.trim().length >= 3 && username.trim().length <= 30 && usernameCharValid && (
                <Feather name="check-circle" size={16} color={Colors.primary} />
              )}
            </View>
            {username.trim().length > 0 && !usernameCharValid && (
              <Text style={styles.fieldHint}>Letters, numbers, underscores, and hyphens only</Text>
            )}
          </View>

          {/* Email */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Email <Text style={styles.required}>*</Text></Text>
            <View style={[styles.inputWrapper, email.length > 0 && !emailValid && styles.inputError]}>
              <Feather name="mail" size={17} color={Colors.textMuted} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="you@example.com"
                placeholderTextColor={Colors.textMuted}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                testID="register-email"
              />
              {email.length > 0 && emailValid && (
                <Feather name="check-circle" size={16} color={Colors.primary} />
              )}
            </View>
          </View>

          {/* Password */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Password <Text style={styles.required}>*</Text></Text>
            <View style={[styles.inputWrapper, password.length > 0 && password.length < 8 && styles.inputError]}>
              <Feather name="lock" size={17} color={Colors.textMuted} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="At least 8 characters"
                placeholderTextColor={Colors.textMuted}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                testID="register-password"
              />
              <Pressable onPress={() => setShowPassword(!showPassword)} hitSlop={12}>
                <Feather name={showPassword ? "eye-off" : "eye"} size={17} color={Colors.textMuted} />
              </Pressable>
            </View>
            {password.length > 0 && password.length < 8 && (
              <Text style={styles.fieldHint}>Must be at least 8 characters</Text>
            )}
            {password.length > 72 && (
              <Text style={styles.fieldHint}>Must be 72 characters or fewer</Text>
            )}
          </View>

          {/* Confirm Password */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Confirm Password <Text style={styles.required}>*</Text></Text>
            <View style={[styles.inputWrapper, confirmPassword.length > 0 && confirmPassword !== password && styles.inputError]}>
              <Feather name="lock" size={17} color={Colors.textMuted} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Re-enter your password"
                placeholderTextColor={Colors.textMuted}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry={!showPassword}
                testID="register-confirm-password"
              />
              {confirmPassword.length > 0 && confirmPassword === password && (
                <Feather name="check-circle" size={16} color={Colors.primary} />
              )}
            </View>
          </View>

          {/* Referral code (collapsible) */}
          <Pressable
            onPress={() => { setShowReferral(!showReferral); Haptics.selectionAsync(); }}
            style={styles.referralToggle}
          >
            <Feather name={showReferral ? "chevron-up" : "chevron-down"} size={15} color={Colors.textMuted} />
            <Text style={styles.referralToggleText}>Have a referral code?</Text>
          </Pressable>
          {showReferral && (
            <View style={styles.inputWrapper}>
              <Feather name="gift" size={17} color={Colors.textMuted} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Enter referral code"
                placeholderTextColor={Colors.textMuted}
                value={referralCode}
                onChangeText={setReferralCode}
                autoCapitalize="none"
                autoCorrect={false}
                testID="register-referral"
              />
            </View>
          )}

          {/* Terms checkbox */}
          <Pressable
            onPress={() => { setAgreedToTerms(!agreedToTerms); Haptics.selectionAsync(); }}
            style={styles.termsRow}
            testID="register-terms"
          >
            <View style={[styles.checkbox, agreedToTerms && styles.checkboxChecked]}>
              {agreedToTerms && <Feather name="check" size={12} color="#0A0A0F" />}
            </View>
            <Text style={styles.termsText}>
              I agree to the{" "}
              <Text
                style={styles.termsLink}
                onPress={() => Linking.openURL("https://absustaininvest.com/cashclip/terms")}
              >
                Terms of Service
              </Text>
              {" "}and{" "}
              <Text
                style={styles.termsLink}
                onPress={() => Linking.openURL("https://absustaininvest.com/cashclip/privacy")}
              >
                Privacy Policy
              </Text>
            </Text>
          </Pressable>

          {/* Submit */}
          <Pressable
            onPress={handleRegister}
            disabled={loading || !isValid}
            style={({ pressed }) => [
              styles.primaryBtn,
              { opacity: loading || !isValid ? 0.45 : pressed ? 0.85 : 1 },
            ]}
            testID="register-submit"
          >
            <LinearGradient colors={[Colors.primary, "#00C853"]} style={styles.primaryBtnGradient}>
              {loading ? (
                <ActivityIndicator color="#0A0A0F" />
              ) : (
                <>
                  <Feather name="user-plus" size={16} color="#0A0A0F" />
                  <Text style={styles.primaryBtnText}>Create Account</Text>
                </>
              )}
            </LinearGradient>
          </Pressable>
        </View>

        {/* ── Footer ── */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>{t.auth.alreadyHaveAccount}</Text>
          <Pressable onPress={() => router.replace("/(auth)/login")} testID="register-go-login">
            <Text style={styles.footerLink}>{t.auth.signIn}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container:          { flex: 1, backgroundColor: Colors.background },
  scrollContent:      { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 48, paddingTop: 16 },

  // Logo
  logoSection:        { alignItems: "center", marginBottom: 20 },
  logoCircle:         { width: 76, height: 76, borderRadius: 38, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  appName:            { fontFamily: "Outfit_700Bold", fontSize: 30, color: Colors.text, marginBottom: 4 },
  tagline:            { fontFamily: "Outfit_400Regular", fontSize: 15, color: Colors.textSecondary },

  // Perks
  perksRow:           { flexDirection: "row", justifyContent: "center", gap: 8, marginBottom: 24 },
  perkPill:           { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: `${Colors.primary}14`, borderWidth: 1, borderColor: `${Colors.primary}28`, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  perkText:           { fontFamily: "Outfit_600SemiBold", fontSize: 11, color: Colors.primary },

  // Form
  form:               { gap: 4 },
  errorBox:           { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(244,67,54,0.12)", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "rgba(244,67,54,0.3)", marginBottom: 8 },
  errorText:          { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: Colors.error, flex: 1 },

  fieldGroup:         { marginBottom: 10 },
  fieldLabel:         { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: Colors.textSecondary, marginBottom: 6 },
  required:           { color: Colors.error },
  optional:           { fontFamily: "Outfit_400Regular", fontSize: 12, color: Colors.textMuted },
  fieldHint:          { fontFamily: "Outfit_400Regular", fontSize: 12, color: Colors.error, marginTop: 4 },

  inputWrapper:       { flexDirection: "row", alignItems: "center", backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 14, height: 50 },
  inputError:         { borderColor: Colors.error },
  inputIcon:          { marginRight: 10 },
  input:              { flex: 1, fontFamily: "Outfit_400Regular", fontSize: 15, color: Colors.text, height: "100%" as any },

  referralToggle:     { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", marginBottom: 8, paddingVertical: 4 },
  referralToggleText: { fontFamily: "Outfit_400Regular", fontSize: 13, color: Colors.textMuted },

  termsRow:           { flexDirection: "row", alignItems: "flex-start", gap: 10, marginTop: 6, marginBottom: 14 },
  checkbox:           { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.surface, alignItems: "center", justifyContent: "center", marginTop: 1 },
  checkboxChecked:    { backgroundColor: Colors.primary, borderColor: Colors.primary },
  termsText:          { fontFamily: "Outfit_400Regular", fontSize: 13, color: Colors.textSecondary, flex: 1, lineHeight: 20 },
  termsLink:          { fontFamily: "Outfit_600SemiBold", color: Colors.primary },

  primaryBtn:         { borderRadius: 14, overflow: "hidden" },
  primaryBtnGradient: { height: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14 },
  primaryBtnText:     { fontFamily: "Outfit_700Bold", fontSize: 16, color: "#0A0A0F" },

  footer:             { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, marginTop: 28 },
  footerText:         { fontFamily: "Outfit_400Regular", fontSize: 14, color: Colors.textSecondary },
  footerLink:         { fontFamily: "Outfit_700Bold", fontSize: 14, color: Colors.primary },
});
