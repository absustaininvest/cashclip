---
name: CashClip referral reward enforcement
description: How the referral bonus is actually earned/enforced server-side, and the code==username design choice
---

# CashClip referral enforcement

The referral reward ($0.50 to the referrer) is **server-authoritative** and only granted
once a referred friend completes their first qualifying cash-out (>= $3). It is NOT granted
at sign-up and NOT granted client-side.

## Design decisions (be consistent with these)
- **Referral code == referrer's username.** There is no separate code table. At registration
  a friend enters the referrer's username into `referredBy` (lowercased, already unique).
  `getUserByUsername(referredBy)` resolves the referrer. Do not reintroduce random "CCXXXX" codes.
  **Why:** the old system minted local random codes never synced to the server, so the whole
  referral economy was a client-side mock that paid $0.50 instantly and was trivially exploitable.
- **Qualification = first withdrawal whose tier amount >= the qualify threshold** (default $3,
  tracked as `REFERRAL_QUALIFY_USD`). Crediting is idempotent, guarded by a `referralCreditedAt`
  timestamp on the referred user's row, set under `FOR UPDATE`. The credit fires once, ever.
  **Why:** prevents double-pay on repeat withdrawals and across autoscaled replicas.
- The withdrawal hook is **fire-and-forget after the 201** — it must never block or fail the
  user's own withdrawal response.

## How to apply
- Bonus/threshold live in `withdrawalTiers.ts` (`REFERRAL_BONUS_USD`, `REFERRAL_QUALIFY_USD`).
- Client reads status from `GET /api/referrals` (auth) → returns code(=username), totals,
  pending vs qualified counts, and a **masked** friend list. Client never mints balance; it only
  caches totals for the Profile screen and sets the "weekly_referrals" (Social Butterfly) mission
  progress to the count of friends who qualified *this week*.
- Ledger entries use type `"referral"`, refId = referred user's id.
