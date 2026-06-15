# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Two products: CashClip (mobile rewards app) and AB Sustainability Investments (corporate website).

## Secrets — Actual Names in Use

| Secret Name | Purpose |
|-------------|---------|
| `EXPO_TOKLAST` | Expo/EAS authentication token (used by EAS build scripts as EXPO_TOKEN) |
| `JWT_ACCESS_SECRET` | JWT signing secret for access tokens (HS256) |
| `JWT_ACCESS_SECRET_PREV` | Previous access token secret for graceful rotation (optional) |
| `JWT_REFRESH_SECRET` | JWT signing secret for refresh tokens (30-day session renewal) |
| `JWT_EDDSA_KEY` | Ed25519 private key for EdDSA JWT signing (optional, falls back to HS256) |
| `ADMIN_TOKEN` | Admin console token — signs session cookies and gates operator routes |
| `SEED_PASSWORD_SUPPORT` | Seeds `support@absustaininvest.com` password on startup |
| `SEED_ADMIN_PASSWORD` | Seeds reserved admin accounts on API startup |
| `SECRETS_PASSPHRASE` | High-privilege gate for rotating integration keys via API |
| `DATABASE_URL` | PostgreSQL connection string |
| `ZOHO_SMTP_PASSWORD` | Zoho SMTP password for sending emails (OTPs, support) |
| `CPX_API_KEY` | CPX Research survey integration |
| `CPX_APP_ID` | CPX Research app ID |
| `CPX_WEBHOOK_SECRET` | CPX Research webhook validation |
| `BITLABS_API_KEY` | BitLabs survey integration |
| `BITLABS_WEBHOOK_SECRET` | BitLabs webhook validation |
| `TAPJOY_SDK_KEY` | Tapjoy offerwall — gates the provider, used as `X-Api-Key` for offers/verify |
| `TAPJOY_WEBHOOK_SECRET` | Tapjoy callback verification (MD5 verifier) |
| `TAPJOY_APP_ID` | Tapjoy app identifier — sent as `app_id` on Tapjoy offers/verify API calls |
| `TAPJOY_REPORTING_KEY` | Tapjoy Reporting API key — stored in config for pulling Tapjoy earnings reports |
| `UNITY_MONETIZATION_API_KEY` | Unity Monetization Stats API key (Unity → Setup → API Access → **Monetization Stats API Access**, NOT LevelPlay or the deprecated Applifier key). Used only to pull Unity earnings reports / verify the integration; does not affect live ad revenue. Sent as `Authorization: Token <key>` to `monetization.api.unity.com/stats/v1/operate`. Per Unity, any org member's key works for the whole org. |
| `UNITY_ORGANIZATION_ID` | Unity Organization core ID for the org that owns the Unity Game IDs ("AB Sustainability Investments"). Required alongside `UNITY_MONETIZATION_API_KEY`. Source: cloud.unity.com → Organization Settings → **Organization ID**. Confirmed `2475979924671` (Jun 2026) — same as the old hardcoded value, so the transfer did NOT change it; hardcode was still removed because Unity says this ID *can* change on a future transfer. |
| `LOOTABLY_API_KEY` | Lootably offerwall integration |
| `ADJOE_SDK_KEY` | Adjoe offerwall SDK key |
| `ADJOE_APP_ID` | Adjoe offerwall app ID |
| `APP_VISIT_PROOF_KEY` | Sponsored-visit app attestation key. Must be a 32-byte random hex string. Set as an EAS secret (not `EXPO_PUBLIC_APP_VISIT_PROOF_KEY` — it must NOT be EXPO_PUBLIC so it is not intentionally client-exposed). app.config.js reads this and embeds it in `extra.appVisitProofKey`; the app reads it via `Constants.expoConfig.extra.appVisitProofKey`. The server reads it from this env var to validate HMAC-SHA256 attestations at `/api/earn/sponsored/:id/visit`. Must match on both sides. |
| `SENTRY_TOKEN` | Sentry **build-time auth token** (uploads source maps during the EAS build so crash stack traces are readable). NOT the DSN. Owner added Jun 5 2026. Sentry org: `ab-sustainability-investments`. |
| `EXPO_PUBLIC_SENTRY_DSN` | Sentry **DSN** — the client key that actually lets the app *send* crash/error reports. Client-exposed by design (lives in the app), so EXPO_PUBLIC so Expo inlines it into build 39. Found in Sentry → Settings → Projects → CashClip → Client Keys (DSN). |
| `EXPO_PUBLIC_VEXO_API_KEY` | Vexo Analytics client API key (Vexo app "Cash-Clip", repo `absustaininvest/cashclip`). Client-exposed by design; EXPO_PUBLIC so Expo inlines it into build 39. From the Vexo dashboard → App Settings → API KEY. |
| `TIKTOK_APP_ID` | TikTok Marketing API app ID (advertiser-side, for advertising CashClip + measuring installs). Issued by TikTok only AFTER the app is approved (business verification gates approval). From business-api.tiktok.com → My Apps → CashClip. Used by the API server's TikTok OAuth (`/api/integrations/tiktok/*`). |
| `TIKTOK_APP_SECRET` | TikTok Marketing API app secret — pairs with `TIKTOK_APP_ID` for the OAuth token exchange. Sensitive. Registered redirect URI: `https://api.cash-clip.app/api/integrations/tiktok/callback`. Must be added to the **production** deployment secrets and the API re-published to work live. |
| `PAYPAL_CLIENT_ID` | PayPal Payouts API client ID — from developer.paypal.com → your app credentials. Required for user withdrawals. |
| `PAYPAL_SECRET` | PayPal Payouts API secret — pairs with `PAYPAL_CLIENT_ID`. Also accepted as `PAYPAL_CLIENT_SECRET`. Required for user withdrawals. |
| `PAYPAL_WEBHOOK_ID` | PayPal webhook ID — from developer.paypal.com → Webhooks. Register URL: `https://api.cash-clip.app/api/paypal/webhook`. Required for payout status callbacks. |
| `PAYPAL_MODE` | Set to `live` for production payouts; omit or set to `sandbox` for testing. All four PayPal secrets must be in the **production** deployment secrets and the API re-published before any payout can succeed. |

