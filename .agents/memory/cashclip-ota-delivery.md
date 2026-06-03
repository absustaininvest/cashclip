---
name: CashClip OTA delivery — build 29 lives in a SEPARATE Expo project
description: How EAS Update OTAs map to CashClip builds, and the exact procedure to push an OTA onto the live App Store build (29).
---

# OTA delivery to CashClip builds — two projects, not one

**Hard fact (verified June 1, 2026 via Expo GraphQL build registry):** CashClip builds are split across TWO Expo projects, and our token's viewer has access to BOTH accounts.

- **Project A — `aac2a3d9-56b6-49ab-b254-9b80e98bab2f`** (account `absustainabilityinvestments`). Holds iOS builds **30–38**. This is what `app.json` normally points at (`owner`, `extra.eas.projectId`, `updates.url`). OTAs published normally land here → reach builds 30–38.
- **Project B — `10994af8-62e3-4a9d-9e35-7f4381965a31`** (slug `cashclip`, account `absustainabilityinvestmentsllc`). Holds the **live, App-Store-approved build 29** (v1.0.0(29), bundle id `app.replit.cashclip`, built under username expodeveloper20). Build 29's baked-in `updates.url` points HERE.

**Both projects use channel `production` → branch `production` (mapping logic "true") and runtimeVersion `1.0.0`.** That shared runtime label is why drift happened: after the May 15 2026 "Fix admin modals" update (the last OTA to reach build 29 on Project B), all subsequent OTAs went to Project A and only reached 30–38, leaving build 29 stuck on stale JS (the "tap home ad card → flash → bridge to Earn" behavior).

## Build 29 IS reachable by OTA, but PASSIVE native-ad VIEWS crash it — only TAP-triggered ads are safe (corrected live June 3, 2026)
**Nuance that matters:** build 29 reliably plays TAP-triggered full-screen ads (rewarded/interstitial via `lib/admob.ts` guarded `require()` + `isAdMobReady()` + try/catch in `handleAdPress`) — those degrade gracefully and never crashed. BUT **passively-rendered native ad VIEWS on the Home screen DO hard-crash build 29's older bundled `react-native-google-mobile-ads`** — a native crash JS can't catch. Two offenders, both on Home (`app/(tabs)/index.tsx`):
- `components/NativeAdCard.native.tsx` — used `NativeAd.createForAdRequest` + `<NativeAdView>` for the 25-card "Google Ad Feed". 25 simultaneous native ad views = instant crash. **FIX: render fallback placeholder cards only (FALLBACK_CARDS) — no NativeAd/NativeAdView at all.**
- `components/InFeedBanner.native.tsx` — rendered a real `<BannerAd>`. It loads async, so it crashed a beat LATER ("app stays open a bit longer, then closes"). **FIX: return null (match the web `InFeedBanner.tsx` which already returns null).**
Symptom progression confirmed by owner: after fixing only NativeAdCard, app lasted longer then still closed → that delayed crash was the BannerAd. Fixing both stopped it.
**Rule going forward: NEVER ship a passively-rendered AdMob view (`NativeAdView`, `BannerAd`, `GAMBannerAd`) in an OTA targeting build 29. Only tap-triggered guarded full-screen ads are build-29-safe. Keep the colorful card visuals as static placeholders.**
**Meta-lesson: a crash that "takes longer each time" = a second async-loading crash source, not the same one; hunt for ALL passive native surfaces on the screen, not just the first.**
**Platform-file export trap (cost a 3rd OTA, June 3 2026):** when a `Foo.native.tsx` / `Foo.tsx` pair exists, `tsc` type-resolves the NON-native file, so if `index.tsx` imports named exports (`PLACEHOLDER_CARDS`, `adSlotReward`) that exist only in `Foo.tsx`, typecheck PASSES but on-device Metro loads `Foo.native.tsx` → those imports are `undefined` → device-only crash (here: tap-to-earn fallback). RULE: when editing one variant of a platform pair, keep ALL named exports identical across both files; tsc will NOT catch a missing `.native` export.
**Rollback procedure (USED June 3 2026 to stop the build-29 crash loop):** `eas update:roll-back-to-embedded --branch production --runtime-version "1.0.0" --platform ios --message "..." --non-interactive` on Project B. Flags `--runtime-version` (hyphenated) AND `--message` are BOTH REQUIRED in `--non-interactive` (eas-cli 20.0.0 errors "--branch and --message ... are required" without `--message`). Publishes a tiny directive so clients drop the OTA and use their embedded (App-Store-approved v1.0) bundle. **Why this over another OTA fix:** when build 29 crashes ~2s in, a full ~3.6MB JS bundle can't finish its background download before the crash → fixes never land (crash-download-loop). The rollback directive is bytes-sized, fetched at launch-start, so it beats the crash and applies within a couple of launches. Same app.json Project-B swap + revert dance as a normal OTA publish.

To publish an OTA onto build 29:
1. Temporarily edit `artifacts/cashclip/app.json`: `owner` → `absustainabilityinvestmentsllc`, `extra.eas.projectId` → `10994af8-...`, `updates.url` → `https://u.expo.dev/10994af8-...`. **Keep `runtimeVersion` "1.0.0".**
2. Publish: `cd artifacts/cashclip && EXPO_TOKEN="$EXPO_TOKLAST" EXPO_PUBLIC_ENV=production EXPO_PUBLIC_DOMAIN=cash-clip.app pnpm exec eas update --branch production --message "..." --non-interactive`.
   - `eas-cli` bundling takes ~2–4 min and exceeds the 120s bash limit → run it via a managed workflow (`configureWorkflow` outputType "console"), `tee` to a log file, poll, then `removeWorkflow`. Plain bash `eas` gets KILLED.
3. **REVERT `app.json`** back to Project A values (`absustainabilityinvestments` / `aac2a3d9-...`) so normal build/OTA flow is unchanged. Confirm `git diff` on app.json is empty.
4. Verify via GraphQL: newest update on Project B branch `production` runtime `1.0.0`.

**How to verify build membership / channel mapping:** `curl` `https://api.expo.dev/graphql` with `Authorization: Bearer $EXPO_TOKLAST` (code_execution sandbox has no env secrets — use bash+curl). Query `app.byId(appId).buildsPaginated` for `appBuildVersion`+`platform`, and `updateBranchByName(name:"production").updates` for the OTA history.

## For all builds: small, JS-only groups only
runtimeVersion `"1.0.0"` is one static label shared across builds whose NATIVE code differs. OTA carries only JS + assets. Ship small, self-contained JS/content changes verified compatible with the OLDEST reachable native layer; never bundle native changes (new SDK/module, new permission, plugin/`expo-build-properties`/`newArchEnabled` changes) into an OTA — those need a new App Store build. Get explicit owner approval before any publish.
