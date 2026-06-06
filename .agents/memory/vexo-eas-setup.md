---
name: Vexo analytics EAS setup
description: How vexo-analytics is wired into the CashClip Expo app, and the non-obvious peer-dep + EAS-env-var gotchas.
---

# Vexo Analytics (CashClip, build 39+ / runtime 1.1.0)

`vexo-analytics` ships native iOS/Android code but **no Expo config plugin** — it
autolinks during prebuild, so do NOT add it to `app.json` plugins. Init at
**module scope** in `app/_layout.tsx` (so it patches expo-router before the router
renders), guarded by API-key presence **and** `!__DEV__`, wrapped in try/catch —
same fail-open shape as Sentry/LogRocket. It must NEVER gate the splash.

## Gotcha 1 — Metro-resolved peer deps must be direct deps
Vexo hard-requires `@react-navigation/native`. Even though Vexo wraps
`require("@react-navigation/native")` in try/catch (runtime-safe), **Metro
resolves require() calls statically at build time**, so a missing/unlinked peer
breaks the bundle and the EAS build — not just a runtime no-op.

**Fix:** add the peer as a *direct* dependency of `artifacts/cashclip`, pinned to
the **same version the app already uses** (it tracks expo-router's
`@react-navigation/native`, currently 7.x). Verify only **one copy** exists in the
pnpm store (two copies of react-navigation breaks navigation) and that it resolves
from Vexo's actual `.pnpm` dir.

**Why:** pnpm doesn't hoist a transitive-only peer to where Metro/another package
can find it; and a try/catch around `require` does not save you from Metro's static
resolution.

**How to apply:** any future Expo native lib with a peer dep on something only
present transitively → add that peer as a direct, version-matched dep before
building.

## Gotcha 2 — EXPO_PUBLIC_* keys need an EAS env var
Replit workspace secrets do NOT reach EAS cloud builds. The client key
(`EXPO_PUBLIC_VEXO_API_KEY`) must be created as an EAS **production** env var on the
build's project (Project A = `@absustainabilityinvestments/cashclip`), or the
built app sees `undefined` and analytics silently no-ops.

## pnpm install note
Local installs use `--ignore-scripts` (root prepare hook trips the git-guard,
exit 254). EAS cloud build runs scripts normally, so native autolink still happens
there.
