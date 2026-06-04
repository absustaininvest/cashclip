---
name: CashClip publish fails when test files live under app/
description: Why a Replit publish build can fail at the Metro/Expo step, and the durable fix
---

Replit "Publish" runs the whole monorepo build; the CashClip step bundles the Expo app with Metro. expo-router's `require.context` globs EVERY file under `artifacts/cashclip/app/`, so any `*.test.tsx`/`*.spec.tsx` placed there gets pulled into the production bundle. Those tests import `vitest` → `vite`, whose `module-runner.js` has a dynamic `import(filepath)` Metro can't parse → "iOS Bundling failed … SyntaxError: Invalid call … import(filepath)" → publish aborts at ~92%.

**Fix (durable):** `artifacts/cashclip/metro.config.js` `resolver.blockList` includes `/\.(test|spec)\.[jt]sx?$/` so test files can never enter any bundle.

**Why:** background task agents kept dropping check-in/milestone tests next to the screens inside `app/(tabs)/`. The blockList fix is location-proof; don't rely on remembering to keep tests out of `app/`.

**How to apply / verify:** reproduce or confirm with `cd artifacts/cashclip && npx expo export --platform ios --output-dir /tmp/x` — must exit 0 and emit the `.hbc` bundle. This is a build-time packaging issue only: it does NOT require a new App Store/native build; the live iOS build is unaffected.
