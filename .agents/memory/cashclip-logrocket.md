---
name: CashClip LogRocket integration
description: How LogRocket session-replay is wired into the CashClip Expo app, the SDK/package gotchas, and the money-app privacy constraints before recording is switched on.
---

# CashClip LogRocket (session replay)

## The package gotcha (most important)
- LogRocket's onboarding screen shows the **web** SDK: `npm i logrocket` + `LogRocket.init('wzfayx/cashclip')`. That is WRONG for this app.
- The CashClip app is React Native/Expo → use **`@logrocket/react-native`** (different package). Web SDK would not work in the app.
- New Architecture is enabled (`newArchEnabled: true`); RN SDK supports new arch only from v1.46.4+. We use v3.1.1.

## Native, not OTA
- `@logrocket/react-native` is a **native** module added via its Expo **config plugin** (`"@logrocket/react-native"` in app.json `plugins`). The native module must ship in a real native build (EAS) — it cannot be added over OTA to live build 29.
- The JS `LogRocket.init(...)` call is plain JS, so once the native module is in a build it *could* be toggled/adjusted via OTA. The native module itself cannot.
- Requires Android `minSdkVersion: 25` → added inside the existing `expo-build-properties` android block.

## Android-native-build landmine (compounding)
- The LogRocket config plugin applies to BOTH platforms, and minSdk 25 is an Android requirement. Combined with the Firebase landmine (no `google-services.json` / no Android Firebase app), a future **Android native build** needs prep. Currently safe: next native build is iOS; Android rides OTA.

## App ID is client-public (not a secret)
- `wzfayx/cashclip` is a client-embedded init identifier, analogous to the hardcoded AdMob app ID. Hardcoding it is consistent with the project pattern; it does NOT need its own secret. (The per-credential-secret rule is about API keys/webhook secrets, not client-public init IDs.)

## Money-app privacy — MANDATORY before recording real users
- LogRocket is a session recorder on a **finance app**: it can capture emails, balances, payout info, JWTs. Before any real-user recording:
  - Network request/response sanitizers to strip Authorization headers + bodies.
  - Redact/mask on-screen sensitive fields (balances, email, payout) — RN needs explicit redaction, no free global text mask.
  - Avoid `LogRocket.identify` with raw PII (hash or omit).
  - Apple privacy nutrition labels need a data-collection (Analytics/Diagnostics) update for the next build.

## Current state (as staged)
- Installed `@logrocket/react-native` v3.1.1; added config plugin + Android minSdk 25 in app.json. Typecheck passes.
- **`LogRocket.init` is NOT wired yet** → recording is OFF. Switching it on (with masking) is the deliberate next step.
- Bakes into the next iOS native build alongside Firebase + Chipley.
