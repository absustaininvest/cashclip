import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants, { ExecutionEnvironment } from "expo-constants";
import type { RewardedAd as RewardedAdType, RewardedAdReward } from "react-native-google-mobile-ads";
import {
  trackAdImpression,
  trackAdCompletion,
  trackAdRewardEarned,
  trackAdLoadFailed,
} from "./ad-analytics";

// Google AdMob is the mediation ORCHESTRATOR. Unity Ads, ironSource, Pangle, and
// Chartboost are retained as DEMAND SOURCES — each wired as an AdMob mediation
// adapter (Android Gradle dependency + iOS pod), bidding/serving underneath
// AdMob's auction. Rewarded-ad rewards credit ONLY server-side via the AdMob SSV
// callback (GET /api/admob/ssv, Google ECDSA verified) plus the begin/complete
// fallback — the client never credits points (see SERVER_ONLY_ACTIONS server-side).

export const ADMOB_APP_ID = Platform.select({
  ios: "ca-app-pub-8679658921848348~6212139107",
  android: "ca-app-pub-8679658921848348~2934376019",
  default: "ca-app-pub-8679658921848348~6212139107",
}) as string;

export const AD_UNITS = {
  rewarded: Platform.select({
    ios: "ca-app-pub-8679658921848348/7282036986",
    android: "ca-app-pub-8679658921848348/8659630355",
    default: "ca-app-pub-8679658921848348/7282036986",
  }) as string,
  interstitial: Platform.select({
    ios: "ca-app-pub-8679658921848348/8403546965",
    android: "ca-app-pub-8679658921848348/4959956862",
    default: "ca-app-pub-8679658921848348/8403546965",
  }) as string,
  banner: "ca-app-pub-8679658921848348/3883360799",
  native: "ca-app-pub-8679658921848348/4968536047",
};

export const TEST_AD_UNITS = {
  rewarded: Platform.select({
    ios: "ca-app-pub-3940256099942544/1712485313",
    android: "ca-app-pub-3940256099942544/5224354917",
    default: "",
  }),
  interstitial: Platform.select({
    ios: "ca-app-pub-3940256099942544/4411468910",
    android: "ca-app-pub-3940256099942544/1033173712",
    default: "",
  }),
  banner: Platform.select({
    ios: "ca-app-pub-3940256099942544/2934735716",
    android: "ca-app-pub-3940256099942544/6300978111",
    default: "",
  }),
  native: Platform.select({
    ios: "ca-app-pub-3940256099942544/3986624511",
    android: "ca-app-pub-3940256099942544/2247696110",
    default: "",
  }),
};

const isDev = __DEV__;

export function getAdUnitId(type: "rewarded" | "interstitial" | "banner" | "native"): string {
  if (isDev) return TEST_AD_UNITS[type] || "";
  return AD_UNITS[type] || TEST_AD_UNITS[type] || "";
}

export const isAdMobAvailable =
  Platform.OS !== "web" &&
  Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;

/**
 * Returns a short human-readable reason string when the AdMob ad system is
 * unavailable, or null when it is ready to be used. Derived from the same guard
 * that gates `isAdMobAvailable` so the diagnosis always matches the gate.
 *
 * Example values:
 *   "Expo Go / web"  — running in Expo Go or a browser (no native AdMob SDK)
 */
export function getAdUnavailabilityReason(): string | null {
  if (isAdMobAvailable) return null;
  if (
    Platform.OS === "web" ||
    Constants.executionEnvironment === ExecutionEnvironment.StoreClient
  ) {
    return "Expo Go / web";
  }
  return null;
}

let adMobInitialized = false;
let nonPersonalizedOnly = true;
let ssvUserId: string | null = null;

// ─── Fill-state notification ─────────────────────────────────────────────────
// A callback the app registers (in _layout via setFillChangeCallback) so the
// server can be told whenever rewarded-ad fill becomes available/unavailable.
// For AdMob, "fill available" == a preloaded rewarded ad is cached and valid.
type FillChangeCallback = (fillAvailable: boolean) => void;
let fillChangeCallback: FillChangeCallback | null = null;
let lastFillReported: boolean | null = null;

export function setFillChangeCallback(cb: FillChangeCallback | null): void {
  fillChangeCallback = cb;
}

// Fire the fill callback only when the value actually changes, so we don't spam
// the server with redundant ad-fill POSTs.
function notifyFill(available: boolean): void {
  if (lastFillReported === available) return;
  lastFillReported = available;
  fillChangeCallback?.(available);
}

