import React, { useState } from "react";
import { View, StyleSheet } from "react-native";
import {
  BannerAd as _BannerAd,
  BannerAdSize,
  type BannerAdProps,
} from "react-native-google-mobile-ads";
import { isAdMobAvailable, getAdUnitId } from "@/lib/admob";

const BannerAd = _BannerAd as unknown as React.ComponentType<BannerAdProps>;

// Anchored banner shown at the bottom of game screens. Unit ID is wired from
// lib/admob.ts so dev builds use Google's test banner ID and production builds
// use the real recovered banner unit (ca-app-pub-8679658921848348/3883360799).
// Rendering only happens on native builds where the AdMob SDK is present; the
// web variant is a no-op stub.
export default function BackgroundBanner() {
  const [visible, setVisible] = useState(false);

  if (!isAdMobAvailable) return null;

  const unitId = getAdUnitId("banner");
  if (!unitId) return null;

  return (
    <View style={[styles.wrapper, !visible && styles.hidden]}>
      <BannerAd
        unitId={unitId}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
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
  },
  hidden: {
    height: 0,
    overflow: "hidden",
  },
});
