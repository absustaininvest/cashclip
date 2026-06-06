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
import { startAdAnalyticsFlush, stopAdAnalyticsFlush } from "@/lib/ad-analytics";
import { TrackingConsentGate } from "@/components/TrackingConsentGate";
import { ForceUpdateGate } from "@/components/ForceUpdateGate";
import { OtaUpdateGate } from "@/components/OtaUpdateGate";
import { CelebrationProvider } from "@/lib/CelebrationContext";
import { hydrateDisplayRate, fetchConversionRate } from "@/lib/earn-client";
import LogRocket from "@logrocket/react-native";
import * as Updates from "expo-updates";
import * as Sentry from "@sentry/react-native";
import { vexo } from "vexo-analytics";

// Crash & error reporting (Sentry). Initialized at module load — as early as
// possible — so it captures the earliest startup errors. Fail-open: guarded by
// DSN presence and wrapped in try/catch so a telemetry problem can NEVER crash
// or delay launch (see prior splash-deadlock). PII is minimized on this money
// app: sendDefaultPii=false means no IP address or user data is auto-attached.
// Events are tagged with the environment and the OTA update they shipped in
// (dist) so crashes can be traced to the exact build/OTA layer.
try {
  const sentryDsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (sentryDsn) {
    Sentry.init({
      dsn: sentryDsn,
      environment: process.env.EXPO_PUBLIC_ENV ?? "production",
      sendDefaultPii: false,
      dist: Updates.isEmbeddedLaunch ? undefined : Updates.updateId ?? undefined,
    });
  }
} catch (e) {
  if (__DEV__) console.warn("Sentry init skipped:", e);
}

// Product analytics (Vexo). Initialized at module load, fail-open like Sentry:
// guarded by API-key presence and wrapped in try/catch so analytics can NEVER
// crash or delay launch (see prior splash-deadlock). Gated to non-dev builds so
// local development never pollutes production analytics. Vexo auto-instruments
// expo-router navigation for screen tracking once the router mounts.
try {
  const vexoKey = process.env.EXPO_PUBLIC_VEXO_API_KEY;
  if (vexoKey && !__DEV__) {
    vexo(vexoKey);
  }
} catch (e) {
  if (__DEV__) console.warn("Vexo init skipped:", e);
}

SplashScreen.preventAutoHideAsync();

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

  // Session replay (LogRocket) for debugging real-user issues. Initialized once,
  // fire-and-forget — it must NEVER gate the splash (see prior splash-deadlock).
  // This is a money app, so PII is stripped before anything leaves the device:
  //  - textSanitizer "excluded": masks ALL on-screen text (balances, emails, payouts)
  //  - enableIPCapture false: no IP addresses recorded
  //  - console capture disabled: app logs can carry sensitive values
  //  - network sanitizers: drop Authorization headers, all request/response bodies,
  //    AND query strings on URLs (reset tokens / emails / ids can ride query params)
  // The whole call is wrapped in try/catch so telemetry can never crash launch
  // (fail-open). expoChannel/updateId tie each session to the OTA/build it came from.
  useEffect(() => {
    try {
      LogRocket.init("wzfayx/cashclip", {
        updateId: Updates.isEmbeddedLaunch ? null : Updates.updateId,
        expoChannel: Updates.channel,
        enableIPCapture: false,
        textSanitizer: "excluded",
        console: { isEnabled: false },
        network: {
          requestSanitizer: (request) => {
            delete request.headers.Authorization;
            delete request.headers.authorization;
            request.body = undefined;
            const q = request.url.indexOf("?");
            if (q !== -1) request.url = request.url.slice(0, q);
            return request;
          },
          responseSanitizer: (response) => {
            response.body = undefined;
            return response;
          },
        },
      });
    } catch (e) {
      if (__DEV__) console.warn("LogRocket init skipped:", e);
    }
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
                  }}>
                    <OtaUpdateGate>
                      <CelebrationProvider>
                        <RootLayoutNav />
                      </CelebrationProvider>
                    </OtaUpdateGate>
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

export default Sentry.wrap(RootLayout);
