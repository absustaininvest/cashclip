import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { BannerAd, BannerAdSize } from "react-native-google-mobile-ads";
import { getAdUnitId } from "@/lib/admob";
import Colors from "@/constants/colors";

export default function InFeedBanner() {
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
    marginBottom: 12,
    gap: 4,
  },
  label: {
    fontFamily: "Outfit_400Regular",
    fontSize: 10,
    color: Colors.textMuted,
    alignSelf: "flex-start",
  },
});
