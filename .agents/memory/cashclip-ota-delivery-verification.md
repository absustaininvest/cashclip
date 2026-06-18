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

**Standing delivery default:** server-side changes go to production FIRST, then the OTA, in that order. Standing OTA target = runtime `1.0.0` / channel `production` (build-46 codebase → live build-29 users) until a native build with runtimeVersion `1.1.0` ships and goes live as the App Store public baseline. At that point the target switches to runtime `1.1.0` / channel `production` — app.json already has 1.1.0 (buildNumber 48/versionCode 46), so the next native build will carry that runtime. Do not delay this flow by citing past build-failure caution notes; only native-only changes are exempt (they need a fresh EAS build). See `cashclip-current-build-state.md` and replit.md User preferences.

**`eas update` ships the WHOLE cumulative HEAD JS bundle — never a cherry-picked diff.** The latest production update group therefore already contains every earlier JS change (honest-balance, server-data wallet feed, AdMob revenue capture, etc.). So "make sure change X reached users" = confirm the latest group on `production`/`1.0.0` was published AFTER X merged; a redundant re-publish of an unchanged HEAD just creates a duplicate group. Use `eas update:list --branch production` to read the history.

**The HEAD bundle is OTA-safe on build 29 even though build 29 predates Sentry/Vexo/LogRocket.** Those telemetry SDKs are hard-imported at module scope in `app/_layout.tsx`, but every `init` is try/catch + env-key gated and `Sentry.wrap` is a pure-JS HOC that no-ops without its native module — so a binary missing those native modules degrades gracefully instead of crashing. AdMob (`react-native-google-mobile-ads`) and Unity have been in the app since BEFORE build 29 was approved (owner-confirmed Jun 2026), so the AdMob orchestrator-swap JS is also safe on build 29. **Why:** this is the exact native-drift crash question that gates every 1.0.0 OTA; the answer is "safe because telemetry is fail-open + AdMob/Unity predate build 29," proven empirically by full-HEAD OTAs sitting live on `production`/`1.0.0` with no rollback.