## Apps / Artifacts

| Artifact | Kind | Preview Path | Directory |
|----------|------|--------------|-----------|
| CashClip | Mobile (Expo) | `/` | `artifacts/cashclip/` |
| API Server | API (Express) | `/api` | `artifacts/api-server/` |
| AB Sustainability Investments | Web (React+Vite) | `/absustain/` | `artifacts/absustain/` |

## CashClip App

Mobile rewards app — users earn cash completing surveys, watching videos, playing games, completing offers, and referring friends. Withdrawals via PayPal.

### Frontend (artifacts/cashclip/)

- **Framework**: Expo (SDK 54) with expo-router
- **Auth**: JWT stored in AsyncStorage via custom `AuthContext`
- **Build number**: iOS 35, Android versionCode 2, version 1.1.0
- **Bundle ID**: `app.replit.cashclip`
- **EAS Build**: `scripts/eas-build-ios.sh` — reads `EXPO_TOKLAST` secret
- **Expo account**: username `absustainabilityinvestments`, login email `support@absustainabilityinvestments.com`. If EAS builds fail auth, regenerate a token from expo.dev while logged in with that email and update `EXPO_TOKLAST`

### Backend (artifacts/api-server/)

- **Framework**: Express 5 + TypeScript
- **Auth**: JWT via `JWT_ACCESS_SECRET` secret
- **Database**: PostgreSQL via Drizzle ORM (`@workspace/db`)
- **Production URL**: `https://cash-clip.replit.app` (Replit deployment)
- **Production API domain (baked into EAS builds)**: `api.cash-clip.app` — add as custom domain in Replit deployment panel, then set CNAME `api.cash-clip.app` → `cash-clip.replit.app` at DNS registrar
- **`REGISTRATION_PAUSED` (soft-launch gate)**: when this env var is truthy (`true`/`1`/`yes`/`on`), `POST /api/auth/register` returns `503` with `{ paused: true }` and a friendly "signups reopen soon" message. The `503`s on `/api/auth/register` seen in deployment logs are this intentional gate, **not a crash**. To reopen signups, set `REGISTRATION_PAUSED=false` (or remove it) on the **production** deployment — an owner-authorized production env change, then re-publish. Login and all other routes are unaffected while paused.
- **Restart/DB resilience**: the server handles `SIGTERM`/`SIGINT` with graceful shutdown (drains in-flight requests, closes the DB pool), so routine platform restarts log as clean exits, not errors. The DB pool (`lib/db/src/index.ts`) has an idle-client error handler plus connection limits/timeouts (`DB_POOL_MAX`, default 10; 5s connect timeout) so a brief database blip self-heals instead of surfacing as a `503`.

## AB Sustainability Investments (artifacts/absustain/)

Corporate website, React + Vite. Pages: Home, Ventures, About, Investors, Team, Contact, Press Kit.

## Key Commands

- `pnpm run typecheck` — full typecheck
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

## User Preferences

