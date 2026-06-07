---
name: Unity mediation restructuring plan (CashClip)
description: The owner-defined 4-part plan to get Unity (and ironSource/Pangle) actually serving ads. Follow this order; do NOT re-litigate the build-29 caveat every time.
---

# Unity restructuring — owner's 4-part plan (Jun 2026)

The owner ("papi") drove this scope himself. When Unity comes up, EXECUTE this —
do not re-ask which part, and do not keep repeating the "needs a new build" point.
He already knows it. The 4 parts, in order:

1. **Game ID verification** — confirm Unity Game IDs are correct and verified in
   AdMob's mediation source config. Owner-attested IDs: **iOS `6110340`,
   Android `6110341`**; Unity org core ID `2475979924671`.
2. **Units remaking** — rebuild the AdMob ad units cleanly. App's current AdMob
   app id `ca-app-pub-8679658921848348~6212139107`; ad units live in
   `artifacts/cashclip/lib/admob.ts` (`AD_UNITS`: rewarded/interstitial/banner/
   native). If units are recreated in AdMob, the new IDs MUST be updated there.
3. **Placements** — Unity-side placements for each format (Rewarded, Interstitial,
   Banner). Note: Interstitial_iOS was NOT attached as of the last check.
4. **Mediation** — AdMob mediation groups: add Unity + ironSource + Pangle as ad
   sources to EACH ad unit (rewarded, interstitial, banner). "All of them are
   being changed" (owner). Parts 1–3 mostly happen in the Unity + AdMob dashboards
   (guide ONE step at a time, wait for confirmation each time).

## State that's already DONE (don't re-diagnose as missing)
- The native adapters ARE wired into the **build-39** config:
  iOS `extraPods` (`GoogleMobileAdsMediationUnity/IronSource/Pangle`) via
  expo-build-properties + custom Android plugins
  (`plugins/withAndroidUnityAdapter.js` etc., Unity adapter `4.13.0.0`).
- **app.json is set for the NEXT build**: buildNumber 39 / versionCode 39 /
  version 1.1.0 / runtimeVersion 1.1.0. LIVE App Store build is still **29**
  (runtime 1.0.0), which has NO adapters — so Unity revenue only starts once a
  build containing the adapters (39) is approved + live. This is known; state it
  ONCE if needed, then move on with the dashboard restructuring (it's valid prep
  that the new build needs anyway).

**Why this file exists:** the owner got frustrated that the plan kept getting
re-asked/re-explained instead of executed. Treat this as the source of truth for
the Unity effort and just drive the steps.
