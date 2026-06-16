---
name: EAS upload .easignore must exclude heavy local dirs
description: Why EAS builds from this repl fail with "Unknown system error -122" during "Compressing project files" and how .easignore overrides .gitignore.
---

# EAS upload archive blows up when .easignore is in wrong location or missing entries

## CRITICAL: .easignore must live at the WORKSPACE ROOT

EAS for monorepos packs from the **monorepo root** (where `pnpm-workspace.yaml` lives), not from `artifacts/cashclip/`. The `.easignore` file must be at `/home/runner/workspace/.easignore` — NOT at `artifacts/cashclip/.easignore` (that file is ignored by EAS). Confirmed fix Jun 2026.

## Archive size / -122 error

When `.easignore` exists, EAS **ignores `.gitignore` entirely** and only honors `.easignore`. If `.easignore` does not explicitly exclude the heavy root-level local-only dirs, EAS packs them into the upload tarball (multiple GB) and the build dies during "Compressing project files" with `Unknown system error -122` (not a code/typecheck error, not a disk-space error — the FS had 240G+ free).

The heavy dirs that MUST be in root `.easignore`: `exports/` (~3G), `.local/` (~1.3G), `.cache/`, `.git/`, `attached_assets/`, `snapshots/`, `dist/`, `static-build/`, `.eas-tmp/`. Without these, archive hits quota/limit and fails with -122.

**Why:** EAS's ignore semantics differ from deploy. The root `.replitignore` only governs Replit deployment image size; it does nothing for EAS. The per-app `.easignore` is the only lever for EAS upload size, and its mere existence disables `.gitignore` fallback. For monorepos, EAS looks for `.easignore` at the monorepo root, not the app subdirectory.

**How to apply:** Before any `eas build` from this repl (iOS or Android), confirm `/.easignore` (workspace root) exists and lists all heavy dirs. The file at `artifacts/cashclip/.easignore` is a decoy for EAS — it does nothing.

**Verified archive size (Jun 2026):** with the heavy local dirs fully excluded (`exports`, `.local`, `.cache`, `.config`, `.pythonlibs`, `attached_assets`, plus `**/node_modules/`, `.git`, all `dist/`, `store-assets/`), the actual EAS payload is only ~21 MB of source uncompressed → **~18 MB gzip'd** (the number the "Compressing project files" step reports), ~548 files. The old ~667–838 MB figures came from incomplete `.easignore` exclusions; that much smaller size is the new correct baseline. To re-verify cheaply without spending an EAS build, replicate EAS's gitignore-semantics filter (a walker that skips those dir names at any depth + a real gzip `tar` with the same `--exclude` set) — the archive size is fully deterministic from `.easignore`, so a live build is not required just to measure it.
