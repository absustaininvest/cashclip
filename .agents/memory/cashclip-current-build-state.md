---
name: CashClip current build state (Jun 15 2026)
description: Which builds exist where, what runtime they have, and what's live.
---

**App Store live build:** build 40 (1.1.0, runtime 1.1.0) — submitted by owner from their PC; this is the binary users install fresh from the App Store.

**EAS builds in current project (absustainabilityinvestments org):**
- appBuildVersion 41, runtime 1.0.0, FINISHED — EAS ID 3a0a0c20
- appBuildVersion 42, runtime 1.1.0, FINISHED — EAS ID 44225ec2 (IPA: expo.dev/artifacts/eas/5KsTV_...)
- appBuildVersion 43, runtime 1.0.0, ERRORED — EAS ID 28488758

**app.json state:** buildNumber "43", versionCode 43, runtimeVersion "1.0.0"

**Repacked IPA:** Owner uploaded build 40 IPA (1.1.0); patched to runtime 1.0.0 via Python plistlib, saved at exports/cashclip-build40-runtime1.0.0-unsigned.ipa. Needs Mac re-signing before App Store submission.

**Why runtimeVersion matters:** OTA updates only land on devices whose baked-in runtimeVersion matches the update's runtimeVersion. Live users are on build 40 (1.1.0), so OTAs must target runtime 1.1.0 OR a new build with runtime matching the OTA must reach the App Store.