- Keep it simple: CashClip + website only, no extra artifacts or background tasks.
- Don't recover deleted files or artifacts.
- All integrations must follow the same setup pattern as CPX Research: one secret per credential (API key, app ID, webhook secret each get their own named secret). No shared or bundled secrets across integrations.
- All domains must use registered legal domains (absustaininvest.com, cash-clip.app) — never Replit subdomains — in any production-facing configuration, links, or API references.
- Every fix requires explicit user approval before execution. No unsolicited changes.
- During integration/ad-network setup, give ONE step at a time and wait for confirmation — never a multi-step list at once. This is the highest-stakes part of the project (ad-revenue wiring); rushing it means money never flows.
- When entering credentials/secrets/tokens, capture and SAVE each one individually as its step completes — never open several secret boxes at once. Batching all boxes together caused values to get pasted into the wrong fields. One value → save → confirm → next.
- Deliver app changes as small, frequent, self-contained over-the-air (OTA) update groups that actually land on the live in-distribution build (29) — never big bundled update packs. Native-level changes can't ride OTA and need a new App Store build.
- **This is a live product handling real money.** Always query the production database first when looking up users, withdrawals, balances, or any operational data. Never present dev database results as if they are relevant to what the owner sees in the admin panel or the app. Dev data must be clearly labeled as dev-only and is almost never the answer the owner needs.

## Footnote (agent memory — context only)

- May 2026: Owner (Jorge Ballen) faced retaliatory App Store 1-star reviews on v1.0 after the platform blocked a $5,000 fraudulent withdrawal attempt and contained a few abusive accounts. We prepared a defense/compliance package: a firm-but-objective Apple "Report a Concern" note, four compliant public review replies, and an evidence summary. Exported as `exports/CashClip_AppStore_Defense_Record.pdf` for the owner's records; source screenshots purged from `attached_assets/` per his rule.
- Key truthful talking points: per-provider signed webhook verification (CPX, BitLabs, PayPal), server-side reward clamping (PROVIDER_REWARD_RANGES), sandboxed PayPal keys + 2FA + manual payout approval, in-app fraud controls (daily cap, 3-day new-account hold, 2 withdrawals/day, activity monitoring). The old "email optional but required for recovery" red disclosure existed in a pre-transfer codebase that was wiped — NOT in current git history; treat as owner-attested, not code-proven.
- Release status: iOS build 38 (v1.1.0) submitted to Apple, "Waiting for Review". A matching Play Store (Android) version of v1.1.0 was also produced (originally built in the previous project / prior agent session). So both App Store and Google Play have the v1.1.0 release lined up.
- Google Play specifics (as of May 27, 2026): build 38 (1.1.0) is in the "Internal testing" track, full rollout to internal testers only (not yet Production/public). App bundle 38 = Active; older bundle 1 = Inactive. Next step to go public on Android = promote build 38 from Internal testing → Production.
- Version lineage (owner-attested): Android versionCode 38 originated during the iOS 37 build cycle. The new version sent to Apple is iOS buildNumber 38; Android was NOT bumped to 39 — it stayed 38. Current `app.json`: iOS buildNumber 38, Android versionCode 38, version 1.1.0, runtimeVersion 1.0.0.
- Why Android 38 is effectively current ("right in the middle"): the native Android build came out of the SAME batch as the iOS 38 submission (built yesterday), AND the prior day's changes were shipped OTA. Because both platforms share runtimeVersion 1.0.0, those OTA updates land on Android 38 too. So Android 38 = native base + OTA layer = up to date. Caveat: OTA only covers JS/content, not native changes; the next time a NATIVE change is needed, bump Android to ≥39 (Play never allows reusing/lowering versionCode) and rebuild iOS.
- May 29, 2026: Built the "Owner Factory Reset" admin recovery tool to unlock the locked-out `jorge.ballen@cash-clip.app` admin (TOTP enabled in DB but authenticator deleted). New endpoint `POST /api/admin/users/:userId/factory-reset` (gated by adminMiddleware + secretsPassphraseMiddleware/`SECRETS_PASSPHRASE`) regenerates a strong password, clears TOTP, bumps tokenVersion; surfaced as a "Factory Reset" button in the absustain `/sc-portal` CashClip Users panel. Deployed to Replit production (NOT Apple). `support@cash-clip.app` is the brand-new rescue admin (no 2FA) used to run the reset.
- May 29, 2026 (DONE): `support@cash-clip.app` added as a Zoho alias on the `support@absustaininvest.com` mailbox, so it can send/receive. It is also a working admin login in the app DB. Registrar/DNS/email provider is Zoho.
- Jun 3, 2026: "Original (29)" known-good restore point saved at `snapshots/original-29/` (copy of normal app.json + `RESTORE.md`). It pins the stable build-29 OTA: good source group `26fa0d4c-44c7-49ca-9e7c-35a7cf835f86` (commit `9c71ec40`), republished live as `991eb089-dd3a-4a72-a049-949743e5b6ea` on branch `production` / runtime `1.0.0`. To roll back to the known-good state, follow `snapshots/original-29/RESTORE.md`. Root cause of the "consent keeps re-asking" issue documented in `.agents/memory/cashclip-consent-reprompt.md` (old embedded build-29 consent code re-appearing; fixed code is in the good group).
