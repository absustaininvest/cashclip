---
name: CashClip OTA delivery — ONE project covers ALL builds including build 29
description: How EAS Update OTAs map to CashClip builds. Project B is gone; Project A is the single source of truth.
---

# OTA delivery to CashClip builds — ONE project (Jun 13 2026 confirmed)

**SUPERSEDES the old "two projects" doc.** As of Jun 13 2026 the `absustainabilityinvestmentsllc` account was renamed/converted into the `absustainabilityinvestments-owner` org. Project B (`10994af8`) no longer exists (`EXPERIENCE_NOT_FOUND` via GraphQL). **Project A is now the only project and covers ALL builds including build 29.**

- **Project A — `aac2a3d9-56b6-49ab-b254-9b80e98bab2f`** (account `absustainabilityinvestments-owner`). Holds ALL builds — iOS 29 through 38+. OTA group `17aaf3a7` (Jun 13 2026) confirmed **45 builds** on runtime `1.0.0` production channel. This is the normal `app.json` pointer — no switching needed.

## Publishing an OTA (the ONLY procedure now)

Just publish from the workspace normally:

```
cd artifacts/cashclip && PATH=/tmp/fake-bin:$PATH EXPO_TOKEN=$EXPO_TOKLAST pnpm exec eas update --channel production --message 'OTA update' --non-interactive
```

The `EAS OTA Publish` Replit workflow does this. No `app.json` repointing, no `_layout` swap, no Project B. **The build29-delivery snapshot procedure is OBSOLETE — do not use it.**

## Runtime lineage

- **`1.0.0`** → build 29 (live App Store) + all prior builds. OTAs with runtime `1.0.0` reach ALL of them.
- **`1.1.0`** → reserved for future native builds ≥41. Not yet in use.

## Hard rules (unchanged)

- JS/content only — native changes need a new App Store build.
- Ship SMALL, self-contained groups.
- Never roll back a live OTA without verifying on-device first.
- `app.json` runtimeVersion is permanently `"1.0.0"` — do NOT change it.

## NEVER bulk-restart the `EAS OTA Publish` workflow accidentally

Its command is a one-shot `eas update` — restarting it RE-RUNS a live OTA publish. Only restart it when an OTA publish is explicitly intended and owner-approved.
