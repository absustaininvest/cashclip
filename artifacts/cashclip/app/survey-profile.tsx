import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  TextInput, Alert, ActivityIndicator, Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useFonts, Outfit_400Regular, Outfit_600SemiBold, Outfit_700Bold } from "@expo-google-fonts/outfit";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import { useAuth } from "@/lib/AuthContext";

const API_BASE = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
  : "";

interface ProfileData {
  dateOfBirth: string;
  gender: string;
  zipCode: string;
  employmentStatus: string;
  householdIncome: string;
  educationLevel: string;
  ethnicity: string;
  profileComplete: boolean;
}

const GENDER_OPTIONS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "non_binary", label: "Non-binary" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];

const EMPLOYMENT_OPTIONS = [
  { value: "employed", label: "Employed full-time" },
  { value: "self_employed", label: "Self-employed" },
  { value: "unemployed", label: "Unemployed" },
  { value: "student", label: "Student" },
  { value: "retired", label: "Retired" },
  { value: "homemaker", label: "Homemaker" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];

const INCOME_OPTIONS = [
  { value: "under_25k", label: "Under $25,000" },
  { value: "25k_50k", label: "$25,000 – $50,000" },
  { value: "50k_75k", label: "$50,000 – $75,000" },
  { value: "75k_100k", label: "$75,000 – $100,000" },
  { value: "100k_150k", label: "$100,000 – $150,000" },
  { value: "over_150k", label: "Over $150,000" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];

const EDUCATION_OPTIONS = [
  { value: "less_than_high_school", label: "Less than high school" },
  { value: "high_school", label: "High school / GED" },
  { value: "some_college", label: "Some college" },
  { value: "associates", label: "Associate's degree" },
  { value: "bachelors", label: "Bachelor's degree" },
  { value: "masters", label: "Master's degree" },
  { value: "doctorate", label: "Doctorate" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];

const ETHNICITY_OPTIONS = [
  { value: "hispanic_latino", label: "Hispanic or Latino" },
  { value: "white", label: "White" },
  { value: "black_african_american", label: "Black or African American" },
  { value: "asian", label: "Asian" },
  { value: "native_american", label: "American Indian / Alaska Native" },
  { value: "pacific_islander", label: "Native Hawaiian / Pacific Islander" },
  { value: "mixed", label: "Two or more races" },
  { value: "other", label: "Other" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];

function OptionPicker({
  label, value, options, onSelect,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onSelect: (v: string) => void;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionRow}>
        {options.map((o) => (
          <Pressable
            key={o.value}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onSelect(o.value); }}
            style={[styles.optionChip, value === o.value && styles.optionChipSelected]}
          >
            <Text style={[styles.optionChipText, value === o.value && styles.optionChipTextSelected]}>
              {o.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

export default function SurveyProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profileComplete, setProfileComplete] = useState(false);

  const [dob, setDob] = useState("");
  const [gender, setGender] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [employment, setEmployment] = useState("");
  const [income, setIncome] = useState("");
  const [education, setEducation] = useState("");
  const [ethnicity, setEthnicity] = useState("");

  const [fontsLoaded] = useFonts({ Outfit_400Regular, Outfit_600SemiBold, Outfit_700Bold });

  const loadProfile = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/profile`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data: ProfileData = await res.json();
      setDob(data.dateOfBirth || "");
      setGender(data.gender || "");
      setZipCode(data.zipCode || "");
      setEmployment(data.employmentStatus || "");
      setIncome(data.householdIncome || "");
      setEducation(data.educationLevel || "");
      setEthnicity(data.ethnicity || "");
      setProfileComplete(data.profileComplete || false);
    } catch {
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  async function handleSave() {
    if (!dob.match(/^\d{4}-\d{2}-\d{2}$/)) {
      Alert.alert("Invalid date", "Please enter your date of birth as YYYY-MM-DD.");
      return;
    }
    if (!gender) { Alert.alert("Required", "Please select your gender."); return; }
    if (!zipCode.trim()) { Alert.alert("Required", "Please enter your zip code."); return; }
    if (!employment) { Alert.alert("Required", "Please select your employment status."); return; }
    if (!income) { Alert.alert("Required", "Please select your household income."); return; }
    if (!education) { Alert.alert("Required", "Please select your education level."); return; }

    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          dateOfBirth: dob,
          gender,
          zipCode: zipCode.trim(),
          employmentStatus: employment,
          householdIncome: income,
          educationLevel: education,
          ethnicity: ethnicity || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      setProfileComplete(data.profileComplete || false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Saved!", "Your survey profile is complete. You'll now get better-matched surveys and higher payouts.", [
        { text: "Great!", onPress: () => router.back() },
      ]);
    } catch (e: any) {
      Alert.alert("Error", e.message || "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (!fontsLoaded || loading) {
    return (
      <View style={[styles.container, { justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  const webTopPad = Platform.OS === "web" ? 67 : 0;

  return (
    <ScrollView
      style={[styles.container, { paddingTop: webTopPad }]}
      contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={Colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Survey Profile</Text>
        {profileComplete && (
          <View style={styles.completeBadge}>
            <Ionicons name="checkmark-circle" size={14} color={Colors.primary} />
            <Text style={styles.completeBadgeText}>Complete</Text>
          </View>
        )}
      </View>

      <View style={styles.content}>
        <View style={styles.heroBanner}>
          <Feather name="target" size={28} color={Colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.heroTitle}>Unlock Better Surveys</Text>
            <Text style={styles.heroSub}>
              A complete profile means higher-paying surveys matched to you. This info is only used to qualify you — it's never sold.
            </Text>
          </View>
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Date of Birth</Text>
          <Text style={styles.fieldHint}>Format: YYYY-MM-DD (e.g. 1995-07-14)</Text>
          <TextInput
            style={styles.textInput}
            value={dob}
            onChangeText={setDob}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={Colors.textMuted}
            keyboardType="numbers-and-punctuation"
            maxLength={10}
          />
        </View>

        <OptionPicker label="Gender" value={gender} options={GENDER_OPTIONS} onSelect={setGender} />

        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Zip Code</Text>
          <TextInput
            style={styles.textInput}
            value={zipCode}
            onChangeText={setZipCode}
            placeholder="e.g. 30301"
            placeholderTextColor={Colors.textMuted}
            keyboardType="number-pad"
            maxLength={10}
          />
        </View>

        <OptionPicker label="Employment Status" value={employment} options={EMPLOYMENT_OPTIONS} onSelect={setEmployment} />
        <OptionPicker label="Household Income" value={income} options={INCOME_OPTIONS} onSelect={setIncome} />
        <OptionPicker label="Education Level" value={education} options={EDUCATION_OPTIONS} onSelect={setEducation} />
        <OptionPicker label="Ethnicity (optional)" value={ethnicity} options={ETHNICITY_OPTIONS} onSelect={setEthnicity} />

        <Pressable
          onPress={handleSave}
          disabled={saving}
          style={({ pressed }) => [styles.saveBtn, { opacity: pressed || saving ? 0.8 : 1 }]}
        >
          {saving
            ? <ActivityIndicator color="#000" />
            : <Text style={styles.saveBtnText}>Save Survey Profile</Text>
          }
        </Pressable>

        <Text style={styles.disclaimer}>
          Your demographic information is only used to match you with relevant survey opportunities from our research partners. It is never shared with advertisers or sold to third parties.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, gap: 12 },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: Colors.surface, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontFamily: "Outfit_700Bold", fontSize: 20, color: Colors.text, flex: 1 },
  completeBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: `${Colors.primary}20`, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  completeBadgeText: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: Colors.primary },
  content: { paddingHorizontal: 16, paddingTop: 8 },
  heroBanner: { flexDirection: "row", alignItems: "flex-start", gap: 14, backgroundColor: `${Colors.primary}10`, borderWidth: 1, borderColor: `${Colors.primary}30`, borderRadius: 16, padding: 16, marginBottom: 24 },
  heroTitle: { fontFamily: "Outfit_700Bold", fontSize: 16, color: Colors.text, marginBottom: 4 },
  heroSub: { fontFamily: "Outfit_400Regular", fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },
  fieldGroup: { marginBottom: 20 },
  fieldLabel: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: Colors.text, marginBottom: 4 },
  fieldHint: { fontFamily: "Outfit_400Regular", fontSize: 12, color: Colors.textMuted, marginBottom: 8 },
  textInput: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: "Outfit_400Regular", fontSize: 15, color: Colors.text },
  optionRow: { flexDirection: "row", gap: 8, paddingVertical: 4 },
  optionChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  optionChipSelected: { backgroundColor: `${Colors.primary}20`, borderColor: Colors.primary },
  optionChipText: { fontFamily: "Outfit_400Regular", fontSize: 13, color: Colors.textSecondary },
  optionChipTextSelected: { fontFamily: "Outfit_600SemiBold", color: Colors.primary },
  saveBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 16, alignItems: "center", marginTop: 8, marginBottom: 16 },
  saveBtnText: { fontFamily: "Outfit_700Bold", fontSize: 16, color: "#000" },
  disclaimer: { fontFamily: "Outfit_400Regular", fontSize: 12, color: Colors.textMuted, textAlign: "center", lineHeight: 18, marginBottom: 8 },
});
