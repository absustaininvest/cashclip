import React, { useEffect, useState, useRef } from "react";
import { View, Text, StyleSheet, Pressable, Dimensions } from "react-native";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { getAdUnitId } from "@/lib/admob";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
export const CARD_WIDTH = (SCREEN_WIDTH - 48) / 2;

const CATEGORY_COLORS: Record<string, string> = {
  finance:     "#43A047",
  gaming:      "#1E88E5",
  shopping:    "#FB8C00",
  travel:      "#00ACC1",
  food:        "#E53935",
  health:      "#8E24AA",
  tech:        "#D81B60",
  education:   "#FDD835",
  sports:      "#00897B",
  entertainment: "#F4511E",
  auto:        "#6D4C41",
};

function colorForHeadline(h: string): string {
  const lower = h.toLowerCase();
  for (const [key, color] of Object.entries(CATEGORY_COLORS)) {
    if (lower.includes(key)) return color;
  }
  return Colors.surfaceHighlight;
}

const FALLBACK_CARDS = [
  { headline: "Grow Your Money with Smart Investing", body: "Start building wealth today", advertiser: "Finance Weekly", color: "#43A047" },
  { headline: "Top Gaming Deals This Week", body: "Save big on the latest games", advertiser: "GameHub Pro", color: "#1E88E5" },
  { headline: "Shop the Best Deals Near You", body: "Exclusive offers from top brands", advertiser: "ShopLocal", color: "#FB8C00" },
  { headline: "Plan Your Dream Vacation", body: "Flights at unbeatable prices", advertiser: "TravelNow", color: "#00ACC1" },
  { headline: "Eat Healthy, Feel Great", body: "Meal plans for your lifestyle", advertiser: "NutriLife", color: "#8E24AA" },
  { headline: "Boost Your Fitness Today", body: "Workouts that actually work", advertiser: "FitTrack", color: "#E53935" },
  { headline: "Learn to Code in 30 Days", body: "Build apps from scratch", advertiser: "CodeCamp", color: "#FDD835" },
  { headline: "Get the Best Car Insurance", body: "Compare rates and save", advertiser: "AutoShield", color: "#6D4C41" },
  { headline: "Stream Movies Unlimited", body: "New releases every week", advertiser: "StreamMax", color: "#F4511E" },
  { headline: "Score Big on Sports Gear", body: "Pro quality, amateur prices", advertiser: "SportZone", color: "#00897B" },
  { headline: "Earn Cash Back on Everything", body: "Every purchase pays back", advertiser: "CashRewards", color: "#43A047" },
  { headline: "Find Your Perfect Home", body: "Thousands of local listings", advertiser: "HomeSearch", color: "#1E88E5" },
  { headline: "Latest Tech at Lowest Prices", body: "Phones, laptops and more", advertiser: "TechDeal", color: "#D81B60" },
  { headline: "Free Trial — Premium Music", body: "60 million songs offline", advertiser: "MusicStream", color: "#8E24AA" },
  { headline: "Master a New Skill", body: "Expert-led courses on any topic", advertiser: "SkillUp", color: "#FB8C00" },
  { headline: "Best Credit Card Rewards", body: "Earn points on every dollar", advertiser: "RewardCard", color: "#00ACC1" },
  { headline: "Fast Food Deals Near You", body: "Order now, save up to 40%", advertiser: "FoodRunner", color: "#E53935" },
  { headline: "Your Style, Your Way", body: "Fashion at affordable prices", advertiser: "StyleHub", color: "#F4511E" },
  { headline: "Protect What Matters Most", body: "Life insurance from $10/mo", advertiser: "SafeGuard", color: "#00897B" },
  { headline: "Play & Win Real Prizes", body: "Free to play, real rewards", advertiser: "WinZone", color: "#FDD835" },
  { headline: "Explore More, Spend Less", body: "Adventure on every budget", advertiser: "AdventureGo", color: "#00ACC1" },
  { headline: "Fresh Groceries Delivered", body: "Same-day delivery to door", advertiser: "FreshMart", color: "#43A047" },
  { headline: "Build Credit the Smart Way", body: "No fee, instant approval", advertiser: "SmartCredit", color: "#1E88E5" },
  { headline: "Unlimited Reading for $1/mo", body: "Best-sellers and audiobooks", advertiser: "ReadMore", color: "#D81B60" },
  { headline: "Work From Home — Real Jobs", body: "Remote roles at top companies", advertiser: "RemoteWork", color: "#6D4C41" },
];

interface AdData {
  headline: string;
  body: string;
  callToAction: string;
  advertiser: string | null;
  color: string;
}

interface NativeAdCardProps {
  index: number;
  onPress?: () => void;
}

