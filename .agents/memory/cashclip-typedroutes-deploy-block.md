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

**First attempt (REVERTABLE — don't rely on it):** removing `".expo/types/**/*.ts"` from the `include` array works *until* the running `cashclip: expo` dev server restarts — on `expo start` Expo **rewrites tsconfig.json and re-adds** that include line (it logs "The tsconfig.json#include property has been updated"). So the errors silently came back and a later publish would fail again.

**Durable fix (applied Jun 16 2026):** ADD `".expo/types/**/*.ts"` to the **`exclude`** array in `artifacts/cashclip/tsconfig.json` (leave it in `include` too — Expo will keep re-adding it there). In TypeScript **`exclude` wins over `include`**, so even after Expo re-adds the include line, tsc skips the empty stub. Verified with the expo dev server still running: `pnpm run typecheck:deploy` → exit 0 across all 4 projects.

**Why:** typed-routes literal checking only ever worked when the dev server happened to populate the file; it never did reliably here, so the check provided no real value while intermittently breaking every publish. Trade-off accepted: lose compile-time spell-checking of internal route strings (all static internal screens, low risk). No runtime effect, no native build needed.

**How to apply:** if a future publish fails on these typed-route errors again, confirm `.expo/types/router.d.ts` is the 14-line stub, then ensure `.expo/types/**/*.ts` is in the **`exclude`** array (not just absent from `include` — that gets reverted). Do NOT try to "regenerate" the file (it won't populate).
