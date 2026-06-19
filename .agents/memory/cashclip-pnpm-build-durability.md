---
name: CashClip pnpm ⇄ React Native build durability
description: The two recurring CashClip build-failure root causes (pnpm strict layout vs RN/CocoaPods/Metro) and their permanent fixes — read before touching app.json extraPods, app.config.js, or pnpm-workspace.yaml hoisting.
---

The chronic "CashClip build keeps failing" was actually TWO independent bugs at once, both from pnpm's isolated/virtual-store layout conflicting with React-Native tooling that assumes a flat node_modules. Re-pinning hashes only "fixed" it until the next dependency bump.

## 1. iOS "Install pods" fails after every expo patch bump
**Rule:** never hardcode a `node_modules/.pnpm/<pkg>@<ver>_<peerhash>/...` path anywhere (app.json extraPods, Podfile, scripts). pnpm bakes the resolved peer version into that virtual-store folder name, so a static path silently dies the next time the peer (here `expo`) bumps.
**Why:** the `EXUpdatesInterface` extraPod path was pinned to `_expo@54.0.34`; expo went to 54.0.35, pnpm renamed the folder, CocoaPods couldn't find the podspec → "Install pods" phase errored on EAS. It had been "fixed" repeatedly by re-pinning the hash — a treadmill.
**How to apply:** resolve such paths dynamically in `app.config.js` (which spreads app.json). `require.resolve` the package from a context that can actually see it (expo-updates-interface is a *transitive* dep, so resolve it from the expo-updates dir, not the project root), then emit `path.relative(projectRoot/ios, pkg/ios)` because expo-build-properties interprets extraPods paths relative to the generated ios/Podfile. The full EXUpdatesInterface entry now lives ONLY in app.config.js, NOT app.json (so nothing that reads raw app.json sees a stale/pathless pod). EAS evaluates app.config.js on its own machine after install, so the hash always matches there.

## 2. Metro/deploy bundle: "Cannot find module '@babel/generator'"
**Rule:** RN build tooling (`react-native-worklets/plugin`, `babel-preset-expo`, Metro transformer) does undeclared bare `require('@babel/*')`. Keep `publicHoistPattern` in pnpm-workspace.yaml hoisting `@babel/*` (plus pnpm defaults `*eslint*`,`*prettier*`) to root node_modules.
**Why:** a security override pinning `@babel/core` split `@babel/generator` into two versions so pnpm stopped auto-hoisting it; the bare require became unresolvable → HTTP 500 bundle / failed deploy.
**How to apply:** do NOT use `nodeLinker: hoisted` (full flat) — it relocates `@expo/metro-config` to root while `expo` stays inside the workspace package, breaking `expo/package.json` resolution ("Cannot find module 'expo/package.json'"). publicHoistPattern is the minimal-blast-radius fix; root provides ONE @babel version, other consumers still resolve their own from .pnpm.

## 3. metro.config.js workspaceRoot must match the actual pnpm workspace root
**Rule:** `workspaceRoot` in `metro.config.js` must point to the directory that owns `node_modules/.pnpm/` (the pnpm virtual store). If cashclip is a member of the ROOT pnpm workspace (`/home/runner/workspace`), `workspaceRoot` must be `path.resolve(projectRoot, "../../../..")` (4 levels up), NOT `"../.."`(`@expo/artifacts`).
**Why:** pnpm symlinks inside `cashclip/node_modules/` point 5 levels up (`../../../../../`) to the root workspace store when cashclip is a root workspace member. When Metro follows those symlinks and computes entry-point relative paths, it uses the pnpm workspace root as the "from" base — so `workspaceRoot` must also be that same root or Metro fails with "Unable to resolve module … from /home/runner/workspace/."
**How to apply:** if the cashclip pnpm virtual store disappears (symptom: `eas update` fails at Metro bundler with "Cannot find module" for react-native/metro/expo-router), add `@expo/artifacts/absustain/cashclip` to root `pnpm-workspace.yaml` packages list, run `pnpm install --ignore-scripts`, then update `metro.config.js` `workspaceRoot` to `"../../../.."`. Also update the `REACT_PATH`/`REACT_DOM_PATH` singleton pins — they now come from the root store (same path, since `workspaceRoot` moved there).

## Verify before any build
- `node -e` eval of app.config.js → EXUpdatesInterface path uses the CURRENT expo hash and the dir exists.
- local iOS Metro bundle returns HTTP 200.
- root `pnpm run typecheck` passes (deploy gate is monorepo-wide; a TS error in cashclip fails the API publish too).
- A `pnpm install` running while a dev workflow is up corrupts the live Metro/Vite process (mid-install `patch-package_tmp_*` watch ENOENT + transient @babel errors). Restart dev workflows AFTER any reinstall; those are concurrency artifacts, not the bug.
