---
name: CashClip OTA update prompt vs native gate
description: Two distinct update mechanisms in the app and the first-rollout caveat for any client-display change
---

# Two separate "update" mechanisms — don't confuse them

- `ForceUpdateGate` (components/ForceUpdateGate.tsx) is a **native store** gate: it calls
  `/api/app/version` with `X-App-Version`, and on `426` sends users to the App Store, or shows
  a maintenance screen. It does NOT deliver or refresh the OTA JS bundle.
- `OtaUpdateGate` (components/OtaUpdateGate.tsx) handles the **OTA JS bundle**: on launch and on
  foreground it runs `Updates.checkForUpdateAsync()` → `fetchUpdateAsync()` and shows a
  non-blocking "Reload Now" prompt → `Updates.reloadAsync()`. No-ops in dev/Expo Go
  (`__DEV__ || !Updates.isEnabled`).

# First-rollout caveat (the part that surprises people)

**An in-app "update available" prompt can only fire from a bundle that already contains the
prompt code.** So the VERY FIRST time you ship `OtaUpdateGate` (or any client change), existing
live sessions still pick it up via the normal Expo cold-start auto-update, NOT via the prompt.
Every subsequent OTA after the prompt is live will trigger the prompt.

**Why this matters for the points economy:** old JS bundles hardcode the old points→USD ratio,
so a stale session OVERSTATES the cash value of newly-earned points while the server credits the
new (lower, floored) rate. Updated bundles read cash value straight from the server, so they are
always correct. The money is protected regardless (already-earned/legacy/NULL-snapshot tokens are
credited at the legacy 0.001 rate), but the DISPLAY mismatch only resolves once the new JS is live.

**How to apply:** When a server change alters displayed cash value, ship the JS OTA together with
the server change. Re-login is NOT what delivers JS — a cold start (or the OtaUpdateGate prompt on
later updates) is.
