---
name: CashClip tracking-consent re-prompt root cause
description: Why "ATT accepted but keeps re-asking" happens, and which version is actually clean
---

# "Tracking consent keeps coming back even though I accepted it (toggle ON)"

## Root cause (evidence-backed)
The re-asking is the EARLY consent-gate code re-appearing. That early code is what
build 29's EMBEDDED bundle carries (build 29 / v1.0.0 was compiled in the pre-transfer
codebase that is NOT in current git history). When a device runs the embedded bundle
(e.g. after an OTA "roll back to embedded", or before a slow OTA finishes downloading),
the old re-prompt bug returns.

## Dated fix timeline (current git history, file TrackingConsentGate.tsx)
- 2026-05-20 f4ef89b — gate first set up (waitForActive present from the start)
- 2026-05-24 fa36093 — improve ATT flow + handle foregrounding
- 2026-05-25 e8f4ef5 — "prevent repeated prompts"
- 2026-05-26 3534ec1 / 7e514c7 — blank-screen fix + "reappearing after denial"
- 2026-05-27 cd5ad5b / bd63802 — Android GDPR form + "reappearing unexpectedly"
- 2026-05-28 537ec9e — "stop ATT gate from reappearing" (auth+att)
- 2026-06-01 ea20b4a — launch/freeze fix
- 2026-06-01 9c71ec4 — the GOOD restored version (group 26fa0d4c); contains ALL the above

So the reappearing bug took a whole series of May 24–28 fixes to kill. Build 29's
embedded bundle predates them → it still re-prompts.

## The good (restored) version's consent logic is correct
- Reads `getTrackingPermissionsAsync()`; if `authorized` or `unavailable` → markDone, gate
  is SKIPPED (this authorized→skip short-circuit landed in bd63802/537ec9e).
- Custom gate only on `undetermined` + no `tracking_consent_dismissed_v1` key.
- `consentDoneRef` guard stops reappearance on foreground; `waitForActive(2000)` before
  requesting ATT so the system prompt fires while app is active and the result sticks.
- 3s timeout on the status read → fails OPEN (never stuck on a spinner).

## Why the owner's toggle OFF→ON test fixed it (the smoking gun)
Toggling iOS Settings → Tracking OFF then ON forces iOS to commit a fresh, durable
`authorized` status. The running code then reads `authorized` and stops showing the
gate. This proves the lever is the OS-level ATT status, and that current code honors it.

## Jun 2026 — Full v3 rewrite + architectural gate fix

TrackingConsentGate was fully rewritten (v3, DONE_KEY = "consent_done_v3"):
- Simple `checking→disclosures→terms→done` state machine, no AppState listeners
- Migrates old keys: `consent_fully_done_v2` and `tracking_consent_dismissed_v1`
- Post-ATT-dialog authorized check: after requestATT(), 600ms settle delay, re-reads
  status; if "authorized"/"granted" → writes done key → skips disclosures/terms entirely
- Handles the build-29 silent-authorized path (wrote NO key on authorized pass-through)

**Critical architectural fix**: TrackingConsentGate is outermost AND AuthProvider
is inside it. Gate order: TrackingConsentGate → AuthProvider → OtaUpdateGate →
ForceUpdateGate → App. This means: (1) OtaUpdateGate can never reload mid-consent,
(2) zero auth activity (token reads, API calls, login redirects) fires before consent
resolves — eliminating background fluctuation on fresh installs before the user taps.

## How to apply
If owner reports consent re-asking: confirm gate order in _layout.tsx (TrackingConsentGate
must be outermost). Check which of the three keys is present. If none, the device
is mid-consent on first launch — that's expected. ATT must be requested while the app
is ACTIVE or the prompt is suppressed and status stays undetermined. Always confirm
on-device after the OTA fully propagates.
