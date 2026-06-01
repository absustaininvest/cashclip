---
name: How to find the real live App Store version
description: The approved/live App Store version is NOT the app.json build number; how to check it authoritatively.
---

# Live vs. in-repo version (CashClip)

The build/version numbers in `artifacts/cashclip/app.json` are the **next working build**, NOT what users have. They drift ahead of what Apple has actually approved.

**Confirmed June 1, 2026 (App Store Connect):** the live, approved, in-distribution version is **marketing v1.0 = build 29** (the "29" the owner kept referring to). **v1.1.0 (build 38) was REJECTED** by Apple because **the app never opened for the reviewer, who tested on an iPad** — i.e. a launch/startup freeze (Apple "app completeness" 2.1). The 38/39 build numbers in app.json never shipped. So build 29 is the real current app.

**Likely root cause of the build-38 rejection:** a launch-screen handoff freeze — see [expo-splash-launch-deadlock](expo-splash-launch-deadlock.md) (splash never hides because launch is gated on a step that never resolves). Owner-stated symptom matches that pattern exactly.

**To find the version truly live & approved in the App Store**, use Apple's public lookup (no auth):
`https://itunes.apple.com/lookup?bundleId=app.replit.cashclip&country=us` → the `version` field is what's live.

**Why:** The owner (non-technical) repeatedly gets tangled in version numbers (e.g., "29", "38", "39"). Different numbers are all real but mean different things:
- **App marketing version** = what the store shows users (e.g. `1.0`).
- **buildNumber / versionCode** in app.json = the next build being prepped.
- **`expo-updates` package version** (e.g. `~29.x`) = the OTA update *engine*, NOT the app version.

**How to apply:** When the owner asks "what version is live", trust the iTunes lookup, not app.json. The public lookup gives only the marketing version string; the exact build number behind it requires the App Store Connect API (Apple ASC secrets are configured). Before pushing OTA (`expo-updates`) to live users, confirm the update's `runtimeVersion` matches the runtimeVersion the LIVE build was compiled with, or the update won't land.
