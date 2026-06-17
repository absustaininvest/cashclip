---
name: CashClip ATT consent screen neutrality
description: Keep the ATT pre-prompt/consent screen and its decline alert neutral — no coercive earnings-threat copy, no celebratory/distracting mascot art.
---

The custom ATT pre-prompt ("Your Privacy & Earnings" disclosures step in TrackingConsentGate) and its decline-confirmation Alert must stay neutral and non-coercive.

**Why:** Apple Guideline 5.1.1 rejects apps that pressure or penalize the tracking choice. Earnings-threat framing (e.g. a title "This Will Reduce Your Earnings" or "you'll still earn, but less") reads as coercion → denial, sent back. A celebratory mascot pose (confetti/arms-up) on a disclosure screen pulls the reviewer's/user's eye off the actual disclosure and can read as hyping past the privacy text. Owner (Jorge) explicitly chose the calm, neutral option both times.

**How to apply:** When editing consent-screen copy or art — no penalty/threat language; describe declining neutrally ("Continue Without Personalized Ads?", ads "won't be personalized", "you can turn it on anytime under Settings → Privacy & Security → Tracking"). If a mascot is ever added to this screen, use a calm/neutral pose (thumbs-up), never the celebrate pose. The component and `TrackingConsentGate.test.tsx` pin these exact user-facing strings in lockstep — change both together or the test fails. The "higher-paying offers" line in the subtitle was deliberately left as descriptive (not a penalty) and was not approved for change.
