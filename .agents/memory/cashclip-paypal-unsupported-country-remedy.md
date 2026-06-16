---
name: PayPal-unsupported country payout remedy
description: How CashClip handles users who earned a balance but live where PayPal can't pay (e.g. Iraq) — owner-approved reconciliation pattern.
---

# PayPal-unsupported country payout remedy

PayPal is CashClip's ONLY in-app payout rail. Users in countries PayPal doesn't
serve (e.g. Iraq — sanctions/compliance/banking, not the user's fault) cannot be
paid through the app. Their withdrawal attempt fails with PayPal webhook
`PAYMENT.PAYOUTS-ITEM.FAILED`; the server auto-writes a `withdrawal_refund`
ledger entry so their balance is restored (no money lost, nothing stuck).

**Owner-approved remedy (manual, his action — money moves are his):**
1. Owner manually sends an equivalent gift card (Amazon eGift) to the user. Ask
   the user WHICH regional Amazon they use first — a `.com` (US) card may not
   redeem on a foreign Amazon (e.g. `.ae`). Send the card to support@ first so
   the owner holds the code, then FORWARD that Amazon email to the user (do NOT
   tap "Apply to your Amazon Account" — that loads it onto the owner's account).
2. Settle the in-app balance to $0 so the user can't be double-paid: `/sc-portal`
   → CashClip Users → find user → "Apply Credit / Correction" with a NEGATIVE
   amount equal to current balance (or the "Zero Balance" button). The **reason
   field is REQUIRED** (`/api/admin/credit` rejects empty notes). Writes a
   `type='adjustment'` ledger entry + emails a receipt.

**Why:** keeps the books honest and attributable while still treating an honest,
loyal user with dignity instead of just closing the ticket. Gift-card cost is the
owner's personal choice (he used Amex points = $0).

**How to verify:** read-only `executeSql` against PRODUCTION — confirm
`users.balance = 0` AND an `adjustment` row in `earnings_ledger`. Note: the admin
write commits a beat after the click; if a verification read shows the old
balance, re-read a few seconds later before reporting (don't report a stale read).
