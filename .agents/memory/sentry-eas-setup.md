---
name: Sentry EAS build setup (CashClip)
description: How Sentry crash reporting + source maps are wired into CashClip EAS builds — org/project slugs, token scope, required EAS env vars, build-safety guard.
---

- Sentry org slug: `ab-sustainability-investments`; project slug: **`cash-clip`** (with hyphen — plain `cashclip` was already taken by someone else). This is the **React Native** app project; the Unity "Set Up Metrics" docs (C#) do NOT apply to CashClip.
- **Replit Secrets do NOT reach EAS cloud builds.** Sentry creds must live as **EAS environment variables** on the cashclip project (Project A), environment `production`:
  - `EXPO_PUBLIC_SENTRY_DSN` (crash capture; sensitive) — this alone is enough for crash reporting.
  - `SENTRY_AUTH_TOKEN` (source-map upload; sensitive), `SENTRY_ORG` + `SENTRY_PROJECT` (plaintext) — only needed for readable stack traces.
- The production **build profile in eas.json MUST set `"environment": "production"`** or those EAS env vars are never injected. It's additive to the profile's inline `env`; inline keys win on a name collision.
- The upload token (`SENTRY_TOKEN` in Replit → copied into EAS `SENTRY_AUTH_TOKEN`) is **upload-scoped only**: it returns 403 on every Sentry read/list endpoint, so you cannot auto-resolve the project slug with it — read the slug from the dashboard URL instead.
- `SENTRY_ALLOW_FAILURE=true` is set so a failed source-map upload **cannot fail the EAS build** (honors the "never break the build" rule). The `@sentry/react-native` build scripts check this var and exit 0 on upload error.

**Why:** owner's #1 rule is never break the live build / ship path. Crash capture must work even if the token/slug are wrong; source-map upload is best-effort.

**How to apply:** the Sentry plugin + native module are build-time/native — they ride a NEW native build (39, runtime 1.1.0) and can NOT reach the live OTA build 29 (runtime 1.0.0). App launch fails open: `Sentry.init` is DSN-guarded + try/catch in `app/_layout.tsx`; default export is `Sentry.wrap(RootLayout)`.
