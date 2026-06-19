import { Stack } from "expo-router";
import { View, StyleSheet } from "react-native";
import BackgroundBanner from "@/components/BackgroundBanner";

export default function GameLayout() {
  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="scratch-card" />
          <Stack.Screen name="memory-match" />
          <Stack.Screen name="trivia" />
          <Stack.Screen name="coin-catcher" />
          <Stack.Screen name="tap-frenzy" />
          <Stack.Screen name="solitaire" />
          <Stack.Screen name="dominoes" />
          <Stack.Screen name="tetris" />
          <Stack.Screen name="block-blitz" />
        </Stack>
      </View>
      <BackgroundBanner />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
});
