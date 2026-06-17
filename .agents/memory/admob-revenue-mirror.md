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

**Admin relabel companion:** `reconMirrorInactive = appReported===0 && official>0`
flips the badge to neutral "Official only" and explains the $0 is by design.
Caveat (open, owner to decide): once the mirror build is live this flag could
mask a genuine future regression back to $0 — gating it on a server-driven
"mirror expected active" flag/cutover would close that hole (needs an API deploy).
