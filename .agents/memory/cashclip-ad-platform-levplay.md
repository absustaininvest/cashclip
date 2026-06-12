---
name: CashClip ad platform — LevelPlay (ironSource), NOT AdMob
description: AdMob fully removed Jun 2026; LevelPlay (ironsource-mediation v3.2.0) is the new primary ad SDK. Requires a new native build to activate.
---

# CashClip ad platform: LevelPlay (ironSource mediation)

**AdMob has been fully removed (Jun 12 2026).** `react-native-google-mobile-ads` plugin is gone from `app.json`. The `lib/admob.ts` API surface is preserved (same exported function names) so all callers continue to compile; internally every function now targets LevelPlay.

## Key facts for the next session

- **Package:** `ironsource-mediation@3.2.0` — already installed in the workspace (pnpm).
- **App Key:** saved as `IRONSOURCE_APP_KEY` secret AND baked into `app.json extra.ironsourceAppKey` (client-public, read at runtime via `Constants.expoConfig.extra.ironsourceAppKey`). Value: `2690d87e5`.
- **Init flow:** `initializeAdMob()` → calls `IronSource.setConsent()` → `IronSource.setDynamicUserId()` → `IronSource.init(appKey)`. ATT consent handled upstream by TrackingConsentGate (same as before).
- **Rewarded video:** auto-load mode. `onAdRewarded` fires BEFORE `onAdClosed`; the flag `lpEarnedRewardThisSession` bridges the two events. `showRewardedAd()` returns a Promise resolved in `onAdClosed`.
- **Interstitial:** manual load (`loadInterstitial()` on init + after each close). `isInterstitialReady()` → `showInterstitial()`.
- **Banner ads:** `InFeedBanner.native.tsx` and `BackgroundBanner.native.tsx` return `null` — LevelPlay banner support deferred to a future build.
- **Demand sources (server-side in LevelPlay dashboard):** Unity Ads ($0.20 earned, 15 impressions confirmed live Jun 2026), Pangle (company verification pending by owner).
- **S2S reward callbacks:** LevelPlay sends server-to-server callbacks; the API's `/api/earn/ad/complete` path is unchanged (existing `begin/complete` challenge flow is the bridge until S2S is wired).

## CRITICAL: NativeEventEmitter guard pattern

`ironsource-mediation` (and many other RN packages) runs `new NativeEventEmitter(NativeModules.X)` at module-evaluation time. If the native module isn't in the binary, this throws immediately — BEFORE any try/catch in calling code can run, and before even `initializeAdMob()` is reached. This caused fatal crashes on V40/V41 after the first LevelPlay OTA was pushed.

**Fix applied (Jun 12 2026):** `LP_NATIVE_AVAILABLE = Boolean(NativeModules.IronSourceMediation)` computed at import time (NO require() call), and included in `isAdMobAvailable`. Every function that would call `require("ironsource-mediation")` already guards on `isAdMobAvailable`, so the require is never reached on builds without the native module.

**Rule:** For ANY new RN native-module package added to admob.ts (or similar), always add a `NativeModules.X` check BEFORE the `require()` — never rely on try/catch around require() alone.

## What still needs a new NATIVE BUILD (build ≥41)

LevelPlay is JS-only on the surface (ironsource-mediation autolinks) but the native SDK (IronSourceSDK 8.10.0.0 on iOS via the podspec; ironSource Maven on Android) must be compiled into the binary. Live build 29 and V40 do NOT have the ironsource-mediation native module — `initializeAdMob()` will fail gracefully (returns false) and ads won't load on those builds. The maintenance-notice OTA was pushed to bridge the gap while the new build is prepared.

## AdMob artifacts that remain (intentionally)

- `lib/admobAlerts.ts` — reporting/divergence alert code; now gated by `ADMOB_ALERTS_DISABLED=true` env var (set Jun 2026). Safe to leave; produces no alerts. Remove or repurpose for LevelPlay reporting in a future session.
- `lib/admob.web.ts` — no-op web stubs; unchanged (web has no ads regardless of platform).
- ADMOB_OAUTH_* secrets — still in workspace for historical access to AdMob reporting data; no longer used by the app.

**Why:**
Owner explicitly requested full AdMob removal ("i dont wanna see admob anywhere ive had enough of their lies"). Unity's LevelPlay team also proactively reached out with support. AdMob never communicated despite live revenue issues. LevelPlay gives owner direct Unity earnings without AdMob cut.
