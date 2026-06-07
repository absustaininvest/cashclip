---
name: Unity never invoked in production (diagnosis)
description: Unity lifetime ad-request data shows the app never really called Unity; how to tell a wiring gap from a dashboard misconfig.
---

Rule: If an AdMob *mediation adapter* (Unity/IronSource/Pangle) is earning ~$0, pull the network's OWN reporting and look at **ad-request count first**, before blaming dashboard settings.

- Near-zero ad requests = the app/build never actually called the network -> wiring gap (adapter not in the shipped native binary, and/or the network not added as an ad source in the AdMob mediation group). NOT a settings toggle.
- Many requests but zero fill/revenue = a real dashboard misconfig (wrong Game ID / placement / disabled).

**Why:** Owner spent months believing he "messed up the Unity config." Unity Operate API (Monetization Stats, `monetization.api.unity.com/stats/v1/operate/organizations/<orgId>`, fields `adrequest_count,available_sum,start_count,view_count,revenue_sum`, requires `start`+`end`+`scale=all`, header `Authorization: Token <key>`) showed lifetime: 2 ad requests total (both iOS; available=2 but start/view=0 -> SDK/test pings), **0 Android requests ever, $0 all-time**. That shape = the app never invoked Unity, not a broken setting.

**How to apply:** For CashClip Phase 2 (Android build 39) the two real fixes are (1) adapter compiled into the native build — already in app.json (`GoogleMobileAdsMediationUnity` + `./plugins/withAndroidUnityAdapter`), and (2) Unity added as an ad source in the AdMob console mediation group for the rewarded unit (apps.admob.com -> Mediation) with the correct Android Unity Game ID/placement. After 39 ships, confirm `adrequest_count` climbs on Android; do not re-blame dashboard settings.

**AdMob-side confirmation (Bidding report, all-time):** Unity IS wired as a bidding source (config is correct, not missing). Unity row: eligible 5,483, bid requests 275 (AdMob throttled it down from 5,483 because it wasn't delivering), bids-in-auction 2, winning bids 2, **impressions 0**, eCPM —. AdMob Network leg works fine ($68 / 2,616 impressions). Key heuristic: **a winning bid with 0 impressions = the ad was selected but never rendered on device = the on-device adapter isn't functioning in the live build** (not a dashboard error). Matches Unity's own Operate data (2 requests, 0 views). So the fix is a native build that actually renders Unity (build 39), NOT a config change.

## Unity Stats API — how to re-pull the proof (baseline Jun 6 2026)
- Endpoint: `GET https://monetization.api.unity.com/stats/v1/operate/organizations/<UNITY_ORGANIZATION_ID>?fields=adrequest_count,start_count,view_count,revenue_sum&scale=all&start=<ISO>&end=<ISO>` with header `Authorization: Token <UNITY_MONETIZATION_API_KEY>`. ISO 8601 no ms.
- Valid `fields` ONLY: `adrequest_count, available_sum, revenue_sum, start_count, view_count`. Max window is **P1Y (1 year)** or it 400s. `scale=all` returns one `timestamp:"all-time"` row.
- **BASELINE Jun 6 2026** (last 12mo = entire build-29 live life): `adrequest_count=2, start_count=0, view_count=0, revenue_sum=0`. 2 requests across a year = test pings only → the Unity SDK has never run on real users' phones. Hard proof the adapter was never in a LIVE build — NOT a key/dashboard problem.
- **Success test** after a Unity-carrying build goes LIVE + approved: `adrequest_count` should climb into the thousands with real DAU. This metric is the honest scoreboard for "did Unity actually turn on."

## CORRECTION (Jun 7 2026): build 29 DOES contain the Unity adapter
Evidence: `snapshots/original-29/app.json` (the saved build-29 config) includes `react-native-google-mobile-ads`, `GoogleMobileAdsMediationUnity`, and `./plugins/withAndroidUnityAdapter`. So the live build 29 was compiled WITH the Unity mediation adapter — earlier "adapter not in live build" claim was WRONG for Unity/29.
**Implication:** Unity CAN serve on the live build 29 with NO new build. The remaining trigger is the AdMob **mediation group** (dashboard): the ad unit must list Unity Ads as a source with the correct Game ID/placement, else AdMob never calls Unity → 0 requests → no callback.
**Proof to check:** Unity Reporting "Ad requests" >0 = AdMob is calling Unity; 0 = mediation-group mapping still missing. Do NOT push owner to build 39 for Unity — fix the AdMob dashboard mapping instead.

## Test mode is NOT the cause (owner-confirmed Jun 7 2026)
Unity test mode was OFF continuously from the May 8 approval until Jun 7 2026 ~07:14 EST, yet Unity served 0 the whole time. So test mode never caused the zero — the block is UPSTREAM. Evidence (Jun 7) shows Unity IS in the live AdMob rewarded mediation group as real-time bidding + "Active partnership", adapter com.google.ads.mediation:unity:4.13.0.0 is in build 29, but Unity gets 0 requests/0 impressions while AdMob Network fills ~100%.
**Leading suspect:** app-ads.txt authorization — live cash-clip.app/app-ads.txt has only ONE Unity line (`unity.com, 121661720, DIRECT, 96cabb5fbdde37a7`); if that publisher ID isn't the owner's Unity ID or AdMob needs more lines, Google never sends Unity a bid request. Bidding partnership (#4) can't function until app-ads.txt authorizes Unity. Also present: a DUPLICATE rewarded mediation group (one dead $0, one live $36.96).

## Owner-affirmed Jun 7 2026: build 29 is fully functional; Unity present all along; root cause = NO Unity placement
Build 29 (live App Store) is completely functional — AdMob serving + the Unity adapter have both been in it since launch. Unity's $0 is NOT the app or the build. Root cause is Unity-DASHBOARD-side: Unity reporting broken down by Ad Unit + Placement shows NO ad units / NO placements, so there is nothing for AdMob's bid requests to land on → 355 of 357 AdMob→Unity requests don't fill and the 2 that reached the project got 0 impressions. Compounded by near-zero live traffic (the only requests came from the owner's own test sessions on Jun 2–3 during the known-good republish). Fix is Unity-side: create the Rewarded placement for the iOS app + map the correct Game ID/Placement into the AdMob mediation source. NO new build needed. Never re-suspect build 29 or the app for Unity $0 again.
