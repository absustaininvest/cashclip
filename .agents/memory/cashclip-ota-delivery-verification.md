---
name: CashClip OTA delivery verification
description: How to confirm an EAS OTA actually reaches users — what to check, what failure looks like, and what NOT to dismiss.
---

## Confirmed working delivery looks like this

```
✔ Uploaded assetmap.json        ← REQUIRED. If missing, bundle is malformed.
✔ Uploaded 1 app bundle
✔ Published!
Runtime version  1.0.0
Platform         ios
```

Bundle size must be ~4.98 MB per platform. If it shows ~7–8 MB and `assetmap.json` is missing, the wrong approach was used (`expo export --skip-bundler`) and nobody will receive the update.

## What breaks delivery (do not dismiss these)

- **Missing `assetmap.json`** — EAS cannot serve the update. Users get nothing. This happened when `expo export --skip-bundler --input-dir` was used instead of `eas update` directly.
- **`--branch production` vs `--channel production`** — always use `--channel`. Publishing directly to a branch bypasses the channel config.
- **Race condition** — iOS and Android running simultaneously overwrite each other's `dist/metadata.json`. Fixed in the script with `flock`. If the error is `--platform=ios not found in metadata.json`, this is the cause.
- **Wrong runtime version** — updates published to `1.1.0` never reach live build-29 users (runtime `1.0.0`). Standing target is runtime `1.0.0` / channel `production`.

## "Nobody got the update including me" is not a timing issue

Do not tell the owner to "relaunch twice, it's the 2nd-cold-launch apply timing." That answer silences a real problem. When the owner says nobody has the update, check the publish log for `assetmap.json` and bundle size first. If those are wrong, the update is malformed — no amount of relaunching fixes it.

The 2nd-cold-launch timing is real but only relevant AFTER confirming the publish output is clean.

## Routing

Channel `production` → branch `production` → runtime `1.0.0`. Verified working. Confirm with:
```
cd apps/cashclip && EXPO_TOKEN=$EXPO_TOKLAST pnpm exec eas channel:list
```

## Standing delivery policy

Server-side changes go to production FIRST, then OTA — in that order. OTA target: runtime `1.0.0` / channel `production` (build-46 codebase → live build-29 users) until a native build with runtimeVersion `1.1.0` ships publicly in the App Store/Play Store.

## Cumulative bundles

`eas update` ships the entire HEAD JS bundle, not a diff. The latest production group already contains every prior JS change. A re-publish on unchanged HEAD creates a duplicate group — check `eas update:list --branch production` before re-publishing to confirm HEAD actually changed.
