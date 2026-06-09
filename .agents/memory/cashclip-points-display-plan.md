---
name: CashClip points-display plan (post-launch)
description: Owner-approved plan to surface earn/survey rewards as big POINT numbers (not raw cents) for appeal, while wallet + PayPal stay real cash.
---

# CashClip points-display plan (deferred until after Google Play launch)

**Decision (owner Jorge, Jun 9 2026):** show per-survey / per-action rewards as POINTS
(big, appealing numbers) on the earn/survey/offer screens instead of raw cents.
The Wallet balance and the actual payout stay **real cash to PayPal** — points are a
display layer only, not a currency change.

**Why:** "a normal rational person looks at a survey as 50,000 points — that looks more
appealing than $0.50." Standard rewards-app psychology: big point numbers convert
better; the cash is the payoff. (The 50,000-vs-50¢ figure was illustrative, not a literal
rate.)

**How to apply (when built):**
- Display only. Do NOT change the money economy. Respect the existing dual rate — see
  [cashclip-points-display-rate.md]. Pick a display rate so numbers feel big yet convert
  honestly to the real cash that lands in the wallet.
- Wallet + PayPal cash-out remain in real dollars, unchanged.
- Soften the store-listing copy that currently says "no points, no gift cards, no
  gimmicks" so the points display isn't a contradiction.
- Ships as a JS-only **OTA** onto the live build (no native change). See
  [cashclip-ota-delivery.md].

**Gating:** owner chose **launch-first** — finish the public Google Play launch, THEN ship
this. Needs explicit owner approval before building (his standard rule).
