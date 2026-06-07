---
name: AdMob reporting OAuth token connect/rotate
description: How to generate/rotate ADMOB_OAUTH_REFRESH_TOKEN so the admin AdMob Revenue hub pulls real Google numbers — and why "Bad Request"/invalid_grant happens.
---

# Connecting / rotating the AdMob reporting refresh token

The admin AdMob Revenue hub pulls REAL Google earnings using an OAuth2 refresh
token (`ADMOB_OAUTH_REFRESH_TOKEN`) + `ADMOB_OAUTH_CLIENT_ID`/`_SECRET` +
`ADMOB_PUBLISHER_ID`. Scope is `https://www.googleapis.com/auth/admob.readonly`.

## Generating a working refresh token (Google OAuth 2.0 Playground)
- In the Playground, open the gear ⚙️ → check **"Use your own OAuth credentials"**
  and enter the SAME Client ID/Secret the server uses (`ADMOB_OAUTH_CLIENT_ID` /
  `ADMOB_OAUTH_CLIENT_SECRET`). A token minted with the Playground's **default
  demo client** fails the server's refresh grant with `invalid_grant` /
  "Bad Request" — this is the #1 cause of the hub's "token refresh failed" error.
- Step 1 authorize the scope → Step 2 "Exchange authorization code for tokens" →
  copy the **Refresh token** (starts `1//`, ~103 chars). That is the value to save.

**Why a Playground "200" on `GET .../v1/accounts` does NOT prove success:** that
test only validates the short-lived *access* token + scope; it's client-agnostic.
The refresh token can still be tied to the wrong client. Always verify the full
chain server-side (refresh grant → access token → accounts call) before trusting.

## Saving gotcha
- Paste the token RAW — no surrounding quotes, no spaces. A value saved as
  `"1//..."` (with quote chars) also throws `invalid_grant`. Sanity-check prefix
  is `1//` and there is no `"`.

## Verifying without prod admin access
- The deployed admin endpoint can't be hit with the workspace `ADMIN_TOKEN`
  (prod's ADMIN_TOKEN differs → "Admin console-token rejected" / 401). To confirm
  production really works, do both: (1) hit the AdMob report API directly with the
  refresh token + client creds from the workspace shell, and (2) read deployment
  logs for `admob_report_alert ... stale_sync ... status=resolved` (sync landed).

## Operational behavior to expect
- The hub serves from a **DB snapshot** and kicks a background sync on page load.
  Right after a fresh token/publish the first view shows **"No AdMob data synced
  yet"** for ~1–2 min until that first sync lands — NOT a failure; refresh.
- Prod uses its own secret snapshot, so after updating the token you must
  **re-publish** the API for the live hub to use it (see prod-secrets-location.md).
- A `revenue_divergence` alert (official AdMob vs app's own ad_events estimate) is
  the reconciliation working as designed, not a token problem. The official Google
  number is the source of truth.
