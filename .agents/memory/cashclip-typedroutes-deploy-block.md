---
name: CashClip typed-routes deploy block
description: Why a publish suddenly fails on cashclip router.push("/...") typecheck errors, and the durable fix.
---

# CashClip typed-routes typecheck blocks publish

Symptom: `pnpm run build` / deploy fails in `typecheck:deploy` with many
`Argument of type '"/route"' is not assignable to parameter of type 'RelativePathString | ExternalPathString | ...'`
errors across cashclip `app/**` (login, register, earn, index, profile, _layout, admin, +not-found, etc.). The routes all exist — code is fine.

**Root cause:** cashclip has `experiments.typedRoutes: true` (since the first commit). expo-router enforces route literals via the generated file `artifacts/cashclip/.expo/types/router.d.ts`. That file is **git-ignored** and, in this workspace, the expo dev server only ever writes the **empty stub** (a generic `href: RelativePathString | ExternalPathString` form that lists ZERO routes) — restarting expo / forcing web bundles does NOT populate it. With the empty stub included by tsconfig, every absolute `router.push("/x")` fails typecheck.

**Why it hits deploy specifically:** Replit deploys from the **workspace file snapshot**, not a clean git clone, so the git-ignored stub IS present at deploy time; `typecheck:deploy` is monorepo-wide so a cashclip typecheck failure fails the whole publish (api-server + absustain too).

**Durable fix (applied Jun 2026):** remove `".expo/types/**/*.ts"` from the `include` array in `artifacts/cashclip/tsconfig.json`. Verified: with the stub excluded, expo-router's own bundled types accept the route strings and cashclip typechecks with 0 errors. `pnpm run typecheck:deploy` → exit 0 across all 4 projects.

**Why:** typed-routes literal checking only ever worked when the dev server happened to populate the file; it never did reliably here, so the check provided no real value while intermittently breaking every publish. Trade-off accepted: lose compile-time spell-checking of internal route strings (all static internal screens, low risk). No runtime effect, no native build needed.

**How to apply:** if a future publish fails on these typed-route errors again, confirm `.expo/types/router.d.ts` is the 14-line stub and that the include line hasn't been re-added; do NOT try to "regenerate" the file (it won't populate) — keep the include excluding it.
