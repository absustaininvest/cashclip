import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Platform,
  Alert,
  Switch,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import * as LocalAuthentication from "expo-local-authentication";
import { useRouter } from "expo-router";
import { useFonts, Outfit_400Regular, Outfit_600SemiBold, Outfit_700Bold } from "@expo-google-fonts/outfit";
import Colors from "@/constants/colors";
import { useAuth } from "@/lib/AuthContext";
import { useLanguage } from "@/lib/LanguageContext";
import { getApiUrl } from "@/lib/query-client";

function DeleteAccountSection({ token, onDeleted }: { token: string | null; onDeleted: () => void }) {
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { t } = useLanguage();

  const handleDelete = useCallback(() => {
    if (!password) { setError(t.security.enterPasswordFirst); return; }
    Alert.alert(
      t.security.deleteAlertTitle,
      t.security.deleteAlertMessage,
      [
        { text: t.security.deleteAlertCancel, style: "cancel" },
        {
          text: t.security.deleteAlertConfirm,
          style: "destructive",
          onPress: async () => {
            setLoading(true);
            setError("");
            try {
              const baseUrl = getApiUrl();
              const res = await fetch(new URL("/api/auth/account", baseUrl).toString(), {
                method: "DELETE",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ password }),
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data.error || t.errors.somethingWentWrong);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              onDeleted();
            } catch (err: any) {
              setError(err.message || t.errors.somethingWentWrong);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  }, [password, token, onDeleted, t]);

  return (
    <View style={{ backgroundColor: "rgba(255,107,107,0.06)", borderRadius: 14, padding: 16, marginBottom: 24, borderWidth: 1, borderColor: "rgba(255,107,107,0.2)" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <Feather name="trash-2" size={18} color="#FF6B6B" />
        <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 15, color: "#FF6B6B" }}>{t.security.deleteAccount}</Text>
      </View>
      <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: Colors.textMuted, marginBottom: 14, lineHeight: 18 }}>
        {t.security.deleteAccountDesc}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: Colors.background, borderRadius: 12, borderWidth: 1, borderColor: error ? "rgba(255,107,107,0.5)" : Colors.border, paddingHorizontal: 12, height: 46, marginBottom: 10 }}>
        <TextInput
          style={{ flex: 1, fontFamily: "Outfit_400Regular", fontSize: 14, color: Colors.text, height: "100%" as any }}
          placeholder={t.security.confirmPasswordPlaceholder}
          placeholderTextColor={Colors.textMuted}
          secureTextEntry={!showPw}
          value={password}
          onChangeText={(v) => { setPassword(v); setError(""); }}
          autoCapitalize="none"
          testID="delete-account-password"
        />
        <Pressable onPress={() => setShowPw((v) => !v)} hitSlop={8}>
          <Feather name={showPw ? "eye-off" : "eye"} size={18} color={Colors.textMuted} />
        </Pressable>
      </View>
      {error ? (
        <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: "#FF6B6B", marginBottom: 8 }}>{error}</Text>
      ) : null}
      <Pressable
        onPress={handleDelete}
        disabled={loading || !password}
        style={({ pressed }) => ({ backgroundColor: loading || !password ? "rgba(255,107,107,0.3)" : "rgba(255,107,107,0.9)", borderRadius: 12, height: 46, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.85 : 1 })}
        testID="delete-account-submit"
      >
        {loading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 15, color: "#fff" }}>{t.security.deleteMyAccount}</Text>}
      </Pressable>
    </View>
  );
}
import {
  getSecuritySettings,
  setAppPin,
  verifyPin,
  removeAppPin,
  setBiometricEnabled,
  getAccountAge,
  getDailyEarnings,
  getFraudFlags,
  getFraudProtectionConfig,
  type FraudFlag,
} from "@/lib/storage";

