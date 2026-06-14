import { Platform, NativeModules } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants, { ExecutionEnvironment } from "expo-constants";
import {
  trackAdImpression,
  trackAdCompletion,
  trackAdRewardEarned,
  trackAdLoadFailed,
} from "./ad-analytics";

// LevelPlay (ironSource mediation) is the primary ad platform.
// Unity Ads, Pangle, and Chartboost are demand sources managed by LevelPlay.

// CRITICAL: check native module presence BEFORE ever calling
// require("ironsource-mediation"). The package's top-level JS creates a
// NativeEventEmitter that crashes immediately if IronSourceMediation isn't
// compiled into the binary (V40/V41 and earlier builds don't have it).
const LP_NATIVE_AVAILABLE = Boolean(NativeModules.IronSourceMediation);

// Unity Ads adapter wires its own NativeEventEmitter inside ironsource-mediation.
// If the Unity native module is absent (e.g. adapter present in Gradle but not
// yet linked, or running on a build without the Unity pod/AAR), constructing
// that emitter throws "NativeEventEmitter requires a non-null argument" and
// crashes the app before any JS guard can run.  Check for the module
// explicitly and skip init when it is missing.
// The module is typically registered as "UnityAds" by the Unity Ads SDK.
const UNITY_NATIVE_AVAILABLE =
  !LP_NATIVE_AVAILABLE || // skip check entirely when IronSource itself is absent
  Boolean(
    NativeModules.UnityAds ||
    NativeModules.UnityAdsPlugin ||
    NativeModules.RNUnityAds
  );

// ─── Diagnostic: log module-presence state once at startup ───────────────────
// These lines are the primary smoke-test signal for build ≥41.
// In a native build with the Unity adapter compiled in you should see:
//   [AdInit] LP_NATIVE_AVAILABLE = true  UNITY_NATIVE_AVAILABLE = true
// If Unity is missing you will see UNITY_NATIVE_AVAILABLE = false and ads will
// be disabled until the next native build that includes the adapter.
console.log(
  `[AdInit] LP_NATIVE_AVAILABLE = ${LP_NATIVE_AVAILABLE}  UNITY_NATIVE_AVAILABLE = ${UNITY_NATIVE_AVAILABLE}` +
  (LP_NATIVE_AVAILABLE && !UNITY_NATIVE_AVAILABLE
    ? "  ← Unity module absent; ad system will be disabled"
    : "")
);

export const ADMOB_APP_ID = "";
export const AD_UNITS = { rewarded: "", interstitial: "", banner: "", native: "" };
export const TEST_AD_UNITS = { rewarded: "", interstitial: "", banner: "", native: "" };

export function getAdUnitId(_type: "rewarded" | "interstitial" | "banner" | "native"): string {
  return ""; // LevelPlay uses placement names, not AdMob ad unit IDs
}

export const isAdMobAvailable =
  Platform.OS !== "web" &&
  Constants.executionEnvironment !== ExecutionEnvironment.StoreClient &&
  LP_NATIVE_AVAILABLE &&
  UNITY_NATIVE_AVAILABLE;

/**
 * Returns a short human-readable reason string when the LevelPlay ad system is
 * unavailable, or null when it is ready. Derived from the same boolean guards
 * that gate `isAdMobAvailable` so the diagnosis always matches the gate.
 *
 * Example values:
 *   "Expo Go / web"              — running in Expo Go or a browser
 *   "IronSource not in build"    — IronSourceMediation native module absent
 *   "Unity native module not found" — Unity module missing (NativeEventEmitter crash guard)
 */
export function getAdUnavailabilityReason(): string | null {
  if (isAdMobAvailable) return null;
  if (
    Platform.OS === "web" ||
    Constants.executionEnvironment === ExecutionEnvironment.StoreClient
  ) {
    return "Expo Go / web";
  }
  if (!LP_NATIVE_AVAILABLE) return "IronSource not in build";
  if (!UNITY_NATIVE_AVAILABLE) return "Unity native module not found";
  return null;
}

