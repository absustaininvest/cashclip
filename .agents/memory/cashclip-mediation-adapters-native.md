---
name: CashClip mediation adapters are native (Unity/ironSource/Pangle)
description: Why Unity/ironSource show $0 despite "Active partnership" in AdMob and "Connected" in the hub — adapters must live in the in-users'-hands native build.
---

Unity Ads / ironSource / Pangle earn ONLY when their AdMob mediation adapters are compiled into a native build that is actually live in users' hands. Three "green" signals do NOT mean money is flowing:

- Hub "Connected"/health for ad networks = credential merely PRESENT in env. `integrationHealth.ts` has no health URL for admob/unity/ironsource, so it auto-reports `reachable=true`. Not a key-validity check, not a revenue check.
- AdMob console "Active partnership" with Unity = AdMob is *allowed* to request bids from Unity; it does not put the adapter on users' phones.
- `app.json` containing `GoogleMobileAdsMediationUnity` / `withAndroidUnityAdapter` = config for the NEXT build, not necessarily the live one.

Decisive real-world tell: the Unity dashboard **DAU**. Unity counts a DAU when its SDK initializes on a device. 0 DAU (with 0 revenue / "no chart data") = Unity SDK is running on ~0 live phones = the live build has no working Unity adapter calling out.

Live surface (Jun 2026): iOS App Store build 29 (v1.0) is the only public build; Android is NOT public on the Play Store yet (internal testing only). The iOS build that carries the adapters (38) was rejected and is not live. So no live user has Unity → 0 DAU → $0.

**Why:** mediation adapters are native; OTA (JS-only) cannot add them.
**How to apply:** when Unity/ironSource/Pangle show $0, do NOT trust hub "Connected", AdMob "Active partnership", or the current `app.json` — confirm the adapter is in the LIVE build. The gate to the first-ever bid is a new approved native iOS build (and eventually a public Android release) that actually ships these adapters to users.

**Definitive proof of what's in a live build (the binary, not config):** read that build's EAS native build log and grep the pod/gradle install list. EAS GraphQL `builds.byId(buildId).logFiles` returns short-lived signed URLs to the raw build logs (curl them, no token in URL). The iOS `INSTALL_PODS` phase prints every pod ("Installing <Pod> (<ver>)" + "Pod installation complete! ... N total pods"). This is git-independent, so it works even when the build came from a prior/separate repo whose commits aren't local.
**app-ads.txt is NOT the missing piece (Jun 6 2026):** live `cash-clip.app/app-ads.txt` (served by cashclip `server/serve.js`, embedded list) already authorizes Unity — `unity.com, 121661720, DIRECT, 96cabb5fbdde37a7`. So when Unity shows $0, do not chase app-ads.txt; the gaps are the in-binary adapter (build ≥39) + the AdMob↔Unity mediation group in the AdMob dashboard.

**Proven Jun 6 2026 for LIVE iOS build 29** (Project B `@absustainabilityinvestmentsllc/cashclip`, finished build-29 jobs May 14 2026, e.g. buildId `25046db9-637b-42ea-b0ac-bfced4e85b28`): 114 total pods incl. `Google-Mobile-Ads-SDK (13.1.0)` + `RNGoogleMobileAds (16.3.3)` — AdMob YES — but **ZERO** mediation adapters (no `GoogleMobileAdsMediationUnity`/`UnityAds`/ironSource/Pangle/AppLovin/Meta; only "unity" string in log = "Community CLI"). So build 29 physically cannot call Unity → 0 Unity data is the binary, not a dashboard mistake. Owner believed Unity was incorporated before May 14; the account/dashboard setup may predate it, but the adapter was never in the shipped binary.
