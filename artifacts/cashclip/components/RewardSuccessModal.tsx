import React, { useEffect } from "react";
import { View, Text, StyleSheet, Modal, Pressable } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from "react-native-reanimated";
import Colors from "@/constants/colors";
import Chipley from "@/components/Chipley";

interface RewardSuccessModalProps {
  visible: boolean;
  amount: number;
  title?: string;
  subtitle?: string;
  buttonLabel?: string;
  onClose: () => void;
}

export default function RewardSuccessModal({
  visible,
  amount,
  title = "Reward Earned!",
  subtitle,
  buttonLabel = "Collect",
  onClose,
}: RewardSuccessModalProps) {
  const celebScale = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      celebScale.value = 0;
      celebScale.value = withSpring(1, { damping: 6, stiffness: 100 });
    }
  }, [visible]);

  const celebStyle = useAnimatedStyle(() => ({
    transform: [{ scale: celebScale.value }],
  }));

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Animated.View style={celebStyle}>
          <View style={styles.card}>
            <Chipley pose="celebrate" size={92} />
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.amount}>+${Number.isFinite(amount) ? amount.toFixed(2) : "0.00"}</Text>
            {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
            <Pressable onPress={onClose} style={styles.button}>
              <LinearGradient
                colors={[Colors.primary, Colors.primaryDark]}
                style={styles.buttonGradient}
              >
                <Text style={styles.buttonText}>{buttonLabel}</Text>
              </LinearGradient>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 24,
    padding: 32,
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
    width: 340,
    maxWidth: "100%",
  },
  title: {
    fontFamily: "Outfit_700Bold",
    fontSize: 24,
    color: Colors.text,
    marginTop: 16,
    textAlign: "center",
  },
  amount: {
    fontFamily: "Outfit_700Bold",
    fontSize: 40,
    color: Colors.accent,
    marginTop: 8,
  },
  subtitle: {
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 4,
    marginBottom: 8,
    textAlign: "center",
  },
  button: {
    marginTop: 16,
    alignSelf: "stretch",
  },
  buttonGradient: {
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
  },
  buttonText: {
    fontFamily: "Outfit_700Bold",
    fontSize: 16,
    color: Colors.background,
  },
});
