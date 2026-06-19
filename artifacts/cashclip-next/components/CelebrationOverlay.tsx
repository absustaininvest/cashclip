import React, { useEffect, useMemo } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import Colors from "@/constants/colors";
import Chipley from "@/components/Chipley";

/**
 * CelebrationOverlay — a full-screen, touch-transparent celebration that sends
 * Chipley sprinting across the screen with confetti (and fireworks on the EPIC
 * tier) at genuine win moments. Pure JS/Reanimated (no native module), so it can
 * ride an OTA update onto the live build.
 *
 * It is mounted once at the app root by CelebrationProvider and is remounted on
 * every run (keyed by runId), so all animations fire fresh from useEffect.
 */

export type CelebrationTier = "nice" | "epic";

const PALETTE = [
  Colors.primary,
  Colors.accent,
  "#FFFFFF",
  "#FF4081",
  "#29B6F6",
  "#FFD54F",
  "#7C4DFF",
];

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

interface ConfettiSpec {
  left: number;
  size: number;
  color: string;
  delay: number;
  duration: number;
  sway: number;
  swayDur: number;
  spin: number;
  spinDur: number;
}

interface SparkSpec {
  cx: number;
  cy: number;
  angle: number;
  radius: number;
  gravity: number;
  size: number;
  color: string;
  delay: number;
  dur: number;
}

function ConfettiPiece({ spec, fallTo }: { spec: ConfettiSpec; fallTo: number }) {
  const ty = useSharedValue(-40);
  const tx = useSharedValue(0);
  const rot = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.value = withDelay(
      spec.delay,
      withSequence(
        withTiming(1, { duration: 140 }),
        withDelay(Math.max(0, spec.duration - 460), withTiming(0, { duration: 320 })),
      ),
    );
    ty.value = withDelay(
      spec.delay,
      withTiming(fallTo, { duration: spec.duration, easing: Easing.in(Easing.quad) }),
    );
    tx.value = withDelay(
      spec.delay,
      withRepeat(
        withTiming(spec.sway, { duration: spec.swayDur, easing: Easing.inOut(Easing.sin) }),
        -1,
        true,
      ),
    );
    rot.value = withDelay(
      spec.delay,
      withRepeat(
        withTiming(spec.spin, { duration: spec.spinDur, easing: Easing.linear }),
        -1,
        false,
      ),
    );
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { rotate: `${rot.value}deg` },
    ],
  }));

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          left: spec.left,
          top: 0,
          width: spec.size,
          height: spec.size * 0.42,
          backgroundColor: spec.color,
          borderRadius: 2,
        },
        style,
      ]}
    />
  );
}

function Spark({ spec }: { spec: SparkSpec }) {
  const prog = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.value = withDelay(
      spec.delay,
      withSequence(
        withTiming(1, { duration: 90 }),
        withDelay(Math.max(0, spec.dur - 290), withTiming(0, { duration: 300 })),
      ),
    );
    prog.value = withDelay(
      spec.delay,
      withTiming(1, { duration: spec.dur, easing: Easing.out(Easing.quad) }),
    );
  }, []);

  const style = useAnimatedStyle(() => {
    const dx = Math.cos(spec.angle) * spec.radius * prog.value;
    const dy =
      Math.sin(spec.angle) * spec.radius * prog.value +
      prog.value * prog.value * spec.gravity;
    return {
      opacity: opacity.value,
      transform: [{ translateX: dx }, { translateY: dy }, { scale: 1 - 0.4 * prog.value }],
    };
  });

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          left: spec.cx,
          top: spec.cy,
          width: spec.size,
          height: spec.size,
          borderRadius: spec.size / 2,
          backgroundColor: spec.color,
        },
        style,
      ]}
    />
  );
}

interface CelebrationOverlayProps {
  runId: number;
  tier: CelebrationTier;
  label?: string;
  title?: string;
  onDone: (runId: number) => void;
}

