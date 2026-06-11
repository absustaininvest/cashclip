---
name: EAS upload .easignore must exclude heavy local dirs
description: Why EAS builds from this repl fail with "Unknown system error -122" during "Compressing project files" and how .easignore overrides .gitignore.
---

# EAS upload archive blows up when .easignore exists

When `artifacts/cashclip/.easignore` exists, EAS **ignores `.gitignore` entirely** and only honors `.easignore`. If `.easignore` does not explicitly exclude the heavy root-level local-only dirs, EAS packs them into the upload tarball (multiple GB) and the build dies during "Compressing project files" with `Unknown system error -122` (not a code/typecheck error, not a disk-space error — the FS had 240G+ free).

The heavy dirs that must be excluded (relative to `artifacts/cashclip/`, so `../../`): `exports/` (~3G), `.local/` (~1.4G), `.cache/` (~1.2G), `.git/` (~1.6G), `attached_assets/` (~80M), plus `snapshots/`, `.config/`, `.pythonlibs/`. This mirrors the deployment-time `/.replitignore`.

**Why:** EAS's ignore semantics differ from deploy. The root `.replitignore` only governs Replit deployment image size; it does nothing for EAS. The per-app `.easignore` is the only lever for EAS upload size, and its mere existence disables `.gitignore` fallback.

**How to apply:** Before any `eas build` from this repl (iOS or Android), confirm `artifacts/cashclip/.easignore` still lists the heavy `../../` dirs. `attached_assets` is only used by absustain, safe to exclude for cashclip builds. None of these are needed to build the app.
