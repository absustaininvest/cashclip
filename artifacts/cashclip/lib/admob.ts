import { Platform } from "react-native";
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
// AdMob has been fully removed.

export const ADMOB_APP_ID = "";
export const AD_UNITS = { rewarded: "", interstitial: "", banner: "", native: "" };
export const TEST_AD_UNITS = { rewarded: "", interstitial: "", banner: "", native: "" };

export function getAdUnitId(_type: "rewarded" | "interstitial" | "banner" | "native"): string {
  return ""; // LevelPlay uses placement names, not AdMob ad unit IDs
}

export const isAdMobAvailable =
  Platform.OS !== "web" &&
  Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;

let lpInitialized = false;
let lpRewardedAvailable = false;
let lpUserId: string | null = null;
// Set to true by onAdRewarded, consumed and cleared by onAdClosed
let lpEarnedRewardThisSession = false;
let pendingRewardResolve: ((rewarded: boolean) => void) | null = null;
let pendingInterstitialResolve: ((ok: boolean) => void) | null = null;
let adShowStartTime = 0;

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
    return status === "granted";
  } catch {
    return false;
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

export async function initializeAdMob(): Promise<boolean> {
  if (!isAdMobAvailable) return false;
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

    // Rewarded video listener — LevelPlay uses auto-load mode so the SDK
    // manages inventory. onAdAvailable/onAdUnavailable reflect fill state.
    IronSource.setLevelPlayRewardedVideoListener({
      onAdAvailable: () => {
        lpRewardedAvailable = true;
      },
      onAdUnavailable: () => {
        lpRewardedAvailable = false;
      },
      onAdOpened: () => {
        adShowStartTime = Date.now();
        trackAdImpression("rewarded");
      },
      onAdRewarded: () => {
        // Fired before onAdClosed — set flag so onAdClosed can resolve correctly
        lpEarnedRewardThisSession = true;
        trackAdRewardEarned("rewarded", 1, "rewarded");
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

    await IronSource.init(appKey);
    lpInitialized = true;

    // Check initial fill after init
    try {
      const available = await IronSource.isRewardedVideoAvailable();
      lpRewardedAvailable = !!available;
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
  if (!isAdMobReady()) return { rewarded: false };
  if (!lpUserId) return { rewarded: false };

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
