import React from "react";
import { Image, type ImageStyle, type StyleProp } from "react-native";

/**
 * Chipley — CashClip's coin mascot. A single character rendered in a few poses
 * so key moments (greeting, winning, empty states) feel warm and on-brand.
 *
 * Static PNGs live in assets/images/chip/ and are bundled (OTA-friendly).
 */
export type ChipleyPose =
  | "wave" // happy greeting
  | "celebrate" // dropping/raining coins — reward & success
  | "think" // idle / waiting / loading
  | "sad" // disappointed / error
  | "sleep"; // "nothing here yet" empty state

const CHIPLEY_SOURCES = {
  wave: require("@/assets/images/chip/chip-wave.png"),
  celebrate: require("@/assets/images/chip/chip-celebrate.png"),
  think: require("@/assets/images/chip/chip-think.png"),
  sad: require("@/assets/images/chip/chip-sad.png"),
  sleep: require("@/assets/images/chip/chip-sleep.png"),
} as const;

interface ChipleyProps {
  pose: ChipleyPose;
  size?: number;
  style?: StyleProp<ImageStyle>;
}

export default function Chipley({ pose, size = 96, style }: ChipleyProps) {
  return (
    <Image
      source={CHIPLEY_SOURCES[pose]}
      style={[{ width: size, height: size }, style]}
      resizeMode="contain"
      accessibilityRole="image"
      accessibilityLabel={`Chipley the coin mascot, ${pose}`}
      fadeDuration={0}
    />
  );
}
