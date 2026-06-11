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

## The AdMob-ready branch must ALSO credit via begin/complete (the real live bug)
**Jun 2026 — zero `rewarded_ad` credits in 14 days on live build 29.** Root cause:
on build 29 AdMob fills, so the watch handlers always took the `showRewardedAd()`
branch and `return`ed, crediting ONLY via Google SSV — and SSV callbacks aren't
landing in prod. The begin/complete fallback was gated behind "AdMob NOT ready",
so on the live build it never ran → nothing credited.
**Fix:** in the AdMob-ready branch of BOTH `app/(tabs)/index.tsx` and
`app/(tabs)/earn.tsx`, call `beginAdView()` BEFORE `showRewardedAd()`, and on a
rewarded result call `completeAdView(begin.challengeToken, "Watched video")` to
credit via the reliable server path. Server enforces AD_CHALLENGE_MIN_MS=4000
(a real ad always exceeds it) and SPIN_CHALLENGE_TTL_MS=60000 (challenge expires
in 60s — slow ad loads can drop a credit; acceptable). Double-credit risk is low
while SSV credits zero, and both paths share the rewarded_ad daily cap anyway; if
SSV ever resumes, watch for dual-path over-credit.
**Lesson:** never let a rewarded-watch path depend SOLELY on SSV — always route
the completion through the server begin/complete credit too.

## SUPERSEDED Jun 11 2026 — the begin/complete fallback is now DISABLED server-side (410)
The fallback described above is no longer live. `POST /api/earn/ad/begin`,
`/api/earn/ad/complete`, AND `/api/earn/game/begin|complete` all return **410
permanently** in `artifacts/api-server/src/routes/earnings.ts` (~lines 700-732).
**Why:** anti-fraud / threat-model call — a client-timed begin→complete ceremony
is NOT trusted proof an ad impression actually happened, so it was removed; ad
rewards are meant to credit ONLY via the ECDSA-signed AdMob SSV callback
(`GET /api/admob/ssv`). **Consequence (the live bug papi reports on V29):** the
home screen's 25 video cards (`LIVE_AD_SLOTS = AD_CARD_COUNT = 25` in
`app/(tabs)/index.tsx`) credit NOTHING on any watch — the client still calls
`beginAdView()` but gets 410 (`begin.ok=false`), so `completeAdView()` is skipped,
and SSV callbacks aren't landing in prod → zero `rewarded_ad` credits.
**How to apply:** to make watches pay again, owner must choose ONE path (needs API
republish either way): (a) **fix real SSV** — the correct money path (relates to
the "Real AdMob revenue in admin" follow-up), or (b) **re-enable the small
fallback** — reverts the anti-fraud decision, owner-approved only. Do NOT silently
re-enable the 410 routes; it was an intentional security removal.
