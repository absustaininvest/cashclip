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
| `EXPO_PUBLIC_SENTRY_DSN` | Sentry **DSN** — the client key that actually lets the app *send* crash/error reports. Client-exposed by design (lives in the app), so EXPO_PUBLIC so Expo inlines it into the build. Found in Sentry → Settings → Projects → CashClip → Client Keys (DSN). |
| `EXPO_PUBLIC_VEXO_API_KEY` | Vexo Analytics client API key (Vexo app "Cash-Clip", repo `absustaininvest/cashclip`). Client-exposed by design; EXPO_PUBLIC so Expo inlines it into the build. From the Vexo dashboard → App Settings → API KEY. |
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
- **Build number**: iOS buildNumber 47, Android versionCode 44, version 1.1.0 (runtimeVersion 1.0.0)
- **Ad mediation**: Google AdMob is the rewarded-video mediation ORCHESTRATOR (`react-native-google-mobile-ads`). Unity, ironSource, Pangle, and Chartboost are retained as DEMAND SOURCES, each wired as an AdMob mediation adapter (Android Gradle dep via `plugins/withAndroid*Adapter.js`, iOS pod via `app.json` `extraPods`) — NOT via LevelPlay. The `ironsource-mediation` (LevelPlay) RN SDK was removed Jun 16 2026. Rewarded rewards credit server-side only (AdMob SSV `GET /api/admob/ssv` + begin/complete fallback sharing the `rewarded_ad` cap).
- **Bundle ID**: `app.replit.cashclip`
- **EAS Build**: `scripts/eas-build-ios.sh` — reads `EXPO_TOKLAST` secret
- **Expo account**: username `absustainabilityinvestments`, login email `support@absustainabilityinvestments.com`. If EAS builds fail auth, regenerate a token from expo.dev while logged in with that email and update `EXPO_TOKLAST`

#### Build durability — the recurring build failure, root-caused & fixed (Jun 16 2026)

The "CashClip build keeps failing" symptom was actually **two independent pnpm ⇄ React-Native bugs at once**, both from pnpm's strict/isolated `node_modules` layout conflicting with tools that assume a flat tree. Re-pinning hashes only fixed it until the next dependency bump — these fixes are permanent:

1. **iOS `Install pods` phase fails after every `expo` patch bump.** Never hardcode a `node_modules/.pnpm/<pkg>@<ver>_<peerhash>/…` path anywhere (app.json extraPods, Podfile, scripts). pnpm bakes the resolved peer version into that virtual-store folder name, so e.g. `expo` 54.0.34→54.0.35 renames the folder and CocoaPods can't find the podspec. The `EXUpdatesInterface` extraPod now lives **only in `app.config.js`**, where its path is resolved dynamically (`require.resolve` → `path.relative` to the generated `ios/` dir). It is no longer in `app.json`. Add any future local-podspec extraPods the same way.
2. **Metro/deploy bundle: `Cannot find module '@babel/generator'`.** RN tooling (`react-native-worklets/plugin`, `babel-preset-expo`) does undeclared bare `require('@babel/*')`. Fixed by `publicHoistPattern: ["*eslint*","*prettier*","@babel/*"]` in `pnpm-workspace.yaml` (hoists Babel to root `node_modules`). Do **not** use `nodeLinker: hoisted` — it relocates `@expo/metro-config` away from `expo` and breaks `expo/package.json` resolution.

Verify before any build: `node -e` eval of `app.config.js` (pod path uses the **current** expo hash and the dir exists) → local iOS Metro bundle returns HTTP 200 → root `pnpm run typecheck` passes (the deploy gate typechecks the whole monorepo). Note: a `pnpm install` running while a dev workflow is up corrupts the live Metro/Vite process (mid-install `patch-package_tmp_*` watch ENOENT + transient `@babel` errors) — **restart dev workflows after any reinstall**; those errors are concurrency artifacts, not the bug.

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
- Deliver app changes as small, frequent, self-contained over-the-air (OTA) update groups — never big bundled update packs. Native-level changes can't ride OTA and need a new App Store build.
- **Standing delivery policy (default, no re-litigating each time):** always deliver server-side changes to production FIRST, then process the OTA, in that order — "as we go," keeping the right order. Do not block or delay this standard server→OTA flow by citing past build-failure caution notes; the build-durability fixes are what keep builds succeeding, so treat them as solved, not as reasons to hesitate.
  - **OTA target:** runtime `1.0.0` / channel `production`, delivering the build-46 (1.0.0) codebase to the live build-29 (1.0.0) users. This is the standing target until a new successful native build replaces build 29 as the live baseline.
  - **Irreducible constraint (still true):** native-only changes cannot ride an OTA and still require a fresh EAS build — the "until another successful build is in place" clause covers exactly this.
