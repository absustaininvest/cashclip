---
name: CashClip current build state
description: Which build is live, what's in progress, and the runtime version picture.
---

**App Store LIVE (public) build:** build **29, runtime 1.0.0, channel `production`** — this is what real users actually install/run. Confirmed Jun 16 2026 by owner with a Transporter screenshot + his own session recap. The "Original (29)" restore point pins this bundle; live OTA group `991eb089…` rides on it.

**CORRECTION (do not repeat the old claim):** builds **40, 42, 46 are NOT public.** Transporter shows 40 (Jun 10) and 46 (Jun 15) only "Delivered … ready for internal testing" (TestFlight/internal); build 42 is the runtime-1.1.0 TestFlight backup. **No 1.1.0 build is live** — runtime 1.1.0 only ever existed in TestFlight. Earlier memory/replit.md footnote saying "build 40 runtime 1.1.0 live on the App Store" was wrong on every count.

**OTA reach:** an `eas update` at runtime 1.0.0 on the `production` channel DOES reach the live build-29 users (that's how the Chipley celebration, spin fix, home-taps, consent fixes already shipped). BUT never `eas update` from current repo HEAD — HEAD carries the AdMob mediation NATIVE swap (buildNumber 47) that build 29 lacks; OTA must be built from the live build-29 base with only safe JS changes, isolation-verified.

**Latest successful EAS build:** build 46 (runtime 1.0.0) — completed Jun 15 2026. IPA produced at:
`https://expo.dev/artifacts/eas/n2o4hfj-EIhs99h29_NNWAwyuqex4jXnnet7zRXv1NI.ipa`
EAS build ID: `e8a9b69e-6068-4ad7-a4f9-cea57da96c2d`

**Submission plan:** run `eas submit --platform ios --profile production --non-interactive` (ASC key DGVBV8VV95 wired in eas.json submit.production.ios; EAS submit key `87Z27CQ96U` held by EAS).

**Why runtimeVersion 1.0.0:** all future builds target runtime 1.0.0.

**Jun 16 2026 — AdMob mediation swap (pending build):** app.json bumped to buildNumber "47" / versionCode 44 for the next native build, which reverts the orchestrator from LevelPlay back to AdMob (Unity/ironSource/Pangle/Chartboost retained as AdMob adapters). Not yet built/submitted. See `cashclip-ad-platform-admob-mediation.md`. Builds 40/46 do NOT contain this adapter set.

**Jun 16 2026 — owner declined the new build (no build needed).** Owner confirmed (with an AdMob Mediation-groups screenshot showing CashClip_Rewarded groups earning live revenue) that the live App Store build (40) ALREADY runs AdMob as the rewarded orchestrator and is earning — so AdMob ad setup is live/working without a new build. The only thing the pending build 47 would add is **Chartboost** as a 4th demand source (plus the LevelPlay revert); that's an incremental revenue add, deferred to a future build at the owner's discretion. The "build & submit" task was closed WITHOUT producing/submitting a build per explicit owner approval. Don't auto-trigger a build for the AdMob swap — it's owner-gated.

**What fixed pod install (build 46):** Removed `expo-dev-client@^56.0.20` and downgraded `expo-notifications@^56.0.17` → `~0.32.17` from `dependencies` in package.json. Both were SDK 56 packages in an SDK 54 project, pulling in `expo-manifests@56.x` which conflicted with `expo-manifests@1.0.11` needed by `expo-updates@29.x`, causing CocoaPods to fail resolving `EXManifests`.

**Also fixed:** `expo-device` bumped from `~7.0.3` → `~8.0.10` (SDK 54 expected).

**EAS build script:** `artifacts/cashclip/scripts/eas-build-ios-46.sh` — uses git-wrapper trick + reads ASC key from `attached_assets/AuthKey_DGVBV8VV95_*.p8`. Workflow: "EAS iOS Build 46".

**SDK 54 patch mismatches resolved:** expo-font → ~14.0.12, expo-router → ~6.0.24, expo-updates → ~29.0.18 (expo doctor clean).

**TestFlight confirmation (Jun 16 2026):** owner installed build 46 via TestFlight on a real device and confirmed it works end-to-end against production — balance, ATT consent, terms/privacy, ad playback, reward claim, and wallet pending-points all functional. Critically, ATT consent clears and does NOT re-fire on relaunch (the splash/consent deadlock that got build 38 rejected under Apple 2.1a is gone). Build 46 is the confirmed-good submission candidate.
