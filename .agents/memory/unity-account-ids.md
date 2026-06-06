---
name: Unity Ads Monetization account identifiers
description: Durable Unity dashboard identifiers for the CashClip org (owner-confirmed from cloud.unity.com Organization Settings, Jun 5 2026)
---

# Unity Ads Monetization — account identifiers

Owner-confirmed from cloud.unity.com → Organization Settings (Jun 5, 2026). These are
dashboard identifiers, not secrets — safe to reuse so we don't re-ask the owner.

- **Organization name:** AB Sustainability Investments
- **Organization core ID:** `2475979924671` (this is `UNITY_ORGANIZATION_ID`; used in the
  Monetization Stats API path `/stats/v1/operate/organizations/2475979924671`)
- **Developer ID:** `121661720`
- **Developer website:** https://cash-clip.app
- **Contact entity:** AB Sustainability Investments LLC
- **Country of residence:** United States, Georgia
- **App-Ads URL Unity expects:** https://cash-clip.app/app-ads.txt — Unity reports it
  "up-to-date" (matches the cash-clip.app app-ads.txt served by cashclip serve.js).

**Where the Monetization Stats API key lives:** Unity left nav → **Setup → API management**
(NOT Organization Settings — that page only shows the IDs above). That token is
`UNITY_MONETIZATION_API_KEY`. Reporting/verification only — does NOT affect live ad revenue.

**Integration state (Jun 5, 2026):** Unity reporting is wired and verified end-to-end —
`UNITY_MONETIZATION_API_KEY` is a global secret, `UNITY_ORGANIZATION_ID` is a shared env var
(it's the public org core ID, not sensitive; do NOT also add it as a secret — that creates a
confusing duplicate, and viewEnvVars `type:"all"` double-reports a shared env var under
`secrets`). Both are global, but the LIVE deployment only picks them up on a **re-publish**
(see `prod-secrets-location.md`). Reporting works; revenue is still $0 until the native
adapter ships in a build ≥39 (`cashclip-mediation-adapters-native.md`).

**Live API behavior (verified Jun 5, 2026):** calling the Stats endpoint with the org ID but
no/invalid token returns HTTP `401` (`access token required` / `invalid access token`); a
well-formed org ID returns neither `400` (org omitted) nor `404` (org not found), so a valid
key is the only thing needed for a `200`. Even a `200` will show ~$0 until the Unity mediation
adapter ships in a live build ≥39 — see `cashclip-mediation-adapters-native.md`.

**Account-setup dates are a RED HERRING for the $0-Unity diagnosis** (owner repeatedly suspects
he "messed up" the Unity account): Unity ID created May 8 2026; owner's last account change
~May 15 2026; but live iOS build 29 was COMPILED May 14 2026 (submitted ~May 13) with NO Unity
adapter at all (proven from the build log — see `cashclip-mediation-adapters-native.md`). A
May-15 account tweak post-dates the build, and more fundamentally NO dashboard/account change on
ANY date can add native code to an already-compiled binary. So nothing the owner toggled caused
or can fix the $0; the only fix is a live build ≥39 that ships the adapter. Reassure him: not his fault.

**Unification note:** the Unity ID/account is under the owner's personal iCloud email, NOT the
company identity (support@absustaininvest.com / "AB Sustainability Investments"). Account-
Unification roadmap item #1 must align/migrate it so Unity, ironSource & Tapjoy share the one
company identity.

**Owner-stated login (Jun 6, 2026):** owner now says his cloud.unity.com login email is
**support@absustaininvest.com** (the company identity). This may mean the unification above is
already (partly) done — but CONFIRM before relying on it, since the prior note had the Unity ID
under his personal iCloud email; a login email and the underlying Unity ID owner can differ.

**Game IDs (observed from Placements page, Jun 6, 2026):** the CashClip Unity project has two
Game IDs — **6110340** and **6110341** (one iOS, one Android; platform mapping NOT yet confirmed,
confirm in AdMob setup). These should match the `UNITY_ADS_GAME_ID_IOS`/`UNITY_ADS_GAME_ID_ANDROID`
secrets. Game IDs are semi-public (embedded in the app binary), not sensitive auth.
**Placements state:** 0 active / 0 bidding, **8 archived** ad units — i.e. NO live Unity placement
exists right now, so an AdMob→Unity mediation group has nothing to point at until a placement is
un-archived or a new Rewarded ad unit is created. Also note: Unity Cloud **Project ID** (GUID
`849af6ee-a5ba-450d-92a2-dfb400796cb7`) is NOT used for ads — only Game ID + Placement ID are.
