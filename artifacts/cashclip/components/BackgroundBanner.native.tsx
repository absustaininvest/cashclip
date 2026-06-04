import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { BannerAd, BannerAdSize } from "react-native-google-mobile-ads";
import { getAdUnitId } from "@/lib/admob";
import Colors from "@/constants/colors";

// De-emphasized "background" banner: a quiet footer ad that stays mounted at the
// bottom of a screen without competing with the primary content. The ad itself is
// rendered unaltered (AdMob policy: ads must not be obscured/dimmed) — only the
// surrounding container is muted so it reads as background.
export default function BackgroundBanner() {
  const unitId = getAdUnitId("banner");
  if (!unitId) return null;

  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>Sponsored</Text>
      <BannerAd
        unitId={unitId}
        size={BannerAdSize.BANNER}
        requestOptions={{ requestNonPersonalizedAdsOnly: true }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: "center",
    paddingTop: 4,
    paddingBottom: 2,
    backgroundColor: Colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    gap: 2,
  },
  label: {
    fontFamily: "Outfit_400Regular",
    fontSize: 9,
    color: Colors.textMuted,
  },
});
