---
name: CashClip dual points-per-dollar rates
description: Two intentionally different points→dollar rates coexist — the owner display model vs the server economy. Don't "fix" the mismatch.
---

# CashClip has TWO points-per-dollar rates on purpose

- **Display model = 10,000 pts = $1.** Used ONLY for what the UI shows the user:
  mission card point values, profile lifetime-points figure, profile level
  thresholds, and "Money Maker"-style achievement unlocks. Encoded as a local
  `DISPLAY_POINTS_PER_DOLLAR = 10000` const in `storage.ts` and `profile.tsx`.
- **Server economy = 1,000 pts = $1** (`POINTS_PER_DOLLAR` in `earn-client.ts`)
  plus the server-authoritative floating rate in `api-server/lib/pointsEconomy.ts`
  (each earn token snapshots its own usd/pt at earn time). This is the REAL cash
  conversion used for balances and withdrawals.

**Why:** the owner wanted bigger, more motivating point numbers on earning
surfaces (Phase 3 "feature rebalancing") without changing the actual cash anyone
is owed. So display points were scaled 10x purely for presentation; the money math
underneath was left untouched. Reconciling the two rates into one is a separate,
deliberately deferred task — do NOT collapse them while doing display work.

**How to apply:**
- Mission rewards are stored in DISPLAY points. When crediting the *local*
  optimistic dollar balance, divide by `DISPLAY_POINTS_PER_DOLLAR` so the local $
  balance stays identical to before the points rescale.
- Profile lifetime points = server `totalEarned` (dollars) × `DISPLAY_POINTS_PER_DOLLAR`.
- Server-issued earn tokens (checkin/spin/ad/survey_profile bonus, etc.) use the
  SERVER economy, not the display rate. Never multiply token points by 10.
- Mission claims (`mission_daily`/`mission_weekly`) are still local-only — the
  server rejects those actionTypes (no verifiable proof) pending a real
  `/api/missions/claim` endpoint. Don't wire mission claims to the earn-token API.
