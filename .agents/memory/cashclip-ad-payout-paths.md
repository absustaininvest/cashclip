---
name: CashClip rewarded-ad payout has TWO paths
description: How home/Earn in-app videos credit money — real AdMob SSV vs the secure server-set fallback — and why the client never credits ad rewards directly.
---

# CashClip rewarded-ad payout — two paths, client credits neither directly

`rewarded_ad` is a SERVER_ONLY action: the generic `POST /api/earnings/record`
path rejects it (403). So watching a video can ONLY be credited by one of two
server-observed paths:

1. **Real ad → Google SSV.** AdMob calls `GET /api/admob/ssv` (ECDSA-verified,
   transaction_id dedup, daily cap). This is the real-money path.
2. **In-app fallback → begin/complete challenge.** When AdMob isn't filling, the
   client calls `POST /api/earn/ad/begin` then `/api/earn/ad/complete` (mirrors
   the spin/game flow over the shared `spin_challenges` DB store). The amount is
   fixed server-side (small) and SHARES the rewarded_ad daily cap with SSV, so
   the two paths together can't exceed the per-day cap.

**Why:** on live build 29 the home "mini video players" credited nothing — every
watch hit `/api/earnings/record` (403) and SSV callbacks weren't landing. The
fallback was added (owner-approved, "pay small while we investigate") so videos
pay even when AdMob doesn't fill, without trusting the phone for the amount.

**How to apply:**
- Never credit an ad watch from the client. The real path is SSV; the fallback
  is begin→complete. The old `recordEarnAction("rewarded_ad")` call on the real
  AdMob branch was dead (always 403) and was removed — don't re-add it.
- If you change the fallback amount, it's server-side only (AD_FALLBACK_POINTS in
  earnings.ts). Keep it conservative per the reward-increase gate.
- Both paths write actionType `rewarded_ad`, so missions/caps count them together
  — intended.
- Server route change needs an API republish to reach prod; the client change
  rides OTA onto build 29 (channel `production`, runtimeVersion 1.0.0).
- The separate open question (why SSV callbacks don't land) is NOT fixed by the
  fallback — still investigate that for the real-revenue path.
