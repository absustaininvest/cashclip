---
name: ATT consent status string mismatch
description: expo-tracking-transparency returns "authorized" not "granted"; resolveATTGranted must accept both
---

## Rule
`expo-tracking-transparency`'s `getTrackingPermissionsAsync()` returns `"authorized"` (the raw iOS ATT string) when the user has allowed tracking — **not** the generic Expo PermissionStatus `"granted"`.

`resolveATTGranted()` in `lib/admob.ts` must check `status === "authorized" || status === "granted"` to be safe across package versions.

**Why:** The gate in `TrackingConsentGate.tsx` uses `"authorized"` correctly. The old `resolveATTGranted` only checked `"granted"` — always returned `false` on iOS — so LevelPlay would receive `consented = false` even for users who explicitly allowed tracking. Silent revenue loss on any build with LevelPlay compiled in (≥41).

**How to apply:** Any time `expo-tracking-transparency` status is compared to a permission string, accept both `"authorized"` and `"granted"`. The fix is already in place; do not revert to checking only one string.

**Build impact:** Harmless on build 29 (LevelPlay native module absent, `requestAdsConsent` exits early). Critical for build 41+ where `LP_NATIVE_AVAILABLE = true`.
