---
name: Deploy build typechecks the whole monorepo
description: Why a TS error in the CashClip mobile app can block the API-server publish, and how to avoid publishing mid-edit.
---

The production deploy `build` script runs `typecheck:deploy`, which typechecks the
**entire monorepo** (`tsc --build` of libs + every `artifacts/**` project) before
building the API server. A TypeScript error in `artifacts/cashclip` (the Expo mobile
app, normally shipped via OTA and otherwise unrelated to the deployed API) will fail
the whole publish.

**Why:** the deploy is the API server, but the build gate is monorepo-wide, so the
mobile app's type health is coupled to the API's ability to publish.

**How to apply:**
- Never trigger Publish while a multi-file edit is in flight — a mid-edit snapshot
  (e.g. an import removed but a usage still referencing the removed name → TS2304
  "Cannot find name") gets captured and fails the build.
- Before telling the user to re-publish, run the real gate locally: `pnpm run build`
  from the repo root (not just a single-project typecheck). It runs the same
  `typecheck:deploy` the deployer uses.
- `noUnusedLocals` is `false` (tsconfig.base.json), so leftover unused imports do
  NOT error — but a removed-then-still-referenced name DOES error. That asymmetry is
  the usual cause of "it failed to publish but builds for me" when the working tree
  was fixed after the publish snapshot.
- To diagnose a failed publish, pull the build log via the deployment skill
  (`listDeploymentBuilds` → `getDeploymentBuild`); the failure is at the end of the log.
