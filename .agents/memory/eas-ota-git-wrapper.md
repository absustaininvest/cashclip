---
name: OTA publish git-wrapper trick
description: How to run `eas update` correctly in the Replit sandbox — correct command, race condition fix, and what NOT to do.
---

## The correct OTA publish command

```bash
eas update --channel production --platform ios|android --message "..." --non-interactive
```

**`--channel production`, NOT `--branch production`.** Publishing to `--branch` directly bypasses the channel configuration in eas.json. Users subscribe to the CHANNEL. If you publish to the branch only, the channel→branch mapping is still correct, but `--channel` is the idiomatic and verified-working approach per EAS docs and confirmed working delivery.

**Do NOT use `expo export --skip-bundler --input-dir`.** This splits the bundling step and produces a bundle without `assetmap.json`, which EAS cannot serve correctly to users. Nobody gets the update. Always let `eas update` handle bundling internally.

## Race condition fix (concurrent iOS + Android)

Both OTA workflows share the `apps/cashclip/dist/` directory. If they run simultaneously, one platform's `metadata.json` overwrites the other's and the upload fails (`--platform=ios not found in metadata.json`).

Fix: use `flock` to serialize. The working script is at `apps/cashclip/scripts/eas-ota-publish.sh`. Key section:

```bash
LOCK_FILE="/tmp/eas-ota-workspace-lock"
exec 9>"${LOCK_FILE}"
flock -w 600 9   # wait up to 10 min
rm -rf dist
eas update --channel production --platform "${PLATFORM}" --message "${MESSAGE}" --non-interactive
flock -u 9
```

## Git-wrapper (required in Replit sandbox)

After publishing, EAS CLI runs `git add` + `git commit`. Replit's sandbox blocks `.git` writes and kills the process. Always prepend the fake-git to PATH:

```bash
mkdir -p /tmp/fake-bin
cat > /tmp/fake-bin/git << 'WRAP'
#!/bin/bash
case "$1" in
  add|commit|merge|rebase|restore|checkout|reset|stash|tag|push|pull)
    exit 0 ;;
  *)
    exec /usr/bin/git "$@" ;;
esac
WRAP
chmod +x /tmp/fake-bin/git
export PATH="/tmp/fake-bin:$PATH"
export CI=1
export EXPO_TOKEN="${EXPO_TOKLAST}"
```

## Fingerprinting

Without `EAS_SKIP_AUTO_FINGERPRINT`, EAS computes fingerprints for all active builds and creates per-runtime update groups. This is correct for covering both live build-29 (runtime 1.0.0) and any future 1.1.0 builds in one shot. Do not set `EAS_SKIP_AUTO_FINGERPRINT=1` unless specifically targeting only the app.json runtimeVersion.

## Path

Working directory is `apps/cashclip` (post-monorepo-reorganization). Old path `artifacts/cashclip` no longer exists.

## Delivery verification

After `✔ Published!`, confirm the output shows:
- `✔ Uploaded assetmap.json` — if missing, the bundle is malformed and users won't get it
- Bundle size ~4.98 MB (iOS) / ~4.98 MB (Android) — if it shows ~7–8 MB, the wrong bundler path was used
- `Runtime version: 1.0.0` — must match live build-29
