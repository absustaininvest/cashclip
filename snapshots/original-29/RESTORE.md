# Original (29) Version — Known-Good Restore Point

This is the **stable, owner-approved CashClip configuration** for App Store build 29
(v1.0.0). Saved June 3, 2026 after restoring the version that ran cleanly for 36 hours
and has the correct (non-re-asking) tracking-consent flow. Use this to snap back to a
known-good state at any time.

## What this snapshot is
- `app.json` in this folder = the exact normal app config (its everyday "Project A"
  pointer). This is what `artifacts/cashclip/app.json` should look like during normal
  work and builds.

## The good live OTA this represents
- **Good source update group:** `26fa0d4c-44c7-49ca-9e7c-35a7cf835f86` (June 1, 2026,
  commit `9c71ec40`) — the version that ran stable 36h with correct consent handling.
- **Republished live as:** `991eb089-dd3a-4a72-a049-949743e5b6ea` (June 3, 2026) — the
  current top of the live `production` branch.
- **Branch:** `production` · **runtimeVersion:** `1.0.0` · **platforms:** ios + android.
- **Reaches:** App Store build 29 (v1.0.0) devices over-the-air.

## Expo projects involved
- **Project A (normal/everyday pointer in app.json):**
  `aac2a3d9-56b6-49ab-b254-9b80e98bab2f`, owner `absustainabilityinvestments`.
- **Project B (where build-29 OTAs actually live):**
  `@absustainabilityinvestmentsllc/cashclip`,
  projectId `10994af8-62e3-4a9d-9e35-7f4381965a31`.

## How to restore this version to live build 29 (one-time republish)
1. In `artifacts/cashclip/app.json`, TEMPORARILY point at Project B:
   - `owner` → `absustainabilityinvestmentsllc`
   - `extra.eas.projectId` → `10994af8-62e3-4a9d-9e35-7f4381965a31`
   - `updates.url` → `https://u.expo.dev/10994af8-62e3-4a9d-9e35-7f4381965a31`
   - keep `runtimeVersion` = `1.0.0`
2. From `artifacts/cashclip/`, republish the good group:
   ```
   EXPO_TOKEN="$EXPO_TOKLAST" pnpm exec eas update:republish \
     --group 26fa0d4c-44c7-49ca-9e7c-35a7cf835f86 \
     --message "Restore Original (29) version" --non-interactive
   ```
3. REVERT `artifacts/cashclip/app.json` back to the copy in this folder (Project A).
4. Verify the new group is the top of the `production` branch, then confirm on-device
   (delete + redownload, open twice) before calling it done.

## Notes
- This is JS/content (OTA) only — it lands on the existing build 29 binary. Native
  changes still require a new App Store build.
- Update groups are permanent in Expo, so `26fa0d4c…` can always be republished.