export function getAdFillState(): {
  initialized: boolean;
  rewardedFillAvailable: boolean;
  adSystemActive: boolean;
} {
  return {
    initialized: adMobInitialized,
    rewardedFillAvailable: isPreloadedAdValid(),
    adSystemActive: isAdMobAvailable && adMobInitialized,
  };
}

// Identifies the logged-in user to AdMob Server-Side Verification (SSV).
// Without this, Google's SSV callback arrives with no user_id and the server
// cannot credit the reward to anyone — so rewarded ads never pay out.
//
// When the identity changes (login, logout, or user switch), any ad that was
// preloaded under the OLD identity must be thrown away: showing it would send
// Google's SSV callback with the wrong (or empty) user_id, causing a missed
// credit or — worse — crediting the previous user.
export function setAdMobUserId(userId: string | null): void {
  const normalized = userId && userId.length > 0 ? userId : null;
  if (normalized === ssvUserId) return;
  ssvUserId = normalized;
  // Bump the generation so any preload request already in flight under the old
  // identity is ignored when it finishes loading (it would carry a stale id).
  preloadGeneration++;
  clearPreloadRetryTimer();
  preloadRetryCount = 0;
  preloadInProgress = false;
  discardPreloadedAd();
  notifyFill(false);
}

function shouldUseNonPersonalizedOnly(): boolean {
  return nonPersonalizedOnly;
}

function buildAdRequestConfig() {
  return {
    requestNonPersonalizedAdsOnly: shouldUseNonPersonalizedOnly(),
    ...(ssvUserId ? { serverSideVerificationOptions: { userId: ssvUserId } } : {}),
    keywords: [
      "rewards",
      "cashback",
      "earn money",
      "survey",
      "gaming",
      "gift cards",
      "finance",
      "mobile games",
    ],
    contentUrl: "https://cash-clip.app",
  };
}

async function resolvePersonalizationConsent(): Promise<void> {
  if (Platform.OS === "android") {
    nonPersonalizedOnly = false;
    return;
  }
  try {
    const { getTrackingPermissionsAsync } = require("expo-tracking-transparency");
    const { status } = await getTrackingPermissionsAsync();
    // expo-tracking-transparency returns "authorized" (the raw iOS ATT string),
    // not the generic Expo PermissionStatus "granted". Accept both defensively.
    nonPersonalizedOnly = !(status === "authorized" || status === "granted");
  } catch {
    nonPersonalizedOnly = true;
  }
}

export function isAdMobReady(): boolean {
  return isAdMobAvailable && adMobInitialized;
}

export async function requestAdsConsent(): Promise<void> {
  if (!isAdMobAvailable) return;
  try {
    const { AdsConsent, AdsConsentStatus } = require("react-native-google-mobile-ads");
    const info = await AdsConsent.requestInfoUpdate();
    if (
      info.isConsentFormAvailable &&
      (info.status === AdsConsentStatus.REQUIRED || info.status === AdsConsentStatus.UNKNOWN)
    ) {
      await AdsConsent.showForm();
    }
  } catch (e) {
    console.warn("AdsConsent request failed:", e);
  }
}

export async function initializeAdMob(): Promise<boolean> {
  if (!isAdMobAvailable) {
    console.log("[AdInit] AdMob native module absent — running in OTA/web mode, ads disabled");
    return false;
  }

  try {
    // ATT and AdsConsent are handled by TrackingConsentGate before this runs.
    // Resolve personalization consent now so ad requests use the correct flag.
    await resolvePersonalizationConsent();
    const mobileAds = require("react-native-google-mobile-ads").default;
    // initialize() resolves with the per-adapter initialization statuses. Logging
    // them is the primary smoke-test signal that all four demand-source adapters
    // (Unity / ironSource / Pangle / Chartboost) are compiled into the binary and
    // mediating under AdMob. A missing adapter simply won't appear in this list.
    const statuses = await mobileAds().initialize();
    adMobInitialized = true;
    try {
      const summary = Array.isArray(statuses)
        ? statuses.map((s) => `${s?.name ?? "?"}=${s?.state}`).join(", ")
        : "(no adapter status array)";
      console.log(`[AdInit] AdMob initialized — mediation adapters: ${summary}`);
    } catch {
      console.log("[AdInit] AdMob initialized (adapter status unavailable)");
    }
    return true;
  } catch (e) {
    console.warn("[AdInit] AdMob initialization failed:", e);
    adMobInitialized = false;
    return false;
  }
}

const AD_EXPIRY_MS = 55 * 60 * 1000;
const AD_LOAD_TIMEOUT_MS = 15_000;

