---
name: Expo multi-account build target
description: One Expo org remains (absustainabilityinvestments). The correct CashClip project is locked in code by owner+projectId. Expodeveloper20 and its stray cashclip project were deleted Jun 2026.
---

# Expo account setup (CashClip) — post-cleanup Jun 2026

Owner cleaned up Expo accounts. **Only ONE org remains:**

- **Correct org/owner slug:** `absustainabilityinvestments`
- **Project:** CashClip
- **Project ID:** `aac2a3d9-56b6-49ab-b254-9b80e98bab2f`
- **Updates URL:** `https://u.expo.dev/aac2a3d9-56b6-49ab-b254-9b80e98bab2f`
- **Live channel:** `production`, runtimeVersion `1.0.0`

**Expodeveloper20 / `absustainabilityinvestmentsllc`** (org that owned the live build-29 OTA,
Project B `10994af8…`) was **deleted by the owner in Jun 2026.** It no longer exists.

**Consequence for OTA to build-29 users:** the old "A↔B dance" (temporarily swapping
app.json owner+projectId to reach build-29 devices on Project B) is no longer possible
because Project B's org is gone. Build-29 users on the live App Store app can no longer
receive OTAs. The only way to reach them now is a new native build (41+) that bakes
Project A `aac2a3d9` + new runtimeVersion, submitted to the App Store.

**Why build target is safe:** app.json owner `absustainabilityinvestments` + projectId
`aac2a3d9…` is the only valid target. No decoy orgs remain. EXPO_TOKLAST must belong to
a member of `absustainabilityinvestments` for EAS builds to work.

**How to apply:** before any EAS build/submit/update, confirm app.json still has
owner `absustainabilityinvestments` + projectId `aac2a3d9…`. No need to check for
stray accounts anymore — there is only one.
