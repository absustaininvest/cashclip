---
name: CashClip OTA delivery to the live build (29)
description: How to make over-the-air (EAS Update) changes actually land on the live, in-distribution CashClip build, and what can/can't ride OTA.
---

# Delivering updates to the live CashClip build (build 29)

**Target for OTA to reach the live app:** EAS Update published to channel **`production`** at **runtimeVersion `1.0.0`**. Live build 29 listens on exactly that combination. All production iOS builds 33–38 were compiled on runtimeVersion `1.0.0` / channel `production` (verified via `eas build:list`), and runtimeVersion is a single static string `"1.0.0"` in `app.json`, so build 29 shares the same target.

**Pipeline is wired & working (confirmed June 1, 2026):**
- `app.json`: `updates.url = https://u.expo.dev/<projectId>`, `runtimeVersion: "1.0.0"`, EAS projectId present.
- `eas.json`: `production` build profile → `channel: "production"`.
- Auth: `EXPO_TOKLAST` = the EAS token (passed as `EXPO_TOKEN`). `eas whoami` → `support@absustaininvest.com`, Owner of `absustainabilityinvestments`. Token authenticates.

**Why "updates didn't take effect" this morning:** the Expo/EAS auth secret was not set properly, so the publish never landed. Once the token is set, publishes go through. Always confirm `eas whoami` succeeds before assuming an update will land.

## Hard rule: small, JS-only groups — not big packs
**Why:** runtimeVersion `"1.0.0"` is a single static label shared across builds whose NATIVE code differs (build 29 vs the newer 33–38). OTA only carries **JS + assets**, never native code. An OTA published to `1.0.0` WILL land on build 29 — but if that JS depends on a native module/permission that only exists in a newer build, build 29 will CRASH.

**How to apply:**
- Ship **small, frequent, self-contained JS/content changes** that are verified compatible with build 29's older native layer. This is the owner's stated working preference.
- NEVER bundle into an OTA anything that needs native changes: new SDK/native module, new permission, `expo-build-properties` / `newArchEnabled` / plugin changes, or a version/build bump. Those require a brand-new App Store build + Apple review — they cannot ride OTA.
- Get explicit owner approval before any publish (no unsolicited releases).