let lpInitialized = false;
let lpRewardedAvailable = false;
let lpUserId: string | null = null;

type FillChangeCallback = (fillAvailable: boolean) => void;
let fillChangeCallback: FillChangeCallback | null = null;

export function setFillChangeCallback(cb: FillChangeCallback | null): void {
  fillChangeCallback = cb;
}

export function getAdFillState(): {
  lpInitialized: boolean;
  rewardedFillAvailable: boolean;
  adSystemActive: boolean;
} {
  return {
    lpInitialized,
    rewardedFillAvailable: lpRewardedAvailable,
    adSystemActive: isAdMobAvailable && lpInitialized,
  };
}
// Set to true by onAdRewarded, consumed and cleared by onAdClosed
let lpEarnedRewardThisSession = false;
let pendingRewardResolve: ((rewarded: boolean) => void) | null = null;
let pendingInterstitialResolve: ((ok: boolean) => void) | null = null;
let adShowStartTime = 0;
// Cached from the most recent ImpressionData event (revenue in micros).
// onImpressionSuccess fires at ad show time; onAdRewarded fires shortly after.
// Cleared after it is consumed so stale revenue doesn't leak across sessions.
let lpLastImpressionRevenueMicros: number | null = null;

function getAppKey(): string {
  try {
    const extra = Constants.expoConfig?.extra as Record<string, unknown> | undefined;
    const key = extra?.ironsourceAppKey;
    if (typeof key === "string" && key.length > 0) return key;
  } catch {}
  return "";
}

// ─── Identity ────────────────────────────────────────────────────────────────

export function setAdMobUserId(userId: string | null): void {
  lpUserId = userId;
  if (!lpInitialized || !userId) return;
  try {
    const IronSource = require("ironsource-mediation").default;
    void IronSource.setDynamicUserId(userId);
  } catch {}
}

// ─── Consent ─────────────────────────────────────────────────────────────────

export async function requestAdsConsent(): Promise<void> {
  // ATT is handled by TrackingConsentGate before this runs. We forward the
  // consent signal to LevelPlay so it passes it to demand partners (Unity,
  // Pangle, etc.). Android is always personalized.
  if (!isAdMobAvailable) return;
  try {
    const IronSource = require("ironsource-mediation").default;
    const consented = Platform.OS === "android" || (await resolveATTGranted());
    await IronSource.setConsent(consented);
  } catch (e) {
    console.warn("LevelPlay setConsent failed:", e);
  }
}

