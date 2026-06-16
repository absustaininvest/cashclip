---
name: CashClip ad platform — AdMob orchestrator + 4 demand-source adapters
description: AdMob is the rewarded-video mediation orchestrator again (Jun 16 2026); LevelPlay/ironsource-mediation removed. Unity/ironSource/Pangle/Chartboost kept as AdMob adapters. Needs a native build.
---

# CashClip ad platform: AdMob mediation (orchestrator), 4 networks as adapters

**Jun 16 2026 the orchestrator was swapped back from LevelPlay to Google AdMob.** This reverted the Jun 2026 LevelPlay migration. `react-native-google-mobile-ads` is the orchestrator SDK again; `ironsource-mediation` (the LevelPlay RN SDK) was removed from package.json and `expo.extra.ironsourceAppKey` removed from app.json.

## The key distinction (don't conflate)

Removing **ironSource as the orchestrator** (LevelPlay RN SDK) is NOT removing **ironSource as a demand source**. Unity, ironSource, Pangle, and Chartboost are all kept — each wired as an **AdMob mediation adapter** that bids/serves underneath AdMob's auction.

## How the adapters are wired

- **Android (Gradle `implementation` deps via config plugins in `plugins/`):**
  - `withAndroidUnityAdapter.js` → `com.google.ads.mediation:unity`
  - `withAndroidIronSourceAdapter.js` → `com.google.ads.mediation:ironsource`
  - `withAndroidPangleAdapter.js` → `com.google.ads.mediation:pangle`
  - `withAndroidChartboostAdapter.js` → `com.google.ads.mediation:chartboost` (created Jun 16 2026)
  - These plugins each inject the AdMob adapter (NOT the LevelPlay SDK) — they were always AdMob adapters; their stale comments mention LevelPlay.
- **iOS (`app.json` expo-build-properties `extraPods`):** `GoogleMobileAdsMediationUnity`, `GoogleMobileAdsMediationIronSource`, `GoogleMobileAdsMediationPangle`, `GoogleMobileAdsMediationChartboost`. `withChartboostPodSource.js` adds the Chartboost CocoaPods source.
- **Maven repos (`extraMavenRepos`):** ironSource `https://android-sdk.is.com/`, Pangle `https://artifact.bytedance.com/repository/pangle`. Unity/Chartboost adapters resolve from Google's Maven + Maven Central (already default).
- **App ID:** restored via the `react-native-google-mobile-ads` plugin (`androidAppId`/`iosAppId`) AND `ios.config`/`android.config.googleMobileAdsAppId`. Value `ca-app-pub-8679658921848348~6212139107`.

## lib/admob.ts facts

- Recovered the original AdMob implementation from git commit `953ccb6^` (parent of the LevelPlay migration commit) and rebuilt on it.
- AD_UNITS: rewarded `/7282036986`, interstitial `/8403546965`, banner `/3883360799`, native `/4968536047` (all under `ca-app-pub-8679658921848348`).
- Public interface kept stable so callers/tests don't change: `initializeAdMob`, `isAdMobReady`, `isAdMobAvailable`, `getAdUnavailabilityReason`, `setAdMobUserId`, `showRewardedAd`, `preloadRewardedAd`, `isRewardedAdPreloaded`, `requestAdsConsent`, `setFillChangeCallback`, `getAdFillState`, plus interstitial helpers. Fill-state helpers (LevelPlay-era) are kept and wired to AdMob preload state (fill = a valid preloaded rewarded ad exists).
- `setAdMobUserId(userId)` binds the SSV `userId` and discards any preloaded ad on identity change (so an ad never serves under a stale/empty user_id).
- `initializeAdMob()` awaits `mobileAds().initialize()` and logs `[AdInit] AdMob initialized — mediation adapters: ...` from the returned `AdapterStatus[]` — the primary smoke-test signal that all four adapters compiled into the binary.
- No `NativeModules` import-time guard needed: unlike `ironsource-mediation`, AdMob's `require()` is lazy inside functions already gated by `isAdMobAvailable` (platform + not Expo Go). This is the proven pre-LevelPlay pattern.

## Server reward logic — UNCHANGED (verify only)

Rewarded rewards credit server-side ONLY: AdMob SSV `GET /api/admob/ssv` (ECDSA-SHA256 verified, dedup by transaction_id, daily `rewarded_ad` cap, 3-hour pending window) plus the begin/complete fallback (`/api/earn/ad/begin` → `/api/earn/ad/complete`) which shares the same `rewarded_ad` daily cap. Client never credits ad points. The SSV callback URL is set in the AdMob dashboard to `https://api.cash-clip.app/api/admob/ssv` (operator step, not in code).

## Still needs a NATIVE build (not OTA)

This is a compiled-SDK change. Bumped app.json buildNumber "47" / versionCode 44 (runtimeVersion still "1.0.0"). Live build 40 / build 46 do NOT have this adapter set. Smoke-test via `[AdInit]` logs + a real rewarded view landing as a pending `rewarded_ad` token.

## ironSource/LevelPlay reporting is ALIVE — keep the admin reconciliation widget

Swapping the *orchestrator* to AdMob did NOT kill ironSource/LevelPlay as an *account*. **Unity acquired ironSource**, so LevelPlay is now the merged Unity reporting surface. Owner confirmed (Jun 16 2026, screenshots) CashClip owns BOTH a Unity Ads account and an ironSource/LevelPlay account, under two Unity orgs: "AB Sustainability Investments" and "AB Sustainability Investments AS Publisher" — real revenue shows (e.g. $0.83 ironSource+Unity).

**Therefore the admin `LevelPlayReconciliationWidget` (absustain Admin.tsx, `/api/admin/levelplay/revenue`, pulls the IronSource Reporting API) is LEGITIMATE — do NOT propose removing it as "dead."** Owner explicitly declined removal. The widget compares real DB revenue vs the live merged ironSource/Unity reporting account.

## Operator follow-ups (owner-driven, one step at a time)

AdMob console: confirm the rewarded ad unit + SSV callback URL, and a mediation group listing all four networks with their credentials (Unity game IDs, ironSource app key/instance, Pangle app/placement, Chartboost app id/signature).
