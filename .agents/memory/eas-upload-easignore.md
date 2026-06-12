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

**How to apply:** Before any `eas build` from this repl (iOS or Android), confirm `/.easignore` (workspace root) exists and lists all heavy dirs. The file at `artifacts/cashclip/.easignore` is a decoy for EAS — it does nothing. Correct archive size should be ~838 MB.
