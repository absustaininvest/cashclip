import React, { useState, useEffect, useRef } from "react";
import { View, Text, StyleSheet, Modal, Pressable, ActivityIndicator } from "react-native";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import Chipley from "@/components/Chipley";

interface RewardedAdModalProps {
  visible: boolean;
  brand: string;
  description: string;
  color: string;
  reward: number;
  duration: number;
  onComplete: (reward: number) => void;
  onClose: () => void;
}

export default function RewardedAdModal({
  visible,
  brand,
  description,
  color,
  reward,
  duration,
  onComplete,
  onClose,
}: RewardedAdModalProps) {
  const [timeLeft, setTimeLeft] = useState(duration);
  const [completed, setCompleted] = useState(false);
  const claimedRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!visible) return;
    setTimeLeft(duration);
    setCompleted(false);
    claimedRef.current = false;
    intervalRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          setCompleted(true);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [visible, duration]);

  const progress = duration > 0 ? ((duration - timeLeft) / duration) * 100 : 0;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.content}>
          <View style={[styles.thumbnail, { backgroundColor: color }]}>
            {!completed ? (
              <>
                <Feather name="monitor" size={48} color="rgba(255,255,255,0.9)" />
                <Text style={styles.brand}>{brand}</Text>
                <Text style={styles.desc} numberOfLines={2}>{description}</Text>
              </>
            ) : (
              <>
                <Chipley pose="celebrate" size={92} />
                <Text style={styles.rewardEarned}>Reward earned!</Text>
              </>
            )}
          </View>

          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress}%` }]} />
          </View>

          {!completed ? (
            <View style={styles.footer}>
              <Text style={styles.timeLeft}>{timeLeft}s remaining</Text>
              <ActivityIndicator color={Colors.primary} size="small" />
            </View>
          ) : (
            <Pressable
              onPress={() => {
                if (claimedRef.current) return;
                claimedRef.current = true;
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                onComplete(reward);
              }}
              style={styles.claimButton}
            >
              <LinearGradient
                colors={[Colors.primary, Colors.primaryDark]}
                style={styles.claimGradient}
              >
                <Text style={styles.claimText}>Claim Reward</Text>
              </LinearGradient>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.75)",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  content: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  thumbnail: {
    height: 180,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 16,
  },
  brand: {
    fontFamily: "Outfit_700Bold",
    fontSize: 18,
    color: "#fff",
    marginTop: 8,
  },
  desc: {
    fontFamily: "Outfit_400Regular",
    fontSize: 13,
    color: "rgba(255,255,255,0.85)",
    textAlign: "center",
  },
  rewardEarned: {
    fontFamily: "Outfit_700Bold",
    fontSize: 30,
    color: "#fff",
    marginTop: 8,
  },
  rewardLabel: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: "rgba(255,255,255,0.9)",
  },
  progressTrack: {
    height: 6,
    backgroundColor: Colors.border,
    borderRadius: 3,
    overflow: "hidden",
    marginTop: 16,
  },
  progressFill: {
    height: 6,
    backgroundColor: Colors.primary,
    borderRadius: 3,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 14,
  },
  timeLeft: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 14,
    color: Colors.textSecondary,
  },
  claimButton: {
    marginTop: 14,
    borderRadius: 12,
    overflow: "hidden",
  },
  claimGradient: {
    paddingVertical: 14,
    alignItems: "center",
  },
  claimText: {
    fontFamily: "Outfit_700Bold",
    fontSize: 15,
    color: "#0A0A0A",
  },
});
