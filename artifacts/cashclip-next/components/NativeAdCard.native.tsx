import React from "react";
import { View, Text, StyleSheet, Pressable, Dimensions, useWindowDimensions } from "react-native";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { dollarsToPoints, formatPoints } from "@/lib/points";

export const CARD_WIDTH = (Dimensions.get("window").width - 48) / 2;

export const PLACEHOLDER_CARDS = [
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

export function adSlotReward(index: number): number {
  return parseFloat(((index % 5) * 0.01 + 0.01).toFixed(2));
}

interface NativeAdCardProps {
  index: number;
  live?: boolean;
  onPress?: () => void;
}

export default function NativeAdCard({ index, live, onPress }: NativeAdCardProps) {
  const { width: screenWidth } = useWindowDimensions();
  const cardWidth = (screenWidth - 48) / 2;
  const card = PLACEHOLDER_CARDS[index % PLACEHOLDER_CARDS.length];
  const reward = adSlotReward(index);
  const isLive = live !== false;

  return (
    <Pressable onPress={onPress} style={[{ width: cardWidth }, !isLive && { opacity: 0.5 }]}>
      <View style={styles.card}>
        <View style={[styles.thumbnail, { backgroundColor: card.color }]}>
          <Feather name="play-circle" size={28} color="rgba(255,255,255,0.9)" />
          <View style={styles.rewardBadge}>
            <Text style={styles.rewardText}>★+{dollarsToPoints(reward)} pts</Text>
          </View>
          <View style={styles.sponsoredBadge}>
            <Text style={styles.sponsoredText}>Ad</Text>
          </View>
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.headline} numberOfLines={2}>{card.headline}</Text>
          <Text style={styles.body} numberOfLines={1}>{card.body}</Text>
          <Text style={styles.advertiser} numberOfLines={1}>{card.advertiser}</Text>
        </View>
        <View style={styles.cardFooter}>
          <View style={styles.ctaBtn}>
            <Text style={styles.ctaText}>{isLive ? "Learn More" : "Coming soon"}</Text>
          </View>
        </View>
      </View>
    </Pressable>
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
});
