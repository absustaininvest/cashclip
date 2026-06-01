---
name: CashClip OTA delivery — build 29 lives in a SEPARATE Expo project
description: How EAS Update OTAs map to CashClip builds, and the exact procedure to push an OTA onto the live App Store build (29).
---

# OTA delivery to CashClip builds — two projects, not one

**Hard fact (verified June 1, 2026 via Expo GraphQL build registry):** CashClip builds are split across TWO Expo projects, and our token's viewer has access to BOTH accounts.

- **Project A — `aac2a3d9-56b6-49ab-b254-9b80e98bab2f`** (account `absustainabilityinvestments`). Holds iOS builds **30–38**. This is what `app.json` normally points at (`owner`, `extra.eas.projectId`, `updates.url`). OTAs published normally land here → reach builds 30–38.
- **Project B — `10994af8-62e3-4a9d-9e35-7f4381965a31`** (slug `cashclip`, account `absustainabilityinvestmentsllc`). Holds the **live, App-Store-approved build 29** (v1.0.0(29), bundle id `app.replit.cashclip`, built under username expodeveloper20). Build 29's baked-in `updates.url` points HERE.

**Both projects use channel `production` → branch `production` (mapping logic "true") and runtimeVersion `1.0.0`.** That shared runtime label is why drift happened: after the May 15 2026 "Fix admin modals" update (the last OTA to reach build 29 on Project B), all subsequent OTAs went to Project A and only reached 30–38, leaving build 29 stuck on stale JS (the "tap home ad card → flash → bridge to Earn" behavior).

## Build 29 IS reachable by OTA — procedure (done successfully June 1, 2026)
**CORRECTION (June 1, 2026): native-dependent Home JS DID crash build 29.** Pushing the current Home feed JS to build 29 crashed it into the ErrorBoundary "Something went wrong / Please reload" screen — the Home feed pulls in Google native ad pieces (`InFeedBanner.native.tsx` STATICALLY imports `BannerAd`/`BannerAdSize` at module load; `NativeAdCard.native.tsx` uses `NativeAd`/`NativeAdView`). Build 29's older compiled `react-native-google-mobile-ads` native layer doesn't match the newer JS API → crash on Home render. Fix: `eas update:roll-back-to-embedded --branch production --runtime-version "1.0.0" --platform ios` on Project B (flag is hyphenated `--runtime-version` and REQUIRED in `--non-interactive`; `roll-back-to-embedded` publishes a rollback directive so clients drop the bad OTA and use their embedded bundle). **Lesson: the 25 native ad slots are NATIVE-dependent → they CANNOT be delivered to build 29 via OTA; they need a NEW App Store build. Do not assume "build 29 has AdMob native" means arbitrary newer AdMob JS is safe.**

To publish an OTA onto build 29:
1. Temporarily edit `artifacts/cashclip/app.json`: `owner` → `absustainabilityinvestmentsllc`, `extra.eas.projectId` → `10994af8-...`, `updates.url` → `https://u.expo.dev/10994af8-...`. **Keep `runtimeVersion` "1.0.0".**
2. Publish: `cd artifacts/cashclip && EXPO_TOKEN="$EXPO_TOKLAST" EXPO_PUBLIC_ENV=production EXPO_PUBLIC_DOMAIN=cash-clip.app pnpm exec eas update --branch production --message "..." --non-interactive`.
   - `eas-cli` bundling takes ~2–4 min and exceeds the 120s bash limit → run it via a managed workflow (`configureWorkflow` outputType "console"), `tee` to a log file, poll, then `removeWorkflow`. Plain bash `eas` gets KILLED.
3. **REVERT `app.json`** back to Project A values (`absustainabilityinvestments` / `aac2a3d9-...`) so normal build/OTA flow is unchanged. Confirm `git diff` on app.json is empty.
4. Verify via GraphQL: newest update on Project B branch `production` runtime `1.0.0`.

**How to verify build membership / channel mapping:** `curl` `https://api.expo.dev/graphql` with `Authorization: Bearer $EXPO_TOKLAST` (code_execution sandbox has no env secrets — use bash+curl). Query `app.byId(appId).buildsPaginated` for `appBuildVersion`+`platform`, and `updateBranchByName(name:"production").updates` for the OTA history.

## For all builds: small, JS-only groups only
runtimeVersion `"1.0.0"` is one static label shared across builds whose NATIVE code differs. OTA carries only JS + assets. Ship small, self-contained JS/content changes verified compatible with the OLDEST reachable native layer; never bundle native changes (new SDK/module, new permission, plugin/`expo-build-properties`/`newArchEnabled` changes) into an OTA — those need a new App Store build. Get explicit owner approval before any publish.
