import React, { useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { BannerAd, BannerAdSize } from "react-native-google-mobile-ads";
import { isAdMobAvailable, getAdUnitId } from "@/lib/admob";
import Colors from "@/constants/colors";

// Unit ID is wired from lib/admob.ts so dev builds use Google's test banner ID
// and production builds use the real recovered banner unit
// (ca-app-pub-8679658921848348/3883360799). Rendering only happens on native
// builds where the AdMob SDK is present; the web variant is a no-op stub.
export default function InFeedBanner() {
  const [visible, setVisible] = useState(false);

  if (!isAdMobAvailable) return null;

  const unitId = getAdUnitId("banner");
  if (!unitId) return null;

  return (
    <View style={[styles.wrapper, !visible && styles.hidden]}>
      {visible && <Text style={styles.label}>Sponsored</Text>}
      <BannerAd
        unitId={unitId}
        size={BannerAdSize.BANNER}
        requestOptions={{ requestNonPersonalizedAdsOnly: true }}
        onAdLoaded={() => setVisible(true)}
        onAdFailedToLoad={() => setVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: "center",
    marginHorizontal: 16,
    marginBottom: 8,
  },
  hidden: {
    height: 0,
    marginBottom: 0,
    overflow: "hidden",
  },
  label: {
    fontFamily: "Outfit_400Regular",
    fontSize: 10,
    color: Colors.textMuted,
    alignSelf: "flex-start",
    marginBottom: 2,
  },
});
