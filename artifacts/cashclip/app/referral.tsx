import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Platform,
  Alert,
  KeyboardAvoidingView,
  TextInput,
  FlatList,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useFonts, Outfit_400Regular, Outfit_600SemiBold, Outfit_700Bold } from "@expo-google-fonts/outfit";
import { useRouter } from "expo-router";
import Colors from "@/constants/colors";
import { useLanguage } from "@/lib/LanguageContext";
import {
  getReferralCode,
  getReferrals,
  getTotalReferrals,
  getReferralEarnings,
  redeemReferralCode,
  type Referral,
} from "@/lib/storage";

export default function ReferralScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useLanguage();
  const [fontsLoaded] = useFonts({ Outfit_400Regular, Outfit_600SemiBold, Outfit_700Bold });

  const [referralCode, setReferralCode] = useState<string>("");
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [totalReferrals, setTotalReferrals] = useState<number>(0);
  const [referralEarnings, setReferralEarnings] = useState<number>(0);
  const [redeemCode, setRedeemCode] = useState<string>("");
  const [isRedeeming, setIsRedeeming] = useState<boolean>(false);

  const loadData = useCallback(async () => {
    const code = await getReferralCode();
    const refs = await getReferrals();
    const totalRefs = await getTotalReferrals();
    const earnings = await getReferralEarnings();

    setReferralCode(code);
    setReferrals(refs);
    setTotalReferrals(totalRefs);
    setReferralEarnings(earnings);
  }, []);

  useEffect(() => {
    loadData();
  }, []);

  const handleCopyCode = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(
      t.referral.copyReferralCode,
      `${t.referral.yourCodeIs}\n\n${referralCode}\n\n${t.referral.copyAndShare}`,
      [{ text: "OK", onPress: () => {} }]
    );
  };

  const handleShare = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const shareLink = `${t.referral.joinCashClip} ${referralCode}`;
    Alert.alert(
      t.referral.shareYourLink,
      shareLink,
      [{ text: "OK", onPress: () => {} }]
    );
  };

  const handleRedeem = async () => {
    if (!redeemCode.trim()) {
      Alert.alert(t.referral.errorTitle, t.referral.enterCode);
      return;
    }

    setIsRedeeming(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const result = await redeemReferralCode(redeemCode.trim());
    setIsRedeeming(false);

    Alert.alert(result.success ? t.referral.successTitle : t.referral.errorTitle, result.message, [
      {
        text: "OK",
        onPress: async () => {
          if (result.success) {
            setRedeemCode("");
            await loadData();
          }
        },
      },
    ]);
  };

  if (!fontsLoaded) return null;

  const webTopPad = Platform.OS === "web" ? 67 : 0;

  const renderReferralItem = ({ item }: { item: Referral }) => (
    <View style={styles.referralItem}>
      <View style={styles.referralItemContent}>
        <View style={styles.referralInfo}>
          <Text style={styles.referralName}>{item.name}</Text>
          <Text style={styles.referralDate}>
            {t.referral.joined} {new Date(item.joinedAt).toLocaleDateString()}
          </Text>
        </View>
        <View style={styles.referralEarning}>
          <Text style={styles.referralEarningAmount}>${item.earningsFromThem.toFixed(2)}</Text>
        </View>
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: Colors.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardAvoid}
        keyboardVerticalOffset={90}
      >
        <ScrollView
          style={[styles.scrollView, { paddingTop: webTopPad }]}
          contentContainerStyle={{ paddingBottom: Platform.OS === "web" ? 34 : 0 }}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.content}>
            <View style={styles.codeSection}>
              <LinearGradient
                colors={[Colors.primary, Colors.accent]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.codeCardGradient}
              >
                <View style={styles.codeCard}>
                  <Text style={styles.codeLabel}>{t.referral.yourReferralCode}</Text>
                  <Text style={styles.codeText}>{referralCode}</Text>
                  <Pressable
                    onPress={handleCopyCode}
                    style={({ pressed }) => [styles.copyButton, { opacity: pressed ? 0.7 : 1 }]}
                  >
                    <Feather name="copy" size={18} color={Colors.background} />
                    <Text style={styles.copyButtonText}>{t.referral.copy}</Text>
                  </Pressable>
                </View>
              </LinearGradient>
            </View>

            <Pressable
              onPress={handleShare}
              style={({ pressed }) => [styles.shareButton, { opacity: pressed ? 0.8 : 1 }]}
            >
              <LinearGradient
                colors={[Colors.accent, Colors.accent]}
                style={styles.shareButtonGradient}
              >
                <Feather name="share-2" size={20} color={Colors.background} />
                <Text style={styles.shareButtonText}>{t.referral.shareReferralLink}</Text>
              </LinearGradient>
            </Pressable>

            <View style={styles.statsSection}>
              <View style={styles.statCard}>
                <View style={styles.statIconContainer}>
                  <MaterialCommunityIcons name="account-multiple" size={24} color={Colors.primary} />
                </View>
                <View style={styles.statContent}>
                  <Text style={styles.statValue}>{totalReferrals}</Text>
                  <Text style={styles.statLabel}>{t.referral.totalReferrals}</Text>
                </View>
              </View>

              <View style={styles.statCard}>
                <View style={styles.statIconContainer}>
                  <MaterialCommunityIcons name="cash-multiple" size={24} color={Colors.accent} />
                </View>
                <View style={styles.statContent}>
                  <Text style={styles.statValue}>${referralEarnings.toFixed(2)}</Text>
                  <Text style={styles.statLabel}>{t.referral.referralEarnings}</Text>
                </View>
              </View>
            </View>

            <View style={styles.redeemSection}>
              <Text style={styles.sectionTitle}>{t.referral.redeemACode}</Text>
              <View style={styles.inputContainer}>
                <TextInput
                  style={styles.input}
                  placeholder={t.referral.enterReferralCode}
                  placeholderTextColor={Colors.textMuted}
                  value={redeemCode}
                  onChangeText={setRedeemCode}
                  editable={!isRedeeming}
                  selectionColor={Colors.primary}
                />
                <Pressable
                  onPress={handleRedeem}
                  disabled={isRedeeming}
                  style={({ pressed }) => [
                    styles.redeemButton,
                    { opacity: pressed ? 0.8 : 1 },
                  ]}
                >
                  <Text style={styles.redeemButtonText}>
                    {isRedeeming ? t.referral.redeeming : t.referral.redeem}
                  </Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.referralListSection}>
              <Text style={styles.sectionTitle}>{t.referral.yourReferrals}</Text>
              {referrals.length === 0 ? (
                <View style={styles.emptyState}>
                  <Ionicons name="people-outline" size={48} color={Colors.textMuted} />
                  <Text style={styles.emptyStateText}>
                    {t.referral.noReferralsYet}
                  </Text>
                </View>
              ) : (
                <FlatList
                  data={referrals}
                  renderItem={renderReferralItem}
                  keyExtractor={(item) => item.id}
                  scrollEnabled={false}
                  ItemSeparatorComponent={() => <View style={styles.separator} />}
                />
              )}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  keyboardAvoid: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
  },
  codeSection: {
    marginBottom: 20,
  },
  codeCardGradient: {
    borderRadius: 16,
    padding: 1,
  },
  codeCard: {
    backgroundColor: Colors.background,
    borderRadius: 15,
    padding: 20,
    alignItems: "center",
  },
  codeLabel: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  codeText: {
    fontFamily: "Outfit_700Bold",
    fontSize: 36,
    color: Colors.text,
    letterSpacing: 2,
    marginBottom: 16,
  },
  copyButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  copyButtonText: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 14,
    color: Colors.background,
  },
  shareButton: {
    marginBottom: 24,
    borderRadius: 12,
    overflow: "hidden",
  },
  shareButtonGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  shareButtonText: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 16,
    color: Colors.background,
  },
  statsSection: {
    gap: 12,
    marginBottom: 24,
  },
  statCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: Colors.surfaceHighlight,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  statContent: {
    flex: 1,
  },
  statValue: {
    fontFamily: "Outfit_700Bold",
    fontSize: 20,
    color: Colors.text,
    marginBottom: 2,
  },
  statLabel: {
    fontFamily: "Outfit_400Regular",
    fontSize: 12,
    color: Colors.textMuted,
  },
  redeemSection: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontFamily: "Outfit_700Bold",
    fontSize: 18,
    color: Colors.text,
    marginBottom: 12,
  },
  inputContainer: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
  },
  input: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: "Outfit_400Regular",
    fontSize: 15,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  redeemButton: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  redeemButtonText: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 14,
    color: Colors.background,
  },
  referralListSection: {
    marginBottom: 24,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 40,
  },
  emptyStateText: {
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: Colors.textMuted,
    marginTop: 12,
    textAlign: "center",
  },
  referralItem: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  referralItemContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 14,
  },
  referralInfo: {
    flex: 1,
  },
  referralName: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 15,
    color: Colors.text,
    marginBottom: 4,
  },
  referralDate: {
    fontFamily: "Outfit_400Regular",
    fontSize: 12,
    color: Colors.textMuted,
  },
  referralEarning: {
    marginLeft: 12,
  },
  referralEarningAmount: {
    fontFamily: "Outfit_700Bold",
    fontSize: 16,
    color: Colors.primary,
  },
  separator: {
    height: 8,
  },
});
