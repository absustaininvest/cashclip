---
name: AdMob revenue mirror (official vs app-reported)
description: Why the admin reconciliation shows $0 app-reported and how the app fills per-impression revenue.
---

# AdMob revenue reconciliation mirror

The admin "Reconciliation: AdMob official vs App-reported" compares AdMob's
official earnings against the server's `SUM(adEvents.revenueMicros)` for the same
window. Server-side this is structurally sound; the gap is a client gap.

**The app historically reported impression COUNTS but no per-impression revenue**,
so app-reported reads $0 and the panel showed "+100% Diverging" — a false alarm,
not a connectivity/server bug.

**How revenue is captured (fix):** AdMob's `AdEventType.PAID` (impression-level
ad revenue) fires per monetized impression with `event.value` in the account
currency's MAIN unit (e.g. 0.0042 = $0.0042). Convert ×1e6 → micros and attach it
to the **existing `completion` event** via `trackAdCompletion(type, durationMs, micros)`.

**Why completion, not a new "paid" event:** the server's ad-event whitelist is
fixed (`impression|completion|reward_earned|load_failed|clicked`) and would drop
any new type; app-reported sums `revenueMicros` across ALL event types while the
impression metric counts only `event='impression'`. So revenue must ride an
existing non-impression event → `completion` (fires once per shown ad, rewarded +
interstitial). Do NOT also put revenue on `reward_earned` or it double-counts.

**Why:** keeps revenue capture from inflating any count, needs zero server change.
**How to apply:** banner revenue is intentionally NOT captured yet. This is a
NATIVE change — it only takes effect in a fresh EAS build, never via OTA. Until
that build is the LIVE build, app-reported $0 is correct/by-design.

**Verified live (Jun 17 2026):** after the OTA wired the PAID→micros listener
(group d41ff6f9, runtime 1.0.0/production), PRODUCTION app-reported revenue is
STILL $0. Of 16,554 lifetime `ad_events`, ZERO carry `revenue_micros` — across
all types (impression/reward_earned/completion/load_failed) and both iOS+Android,
including the 134 completions (latest Jun 16). Events keep flowing, just no
revenue. Confirms the native-change conclusion: build 29's bundled
react-native-google-mobile-ads native SDK does not deliver `AdEventType.PAID` to
the OTA'd JS listener, so the JS-only OTA cannot close the gap. The "+100%
Diverging" / $0 app-reported stays correct/by-design until a fresh EAS build
(build 46+ carries the listener natively) becomes the LIVE native build.

**Admin relabel companion:** `reconMirrorInactive = appReported===0 && official>0`
flips the badge to neutral "Official only" and explains the $0 is by design.

**Cutover gate (closed):** the relabel is now gated on a server-driven cutover
signal so it can't mask a genuine future regression to $0. Set the env flag
`ADMOB_MIRROR_EXPECTED_ACTIVE` truthy on the **production** deployment once the
PAID-capable native build is the LIVE build (then republish — env-only, no DB).
The revenue route (`GET /api/admin/admob/revenue`) echoes it as
`mirrorExpectedActive`; the admin badge keeps "Official only" only while that is
false. After cutover a $0 reconciliation reads as "Diverging" (amber alert).
**Why:** before cutover $0 is by design; after it, $0 is a real regression and
must not be softened. Default false = nothing changes until an operator flips it.
