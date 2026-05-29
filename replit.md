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
| `LOOTABLY_API_KEY` | Lootably offerwall integration |
| `ADJOE_SDK_KEY` | Adjoe offerwall SDK key |
| `ADJOE_APP_ID` | Adjoe offerwall app ID |
| `APP_VISIT_PROOF_KEY` | Sponsored-visit app attestation key. Must be a 32-byte random hex string. Set as an EAS secret (not `EXPO_PUBLIC_APP_VISIT_PROOF_KEY` — it must NOT be EXPO_PUBLIC so it is not intentionally client-exposed). app.config.js reads this and embeds it in `extra.appVisitProofKey`; the app reads it via `Constants.expoConfig.extra.appVisitProofKey`. The server reads it from this env var to validate HMAC-SHA256 attestations at `/api/earn/sponsored/:id/visit`. Must match on both sides. |

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

## Footnote (agent memory — context only)

- May 2026: Owner (Jorge Ballen) faced retaliatory App Store 1-star reviews on v1.0 after the platform blocked a $5,000 fraudulent withdrawal attempt and contained a few abusive accounts. We prepared a defense/compliance package: a firm-but-objective Apple "Report a Concern" note, four compliant public review replies, and an evidence summary. Exported as `exports/CashClip_AppStore_Defense_Record.pdf` for the owner's records; source screenshots purged from `attached_assets/` per his rule.
- Key truthful talking points: per-provider signed webhook verification (CPX, BitLabs, PayPal), server-side reward clamping (PROVIDER_REWARD_RANGES), sandboxed PayPal keys + 2FA + manual payout approval, in-app fraud controls (daily cap, 3-day new-account hold, 2 withdrawals/day, activity monitoring). The old "email optional but required for recovery" red disclosure existed in a pre-transfer codebase that was wiped — NOT in current git history; treat as owner-attested, not code-proven.
- Release status: iOS build 38 (v1.1.0) submitted to Apple, "Waiting for Review". A matching Play Store (Android) version of v1.1.0 was also produced (originally built in the previous project / prior agent session). So both App Store and Google Play have the v1.1.0 release lined up.
- Google Play specifics (as of May 27, 2026): build 38 (1.1.0) is in the "Internal testing" track, full rollout to internal testers only (not yet Production/public). App bundle 38 = Active; older bundle 1 = Inactive. Next step to go public on Android = promote build 38 from Internal testing → Production.
