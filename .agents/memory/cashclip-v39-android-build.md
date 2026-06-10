---
name: CashClip V39 Android EAS build (Firebase + mediation adapters)
description: What it took to get a green Android versionCode 39 .aab via EAS; adapter/repo/Sentry gotchas.
---

# Green Android V39 build — the gotchas that blocked it

Goal was a green Android `.aab` (v1.1.0, versionCode 39) via EAS to ship to Google Play. iOS was dropped (Firebase iOS pod error dead-end); Android via Gradle avoids it. Firebase IS added on Android (google-services.json + android.googleServicesFile in app.json).

It took 4 builds. Each failure taught one thing:

- **AdMob mediation adapters on Google Maven are 5-segment, not 4.** Pangle adapter `com.google.ads.mediation:pangle` is `8.0.0.5.0` (NOT `8.0.0.5`). Unity `4.13.0.0`, ironSource `9.4.2.0` were already valid. Symptom: `Could not find com.google.ads.mediation:pangle:8.0.0.5`.
- **Pangle's NATIVE SDK is not on Google Maven — only on ByteDance's repo.** Must add `https://artifact.bytedance.com/repository/pangle` to expo-build-properties `android.extraMavenRepos` (alongside ironSource's `https://android-sdk.is.com/`). Symptom: `Could not find com.pangle.global:pag-sdk:8.0.0.5`.
- **Sentry source-map upload fails by the cli BINARY failing to LAUNCH on EAS, not by missing creds.** Error: `A problem occurred starting process '.../@sentry/cli/bin/sentry-cli'` (pnpm binary can't exec). `SENTRY_ALLOW_FAILURE` does NOT catch a process-START error. Workaround that gets a green build: set `SENTRY_DISABLE_AUTO_UPLOAD=true` in eas.json production.env. This only defers readable stack-trace symbolication; runtime crash reporting via EXPO_PUBLIC_SENTRY_DSN still works. Adding org/project to the app.json `@sentry/react-native/expo` plugin only removes a cosmetic warning (it already falls back to SENTRY_ORG/SENTRY_PROJECT env vars) — it does NOT fix the launch failure.

**Build trigger:** background workflow runs an EAS build script with `EXPO_TOKEN=$EXPO_TOKLAST`, `EAS_NO_VCS=1`; restart workflow = new build. The trigger workflow exits after upload — the EAS build itself keeps running; check real status with `eas build:list --platform android --limit 1 --json` (build:view can lag). Full build ~20 min; ~1.3GB upload means the build URL takes ~3 min to register after restart.

**Result:** versionCode 39 `.aab` built green with upload disabled. Next: optionally re-enable upload (owner connected the Sentry account on Expo) for one more build, then upload .aab to Google Play (promote toward Production).
