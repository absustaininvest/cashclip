---
name: TikTok Marketing API integration
description: How CashClip's TikTok advertiser integration is wired — credentials, OAuth flow, callback, and the approval gate that blocks activation.
---

# TikTok Marketing API (advertiser side — CashClip user acquisition)

Built for the **advertiser** side (running/measuring CashClip ad campaigns), NOT
monetization. TikTok ad *revenue* for publishers flows through Pangle in AdMob
mediation — unrelated to this Marketing API app.

## Credentials (CPX pattern — one secret per credential)
- `TIKTOK_APP_ID`
- `TIKTOK_APP_SECRET`

**Why these don't exist yet:** TikTok only issues App ID + Secret *after* it
approves the app. A newly-created app sits at Verification Status = **Pending**
with App ID/Secret shown as "--". Nothing to save until approval lands. To speed
approval, the operator's TikTok developer/business account must itself be verified.

## OAuth flow (operator-initiated from /sc-portal)
- Authorize page: `business-api.tiktok.com/portal/auth?app_id&state&redirect_uri`
- Token exchange: `POST business-api.tiktok.com/open_api/v1.3/oauth2/access_token/`
  with JSON `{ app_id, secret, auth_code }`. Success = `code === 0`; returns a
  **long-lived** `data.access_token` + `data.advertiser_ids`.
- Callback receives **`auth_code`** (not `code`) + `state`.

## Registered redirect URI (must match EXACTLY)
`https://api.cash-clip.app/api/integrations/tiktok/callback` — legal domain, hits
the api-server. Changing the route path means re-registering it in the TikTok app.

## Persistence & state
- Access token / advertiser_ids / state stored in the `app_settings` key/value
  table via **direct DB** reads/writes (replica-safe; not the cached runtimeSettings).
- OAuth `state` is consumed **atomically** with `DELETE ... RETURNING` so it's
  truly one-time across the autoscaled fleet (read-then-delete was raceable).
- The access token is never returned in any JSON/redirect — callback only flips a
  `?tiktok=connected|denied|badstate|error` flag on the portal URL.

## Activation checklist when TikTok approves
1. Save `TIKTOK_APP_ID`, then `TIKTOK_APP_SECRET` (one box at a time, owner's rule).
2. Republish the API (prod reads secrets from Publishing, not the Secrets tab).
3. Operator hits `/api/integrations/tiktok/start` (admin) → opens the URL → authorizes.
