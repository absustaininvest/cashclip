import { Platform } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";

const IRONSOURCE_APP_KEY = "2690d87e5";

export const isLevelPlayAvailable =
  Platform.OS !== "web" &&
  Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;

let lpInitialized = false;
let lpUserId: string | null = null;
let lpAdAvailable = false;
let lpAdLoading = false;

type RewardCallback = (rewardAmount: number) => void;
let pendingRewardCallback: RewardCallback | null = null;
let pendingResolve: ((result: { rewarded: boolean }) => void) | null = null;

export function setLevelPlayUserId(userId: string | null): void {
  lpUserId = userId;
  if (lpInitialized && userId) {
    try {
      const { IronSource } = require("ironsource-mediation");
      IronSource.setUserId(userId);
    } catch {}
  }
}

export function isLevelPlayReady(): boolean {
  return isLevelPlayAvailable && lpInitialized && lpAdAvailable;
}

export function isLevelPlayInitialized(): boolean {
  return lpInitialized;
}

function setupRewardedListener(): void {
  try {
    const { IronSource } = require("ironsource-mediation");
    IronSource.setRewardedVideoListener({
      onRewardedVideoAvailabilityChanged: (available: boolean) => {
        lpAdAvailable = available;
        lpAdLoading = false;
      },
      onRewardedVideoAdRewarded: (placement: {
        placementName: string;
        rewardName: string;
        rewardAmount: number;
      }) => {
        if (pendingRewardCallback) {
          pendingRewardCallback(placement.rewardAmount);
          pendingRewardCallback = null;
        }
      },
      onRewardedVideoAdClosed: () => {
        if (pendingResolve) {
          pendingResolve({ rewarded: false });
          pendingResolve = null;
          pendingRewardCallback = null;
        }
        preloadLevelPlayAd();
      },
      onRewardedVideoAdOpened: () => {},
      onRewardedVideoAdStarted: () => {},
      onRewardedVideoAdEnded: () => {},
      onRewardedVideoAdClicked: (_placement: unknown) => {},
      onRewardedVideoAdLoadFailed: (_error: unknown) => {
        lpAdLoading = false;
        lpAdAvailable = false;
      },
      onRewardedVideoAdShowFailed: (_error: unknown, _placement: unknown) => {
        if (pendingResolve) {
          pendingResolve({ rewarded: false });
          pendingResolve = null;
          pendingRewardCallback = null;
        }
        preloadLevelPlayAd();
      },
    });
  } catch (e) {
    console.warn("LevelPlay listener setup failed:", e);
  }
}

export async function initializeLevelPlay(): Promise<boolean> {
  if (!isLevelPlayAvailable) return false;
  if (lpInitialized) return true;

  try {
    const { IronSource, LevelPlayAdFormat } = require("ironsource-mediation");

    if (lpUserId) {
      IronSource.setUserId(lpUserId);
    }

    if (__DEV__) {
      IronSource.setAdaptersDebug(true);
    }

    setupRewardedListener();

    await IronSource.init({
      appKey: IRONSOURCE_APP_KEY,
      adFormats: [LevelPlayAdFormat.REWARDED],
    });

    lpInitialized = true;
    preloadLevelPlayAd();
    return true;
  } catch (e) {
    console.warn("LevelPlay initialization failed:", e);
    return false;
  }
}

export function preloadLevelPlayAd(): void {
  if (!isLevelPlayAvailable || !lpInitialized || lpAdLoading || lpAdAvailable) return;
  try {
    const { IronSource } = require("ironsource-mediation");
    lpAdLoading = true;
    IronSource.loadRewardedVideo();
  } catch (e) {
    lpAdLoading = false;
    console.warn("LevelPlay preload failed:", e);
  }
}

export async function showLevelPlayRewardedAd(
  onRewarded: (rewardAmount: number) => void
): Promise<{ rewarded: boolean }> {
  if (!isLevelPlayAvailable || !lpInitialized || !lpAdAvailable) {
    return { rewarded: false };
  }

  if (!lpUserId) {
    return { rewarded: false };
  }

  return new Promise((resolve) => {
    let settled = false;

    const timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        pendingRewardCallback = null;
        pendingResolve = null;
        resolve({ rewarded: false });
      }
    }, 30_000);

    pendingRewardCallback = (amount: number) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeoutId);
        pendingResolve = null;
        onRewarded(amount);
        resolve({ rewarded: true });
      }
    };

    pendingResolve = (result) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeoutId);
        pendingRewardCallback = null;
        resolve(result);
      }
    };

    try {
      const { IronSource } = require("ironsource-mediation");
      lpAdAvailable = false;
      IronSource.showRewardedVideo();
    } catch (e) {
      settled = true;
      clearTimeout(timeoutId);
      pendingRewardCallback = null;
      pendingResolve = null;
      console.warn("LevelPlay show failed:", e);
      resolve({ rewarded: false });
    }
  });
}
