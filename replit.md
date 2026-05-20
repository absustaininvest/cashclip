# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Two products: CashClip (mobile rewards app) and AB Sustainability Investments (corporate website).

## Secrets — Actual Names in Use

| Secret Name | Purpose |
|-------------|---------|
| `EXPO_TOKLAST` | Expo/EAS authentication token (used by EAS build scripts as EXPO_TOKEN) |
| `JWT_TRIDENTE` | JWT signing secret for API auth (code reads this as JWT_SECRET via alias) |
| `SEED_ADMIN_PASSWORD` | Seeds reserved admin accounts on API startup |
| `DATABASE_URL` | PostgreSQL connection string |
| `CPX_API_KEY` | CPX Research survey integration |
| `CPX_APP_ID` | CPX Research app ID |
| `CPX_WEBHOOK_SECRET` | CPX Research webhook validation |
| `BITLABS_API_KEY` | BitLabs survey integration |
| `BITLABS_WEBHOOK_SECRET` | BitLabs webhook validation |

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

### Backend (artifacts/api-server/)

- **Framework**: Express 5 + TypeScript
- **Auth**: JWT via `JWT_TRIDENTE` secret
- **Database**: PostgreSQL via Drizzle ORM (`@workspace/db`)

## AB Sustainability Investments (artifacts/absustain/)

Corporate website, React + Vite. Pages: Home, Ventures, About, Investors, Team, Contact, Press Kit.

## Key Commands

- `pnpm run typecheck` — full typecheck
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

## User Preferences

- Keep it simple: CashClip + website only, no extra artifacts or background tasks.
- Don't recover deleted files or artifacts.