export default function CelebrationOverlay({
  runId,
  tier,
  label,
  title,
  onDone,
}: CelebrationOverlayProps) {
  const { width, height } = useWindowDimensions();
  const isEpic = tier === "epic";

  const chipSize = isEpic ? 132 : 104;
  const chipY = height * 0.4;
  const startX = -chipSize - 40;
  const centerX = width / 2 - chipSize / 2;
  const endX = width + 60;

  const runIn = 720;
  const hold = isEpic ? 1300 : 850;
  const runOut = 700;
  const total = runIn + hold + runOut + 250;

  const tx = useSharedValue(startX);
  const bob = useSharedValue(0);
  const rot = useSharedValue(0);
  const scale = useSharedValue(0.75);
  const glow = useSharedValue(0);
  const flash = useSharedValue(0);
  const labelOpacity = useSharedValue(0);
  const labelScale = useSharedValue(0.4);

  const confetti = useMemo<ConfettiSpec[]>(() => {
    const count = isEpic ? 32 : 16;
    return Array.from({ length: count }, () => ({
      left: rand(0, width),
      size: rand(8, 16),
      color: pick(PALETTE),
      delay: rand(0, isEpic ? 500 : 350),
      duration: rand(1500, 2300),
      sway: rand(-28, 28),
      swayDur: rand(500, 900),
      spin: rand(180, 720) * (Math.random() < 0.5 ? -1 : 1),
      spinDur: rand(700, 1300),
    }));
  }, [isEpic, width, runId]);

  const sparks = useMemo<SparkSpec[]>(() => {
    if (!isEpic) return [];
    const bursts = [
      { cx: width * 0.22, cy: height * 0.26, delay: 240 },
      { cx: width * 0.78, cy: height * 0.2, delay: 520 },
      { cx: width * 0.5, cy: height * 0.32, delay: 820 },
    ];
    const out: SparkSpec[] = [];
    for (const b of bursts) {
      const n = 14;
      const color = pick(PALETTE);
      for (let i = 0; i < n; i++) {
        out.push({
          cx: b.cx,
          cy: b.cy,
          angle: (i / n) * Math.PI * 2 + rand(-0.12, 0.12),
          radius: rand(60, 120),
          gravity: rand(40, 90),
          size: rand(5, 9),
          color: Math.random() < 0.5 ? color : pick(PALETTE),
          delay: b.delay + rand(0, 80),
          dur: rand(700, 1100),
        });
      }
    }
    return out;
  }, [isEpic, width, height, runId]);

  useEffect(() => {
    bob.value = withRepeat(
      withSequence(
        withTiming(-16, { duration: 150, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 150, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
    rot.value = withRepeat(
      withSequence(
        withTiming(-7, { duration: 150, easing: Easing.inOut(Easing.quad) }),
        withTiming(7, { duration: 150, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      true,
    );

    tx.value = withSequence(
      withTiming(centerX, { duration: runIn, easing: Easing.out(Easing.cubic) }),
      withDelay(hold, withTiming(endX, { duration: runOut, easing: Easing.in(Easing.cubic) })),
    );

    scale.value = withSequence(
      withTiming(1, { duration: runIn - 120, easing: Easing.out(Easing.cubic) }),
      withSpring(isEpic ? 1.22 : 1.14, { damping: 5, stiffness: 150 }),
      withTiming(1, { duration: 220 }),
    );

    glow.value = withDelay(
      runIn - 120,
      withSequence(
        withTiming(1, { duration: 260 }),
        withDelay(hold - 120, withTiming(0, { duration: 360 })),
      ),
    );

    if (isEpic) {
      flash.value = withSequence(
        withTiming(0.16, { duration: 120 }),
        withTiming(0, { duration: 420 }),
      );
    }

    labelOpacity.value = withDelay(
      runIn,
      withSequence(
        withTiming(1, { duration: 200 }),
        withDelay(Math.max(0, hold - 250), withTiming(0, { duration: 280 })),
      ),
    );
    labelScale.value = withDelay(runIn, withSpring(1, { damping: 6, stiffness: 130 }));

    const timer = setTimeout(() => onDone(runId), total);
    return () => clearTimeout(timer);
  }, []);

  const chipStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: bob.value },
      { rotate: `${rot.value}deg` },
      { scale: scale.value },
    ],
  }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: glow.value * 0.55,
    transform: [{ translateX: tx.value }, { scale: 0.8 + glow.value * 0.6 }],
  }));

  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value }));

  const labelStyle = useAnimatedStyle(() => ({
    opacity: labelOpacity.value,
    transform: [{ scale: labelScale.value }],
  }));

  const glowSize = chipSize * 1.4;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {isEpic && (
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: "#FFFFFF" }, flashStyle]}
        />
      )}

      {confetti.map((spec, i) => (
        <ConfettiPiece key={`c${i}`} spec={spec} fallTo={height + 60} />
      ))}

      {sparks.map((spec, i) => (
        <Spark key={`s${i}`} spec={spec} />
      ))}

      <Animated.View
        style={[
          {
            position: "absolute",
            top: chipY + chipSize / 2 - glowSize / 2,
            left: centerX + chipSize / 2 - glowSize / 2,
            width: glowSize,
            height: glowSize,
            borderRadius: glowSize / 2,
            backgroundColor: Colors.primary,
          },
          glowStyle,
        ]}
      />

      {(label || title) && (
        <Animated.View
          style={[
            { position: "absolute", left: 0, right: 0, top: chipY - 92, alignItems: "center" },
            labelStyle,
          ]}
        >
          {title ? <Text style={styles.title}>{title}</Text> : null}
          {label ? <Text style={styles.label}>{label}</Text> : null}
        </Animated.View>
      )}

      <Animated.View
        style={[{ position: "absolute", top: chipY, left: 0 }, chipStyle]}
      >
        <Chipley pose="celebrate" size={chipSize} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: "Outfit_700Bold",
    fontSize: 22,
    color: "#FFFFFF",
    textShadowColor: "rgba(0,0,0,0.4)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
    marginBottom: 2,
  },
  label: {
    fontFamily: "Outfit_700Bold",
    fontSize: 38,
    color: Colors.accent,
    textShadowColor: "rgba(0,0,0,0.45)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
});