export default function SecurityScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token, logout } = useAuth();
  const { t } = useLanguage();
  const [pinEnabled, setPinEnabled] = useState(false);
  const [biometricEnabled, setBiometricState] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricType, setBiometricType] = useState("");
  const [showPinSetup, setShowPinSetup] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [confirmPinInput, setConfirmPinInput] = useState("");
  const [pinStep, setPinStep] = useState<"enter" | "confirm">("enter");
  const [accountAge, setAccountAge] = useState(0);
  const [dailyEarnings, setDailyEarnings] = useState(0);
  const [fraudFlags, setFraudFlags] = useState<FraudFlag[]>([]);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState("");

  const [fontsLoaded] = useFonts({ Outfit_400Regular, Outfit_600SemiBold, Outfit_700Bold });

  const config = getFraudProtectionConfig();

  const handleChangePassword = useCallback(async () => {
    setPwError("");
    setPwSuccess("");
    if (!currentPassword || !newPassword || !confirmNewPassword) {
      setPwError(t.security.allFieldsRequired);
      return;
    }
    if (newPassword.length < 8) {
      setPwError(t.security.passwordTooShort);
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPwError(t.security.passwordsDontMatch);
      return;
    }
    setPwLoading(true);
    try {
      const { getApiUrl } = await import("@/lib/query-client");
      const baseUrl = getApiUrl();
      const res = await fetch(new URL("/api/auth/change-password", baseUrl).toString(), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t.errors.somethingWentWrong);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPwSuccess(t.security.passwordUpdated);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
    } catch (err: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setPwError(err.message || t.errors.somethingWentWrong);
    } finally {
      setPwLoading(false);
    }
  }, [currentPassword, newPassword, confirmNewPassword, token, t]);

  const loadData = useCallback(async () => {
    const settings = await getSecuritySettings();
    setPinEnabled(settings.pinEnabled);
    setBiometricState(settings.biometricEnabled);

    const age = await getAccountAge();
    setAccountAge(age);

    const earnings = await getDailyEarnings();
    setDailyEarnings(earnings);

    const flags = await getFraudFlags();
    setFraudFlags(flags);

    if (Platform.OS !== "web") {
      try {
        const compatible = await LocalAuthentication.hasHardwareAsync();
        setBiometricAvailable(compatible);
        if (compatible) {
          const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
          if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
            setBiometricType(t.security.biometricFaceId);
          } else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
            setBiometricType(t.security.biometricFingerprint);
          } else {
            setBiometricType(t.security.biometricGeneric);
          }
        }
      } catch {
        setBiometricAvailable(false);
      }
    }
  }, []);

  useEffect(() => { loadData(); }, []);

  const handlePinToggle = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (pinEnabled) {
      await removeAppPin();
      setPinEnabled(false);
      if (biometricEnabled) {
        await setBiometricEnabled(false);
        setBiometricState(false);
      }
    } else {
      setShowPinSetup(true);
      setPinStep("enter");
      setPinInput("");
      setConfirmPinInput("");
    }
  }, [pinEnabled, biometricEnabled]);

  const handleBiometricToggle = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!pinEnabled) {
      Alert.alert(t.common.ok, t.profile.privacySecurity);
      return;
    }
    const newValue = !biometricEnabled;
    if (newValue && Platform.OS !== "web") {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: biometricType || t.security.authenticatePrompt,
        disableDeviceFallback: false,
      });
      if (!result.success) return;
    }
    await setBiometricEnabled(newValue);
    setBiometricState(newValue);
  }, [biometricEnabled, pinEnabled, biometricType, t]);

  const handlePinSubmit = useCallback(async () => {
    if (pinStep === "enter") {
      if (pinInput.length < 4) return;
      setPinStep("confirm");
      setConfirmPinInput("");
    } else {
      if (confirmPinInput !== pinInput) {
        Alert.alert(t.common.ok, t.security.pinsDontMatch);
        setPinInput("");
        setConfirmPinInput("");
        setPinStep("enter");
        return;
      }
      await setAppPin(pinInput);
      setPinEnabled(true);
      setShowPinSetup(false);
      setPinInput("");
      setConfirmPinInput("");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [pinStep, pinInput, confirmPinInput, t]);

  if (!fontsLoaded) return null;

  const webTopPad = Platform.OS === "web" ? 67 : 0;

  return (
    <View style={[styles.container, { paddingTop: webTopPad }]}>
      <View style={[styles.header, { paddingTop: Platform.OS === "web" ? 0 : insets.top }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} testID="security-back">
          <Feather name="arrow-left" size={22} color={Colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>{t.profile.privacySecurity}</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: Platform.OS === "web" ? 34 : 16, paddingHorizontal: 16 }}
      >
        <LinearGradient colors={["#1A1A2E", "#0D1B2A"]} style={styles.securityCard}>
          <View style={styles.shieldRow}>
            <Ionicons name="shield-checkmark" size={32} color={Colors.primary} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.securityTitle}>{t.profile.privacySecurity}</Text>
              <Text style={styles.securitySubtitle}>
                {pinEnabled || biometricEnabled ? t.security.protectedSubtitle : t.security.notProtectedSubtitle}
              </Text>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: pinEnabled ? "rgba(0,230,118,0.15)" : "rgba(255,107,107,0.15)" }]}>
              <View style={[styles.statusDot, { backgroundColor: pinEnabled ? Colors.primary : "#FF6B6B" }]} />
              <Text style={[styles.statusText, { color: pinEnabled ? Colors.primary : "#FF6B6B" }]}>
                {pinEnabled ? t.security.statusOn : t.security.statusOff}
              </Text>
            </View>
          </View>
        </LinearGradient>

        <Text style={styles.sectionTitle}>{t.security.appLock}</Text>

        <View style={styles.settingCard}>
          <View style={styles.settingRow}>
            <View style={[styles.settingIcon, { backgroundColor: "rgba(0,230,118,0.1)" }]}>
              <Feather name="lock" size={18} color={Colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>{t.security.pinLock}</Text>
              <Text style={styles.settingDesc}>{t.security.pinLockDesc}</Text>
            </View>
            <Switch
              value={pinEnabled}
              onValueChange={handlePinToggle}
              trackColor={{ false: Colors.border, true: Colors.primary }}
              thumbColor="#fff"
              testID="pin-toggle"
            />
          </View>
        </View>

        {biometricAvailable && (
          <View style={styles.settingCard}>
            <View style={styles.settingRow}>
              <View style={[styles.settingIcon, { backgroundColor: "rgba(124,77,255,0.1)" }]}>
                <Ionicons name="finger-print" size={18} color="#7C4DFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.settingLabel}>{biometricType}</Text>
                <Text style={styles.settingDesc}>{t.security.useToUnlock.replace("{{biometric}}", biometricType.toLowerCase())}</Text>
              </View>
              <Switch
                value={biometricEnabled}
                onValueChange={handleBiometricToggle}
                trackColor={{ false: Colors.border, true: "#7C4DFF" }}
                thumbColor="#fff"
                disabled={!pinEnabled}
                testID="biometric-toggle"
              />
            </View>
          </View>
        )}

        <Text style={styles.sectionTitle}>{t.security.changePassword}</Text>

        <View style={styles.settingCard}>
          <View style={[styles.settingRow, { marginBottom: 14 }]}>
            <View style={[styles.settingIcon, { backgroundColor: "rgba(0,230,118,0.1)" }]}>
              <Feather name="key" size={18} color={Colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>{t.security.accountPassword}</Text>
              <Text style={styles.settingDesc}>{t.security.accountPasswordDesc}</Text>
            </View>
          </View>

          <View style={styles.pwInputWrapper}>
            <TextInput
              style={styles.pwInput}
              placeholder={t.security.currentPasswordPlaceholder}
              placeholderTextColor={Colors.textMuted}
              value={currentPassword}
              onChangeText={setCurrentPassword}
              secureTextEntry={!showCurrentPw}
              autoCapitalize="none"
              testID="current-password"
            />
            <Pressable onPress={() => setShowCurrentPw(!showCurrentPw)} hitSlop={12}>
              <Feather name={showCurrentPw ? "eye-off" : "eye"} size={16} color={Colors.textMuted} />
            </Pressable>
          </View>

          <View style={styles.pwInputWrapper}>
            <TextInput
              style={styles.pwInput}
              placeholder={t.security.newPasswordPlaceholder}
              placeholderTextColor={Colors.textMuted}
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry={!showNewPw}
              autoCapitalize="none"
              testID="new-password"
            />
            <Pressable onPress={() => setShowNewPw(!showNewPw)} hitSlop={12}>
              <Feather name={showNewPw ? "eye-off" : "eye"} size={16} color={Colors.textMuted} />
            </Pressable>
          </View>

          <View style={[styles.pwInputWrapper, { marginBottom: 12 }]}>
            <TextInput
              style={styles.pwInput}
              placeholder={t.security.confirmNewPasswordPlaceholder}
              placeholderTextColor={Colors.textMuted}
              value={confirmNewPassword}
              onChangeText={setConfirmNewPassword}
              secureTextEntry
              autoCapitalize="none"
              testID="confirm-new-password"
            />
          </View>

          {pwError ? (
            <View style={styles.pwMessage}>
              <Feather name="alert-circle" size={14} color={Colors.error} />
              <Text style={[styles.pwMessageText, { color: Colors.error }]}>{pwError}</Text>
            </View>
          ) : null}
          {pwSuccess ? (
            <View style={[styles.pwMessage, { backgroundColor: "rgba(0,230,118,0.1)", borderColor: "rgba(0,230,118,0.2)" }]}>
              <Feather name="check-circle" size={14} color={Colors.primary} />
              <Text style={[styles.pwMessageText, { color: Colors.primary }]}>{pwSuccess}</Text>
            </View>
          ) : null}

          <Pressable
            onPress={handleChangePassword}
            disabled={pwLoading || !currentPassword || !newPassword || !confirmNewPassword}
            style={({ pressed }) => [
              styles.pwBtn,
              { opacity: pwLoading || !currentPassword || !newPassword || !confirmNewPassword ? 0.45 : pressed ? 0.85 : 1 },
            ]}
            testID="change-password-submit"
          >
            {pwLoading ? (
              <ActivityIndicator color="#0A0A0F" size="small" />
            ) : (
              <Text style={styles.pwBtnText}>{t.security.updatePassword}</Text>
            )}
          </Pressable>
        </View>

        <Text style={styles.sectionTitle}>{t.security.fraudProtection}</Text>

        <View style={styles.settingCard}>
          <View style={styles.protectionRow}>
            <View style={[styles.settingIcon, { backgroundColor: "rgba(255,214,0,0.1)" }]}>
              <Feather name="dollar-sign" size={18} color="#FFD600" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>{t.security.dailyEarningCap}</Text>
              <Text style={styles.settingDesc}>{t.security.dailyEarningCapDesc.replace("{{amount}}", config.dailyEarningCap.toFixed(2))}</Text>
            </View>
            <Text style={styles.protectionValue}>${dailyEarnings.toFixed(2)}</Text>
          </View>
          <View style={styles.progressBarBg}>
            <View style={[styles.progressBarFill, { width: `${Math.min(100, (dailyEarnings / config.dailyEarningCap) * 100)}%` }]} />
          </View>
        </View>

        <View style={styles.settingCard}>
          <View style={styles.protectionRow}>
            <View style={[styles.settingIcon, { backgroundColor: "rgba(78,205,196,0.1)" }]}>
              <Feather name="clock" size={18} color="#4ECDC4" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>{t.security.newAccountHold}</Text>
              <Text style={styles.settingDesc}>{t.security.newAccountHoldDesc.replace("{{days}}", String(config.withdrawalHoldDays))}</Text>
            </View>
            <Text style={[styles.protectionValue, { color: accountAge >= config.withdrawalHoldDays ? Colors.primary : "#FFD600" }]}>
              {accountAge >= config.withdrawalHoldDays ? t.security.holdCleared : t.security.holdDaysLeft.replace("{{days}}", String(config.withdrawalHoldDays - accountAge))}
            </Text>
          </View>
        </View>

        <View style={styles.settingCard}>
          <View style={styles.protectionRow}>
            <View style={[styles.settingIcon, { backgroundColor: "rgba(233,30,99,0.1)" }]}>
              <Feather name="shield" size={18} color="#E91E63" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>{t.security.withdrawalLimits}</Text>
              <Text style={styles.settingDesc}>{t.security.withdrawalLimitsDesc.replace("{{count}}", String(config.maxDailyWithdrawals))}</Text>
            </View>
            <Ionicons name="checkmark-circle" size={20} color={Colors.primary} />
          </View>
        </View>

        <View style={styles.settingCard}>
          <View style={styles.protectionRow}>
            <View style={[styles.settingIcon, { backgroundColor: "rgba(255,107,107,0.1)" }]}>
              <Feather name="alert-triangle" size={18} color="#FF6B6B" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>{t.security.activityMonitoring}</Text>
              <Text style={styles.settingDesc}>{t.security.activityMonitoringDesc}</Text>
            </View>
            <Ionicons name="checkmark-circle" size={20} color={Colors.primary} />
          </View>
        </View>

        {fraudFlags.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>{t.security.activityFlags.replace("{{count}}", String(fraudFlags.length))}</Text>
            {fraudFlags.slice(-5).map((flag) => (
              <View key={flag.id} style={[styles.settingCard, { borderColor: "rgba(255,107,107,0.3)" }]}>
                <View style={styles.protectionRow}>
                  <Ionicons name="warning" size={16} color="#FF6B6B" />
                  <View style={{ flex: 1, marginLeft: 8 }}>
                    <Text style={[styles.settingLabel, { fontSize: 13 }]}>{flag.type.replace(/_/g, " ")}</Text>
                    <Text style={styles.settingDesc}>{flag.description}</Text>
                  </View>
                </View>
              </View>
            ))}
          </>
        )}

        <View style={styles.infoCard}>
          <Feather name="info" size={16} color={Colors.textSecondary} />
          <Text style={styles.infoText}>{t.security.accountProtectedInfo}</Text>
        </View>

        <Text style={[styles.sectionTitle, { marginTop: 24, color: "#FF6B6B" }]}>{t.security.dangerZone}</Text>

        <DeleteAccountSection token={token} onDeleted={() => { logout(); }} />
      </ScrollView>

      {showPinSetup && (
        <View style={styles.pinOverlay}>
          <View style={styles.pinModal}>
            <Text style={styles.pinTitle}>
              {pinStep === "enter" ? t.security.setPinTitle : t.security.confirmPinTitle}
            </Text>
            <Text style={styles.pinSubtitle}>
              {pinStep === "enter" ? t.security.enterPinSubtitle : t.security.confirmPinSubtitle}
            </Text>

            <View style={styles.pinDots}>
              {[0, 1, 2, 3].map((i) => (
                <View
                  key={i}
                  style={[
                    styles.pinDot,
                    (pinStep === "enter" ? pinInput : confirmPinInput).length > i && styles.pinDotFilled,
                  ]}
                />
              ))}
            </View>

            <View style={styles.pinPad}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, -1, 0, -2].map((num) => {
                if (num === -1) return <View key="empty" style={styles.pinKey} />;
                if (num === -2) {
                  return (
                    <Pressable
                      key="delete"
                      style={styles.pinKey}
                      onPress={() => {
                        Haptics.selectionAsync();
                        if (pinStep === "enter") setPinInput((p) => p.slice(0, -1));
                        else setConfirmPinInput((p) => p.slice(0, -1));
                      }}
                    >
                      <Feather name="delete" size={22} color={Colors.text} />
                    </Pressable>
                  );
                }
                return (
                  <Pressable
                    key={num}
                    style={({ pressed }) => [styles.pinKey, pressed && styles.pinKeyPressed]}
                    onPress={() => {
                      Haptics.selectionAsync();
                      if (pinStep === "enter") {
                        const next = pinInput + num;
                        setPinInput(next);
                        if (next.length === 4) {
                          setTimeout(() => {
                            setPinStep("confirm");
                            setConfirmPinInput("");
                          }, 200);
                        }
                      } else {
                        const next = confirmPinInput + num;
                        setConfirmPinInput(next);
                        if (next.length === 4) {
                          setTimeout(() => {
                            if (next === pinInput) {
                              setAppPin(pinInput);
                              setPinEnabled(true);
                              setShowPinSetup(false);
                              setPinInput("");
                              setConfirmPinInput("");
                              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                            } else {
                              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
                              setPinInput("");
                              setConfirmPinInput("");
                              setPinStep("enter");
                            }
                          }, 200);
                        }
                      }
                    }}
                  >
                    <Text style={styles.pinKeyText}>{num}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              onPress={() => {
                setShowPinSetup(false);
                setPinInput("");
                setConfirmPinInput("");
              }}
              style={styles.pinCancel}
            >
              <Text style={styles.pinCancelText}>{t.admin.cancel}</Text>
            </Pressable>
          </View>
        </View>
      )}
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
  headerTitle: { fontFamily: "Outfit_700Bold", fontSize: 18, color: Colors.text },
  securityCard: { borderRadius: 16, padding: 20, marginBottom: 20, borderWidth: 1, borderColor: Colors.border },
  shieldRow: { flexDirection: "row", alignItems: "center" },
  securityTitle: { fontFamily: "Outfit_700Bold", fontSize: 18, color: Colors.text },
  securitySubtitle: { fontFamily: "Outfit_400Regular", fontSize: 13, color: Colors.textMuted, marginTop: 2 },
  statusBadge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontFamily: "Outfit_700Bold", fontSize: 12 },
  sectionTitle: { fontFamily: "Outfit_700Bold", fontSize: 16, color: Colors.text, marginBottom: 12, marginTop: 4 },
  settingCard: {
    backgroundColor: Colors.surface, borderRadius: 14, padding: 16, marginBottom: 10,
    borderWidth: 1, borderColor: Colors.border,
  },
  settingRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  protectionRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  settingIcon: {
    width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center",
  },
  settingLabel: { fontFamily: "Outfit_600SemiBold", fontSize: 15, color: Colors.text },
  settingDesc: { fontFamily: "Outfit_400Regular", fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  protectionValue: { fontFamily: "Outfit_700Bold", fontSize: 14, color: Colors.text },
  progressBarBg: { height: 4, backgroundColor: Colors.surfaceHighlight, borderRadius: 2, overflow: "hidden", marginTop: 12 },
  progressBarFill: { height: "100%", backgroundColor: Colors.primary, borderRadius: 2 },
  infoCard: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    backgroundColor: Colors.surface, borderRadius: 12, padding: 14, marginTop: 8,
    borderWidth: 1, borderColor: Colors.border,
  },
  infoText: { fontFamily: "Outfit_400Regular", fontSize: 13, color: Colors.textSecondary, flex: 1, lineHeight: 18 },
  pinOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.9)",
    justifyContent: "center",
    alignItems: "center",
  },
  pinModal: { width: "85%", maxWidth: 320, alignItems: "center" },
  pinTitle: { fontFamily: "Outfit_700Bold", fontSize: 22, color: Colors.text, marginBottom: 6 },
  pinSubtitle: { fontFamily: "Outfit_400Regular", fontSize: 14, color: Colors.textMuted, marginBottom: 28 },
  pinDots: { flexDirection: "row", gap: 16, marginBottom: 32 },
  pinDot: {
    width: 16, height: 16, borderRadius: 8, borderWidth: 2,
    borderColor: Colors.border, backgroundColor: "transparent",
  },
  pinDotFilled: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  pinPad: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 12, width: 260 },
  pinKey: {
    width: 72, height: 56, borderRadius: 14, alignItems: "center", justifyContent: "center",
    backgroundColor: Colors.surface,
  },
  pinKeyPressed: { backgroundColor: Colors.surfaceHighlight },
  pinKeyText: { fontFamily: "Outfit_700Bold", fontSize: 24, color: Colors.text },
  pinCancel: { marginTop: 24, paddingVertical: 12, paddingHorizontal: 24 },
  pinCancelText: { fontFamily: "Outfit_600SemiBold", fontSize: 15, color: Colors.textMuted },
  pwInputWrapper: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: Colors.background, borderRadius: 12, borderWidth: 1,
    borderColor: Colors.border, paddingHorizontal: 12, height: 46, marginBottom: 10,
  },
  pwInput: { flex: 1, fontFamily: "Outfit_400Regular", fontSize: 14, color: Colors.text, height: "100%" as any },
  pwMessage: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(244,67,54,0.1)", borderRadius: 10, padding: 10,
    borderWidth: 1, borderColor: "rgba(244,67,54,0.2)", marginBottom: 10,
  },
  pwMessageText: { fontFamily: "Outfit_400Regular", fontSize: 13, flex: 1 },
  pwBtn: {
    backgroundColor: Colors.primary, borderRadius: 12,
    height: 46, alignItems: "center", justifyContent: "center", marginTop: 4,
  },
  pwBtnText: { fontFamily: "Outfit_700Bold", fontSize: 15, color: "#0A0A0F" },
});