interface PreloadedAd {
  ad: RewardedAdType;
  loadedAt: number;
  userId: string | null;
  cleanupListeners: () => void;
}

let preloadedRewardedAd: PreloadedAd | null = null;
let preloadInProgress = false;
let preloadRetryCount = 0;
let preloadRetryTimer: ReturnType<typeof setTimeout> | null = null;
// Incremented whenever the SSV identity changes; lets in-flight preloads detect
// that their identity is stale by the time they finish loading.
let preloadGeneration = 0;

const MAX_PRELOAD_RETRIES = 3;
const PRELOAD_RETRY_BASE_DELAY_MS = 5_000;
const PRELOAD_RETRY_MULTIPLIER = 3;

function clearPreloadRetryTimer(): void {
  if (preloadRetryTimer !== null) {
    clearTimeout(preloadRetryTimer);
    preloadRetryTimer = null;
  }
}

function schedulePreloadRetry(adUnitId?: string): void {
  if (preloadRetryCount >= MAX_PRELOAD_RETRIES) {
    preloadRetryCount = 0;
    return;
  }

  const delay = PRELOAD_RETRY_BASE_DELAY_MS * Math.pow(PRELOAD_RETRY_MULTIPLIER, preloadRetryCount);
  preloadRetryCount++;

  preloadRetryTimer = setTimeout(() => {
    preloadRetryTimer = null;
    preloadRewardedAd(adUnitId);
  }, delay);
}

function isPreloadedAdValid(): boolean {
  if (!preloadedRewardedAd) return false;
  // A cached ad is only usable for the user it was requested for; otherwise its
  // SSV user_id is stale and the reward would be missed or misattributed. A null
  // identity (not logged in / auth not settled yet) can never be credited, so an
  // ad requested without one must never be served.
  if (preloadedRewardedAd.userId === null || preloadedRewardedAd.userId !== ssvUserId) {
    return false;
  }
  return Date.now() - preloadedRewardedAd.loadedAt < AD_EXPIRY_MS;
}

export function isRewardedAdPreloaded(): boolean {
  return isPreloadedAdValid();
}

export function preloadRewardedAd(adUnitId?: string): void {
  if (!isAdMobAvailable || !adMobInitialized) return;
  if (preloadInProgress || isPreloadedAdValid()) return;

  clearPreloadRetryTimer();

  if (preloadedRewardedAd && !isPreloadedAdValid()) {
    discardPreloadedAd();
  }

  preloadInProgress = true;

  try {
    const { RewardedAd, RewardedAdEventType, AdEventType, TestIds } = require("react-native-google-mobile-ads");
    const unitId = adUnitId || getAdUnitId("rewarded") || TestIds.REWARDED;

    // Capture the identity (and its generation) this ad is being requested for,
    // so we never serve it to a different user later (see isPreloadedAdValid).
    const requestUserId = ssvUserId;
    const requestGeneration = preloadGeneration;
    const rewarded = RewardedAd.createForAdRequest(unitId, buildAdRequestConfig());

    const unsubscribeLoaded = rewarded.addAdEventListener(
      RewardedAdEventType.LOADED,
      () => {
        preloadInProgress = false;
        // The user changed while this ad was loading — its SSV id is now stale,
        // so throw it away instead of caching it.
        if (requestGeneration !== preloadGeneration) {
          cleanup();
          return;
        }
        preloadRetryCount = 0;
        preloadedRewardedAd = {
          ad: rewarded,
          loadedAt: Date.now(),
          userId: requestUserId,
          cleanupListeners: cleanup,
        };
        notifyFill(true);
      }
    );

    const unsubscribeError = rewarded.addAdEventListener(
      AdEventType.ERROR,
      (error: unknown) => {
        console.warn("Rewarded ad preload failed:", error);
        const errObj = error as { code?: string; message?: string } | null;
        trackAdLoadFailed("rewarded", errObj?.code, errObj?.message);
        preloadInProgress = false;
        cleanup();
        notifyFill(false);
        schedulePreloadRetry(adUnitId);
      }
    );

    function cleanup() {
      unsubscribeLoaded?.();
      unsubscribeError?.();
    }

    rewarded.load();
  } catch (e) {
    console.warn("Rewarded ad preload error:", e);
    preloadInProgress = false;
    schedulePreloadRetry(adUnitId);
  }
}

function discardPreloadedAd(): void {
  if (preloadedRewardedAd) {
    preloadedRewardedAd.cleanupListeners();
    preloadedRewardedAd = null;
  }
}

interface PreloadedAdResult {
  rewarded: boolean;
  type?: string;
  amount?: number;
  error?: boolean;
}

