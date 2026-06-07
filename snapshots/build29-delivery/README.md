# Build-29 Delivery Copy — Honest-Money OTA

Clean, reproducible way to ship a **JS-only OTA to the LIVE App Store build 29**
(v1.0.0, runtime `1.0.0`) without breaking live users. Created so the build-29
delivery source is never "lost" again (the old `/home/runner/*-ota-build` trees
were wiped).

## What's in this folder
- `_layout.build29.tsx` — the **only** file that must differ from `main` (HEAD)
  when publishing to build 29. It is HEAD's `app/_layout.tsx` with the three
  build-39-only NATIVE telemetry modules removed (Sentry, Vexo, LogRocket;
  expo-updates import dropped with them). Everything else is identical to HEAD.

## Why only that one file
Verified against build-29 base commit `9c71ec4`:
- **0** shared dependencies changed version → HEAD's JS hits the exact same
  native API surface as build 29 for every shared module.
- The only native additions since build 29 are 7 deps; of those, only
  `@sentry/react-native`, `vexo-analytics`, `@logrocket/react-native` are
  imported in JS, and **all three are imported only in `app/_layout.tsx`**.
- `@react-native-firebase/*` and `expo-audio` are in package.json but never
  imported in JS → harmless over OTA. `@react-navigation/native` is pure JS.

So: HEAD JS + this stripped `_layout` = build-29-native-safe.
Typecheck verified PASS with this file swapped in.

## What this OTA delivers (honest-money, already on HEAD)
- One real server balance everywhere — the phone no longer mints fake $
  (`lib/storage.ts` `recordAdWatch` returns 0, keeps counts/streak/missions).
- Removed the doubled "pts pts" label and the fake "+$0.05" popups
  (`app/(tabs)/earn.tsx`, `components/RewardedAdModal.tsx`).
- Celebration overlay is visual-only (voice removed); spin-fix + home-taps stay.

## Expo projects
- **Project A (everyday pointer, in app.json normally):**
  `aac2a3d9-56b6-49ab-b254-9b80e98bab2f`, owner `absustainabilityinvestments`.
- **Project B (where build-29 OTAs actually live):**
  projectId `10994af8-62e3-4a9d-9e35-7f4381965a31`,
  owner `absustainabilityinvestmentsllc`.

## Publish procedure (in-place temp swap; reuses monorepo node_modules)
Run from `artifacts/cashclip/`.

1. Back up the two files you will touch:
   ```
   cp app.json /tmp/app.json.realbak
   cp app/_layout.tsx /tmp/_layout.head.bak
   ```
2. Swap in the build-29-safe layout:
   ```
   cp ../../snapshots/build29-delivery/_layout.build29.tsx app/_layout.tsx
   ```
3. In `app.json`, TEMPORARILY point at Project B + runtime 1.0.0:
   - `owner` → `absustainabilityinvestmentsllc`
   - `extra.eas.projectId` → `10994af8-62e3-4a9d-9e35-7f4381965a31`
   - `updates.url` → `https://u.expo.dev/10994af8-62e3-4a9d-9e35-7f4381965a31`
   - `runtimeVersion` → `1.0.0`
4. Publish (JS-only OTA to branch `production`):
   ```
   EAS_NO_VCS=1 EXPO_TOKEN="$EXPO_TOKLAST" \
   EXPO_PUBLIC_ENV=production EXPO_PUBLIC_DOMAIN=cash-clip.app \
   pnpm exec eas update --branch production \
     --message "Honest money: one real server balance; no fake +$ popups; visual-only celebration" \
     --non-interactive
   ```
5. REVERT both files so `main` stays the full build-39 tree:
   ```
   cp /tmp/app.json.realbak app.json
   cp /tmp/_layout.head.bak app/_layout.tsx
   ```
6. Verify the new group is top of the `production` branch, then confirm
   on-device (delete + reinstall build 29, open twice) before calling it done.

## Hard rules
- JS/content only — lands on the existing build 29 binary. Native changes need a
  new App Store build (≥39).
- Ship SMALL, self-contained groups. Never roll back a live OTA without
  verifying on-device first.
- `main` must always be reverted back to Project A after publishing.
