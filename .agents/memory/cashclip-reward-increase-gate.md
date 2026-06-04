---
name: CashClip daily-reward increase gate
description: Why the per-action point rewards stay on the conservative floor amounts and what must be true before raising them.
---

# Raising CashClip daily rewards is gated on real data + owner approval

The per-action point amounts (`ACTION_CONFIG`, `SPIN_POOL`, `GAME_POOL` in
`artifacts/api-server/src/routes/earnings.ts`) sit on the deliberately
conservative "floor" set. There is a standing idea to raise them toward a
"middle" (~2.5x) or "restore/full" (~5x, pre-cut value) target to improve
retention.

**Decision (Jun 4, 2026): HOLD — do not raise yet.**

**Why:**
- Production was still soft-launch: ~12 users total, only ~5 had ever earned
  points (over ~9 days), 1 lifetime withdrawal ($3). Busiest user-day was
  ~$1.30 — everyone far under the $5/day cap. Far too little volume to *prove*
  payout sustainability at scale.
- The ad-revenue figure feeding the conversion rate is still the per-reward
  PROXY ($0.012/ad), not real AdMob mediation revenue. Raising rewards on
  proxy revenue is a guess, not a proven-safe move. (Real-revenue swap is a
  separate open task.)
- Owner rule: every money-moving change needs explicit approval first. When
  asked, the owner explicitly chose to hold.

**How to apply:** Before proposing a reward increase again, confirm BOTH
(1) meaningful live traffic exists, and (2) the conversion rate is driven by
real per-impression ad revenue (proxy retired). Then get explicit owner
approval and re-confirm the $5/day cap + floating-rate backstop still bind at
the new amounts (at the ceiling rate, middle/restore would otherwise exceed
$5/day and lean entirely on the cap).

**Fast precondition check (use prod read-only):** the tell that the proxy is
STILL live is that `conversion_rates.revenue_usd` equals exactly
`count(ad_events where event='reward_earned' in window) × 0.012`. When that
identity holds, precondition (2) is unmet — do not raise. Re-verified on a
prod replica and it still held (revenue_usd 4.344 = 362 × 0.012) with only ~5
lifetime earners / ~12 users, so the HOLD stands unchanged.
