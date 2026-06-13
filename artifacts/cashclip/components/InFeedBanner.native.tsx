import React, { useState } from "react";
import { View, Text, StyleSheet, NativeModules, Platform } from "react-native";
import { BannerAd, BannerAdSize } from "react-native-google-mobile-ads";
import Colors from "@/constants/colors";

const BANNER_UNIT_ID = "ca-app-pub-8679658921848348/3883360799";

const ADMOB_NATIVE_AVAILABLE =
  Platform.OS !== "web" &&
  Boolean(NativeModules.GoogleMobileAds || NativeModules.RNGoogleMobileAds);

export default function InFeedBanner() {
  const [visible, setVisible] = useState(false);

  if (!ADMOB_NATIVE_AVAILABLE) return null;

  return (
    <View style={styles.wrapper}>
      {visible && <Text style={styles.label}>Sponsored</Text>}
      <BannerAd
        unitId={BANNER_UNIT_ID}
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
  label: {
    fontFamily: "Outfit_400Regular",
    fontSize: 10,
    color: Colors.textMuted,
    alignSelf: "flex-start",
    marginBottom: 2,
  },
});