async function resolveATTGranted(): Promise<boolean> {
  try {
    const { getTrackingPermissionsAsync } = require("expo-tracking-transparency");
    const { status } = await getTrackingPermissionsAsync();
    // expo-tracking-transparency returns "authorized" (the raw iOS ATT string),
    // not the generic Expo PermissionStatus "granted". Accept both defensively.
    return status === "authorized" || status === "granted";
  } catch {
    return false;
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

export async function initializeAdMob(): Promise<boolean> {
  if (!isAdMobAvailable) {
    if (LP_NATIVE_AVAILABLE && !UNITY_NATIVE_AVAILABLE) {
      console.warn(
        "[AdInit] LevelPlay: Unity Ads native module not found — ad system disabled to prevent NativeEventEmitter crash. " +
        "Build ≥41 with the Unity adapter compiled in is required to enable ads."
      );
    } else if (!LP_NATIVE_AVAILABLE) {
      console.log("[AdInit] LevelPlay native module absent — running in OTA/web mode, ads disabled");
    }
    return false;
  }
  try {
    const IronSource = require("ironsource-mediation").default;
    const appKey = getAppKey();
    if (!appKey) {
      console.warn("LevelPlay: ironsourceAppKey not configured in app.json extra");
      return false;
    }

    // Consent must be set before init
    await requestAdsConsent();

    // Set user ID before init so S2S reward callbacks carry the correct user
    if (lpUserId) await IronSource.setDynamicUserId(lpUserId);

    // Impression-level revenue listener (ARM — Ad Revenue Measurement).
    // onImpressionSuccess fires at the moment an impression is recorded; the
    // revenue field (dollars) is converted to micros and cached so onAdRewarded
    // can attach the real per-impression value to the reward_earned analytics
    // event. ARM SDK Postbacks must be enabled in the IronSource dashboard
    // (Reporting → ARM → SDK Postbacks) for ImpressionData.revenue to be non-null.
    //
    // Correctness rules:
    //  1. We ALWAYS write lpLastImpressionRevenueMicros (including null for
    //     missing/invalid revenue) so a previous ad's value can never bleed
    //     into a later reward event that has no revenue of its own.
    //  2. We only cache revenue for REWARDED impressions — other formats
    //     (interstitial, banner) must not pollute the rewarded revenue slot.
    //
    // Format detection covers both the modern SDK (adFormat = "REWARDED") and
    // the deprecated adUnit string ("RewardedVideo") used by older native SDKs.
    // If format is absent entirely we fail open (treat as rewarded) so a future
    // SDK change never silently drops real revenue.
    try {
      IronSource.setImpressionDataListener({
        onImpressionSuccess: (data?: {
          revenue?: number | null;
          adFormat?: string | null;
          adUnit?: string | null;
          precision?: string | null;
          adNetwork?: string | null;
        }) => {
          // Normalise format: prefer adFormat (AdFormat enum, e.g. "REWARDED"),
          // fall back to legacy adUnit (e.g. "RewardedVideo" → "REWARDEDVIDEO").
          const fmt = (data?.adFormat ?? data?.adUnit ?? "").toUpperCase();
          // Accept "REWARDED" (modern AdFormat enum) or "REWARDEDVIDEO"
          // (deprecated adUnit value from older native SDK versions).
          // When fmt is empty (unknown format) we fail open — better to cache
          // a potentially non-rewarded value than to silently drop real revenue.
          const isRewarded =
            !fmt ||
            fmt === "REWARDED" ||      // AdFormat.REWARDED (ironsource-mediation ≥3)
            fmt === "REWARDEDVIDEO";   // legacy adUnit "RewardedVideo" (deprecated)
          if (!isRewarded) {
            // Not a rewarded impression — leave cache untouched so the rewarded
            // slot isn't clobbered by an unrelated format's revenue.
            return;
          }
          // Always update the cache (including null) for rewarded impressions so
          // stale values from a previous session cannot carry forward.
          if (data?.revenue != null && Number.isFinite(data.revenue) && data.revenue > 0) {
            lpLastImpressionRevenueMicros = Math.round(data.revenue * 1_000_000);
            console.log(
              `[ARM] Impression revenue cached: ${lpLastImpressionRevenueMicros} micros` +
              ` ($${data.revenue.toFixed(6)}) network=${data?.adNetwork ?? "?"} precision=${data?.precision ?? "?"}`
            );
          } else {
            lpLastImpressionRevenueMicros = null;
            if (data != null) {
              // Non-null data but null/zero revenue — ARM toggle may be off in dashboard
              // (Reporting → ARM → SDK Postbacks). Enable it so revenue flows.
              console.warn(
                "[ARM] onImpressionSuccess fired but revenue is null/0. " +
                "Enable ARM SDK Postbacks in the IronSource dashboard: Reporting → ARM → SDK Postbacks."
              );
            }
          }
        },
      });
    } catch (e) {
      console.warn("LevelPlay: setImpressionDataListener failed:", e);
    }

    // Rewarded video listener — LevelPlay uses auto-load mode so the SDK
    // manages inventory. onAdAvailable/onAdUnavailable reflect fill state.
    // Each registration is wrapped independently so a failure in one listener's
    // wiring does not abort the whole init or leave the app in a crashed state.
    try {
      IronSource.setLevelPlayRewardedVideoListener({
        onAdAvailable: () => {
          lpRewardedAvailable = true;
          fillChangeCallback?.(true);
        },
        onAdUnavailable: () => {
          lpRewardedAvailable = false;
          fillChangeCallback?.(false);
        },
        onAdOpened: () => {
          // Reset impression revenue cache at the start of each new ad session
          // so that a stale value from a previous watch cannot attach to this one.
          lpLastImpressionRevenueMicros = null;
          adShowStartTime = Date.now();
          trackAdImpression("rewarded");
        },
        onAdRewarded: () => {
          // Fired before onAdClosed — set flag so onAdClosed can resolve correctly.
          // Consume the cached impression revenue (if any) so it doesn't bleed
          // into the next ad session.
          lpEarnedRewardThisSession = true;
          const revenueMicros = lpLastImpressionRevenueMicros ?? undefined;
          lpLastImpressionRevenueMicros = null;
          trackAdRewardEarned("rewarded", 1, "rewarded", revenueMicros);
        },
        onAdClosed: () => {
          const earned = lpEarnedRewardThisSession;
          lpEarnedRewardThisSession = false;
          const duration = Date.now() - adShowStartTime;
          trackAdCompletion("rewarded", duration);
          if (pendingRewardResolve) {
            pendingRewardResolve(earned);
            pendingRewardResolve = null;
          }
        },
        onAdShowFailed: (error: unknown) => {
          const err = error as { errorCode?: number; errorMessage?: string } | null;
          trackAdLoadFailed("rewarded", String(err?.errorCode ?? ""), err?.errorMessage);
          lpEarnedRewardThisSession = false;
          if (pendingRewardResolve) {
            pendingRewardResolve(false);
            pendingRewardResolve = null;
          }
        },
      });
    } catch (e) {
      console.warn("LevelPlay: setLevelPlayRewardedVideoListener failed:", e);
    }

    try {
      IronSource.setLevelPlayInterstitialListener({
        onAdReady: () => {},
        onAdLoadFailed: (error: unknown) => {
          const err = error as { errorCode?: number; errorMessage?: string } | null;
          trackAdLoadFailed("interstitial", String(err?.errorCode ?? ""), err?.errorMessage);
        },
        onAdOpened: () => {
          adShowStartTime = Date.now();
          trackAdImpression("interstitial");
        },
        onAdClosed: () => {
          const duration = Date.now() - adShowStartTime;
          trackAdCompletion("interstitial", duration);
          if (pendingInterstitialResolve) {
            pendingInterstitialResolve(true);
            pendingInterstitialResolve = null;
          }
        },
        onAdShowFailed: () => {
          if (pendingInterstitialResolve) {
            pendingInterstitialResolve(false);
            pendingInterstitialResolve = null;
          }
        },
      });
    } catch (e) {
      console.warn("LevelPlay: setLevelPlayInterstitialListener failed:", e);
    }

    await IronSource.init(appKey);
    lpInitialized = true;
    console.log(
      "[AdInit] LevelPlay init succeeded — UNITY_NATIVE_AVAILABLE = true, ads are ACTIVE." +
      " If rewarded ads still don't load, check the Unity Game ID and mediation placement in the IronSource dashboard."
    );

    // Check initial fill after init and notify reporter
    try {
      const available = await IronSource.isRewardedVideoAvailable();
      lpRewardedAvailable = !!available;
      console.log(`[AdInit] Rewarded ad immediately available after init: ${!!available}`);
      fillChangeCallback?.(!!available);
    } catch {}

    // Pre-warm interstitial for the first natural break
    try { void IronSource.loadInterstitial(); } catch {}

    return true;
  } catch (e) {
    console.warn("LevelPlay init failed:", e);
    return false;
  }
}

// ─── Rewarded video ──────────────────────────────────────────────────────────

export function isAdMobReady(): boolean {
  return isAdMobAvailable && lpInitialized && lpRewardedAvailable;
}

export function isRewardedAdPreloaded(): boolean {
  // LevelPlay auto-manages its inventory — "preloaded" means an ad is available
  return isAdMobReady();
}

export function preloadRewardedAd(_adUnitId?: string): void {
  // No-op: LevelPlay handles auto-loading in the background after init()
}

export async function showRewardedAd(
  _adUnitId?: string
): Promise<{ rewarded: boolean; type?: string; amount?: number; timedOut?: boolean }> {
  if (!isAdMobAvailable) {
    console.warn("[AdInit] showRewardedVideo skipped — ad platform unavailable (platform/build guard)");
    return { rewarded: false };
  }
  if (!lpInitialized) {
    console.warn("[AdInit] showRewardedVideo skipped — LevelPlay not yet initialized (call initializeAdMob first)");
    return { rewarded: false };
  }
  if (!lpRewardedAvailable) {
    console.warn("[AdInit] showRewardedVideo skipped — no fill (lpRewardedAvailable=false); check Unity mediation placement configuration");
    void trackAdLoadFailed("rewarded", "NO_FILL", "lpRewardedAvailable=false");
    return { rewarded: false };
  }
  if (!lpUserId) {
    console.warn("[AdInit] showRewardedVideo skipped — no userId (call setAdMobUserId before showing ads)");
    return { rewarded: false };
  }

  try {
    const IronSource = require("ironsource-mediation").default;
    // Refresh user ID on every show so S2S callback carries the right user
    await IronSource.setDynamicUserId(lpUserId);

    return await new Promise((resolve) => {
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        pendingRewardResolve = null;
        lpEarnedRewardThisSession = false;
        trackAdLoadFailed("rewarded", "TIMEOUT", "Ad show timed out");
        resolve({ rewarded: false, timedOut: true });
      }, 30_000);

      pendingRewardResolve = (rewarded) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve({ rewarded, type: "rewarded", amount: rewarded ? 1 : 0 });
      };

      IronSource.showRewardedVideo();
    });
  } catch (e) {
    console.warn("LevelPlay showRewardedVideo failed:", e);
    return { rewarded: false };
  }
}

