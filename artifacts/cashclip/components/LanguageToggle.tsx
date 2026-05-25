import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useLanguage } from "@/lib/LanguageContext";
import type { Language } from "@/lib/i18n";
import Colors from "@/constants/colors";

const LANGS: { code: Language; flag: string; label: string }[] = [
  { code: "en", flag: "🇺🇸", label: "EN" },
  { code: "es", flag: "🇪🇸", label: "ES" },
];

export default function LanguageToggle() {
  const { lang, setLang } = useLanguage();

  return (
    <View style={styles.row}>
      {LANGS.map((l, i) => {
        const active = lang === l.code;
        return (
          <React.Fragment key={l.code}>
            {i > 0 && <View style={styles.divider} />}
            <Pressable
              onPress={() => setLang(l.code)}
              style={[styles.btn, active && styles.btnActive]}
              hitSlop={8}
            >
              <Text style={styles.flag}>{l.flag}</Text>
              <Text style={[styles.label, active && styles.labelActive]}>{l.label}</Text>
            </Pressable>
          </React.Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: Colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  btnActive: {
    backgroundColor: `${Colors.primary}20`,
  },
  divider: {
    width: 1,
    height: 20,
    backgroundColor: Colors.border,
  },
  flag: {
    fontSize: 14,
  },
  label: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 12,
    color: Colors.textMuted,
  },
  labelActive: {
    color: Colors.primary,
  },
});