function showPreloadedAd(): Promise<PreloadedAdResult> {
  const cached = preloadedRewardedAd!;
  preloadedRewardedAd = null;
  cached.cleanupListeners();
  // The preloaded ad is now being consumed — fill is no longer available until
  // the next preload completes.
  notifyFill(false);

  const { RewardedAdEventType, AdEventType } = require("react-native-google-mobile-ads");
  const rewarded = cached.ad;

  return new Promise((resolve) => {
    let earned = false;
    let rewardAmount = 0;
    let rewardType = "";
    const showTime = Date.now();

    const unsubscribeEarned = rewarded.addAdEventListener(
      RewardedAdEventType.EARNED_REWARD,
      ((reward: RewardedAdReward) => {
        earned = true;
        rewardType = reward.type;
        rewardAmount = reward.amount;
      }) as Parameters<typeof rewarded.addAdEventListener>[1]
    );

    const unsubscribeClosed = rewarded.addAdEventListener(
      AdEventType.CLOSED,
      () => {
        const durationMs = Date.now() - showTime;
        trackAdCompletion("rewarded", durationMs);
        if (earned) {
          trackAdRewardEarned("rewarded", rewardAmount, rewardType || "rewarded");
        }
        cleanup();
        preloadRewardedAd();
        resolve({ rewarded: earned, type: rewardType || "rewarded", amount: rewardAmount });
      }
    );

    const unsubscribeError = rewarded.addAdEventListener(
      AdEventType.ERROR,
      (error: unknown) => {
        console.warn("Preloaded rewarded ad show error:", error);
        cleanup();
        preloadRewardedAd();
        resolve({ rewarded: false, error: true });
      }
    );

    function cleanup() {
      unsubscribeEarned?.();
      unsubscribeClosed?.();
      unsubscribeError?.();
    }

    trackAdImpression("rewarded");
    rewarded.show();
  });
}

function loadAndShowOnDemand(adUnitId?: string): Promise<{ rewarded: boolean; type?: string; amount?: number; timedOut?: boolean }> {
  const { RewardedAd, RewardedAdEventType, AdEventType, TestIds } = require("react-native-google-mobile-ads");
  const unitId = adUnitId || getAdUnitId("rewarded") || TestIds.REWARDED;

  return new Promise((resolve) => {
    let settled = false;
    let adShown = false;

    const rewarded = RewardedAd.createForAdRequest(unitId, buildAdRequestConfig());

    let earned = false;
    let rewardAmount = 0;
    let rewardType = "";

    const timeoutId = setTimeout(() => {
      if (settled || adShown) return;
      settled = true;
      console.warn(`Rewarded ad load timed out after ${AD_LOAD_TIMEOUT_MS}ms`);
      trackAdLoadFailed("rewarded", "TIMEOUT", `Ad failed to load within ${AD_LOAD_TIMEOUT_MS}ms`);
      cleanup();
      preloadRewardedAd();
      resolve({ rewarded: false, timedOut: true });
    }, AD_LOAD_TIMEOUT_MS);

    const unsubscribeEarned = rewarded.addAdEventListener(
      RewardedAdEventType.EARNED_REWARD,
      (reward: { type: string; amount: number }) => {
        earned = true;
        rewardType = reward.type;
        rewardAmount = reward.amount;
      }
    );

    const loadStartTime = Date.now();

    const unsubscribeLoaded = rewarded.addAdEventListener(
      RewardedAdEventType.LOADED,
      () => {
        if (settled) return;
        adShown = true;
        clearTimeout(timeoutId);
        trackAdImpression("rewarded");
        rewarded.show();
      }
    );

    const unsubscribeClosed = rewarded.addAdEventListener(
      AdEventType.CLOSED,
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        const durationMs = Date.now() - loadStartTime;
        trackAdCompletion("rewarded", durationMs);
        if (earned) {
          trackAdRewardEarned("rewarded", rewardAmount, rewardType || "rewarded");
        }
        cleanup();
        preloadRewardedAd();
        resolve({ rewarded: earned, type: rewardType || "rewarded", amount: rewardAmount });
      }
    );

    const unsubscribeError = rewarded.addAdEventListener(
      AdEventType.ERROR,
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        console.warn("Rewarded ad failed to load:", error);
        const errObj = error as { code?: string; message?: string } | null;
        trackAdLoadFailed("rewarded", errObj?.code, errObj?.message);
        cleanup();
        preloadRewardedAd();
        resolve({ rewarded: false });
      }
    );

    function cleanup() {
      unsubscribeEarned?.();
      unsubscribeLoaded?.();
      unsubscribeClosed?.();
      unsubscribeError?.();
    }

    rewarded.load();
  });
}

