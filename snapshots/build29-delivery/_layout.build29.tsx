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
import { initializeAdMob, preloadRewardedAd, setFillChangeCallback } from "@/lib/admob";
import { apiRequestSafe } from "@/lib/query-client";
import { startAdAnalyticsFlush, stopAdAnalyticsFlush } from "@/lib/ad-analytics";
import { TrackingConsentGate } from "@/components/TrackingConsentGate";
import { ForceUpdateGate } from "@/components/ForceUpdateGate";
import { OtaUpdateGate } from "@/components/OtaUpdateGate";
import { CelebrationProvider } from "@/lib/CelebrationContext";
import { hydrateDisplayRate, fetchConversionRate } from "@/lib/earn-client";
import {
  configureNotificationHandler,
  requestNotificationPermission,
} from "@/lib/streak-notifications";

// ============================================================================
// BUILD-29 DELIVERY COPY of app/_layout.tsx
// ----------------------------------------------------------------------------
// This is the ONLY file that differs from main (HEAD) when shipping an OTA to
// the LIVE App Store build 29 (runtime 1.0.0, v1.0). It is identical to
// app/_layout.tsx EXCEPT the three build-39-only NATIVE telemetry modules are
// removed, because their native code is NOT in build 29 and importing them on
// build 29 would crash every live user:
//   - @sentry/react-native   (Sentry.init + Sentry.wrap default export)
//   - vexo-analytics         (vexo() init)
//   - @logrocket/react-native(LogRocket.init useEffect)
//   - expo-updates was only used by the three above here, so its import is gone too.
// Everything else (gates, celebration, providers) is byte-for-byte HEAD and is
// build-29-native-safe (verified: 0 shared deps changed version vs build-29 base
// 9c71ec4; Firebase/expo-audio are never imported in JS).
// See README.md in this folder for the full publish procedure.
// ============================================================================

SplashScreen.preventAutoHideAsync();

// Configure how notifications appear when the app is already in the foreground.
// Must be called before any notification can fire; fail-open wrapper is inside.
configureNotificationHandler();

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  // Apply the last-known display rate immediately (cold/offline start), then
  // refresh it from the server once the user is authenticated so every surface
  // reads one consistent, owner-tunable display number. Both fail open to the
  // hardcoded default in lib/points.ts.
  useEffect(() => {
    hydrateDisplayRate();
  }, []);

  useEffect(() => {
    if (user) fetchConversionRate();
  }, [user]);

  // Request notification permission once, after the user is authenticated.
  // Fire-and-forget — a denial never blocks any feature (fail-open).
  useEffect(() => {
    if (user) {
      requestNotificationPermission().catch(() => {});
    }
  }, [user?.id]);

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

function RootLayout() {
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
                <OtaUpdateGate>
                  <ForceUpdateGate>
                    {/* TrackingConsentGate shows Apple-style pre-permission screens
                        first, fires the ATT prompt, then AdsConsent — fully
                        serialized. Only after the user taps Continue does AdMob
                        initialize. The native splash is hidden as soon as fonts are
                        ready (see appReady above), NOT when consent resolves — the
                        consent screen must be visible so the user can interact with
                        it, otherwise the app would sit frozen behind the splash. */}
                    <TrackingConsentGate onConsentDone={() => {
                      // Register the fill-state reporter BEFORE init so the first
                      // onAdAvailable event is captured.  The callback is fire-and-forget:
                      // it POSTs to /api/earn/ad-fill with the current fill state so the
                      // admin Integration Hub can show a colour-coded badge without
                      // requiring log access.  Failures are silently swallowed.
                      setFillChangeCallback((fillAvailable) => {
                        apiRequestSafe("POST", "/api/earn/ad-fill", { rewardedFillAvailable: fillAvailable })
                          .catch(() => {});
                      });
                      // LevelPlay (ironSource) replaces AdMob as the ad platform.
                      // initializeAdMob() is the stable entry-point — internally it
                      // now initialises the LevelPlay SDK instead.
                      initializeAdMob().then((initialized) => {
                        if (initialized) preloadRewardedAd();
                      });
                    }}>
                      <CelebrationProvider>
                        <RootLayoutNav />
                      </CelebrationProvider>
                    </TrackingConsentGate>
                  </ForceUpdateGate>
                </OtaUpdateGate>
              </View>
            </GestureHandlerRootView>
          </AuthProvider>
        </LanguageProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default RootLayout;
