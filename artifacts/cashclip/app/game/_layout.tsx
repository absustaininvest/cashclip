import { Stack } from "expo-router";

export default function GameLayout() {
  return (
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
  );
}
