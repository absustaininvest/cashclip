import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useRef } from "react";
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
import { secureGet } from "@/lib/secure-store";
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

// Holds the latest fill-change value that arrived before a token was available.
// Module-level so it is shared between the consent-done callback (RootLayout)
// and the flush effect inside AuthGate. Only one value is kept — the most
// recent pre-auth fill state.
let pendingFill: boolean | null = null;

// Configure how notifications appear when the app is already in the foreground.
// Must be called before any notification can fire; fail-open wrapper is inside.
configureNotificationHandler();

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const flushedRef = useRef(false);

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

  // Flush any fill-change event that fired before the JWT was available.
  // Runs once when the user first becomes available; subsequent live
  // fill-change events (which arrive after auth and carry their own POST)
  // will have already cleared pendingFill, so this is a no-op for them.
  useEffect(() => {
    if (!user || flushedRef.current) return;
    flushedRef.current = true;
    if (pendingFill === null) return;
    const value = pendingFill;
    pendingFill = null;
    apiRequestSafe("POST", "/api/earn/ad-fill", { rewardedFillAvailable: value }).catch(() => {});
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
          <GestureHandlerRootView style={{ flex: 1 }}>
            <StatusBar style="light" />
            <View style={{ flex: 1, backgroundColor: Colors.background }}>
              {/* TrackingConsentGate is outermost so zero auth activity fires
                  before consent resolves. AuthProvider is inside so token reads
                  and login redirects only start after consent is done. */}
              <TrackingConsentGate onConsentDone={() => {
                setFillChangeCallback((fillAvailable) => {
                  secureGet("cashclip_auth_token").then((token) => {
                    if (!token) {
                      // No token yet — queue the most-recent fill value so
                      // AuthGate can flush it once login completes.
                      pendingFill = fillAvailable;
                      return;
                    }
                    // Token available: send immediately and discard any queued
                    // pre-auth value since this is now the authoritative state.
                    pendingFill = null;
                    apiRequestSafe("POST", "/api/earn/ad-fill", { rewardedFillAvailable: fillAvailable })
                      .catch(() => {});
                  }).catch(() => {});
                });
                initializeAdMob().then((initialized) => {
                  if (initialized) preloadRewardedAd();
                });
              }}>
                <AuthProvider>
                  <OtaUpdateGate>
                    <ForceUpdateGate>
                      <CelebrationProvider>
                        <RootLayoutNav />
                      </CelebrationProvider>
                    </ForceUpdateGate>
                  </OtaUpdateGate>
                </AuthProvider>
              </TrackingConsentGate>
            </View>
          </GestureHandlerRootView>
        </LanguageProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default Sentry.wrap(RootLayout);
