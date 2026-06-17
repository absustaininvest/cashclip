---
name: AdMob SDK must match the RN major (GMA 16.x for RN 0.81)
description: react-native-google-mobile-ads version must track the React Native major, or the Android Kotlin compile fails on EAS.
---

# react-native-google-mobile-ads ⇄ React Native version coupling

**Rule:** `react-native-google-mobile-ads` (GMA) must be on the major that
supports the project's React Native version. On **RN 0.81 / Expo SDK 54**, GMA
**14.x fails to compile on Android** and you need **16.x** (16.3.3 is the
known-good pin used; 16.3.4 existed but was blocked by pnpm's `minimumReleaseAge`
24h supply-chain guard, so it was pinned to exact 16.3.3, same major).

**Symptom (the trap):** Android EAS build dies at `compileReleaseKotlin FAILED`
with `Unresolved reference 'currentActivity'` and `Unresolved reference
'runOnUiThread'` inside the GMA Kotlin module. This is NOT a Chartboost / adapter
/ credentials problem — adapters resolve cleanly (zero "Could not find"). It is
purely GMA being too OLD for the RN version. Downgrading GMA makes it worse;
the fix direction is UP.

**Why:** newer RN removed/changed the bridge APIs the old GMA Kotlin referenced.
GMA's `peerDependencies` only declares `expo>=47` (no RN bound), so npm/pnpm give
you no warning — you must match majors yourself.

**How to apply:**
- When bumping Expo/RN, bump GMA to the matching major in the same change.
- Mediation adapter Gradle deps (unity/ironsource/pangle/chartboost) and iOS pods
  did NOT need changing for the 14→16 jump; they resolved fine. Only revisit them
  if a build shows "Could not find com.google.ads.mediation:...".
- App JS usage (RewardedAd, InterstitialAd, BannerAd/BannerAdSize, AdsConsent,
  mobileAds, TestIds, *EventType — mostly lazy `require()`) survived 14→16 with no
  code changes; verify with monorepo typecheck.
- Chartboost App ID/signature are AdMob/Helium **dashboard runtime** values, never
  build inputs. A green build proves compile only — ad SERVING still needs
  on-device test + AdMob "Requires review" clearing.
