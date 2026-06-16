---
name: pnpm overrides effective location
description: Where dependency-override security pins actually take effect in this monorepo (package.json, NOT pnpm-workspace.yaml)
---

# pnpm overrides only work in package.json here

In this workspace, **`pnpm.overrides` in the root `package.json` is the ONLY effective
overrides location.** The `overrides:` block in `pnpm-workspace.yaml` is IGNORED.

**Why:** when both files define overrides, pnpm v10 honors the package.json `pnpm.overrides`
field and drops the pnpm-workspace.yaml `overrides:` map entirely. Proof observed Jun 2026:
the lockfile `overrides:` snapshot exactly matched package.json's list; the esbuild
per-platform excludes (`"esbuild>@esbuild/darwin-arm64": "-"` etc.) that live only in
pnpm-workspace.yaml never applied (`@esbuild/darwin-arm64@0.28.1` and 77 other platform
binaries were still in the lockfile). Catalog entries in pnpm-workspace.yaml DO work
(e.g. `vite` version) — only the `overrides:` map is dead.

**How to apply:** to pin/patch a transitive dependency for security, add it to
`package.json` → `pnpm.overrides`, then `pnpm install --ignore-scripts`. Editing the
pnpm-workspace.yaml `overrides:` block alone does nothing. The repo keeps a large (stale)
overrides block in pnpm-workspace.yaml for documentation, but it is not authoritative.

## ws needs per-major scoped overrides
`ws` resolves at 3 majors simultaneously: @8 (@expo/cli), @7 (metro), @6
(@react-native/dev-middleware). A single global `ws:` override would force metro/dev-middleware
across a major boundary (risk of breaking Expo dev/Metro). Use scoped keys instead:
`"ws@6": "~6.2.4"`, `"ws@7": "~7.5.11"`, `"ws@8": ">=8.21.0"` — each stays in-major while
clearing the advisory.

## install-vs-watcher race
Running `pnpm install` while the `artifacts/cashclip: expo` workflow is live makes Metro's
file watcher crash with `ENOENT … watch '…expo-blur_tmp_NNNN_N/android'` (a pnpm temp
extraction dir removed mid-watch). It's a transient race, not a dep break — just restart
the expo workflow after install completes.