// ─── Interstitial ────────────────────────────────────────────────────────────

const INTERSTITIAL_MIN_GAP_MS = 4 * 60 * 1000;
const INTERSTITIAL_LAST_AT_KEY = "cashclip_last_interstitial_at";

export async function showInterstitialAd(_adUnitId?: string): Promise<boolean> {
  if (!lpInitialized || !isAdMobAvailable) return false;
  try {
    const IronSource = require("ironsource-mediation").default;
    const ready = await IronSource.isInterstitialReady();
    if (!ready) {
      void IronSource.loadInterstitial();
      return false;
    }
    return await new Promise((resolve) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        pendingInterstitialResolve = null;
        resolve(false);
      }, 15_000);

      pendingInterstitialResolve = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(ok);
      };

      adShowStartTime = Date.now();
      IronSource.showInterstitial();
    });
  } catch (e) {
    console.warn("LevelPlay interstitial failed:", e);
    return false;
  }
}

export async function maybeShowInterstitial(): Promise<boolean> {
  if (!lpInitialized || !isAdMobAvailable) return false;
  try {
    const raw = await AsyncStorage.getItem(INTERSTITIAL_LAST_AT_KEY);
    const last = raw ? parseInt(raw, 10) : 0;
    if (Number.isFinite(last) && last > 0 && Date.now() - last < INTERSTITIAL_MIN_GAP_MS) {
      return false;
    }
    await AsyncStorage.setItem(INTERSTITIAL_LAST_AT_KEY, Date.now().toString());
    return await showInterstitialAd();
  } catch {
    return false;
  }
}
