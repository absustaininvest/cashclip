---
name: CashClip OTA delivery — build 29 is UNREACHABLE by OTA
description: Which CashClip builds can/can't receive EAS Update OTAs, and why the live App Store build (29) can never be fixed over-the-air.
---

# OTA delivery to CashClip builds — and why build 29 is a dead end

**Hard fact (verified June 1, 2026 via Expo GraphQL build registry):** the current Expo project is `cashclip` (projectId `aac2a3d9-56b6-49ab-b254-9b80e98bab2f`, owner account `absustainabilityinvestments`). Its iOS builds are **30, 31, 32, 33, 34, 35, 36, 37, 38** (oldest build 2026-05-15). **Build 29 does NOT exist in this project.**

**Therefore build 29 — the live, App-Store-approved build that real users have — was created under a DIFFERENT, earlier Expo project (the pre-transfer codebase that was wiped).** Its baked-in `updates.url` points at that old/dead project, NOT at `aac2a3d9`. So **no OTA we publish to this project can ever reach build 29.** Every EAS update we ship lands only on builds 30–38.

**Why this matters / consequences:**
- The public/live app (build 29) is permanently **frozen on the JS it shipped with** — including the "tap a home ad card → flash → bridge to the Earn tab" behavior (a prior agent temporarily disabled the cards by routing them to Earn and never reverted it). No OTA can fix that on 29.
- Real AdMob ad playback also can't be turned on for 29 via OTA.
- Build 38 (and 30–37) DO get our OTAs (channel `production`, runtimeVersion `1.0.0`) — that's why 38 plays ads and behaves correctly while 29 doesn't.
- **The ONLY way to fix the live public app is a new App Store build from THIS project (≥ build 39) submitted and approved by Apple.** There is no OTA shortcut. (Owner has resisted a new build and wants users kept on 29 — but 29 is technically unfixable by OTA; be honest about this.)

**How to verify build membership again:** query Expo GraphQL `app.byId(appId).buildsPaginated` for `appBuildVersion` + `platform`; if a build number isn't in the list, this project can't deliver updates to it. Use `EXPO_TOKLAST` as a Bearer token via `curl` to `https://api.expo.dev/graphql` (the `eas-cli` gets killed in plain bash; curl/GraphQL works).

## For builds that ARE reachable (30–38): small, JS-only groups only
runtimeVersion `"1.0.0"` is one static label shared across builds whose NATIVE code differs. OTA carries only JS + assets. Ship small, self-contained JS/content changes verified compatible with the OLDEST reachable native layer; never bundle native changes (new SDK/module, new permission, plugin/`expo-build-properties`/`newArchEnabled` changes, version bump) into an OTA — those need a new App Store build. Get explicit owner approval before any publish.
