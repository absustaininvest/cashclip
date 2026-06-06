---
name: CashClip SKAdNetwork IDs status
description: Whether the Unity/AdMob "missing SKAdNetwork IDs" warning is real, and where the IDs live
---

# CashClip SKAdNetwork IDs — already complete

The Unity dashboard's "You have missing SKAdNetwork IDs from your Info.plist"
banner is a **generic nudge**, NOT a per-binary diff — Unity cannot read your
Info.plist. Don't take it at face value.

**Actual state (verified Jun 6, 2026):** `artifacts/cashclip/app.json` already
contains **all 76** of Unity's required SKAdNetwork IDs (plus 1 extra = 77 total),
stored under `ios.infoPlist.SKAdNetworkItems` as `{ "SKAdNetworkIdentifier": "<id>.skadnetwork" }`
entries. Comparing Unity's full list to app.json => **0 missing**. The AdMob/Google
list previously pasted is also 76 and matches. So there is **nothing to add**.

**Why the warning persists anyway:** SKAdNetwork IDs are baked into the iOS binary's
Info.plist **at build time** from app.json. The LIVE App Store build is **29**
(compiled May 14 2026, runtimeVersion 1.0.0) and predates the current app.json, so
the live binary may not carry all of them — and that CANNOT be fixed over OTA (native).
app.json is already bumped to the **next native build 39** (buildNumber 39 / versionCode 39
/ runtimeVersion 1.1.0), so when build 39 is compiled and Apple-approved, the IDs ship
for real and the warning resolves. No code change needed — it's purely a build-39 thing.

**How to apply:** If the owner re-checks Unity monthly (per Unity's "check monthly"
note) and sees "missing IDs," re-run the compare (`grep -oE '[a-z0-9]+\.skadnetwork'`
on the pasted list vs app.json). If 0 missing, reassure him it's already handled and
just rides build 39 — don't add anything or alarm him.
