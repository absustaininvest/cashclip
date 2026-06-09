---
name: Deployment image 8 GiB limit — exclude heavy local-only dirs
description: Publishing fails at the last step with "image size is over the limit of 8 GiB" when grail backups / uploads bloat the repl; fix is a .replitignore, not a build/typecheck fix.
---

# Deployment "image size over 8 GiB" — what it is and the fix

A publish can **build successfully** ("Build complete!") and still fail at the very
last step with:

```
error: image size is over the limit of 8 GiB
```

This is NOT a typecheck/build error. The autoscale deploy pushes the whole repl
filesystem as the **"Repl (cache) layer"**, so large *local-only* directories that
the app never needs at build or runtime push the image over 8 GiB.

**Fix:** a root `.replitignore` excluding the heavy non-runtime dirs. The big
offenders in this repo were `exports/` (grail backups + exported zips, ~2.4 GB),
`.local/` (~1.4 GB agent state), `.git/` (~1.4 GB), `.cache/` (~1.1 GB), and
`attached_assets/` (~460 MB). Excluding those drops the image to ~1.5 GB.

**Why each is safe to exclude:**
- The production run command is the API server only
  (`node artifacts/api-server/dist/index.mjs`); it serves the **pre-built**
  `artifacts/api-server/dist/absustain-static`, so source `attached_assets/` is not
  read at runtime.
- `attached_assets/` is only a *build-time* vite alias (`@assets`) and absustain's
  source does not actually import from it — confirm with
  `rg "@assets|attached_assets" artifacts/absustain/src` before excluding.
- `exports/`, `snapshots/`, `.local/`, `.cache/`, `.git/`, `.config/` are local-only
  state / VCS / caches — needed for neither the deploy build nor runtime.

**Also fixes:** broken-symlink deploy warnings (`.git/worktrees/...chipley-build`,
`.config/pulse/repl-runtime`) disappear once `.git/` and `.config/` are ignored.

**How to apply:** if a publish dies on image size, don't chase the build logs —
measure top-level dir sizes (`du -sh --exclude=node_modules ./* ./.[!.]*`), confirm
nothing excluded is imported by the deploy-built apps, then add/extend
`.replitignore`. Re-publish; no code change needed.
