---
name: CashClip OTA delivery — build 29 lives in a SEPARATE Expo project
description: How EAS Update OTAs map to CashClip builds, and the exact procedure to push an OTA onto the live App Store build (29).
---

# OTA delivery to CashClip builds — two projects, not one

**Hard fact (verified June 1, 2026 via Expo GraphQL build registry):** CashClip builds are split across TWO Expo projects, and our token's viewer has access to BOTH accounts.

- **Project A — `aac2a3d9-56b6-49ab-b254-9b80e98bab2f`** (account `absustainabilityinvestments`). Holds iOS builds **30–38**. This is what `app.json` normally points at (`owner`, `extra.eas.projectId`, `updates.url`). OTAs published normally land here → reach builds 30–38.
- **Project B — `10994af8-62e3-4a9d-9e35-7f4381965a31`** (slug `cashclip`, account `absustainabilityinvestmentsllc`). Holds the **live, App-Store-approved build 29** (v1.0.0(29), bundle id `app.replit.cashclip`, built under username expodeveloper20). Build 29's baked-in `updates.url` points HERE.

**Both projects use channel `production` → branch `production` (mapping logic "true") and runtimeVersion `1.0.0`.** That shared runtime label is why drift happened: after the May 15 2026 "Fix admin modals" update (the last OTA to reach build 29 on Project B), all subsequent OTAs went to Project A and only reached 30–38, leaving build 29 stuck on stale JS (the "tap home ad card → flash → bridge to Earn" behavior).

## Build 29 IS reachable by OTA, and its Home ad feed WORKS over OTA (verified live June 1, 2026)
**The earlier "native Home JS crashes build 29 / 25 ad cards need a new build" claim was WRONG — do not trust it.** It came from misreading the owner pasting ErrorBoundary/ErrorFallback *source files* as proof of a live crash, then rolling back the OTA without verifying on-device. Re-publishing the current Home JS to build 29 made the 25 ad cards PLAY rewarded ads — owner confirmed live, **NO new App Store build needed**.
**Why it works:** build 29's compiled binary already bundles `react-native-google-mobile-ads` (it's in `package.json` + `app.json` plugins). `lib/admob.ts` touches the native module only via guarded `require()` inside try/catch (the top-level is a `type`-only import), so even a version mismatch degrades gracefully (`isAdMobReady()` false → in-app reward fallback) instead of crashing. `handleAdPress` has the same guard + fallback.
**Meta-lesson: never treat owner-pasted source files as a live-crash report, and never roll back a live OTA without first verifying the actual on-device state.**
**Rollback procedure (only if ever genuinely needed):** `eas update:roll-back-to-embedded --branch production --runtime-version "1.0.0" --platform ios` on Project B (flag is hyphenated `--runtime-version`, REQUIRED in `--non-interactive`; publishes a directive so clients drop the OTA and use their embedded bundle). Superseded by simply publishing a newer OTA.

To publish an OTA onto build 29:
1. Temporarily edit `artifacts/cashclip/app.json`: `owner` → `absustainabilityinvestmentsllc`, `extra.eas.projectId` → `10994af8-...`, `updates.url` → `https://u.expo.dev/10994af8-...`. **Keep `runtimeVersion` "1.0.0".**
2. Publish: `cd artifacts/cashclip && EXPO_TOKEN="$EXPO_TOKLAST" EXPO_PUBLIC_ENV=production EXPO_PUBLIC_DOMAIN=cash-clip.app pnpm exec eas update --branch production --message "..." --non-interactive`.
   - `eas-cli` bundling takes ~2–4 min and exceeds the 120s bash limit → run it via a managed workflow (`configureWorkflow` outputType "console"), `tee` to a log file, poll, then `removeWorkflow`. Plain bash `eas` gets KILLED.
3. **REVERT `app.json`** back to Project A values (`absustainabilityinvestments` / `aac2a3d9-...`) so normal build/OTA flow is unchanged. Confirm `git diff` on app.json is empty.
4. Verify via GraphQL: newest update on Project B branch `production` runtime `1.0.0`.

**How to verify build membership / channel mapping:** `curl` `https://api.expo.dev/graphql` with `Authorization: Bearer $EXPO_TOKLAST` (code_execution sandbox has no env secrets — use bash+curl). Query `app.byId(appId).buildsPaginated` for `appBuildVersion`+`platform`, and `updateBranchByName(name:"production").updates` for the OTA history.

## For all builds: small, JS-only groups only
runtimeVersion `"1.0.0"` is one static label shared across builds whose NATIVE code differs. OTA carries only JS + assets. Ship small, self-contained JS/content changes verified compatible with the OLDEST reachable native layer; never bundle native changes (new SDK/module, new permission, plugin/`expo-build-properties`/`newArchEnabled` changes) into an OTA — those need a new App Store build. Get explicit owner approval before any publish.
