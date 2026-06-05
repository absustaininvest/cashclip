---
name: Unity never invoked in production (diagnosis)
description: Unity lifetime ad-request data shows the app never really called Unity; how to tell a wiring gap from a dashboard misconfig.
---

Rule: If an AdMob *mediation adapter* (Unity/IronSource/Pangle) is earning ~$0, pull the network's OWN reporting and look at **ad-request count first**, before blaming dashboard settings.

- Near-zero ad requests = the app/build never actually called the network -> wiring gap (adapter not in the shipped native binary, and/or the network not added as an ad source in the AdMob mediation group). NOT a settings toggle.
- Many requests but zero fill/revenue = a real dashboard misconfig (wrong Game ID / placement / disabled).

**Why:** Owner spent months believing he "messed up the Unity config." Unity Operate API (Monetization Stats, `monetization.api.unity.com/stats/v1/operate/organizations/<orgId>`, fields `adrequest_count,available_sum,start_count,view_count,revenue_sum`, requires `start`+`end`+`scale=all`, header `Authorization: Token <key>`) showed lifetime: 2 ad requests total (both iOS; available=2 but start/view=0 -> SDK/test pings), **0 Android requests ever, $0 all-time**. That shape = the app never invoked Unity, not a broken setting.

**How to apply:** For CashClip Phase 2 (Android build 39) the two real fixes are (1) adapter compiled into the native build — already in app.json (`GoogleMobileAdsMediationUnity` + `./plugins/withAndroidUnityAdapter`), and (2) Unity added as an ad source in the AdMob console mediation group for the rewarded unit (apps.admob.com -> Mediation) with the correct Android Unity Game ID/placement. After 39 ships, confirm `adrequest_count` climbs on Android; do not re-blame dashboard settings.