- **This is a live product handling real money.** Always tell the whole truth in any environment. When querying data, always label which environment it comes from (dev or production). Never present dev data as if it answers a question about what the owner sees in the admin panel or the app. When both environments are relevant, show both — clearly labeled.

## Footnote (agent memory — context only)

- May 2026: Owner (Jorge Ballen) faced retaliatory App Store 1-star reviews on v1.0 after the platform blocked a $5,000 fraudulent withdrawal attempt and contained a few abusive accounts. We prepared a defense/compliance package: a firm-but-objective Apple "Report a Concern" note, four compliant public review replies, and an evidence summary. Exported as `exports/CashClip_AppStore_Defense_Record.pdf` for the owner's records; source screenshots purged from `attached_assets/` per his rule.
- Key truthful talking points: per-provider signed webhook verification (CPX, BitLabs, PayPal), server-side reward clamping (PROVIDER_REWARD_RANGES), sandboxed PayPal keys + 2FA + manual payout approval, in-app fraud controls (daily cap, 3-day new-account hold, 2 withdrawals/day, activity monitoring).
- May 29, 2026: Built the "Owner Factory Reset" admin recovery tool. Endpoint `POST /api/admin/users/:userId/factory-reset` (gated by adminMiddleware + secretsPassphraseMiddleware) regenerates password, clears TOTP, bumps tokenVersion; surfaced as "Factory Reset" button in `/sc-portal`. `support@cash-clip.app` is the rescue admin (no 2FA).
- May 29, 2026: `support@cash-clip.app` added as a Zoho alias on `support@absustaininvest.com`. It is also a working admin login in the app DB.
- Jun 16 2026: Corrected build state (verified via Transporter screenshot + owner records) — the LIVE public App Store build is **build 29 (runtime 1.0.0, channel `production`)**; that is what real users run. Builds 40 / 42 / 46 are TestFlight/internal only ("Delivered … ready for internal testing"), NOT public — **no runtime-1.1.0 build is live** (1.1.0 only ever existed in TestFlight). The earlier note claiming "build 40 (runtime 1.1.0) is live" was wrong. Build 46 (runtime 1.0.0, v1.1.0) succeeded on EAS and is delivered to App Store Connect for internal testing. Per the standing delivery policy, OTAs to live users target runtime 1.0.0 / production channel and deliver the build-46 (1.0.0) codebase to live build-29 users — that is the standing target until a new successful native build replaces build 29. (Technical fact retained: build-46/HEAD carries native drift build 29 lacks — e.g. the AdMob mediation native swap — and native-only changes still can't ride an OTA, so they need a fresh EAS build; JS-only changes OTA normally.) ⚠️ ASC key DGVBV8VV95 was transiently exposed in git history during a build — revoke it in App Store Connect and generate a fresh Admin key before the next build. Android: promote existing Play Store build to Production when ready.
- Jun 16 2026: Swapped rewarded-video mediation orchestrator from LevelPlay (ironSource RN SDK) back to Google AdMob, keeping Unity/ironSource/Pangle/Chartboost as AdMob mediation adapters. Removed `ironsource-mediation` dep + `expo.extra.ironsourceAppKey`; restored AdMob app/ad-unit IDs and the `react-native-google-mobile-ads` plugin; added iOS adapter pods + the four `withAndroid*Adapter` Gradle plugins + `withChartboostPodSource`. Bumped app.json to buildNumber "47" / versionCode 44 (runtimeVersion still "1.0.0"). Native change — needs a fresh EAS build (not OTA). Server reward logic unchanged (verified).
