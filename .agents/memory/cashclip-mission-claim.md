---
name: CashClip server-verified mission claim
description: How daily/weekly mission rewards are credited server-side and why some missions can't be claimed.
---

# CashClip mission rewards are server-verified (not local)

Mission points are issued by `POST /api/missions/claim`, which recomputes each
mission's completion from TRUSTED server records at claim time — never from a
client claim. An earn token is issued at most once per mission per period.

**Why:** missions previously credited only the local AsyncStorage mock balance
(server `/record` rejects `mission_daily`/`mission_weekly` via SERVER_ONLY_ACTIONS),
so a tampered device could fake progress. The fix mirrors the survey_profile
one-time bonus pattern: trusted signals + idempotent token.

**How it works:**
- Idempotency = a per-mission/period `transactionId` on the earn token
  (`mission:<missionId>:<userId>:<periodKey>`), enforced by the UNIQUE
  `earn_tokens_txn_id_idx`. Claiming twice in a period credits once.
- Reward amount comes from server `ACTION_CONFIG` (mission_daily=100pts,
  mission_weekly=500pts) — flat per period, NOT the cosmetic display reward on the
  mission card. Token cash value is the snapshot floor like every other earn token.
- Trusted signals: daily_checkin/weekly_streak = issued `checkin` tokens;
  watch_ads/weekly_ads = issued `rewarded_ad` tokens (AdMob SSV); daily_spin =
  issued `spin` tokens; weekly_referrals = referred users with
  `referralCreditedAt` this week (same signal that pays the referral bonus).
- Weekly period = 7-day buckets from Jan 1 UTC (matches client getCurrentWeekStartMs).

**Unverifiable missions can't be credited (by design):** `watch_videos`,
`refer_friends`, `weekly_videos` have no server-verifiable signal → `verify: null`
→ endpoint returns 422 `{verifiable:false}` and issues nothing. They were never
credited server-side before either, so this is not a regression. Reworking or
removing them is a product decision, not a bug.

**Client:** `earn-client.claimMission(missionId)` calls the endpoint and stores any
issued token locally (pending wallet). `storage.markMissionClaimed` only flips the
local "claimed" UI flag — it no longer moves any balance (renamed from the old
`claimMissionReward`, which used to do a local `addEarnings`).
