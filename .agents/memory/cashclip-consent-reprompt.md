---
name: CashClip tracking-consent re-prompt root cause
description: Why "ATT accepted but keeps re-asking" happens, and which version is actually clean
---

# "Tracking consent keeps coming back even though I accepted it (toggle ON)"

**Root cause:** the phone fell back to the EMBEDDED build-29 JS bundle (the old code
compiled into the App Store binary months ago), not a current OTA. That embedded
bundle has the older/looser consent code that re-prompts. When the live OTA gets
rolled back "to embedded", users land on this re-prompting code.

**The good OTA version's consent flow is correct** (verified in the stable 36h group,
the `TrackingConsentGate` + `lib/admob.ts` of that era):
- On launch it reads `getTrackingPermissionsAsync()`. If status is `authorized` (iOS
  toggle ON) or `unavailable`, it calls `markDone()` and SKIPS the gate — never re-asks.
- Custom "Permissions Needed" gate only shows on `undetermined` AND no
  `tracking_consent_dismissed_v1` AsyncStorage key. After the flow it sets that key.
- A `consentDoneRef` guard prevents the gate reappearing on foreground transitions.
- Google UMP (`requestAdsConsent`) only calls `showForm()` when status REQUIRED/UNKNOWN;
  after consent it's OBTAINED so it won't reappear.
- `getTrackingStatus()` races a 3s timeout → fails OPEN (markDone), never stuck.

**How to apply:** if owner reports the consent screen re-asking, do NOT assume the
current OTA is broken — first check whether his phone is on the embedded fallback
(e.g. an OTA "roll back to embedded" happened). Restoring the good OTA group is the
fix, not a code change. Always confirm on-device after republish.