export default function NativeAdCard({ index, onPress }: NativeAdCardProps) {
  const [adData, setAdData] = useState<AdData | null>(null);
  const [loading, setLoading] = useState(true);
  const nativeAdRef = useRef<any>(null);
  const reward = parseFloat(((index % 5) * 0.01 + 0.01).toFixed(2));

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const { NativeAd } = require("react-native-google-mobile-ads");
        const unitId = getAdUnitId("native");
        if (!unitId) throw new Error("No unit ID");

        const ad = await NativeAd.createForAdRequest(unitId, {
          requestNonPersonalizedAdsOnly: true,
        });

        if (cancelled) { ad.destroy(); return; }

        nativeAdRef.current = ad;
        setAdData({
          headline: ad.headline,
          body: ad.body,
          callToAction: ad.callToAction,
          advertiser: ad.advertiser,
          color: colorForHeadline(ad.headline),
        });
      } catch {
        if (!cancelled) {
          const fb = FALLBACK_CARDS[index % FALLBACK_CARDS.length];
          setAdData({ ...fb, callToAction: "Learn More" });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
      nativeAdRef.current?.destroy();
      nativeAdRef.current = null;
    };
  }, []);

  if (loading) return <SkeletonCard />;
  if (!adData) return null;

  const CardContent = (
    <View style={styles.card}>
      <View style={[styles.thumbnail, { backgroundColor: adData.color }]}>
        <Feather name="play-circle" size={28} color="rgba(255,255,255,0.9)" />
        <View style={styles.sponsoredBadge}>
          <Text style={styles.sponsoredText}>Ad</Text>
        </View>
        <View style={styles.rewardBadge}>
          <MaterialCommunityIcons name="cash" size={10} color={Colors.primary} />
          <Text style={styles.rewardText}>+${reward.toFixed(2)}</Text>
        </View>
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.headline} numberOfLines={2}>{adData.headline}</Text>
        <Text style={styles.body} numberOfLines={1}>{adData.body}</Text>
        {adData.advertiser ? (
          <Text style={styles.advertiser} numberOfLines={1}>{adData.advertiser}</Text>
        ) : null}
      </View>
      <View style={styles.cardFooter}>
        <View style={styles.ctaBtn}>
          <Text style={styles.ctaText} numberOfLines={1}>{adData.callToAction}</Text>
        </View>
      </View>
    </View>
  );

  if (nativeAdRef.current) {
    const { NativeAdView } = require("react-native-google-mobile-ads");
    return (
      <Pressable onPress={onPress} style={{ width: CARD_WIDTH }}>
        <NativeAdView nativeAd={nativeAdRef.current} style={{ flex: 1 }}>
          {CardContent}
        </NativeAdView>
      </Pressable>
    );
  }

  return (
    <Pressable onPress={onPress} style={{ width: CARD_WIDTH }}>
      {CardContent}
    </Pressable>
  );
}

function SkeletonCard() {
  return (
    <View style={[styles.card, { width: CARD_WIDTH, opacity: 0.4 }]}>
      <View style={[styles.thumbnail, { backgroundColor: Colors.surfaceHighlight }]} />
      <View style={styles.cardBody}>
        <View style={styles.skeletonLine} />
        <View style={[styles.skeletonLine, { width: "70%" }]} />
        <View style={[styles.skeletonLine, { width: "50%", marginTop: 4 }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  thumbnail: {
    height: 100,
    alignItems: "center",
    justifyContent: "center",
  },
  sponsoredBadge: {
    position: "absolute",
    bottom: 6,
    right: 6,
    backgroundColor: "rgba(0,0,0,0.65)",
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  sponsoredText: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 9,
    color: "rgba(255,255,255,0.8)",
    letterSpacing: 0.5,
  },
  rewardBadge: {
    position: "absolute",
    top: 6,
    left: 6,
    backgroundColor: "rgba(0,0,0,0.7)",
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  rewardText: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 10,
    color: Colors.primary,
  },
  cardBody: {
    padding: 10,
    gap: 3,
  },
  headline: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 12,
    color: Colors.text,
    lineHeight: 16,
  },
  body: {
    fontFamily: "Outfit_400Regular",
    fontSize: 11,
    color: Colors.textSecondary,
    lineHeight: 15,
  },
  advertiser: {
    fontFamily: "Outfit_400Regular",
    fontSize: 10,
    color: Colors.textMuted,
    marginTop: 2,
  },
  cardFooter: {
    paddingHorizontal: 10,
    paddingBottom: 10,
  },
  ctaBtn: {
    backgroundColor: "rgba(0,230,118,0.15)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: "rgba(0,230,118,0.3)",
    alignItems: "center",
  },
  ctaText: {
    fontFamily: "Outfit_700Bold",
    fontSize: 11,
    color: Colors.primary,
  },
  skeletonLine: {
    height: 10,
    backgroundColor: Colors.surfaceHighlight,
    borderRadius: 5,
    marginBottom: 4,
  },
});
