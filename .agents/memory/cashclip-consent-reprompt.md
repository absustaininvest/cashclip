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

## How to apply
If owner reports consent re-asking: first determine the device isn't on the embedded
fallback / mid-OTA. Restoring the good OTA group is the fix, NOT a code change. ATT must
be requested while the app is ACTIVE (waitForActive) or the prompt is suppressed and
status stays undetermined. Always confirm on-device after the OTA fully propagates.

## Honest caveat
The exact embedded build-29 JS is not in current git history (pre-transfer, wiped per
replit.md footnote), so the embedded code isn't shown line-by-line. The dated fix
history + observed behavior + the toggle test together establish the root cause.
