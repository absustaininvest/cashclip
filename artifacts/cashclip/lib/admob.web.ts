export const ADMOB_APP_ID = "";

export const AD_UNITS = {
  rewarded: "",
  interstitial: "",
  banner: "",
};

export const TEST_AD_UNITS = {
  rewarded: "",
  interstitial: "",
  banner: "",
};

export function getAdUnitId(_type: "rewarded" | "interstitial" | "banner"): string {
  return "";
}

export const isAdMobAvailable = false;

export function isAdMobReady(): boolean {
  return false;
}

export function setAdMobUserId(_userId: string | null): void {
  // no-op on web
}

export async function requestAdsConsent(): Promise<void> {
  // no-op on web
}

export async function initializeAdMob(): Promise<boolean> {
  return false;
}

export function isRewardedAdPreloaded(): boolean {
  return false;
}

export function preloadRewardedAd(_adUnitId?: string): void {
  // no-op on web
}

export async function showRewardedAd(_adUnitId?: string): Promise<{ rewarded: boolean; type?: string; amount?: number; timedOut?: boolean }> {
  return { rewarded: false };
}

export async function showInterstitialAd(_adUnitId?: string): Promise<boolean> {
  return false;
}
