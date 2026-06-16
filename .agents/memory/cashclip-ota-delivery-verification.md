---
name: CashClip OTA delivery verification
description: How to confirm an EAS OTA actually reaches a build, and why "OTA not transmitting" is usually a false alarm rather than a routing bug.
---

- An OTA reaches an installed build only when BOTH conditions hold: the published update's **runtimeVersion** equals the build's embedded runtime, AND the build's **channel** maps to the **branch** the update was published on.
- Verify routing read-only with `eas channel:view <channel>` (run in `artifacts/cashclip`, `EXPO_TOKEN=$EXPO_TOKLAST`). It prints the branch(es) the channel points at + their runtime + latest update group. Confirmed wiring: channel `production` → branch `production` → runtime `1.0.0`.
- **Match runtime EXACTLY.** Updates published to runtime `1.1.0` will NEVER appear on the live `1.0.0` builds (and vice-versa). A mixed-runtime update history is the single most common reason an OTA "doesn't show up."
- **expo-updates applies on the SECOND cold launch:** launch #1 downloads in the background, launch #2 swaps it in. A "not transmitting" report on a correctly-routed channel is almost always this timing — force-quit + reopen twice to confirm before treating it as a bug.
- The update group's **Downloads / Known-launches** counter is the proof-of-delivery signal. A low count (~1) means a tiny active audience or only the test device, not a broken pipeline.

**Why:** Repeatedly burned diagnosing "OTA broken" reports that turned out to be (a) the 2nd-cold-launch apply timing or (b) testing a 1.1.0-published update against a 1.0.0 build. The routing itself was correct each time.

**How to apply:** Before changing any update/channel config in response to an "OTA not working" report, first run `eas channel:view` to confirm runtime+branch routing, then have the owner do the two-relaunch test.
