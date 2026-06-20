# OTA Package Instructions — CashClip

## What an OTA Is (and Is Not)

An OTA (Over-The-Air) update pushes new JavaScript to users who already have
the native build installed. It does NOT touch native code (Gradle, CocoaPods,
Info.plist, app.json permissions, new native packages). Native-only changes
require a full EAS build.

---

## Two Worlds — Know Which One You Are In

```
DEVELOPMENT WORLD                   PRODUCTION WORLD
─────────────────                   ────────────────
Dev build (workflow)                Production build (.ipa / .aab)
Dev backend + Dev DB                Prod backend + Prod DB

        ↓ you build & DEPLOY (the pipe) ──────────────→ hosted at public URL
                ↓
        OTA update pushes new JS
                ↓
        FRONTEND / USER
```

**Rule:** before any OTA, confirm every change is JS-only and belongs in the
production world. Never push dev-world assumptions into the live bundle.

---

## Pre-Flight Checklist (must all pass before running)

| # | Check | Command / Verification |
|---|-------|----------------------|
| 1 | **Typecheck clean** | `pnpm run typecheck` at monorepo root — zero errors |
| 2 | **No native-only changes in bundle** | Review diff — no app.json permission changes, no new native packages, no Info.plist edits |
| 3 | **Production API healthy** | `curl -s -o /dev/null -w "%{http_code}" https://api.cash-clip.app/api/health` → must return `200` |
| 4 | **EXPO_TOKLAST valid** | Secret must be set and not expired (expo.dev → Account → Access Tokens) |
| 5 | **Runtime version correct** | `app.json` → `expo.runtimeVersion` must be `"1.0.0"` (live build-29 baseline) |
| 6 | **Channel is `production`** | Verify the command uses `--channel production` — never `staging` or `development` |
| 7 | **No test files in bundle** | No `*.test.tsx` or `*.test.ts` inside `app/` or `components/` |
| 8 | **EXPO_PUBLIC vars confirmed** | `EXPO_PUBLIC_ENV=production`, `EXPO_PUBLIC_DOMAIN=cash-clip.app` |

---

## Required Fields — Every OTA Command

| Field | Value | Notes |
|-------|-------|-------|
| `--channel` | `production` | Targets live build-29 (runtime 1.0.0) users |
| `--platform` | `ios` \| `android` \| `all` | Run iOS first, then Android |
| `--message` | Short description of the change | Visible in EAS dashboard — be specific |
| `--non-interactive` | (flag, no value) | Required in CI/sandbox environments |
| `EXPO_TOKEN` | `$EXPO_TOKLAST` | Set by the publish script automatically |
| `EXPO_PUBLIC_ENV` | `production` | Metro inlines this at bundle time |
| `EXPO_PUBLIC_DOMAIN` | `cash-clip.app` | Must be the legal domain, never a Replit subdomain |

---

## The Publish Script

**File:** `apps/cashclip/scripts/eas-ota-publish.sh`

This is the authoritative OTA runner. It:
- Installs a fake-git PATH wrapper so EAS post-publish git writes don't get
  blocked by the sandbox
- Sets `EXPO_TOKEN` from `EXPO_TOKLAST`
- Sets all `EXPO_PUBLIC_*` vars for Metro inlining
- Serialises concurrent iOS + Android runs via a workspace flock
- Cleans `dist/` before each run
- Exits non-zero on any failure

**Run via workflow (not bare terminal)** — Metro bundling exceeds the 120s
bash timeout; background jobs get reaped by the sandbox. Use the managed
`OTA Update (iOS)` and `OTA Update (Android)` workflows.

---

## Key Files and Their Worlds

| File | World | Purpose |
|------|-------|---------|
| `apps/cashclip/eas.json` | Build pipeline | EAS build profiles + submit config. Do not mix dev/prod fields. |
| `apps/cashclip/eas.json.submit-bak` | Archive | Backup of submit config — not active, kept for reference only |
| `apps/cashclip/app.json` | Expo/EAS build world | `runtimeVersion`, permissions, plugins. Changes here require a native build — NOT OTA. |
| `apps/cashclip/app.config.js` | Expo/EAS build world | Dynamic config that extends app.json. Same native-build rule applies. |
| `apps/cashclip/scripts/eas-ota-publish.sh` | The pipe | OTA runner. Lives at the boundary between dev and production. |

---

## Current OTA Target

| Field | Value |
|-------|-------|
| Runtime version | `1.0.0` |
| Channel | `production` |
| Live baseline | Build 29 (build-29, installed by real users) |
| Delivering | Build-46 codebase (JS-only changes from HEAD) |
| Switchover condition | Stays `1.0.0` until a new native build with `1.1.0` goes live in the App Store / Play Store |

---

## What Cannot Ride an OTA

These changes require a full EAS build — they are native-only:

- Any change to `app.json` (permissions, plugins, `NSUserTrackingUsageDescription`, etc.)
- New native packages (anything requiring CocoaPods or Gradle)
- Changes to `app.config.js` that affect native output
- AdMob mediation adapter changes (Gradle / podspec level)
- Build number / version code bumps
- Signing / provisioning changes

---

## Security Rules

1. **No secrets in the JS bundle.** Only `EXPO_PUBLIC_*` vars are safe to
   inline — they are intentionally client-visible. Never inline API keys,
   webhook secrets, or JWT signing keys.
2. **Legal domains only.** `EXPO_PUBLIC_DOMAIN` must always be `cash-clip.app`
   — never a `*.replit.dev` or `*.replit.app` subdomain in production bundles.
3. **Verify prod API before OTA.** A broken backend + a fresh OTA that assumes
   it works = users see errors. Check health first.
4. **One platform at a time.** iOS first, confirm success, then Android. The
   flock in the script enforces this but discipline matters too.

---

## Post-OTA Verification

After the publish command exits 0:

1. Check EAS dashboard → Updates → confirm the new update appears under
   `production` channel with the correct runtime version.
2. Confirm `assetmap.json` was uploaded and bundle size is ~4–5 MB.
3. Wait ~5 min for rollout to propagate, then open the app on a real device
   and verify the change is live.
