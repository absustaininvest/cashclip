import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { StatusBar } from "expo-status-bar";
import { useFonts, Outfit_400Regular, Outfit_600SemiBold, Outfit_700Bold } from "@expo-google-fonts/outfit";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { queryClient } from "@/lib/query-client";
import { LanguageProvider, useLanguage } from "@/lib/LanguageContext";
import { AuthProvider, useAuth } from "@/lib/AuthContext";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import Colors from "@/constants/colors";
import { initializeAdMob, preloadRewardedAd } from "@/lib/admob";
import { initializeLevelPlay } from "@/lib/levelplay";
import { startAdAnalyticsFlush, stopAdAnalyticsFlush } from "@/lib/ad-analytics";
import { TrackingConsentGate } from "@/components/TrackingConsentGate";
import { ForceUpdateGate } from "@/components/ForceUpdateGate";

SplashScreen.preventAutoHideAsync();

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === "(auth)";

    if (!user && !inAuthGroup) {
      router.replace("/(auth)/login");
    } else if (user && inAuthGroup) {
      router.replace("/(tabs)");
    }
  }, [user, isLoading, segments]);

  if (isLoading) {
    return (
      <View style={loadingStyles.container}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return <>{children}</>;
}

const loadingStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, alignItems: "center", justifyContent: "center" },
});

function RootLayoutNav() {
  const { t } = useLanguage();
  return (
    <AuthGate>
      <Stack screenOptions={{ headerBackTitle: t.common.back }}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="referral"
          options={{
            title: t.referral.referralProgram,
            headerShadowVisible: false,
            headerStyle: { backgroundColor: "#0A0A0F" },
            headerTintColor: "#00E676",
            headerTitleStyle: {
              fontFamily: "Outfit_700Bold",
              fontSize: 18,
              color: "#FFFFFF",
            },
          }}
        />
        <Stack.Screen
          name="notifications"
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="surveys"
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="admin"
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen name="setup-wizard" options={{ headerShown: false }} />
        <Stack.Screen name="games" options={{ headerShown: false }} />
        <Stack.Screen name="game" options={{ headerShown: false }} />
        <Stack.Screen name="security" options={{ headerShown: false }} />
        <Stack.Screen name="about" options={{ headerShown: false }} />
      </Stack>
    </AuthGate>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Outfit_400Regular,
    Outfit_600SemiBold,
    Outfit_700Bold,
  });
  const appReady = fontsLoaded || !!fontError;

  useEffect(() => {
    if (appReady) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [appReady]);

  useEffect(() => {
    startAdAnalyticsFlush();
    return () => stopAdAnalyticsFlush();
  }, []);

  if (!appReady) return null;

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <LanguageProvider>
          <AuthProvider>
            <GestureHandlerRootView style={{ flex: 1 }}>
              <StatusBar style="light" />
              <View style={{ flex: 1, backgroundColor: Colors.background }}>
                <ForceUpdateGate>
                  {/* TrackingConsentGate shows Apple-style pre-permission screens
                      first, fires the ATT prompt, then AdsConsent — fully
                      serialized. Only after the user taps Continue does AdMob
                      initialize. The native splash is hidden as soon as fonts are
                      ready (see appReady above), NOT when consent resolves — the
                      consent screen must be visible so the user can interact with
                      it, otherwise the app would sit frozen behind the splash. */}
                  <TrackingConsentGate onConsentDone={() => {
                    initializeAdMob().then((initialized) => {
                      if (initialized) preloadRewardedAd();
                    });
                    initializeLevelPlay().catch(() => {});
                  }}>
                    <RootLayoutNav />
                  </TrackingConsentGate>
                </ForceUpdateGate>
              </View>
            </GestureHandlerRootView>
          </AuthProvider>
        </LanguageProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
