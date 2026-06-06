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
