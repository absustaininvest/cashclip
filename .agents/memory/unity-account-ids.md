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