export async function showRewardedAd(adUnitId?: string): Promise<{ rewarded: boolean; type?: string; amount?: number; timedOut?: boolean }> {
  if (!isAdMobReady()) {
    return { rewarded: false };
  }

  // Rewarded ads only pay out via Google's SSV callback, which requires the
  // user_id. If we don't yet know who the user is, showing an ad would burn an
  // impression that can never be credited — skip it rather than mislead the user.
  if (!ssvUserId) {
    return { rewarded: false };
  }

  if (!adUnitId && isPreloadedAdValid()) {
    const result = await showPreloadedAd();
    if (result.error) {
      return loadAndShowOnDemand(adUnitId);
    }
    return result;
  }

  discardPreloadedAd();

  try {
    return await loadAndShowOnDemand(adUnitId);
  } catch (e) {
    console.warn("Rewarded ad error:", e);
    preloadRewardedAd();
    return { rewarded: false };
  }
}

// Minimum gap between interstitials so they stay non-annoying. Interstitials
// only fire at natural transitions (e.g. finishing a game round) and are capped
// to at most one per this window across the whole app.
const INTERSTITIAL_MIN_GAP_MS = 4 * 60 * 1000;
const INTERSTITIAL_LAST_AT_KEY = "cashclip_last_interstitial_at";

/**
 * Frequency-capped interstitial. Call this at natural transition points. It
 * shows an interstitial only if AdMob is ready and the last one was more than
 * INTERSTITIAL_MIN_GAP_MS ago. Impressions/completions are tracked inside
 * showInterstitialAd, so these count in the ads-revenue analytics path.
 * Fails closed (returns false) on any error so it never blocks the user.
 */
export async function maybeShowInterstitial(): Promise<boolean> {
  if (!isAdMobReady()) return false;
  try {
    const raw = await AsyncStorage.getItem(INTERSTITIAL_LAST_AT_KEY);
    const last = raw ? parseInt(raw, 10) : 0;
    if (Number.isFinite(last) && last > 0 && Date.now() - last < INTERSTITIAL_MIN_GAP_MS) {
      return false;
    }
    // Stamp the time up-front so rapid transitions or a slow ad load can't
    // queue two interstitials back-to-back.
    await AsyncStorage.setItem(INTERSTITIAL_LAST_AT_KEY, Date.now().toString());
    return await showInterstitialAd();
  } catch (e) {
    console.warn("maybeShowInterstitial error:", e);
    return false;
  }
}

export async function showInterstitialAd(adUnitId?: string): Promise<boolean> {
  if (!isAdMobReady()) return false;

  try {
    const { InterstitialAd, AdEventType, TestIds } = require("react-native-google-mobile-ads");
    const unitId = adUnitId || getAdUnitId("interstitial") || TestIds.INTERSTITIAL;

    return new Promise((resolve) => {
      let settled = false;
      let adShown = false;

      const interstitial = InterstitialAd.createForAdRequest(unitId, buildAdRequestConfig());

      const loadStartTime = Date.now();

      const timeoutId = setTimeout(() => {
        if (settled || adShown) return;
        settled = true;
        console.warn(`Interstitial ad load timed out after ${AD_LOAD_TIMEOUT_MS}ms`);
        trackAdLoadFailed("interstitial", "TIMEOUT", `Ad failed to load within ${AD_LOAD_TIMEOUT_MS}ms`);
        cleanup();
        resolve(false);
      }, AD_LOAD_TIMEOUT_MS);

      const unsubscribeLoaded = interstitial.addAdEventListener(AdEventType.LOADED, () => {
        if (settled) return;
        adShown = true;
        clearTimeout(timeoutId);
        trackAdImpression("interstitial");
        interstitial.show();
      });

      const unsubscribeClosed = interstitial.addAdEventListener(AdEventType.CLOSED, () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        const durationMs = Date.now() - loadStartTime;
        trackAdCompletion("interstitial", durationMs);
        cleanup();
        resolve(true);
      });

      const unsubscribeError = interstitial.addAdEventListener(AdEventType.ERROR, (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        const errObj = error as { code?: string; message?: string } | null;
        trackAdLoadFailed("interstitial", errObj?.code, errObj?.message);
        cleanup();
        resolve(false);
      });

      function cleanup() {
        unsubscribeLoaded?.();
        unsubscribeClosed?.();
        unsubscribeError?.();
      }

      interstitial.load();
    });
  } catch (e) {
    console.warn("Interstitial ad error:", e);
    return false;
  }
}
