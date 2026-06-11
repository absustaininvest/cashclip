---
name: CashClip pending→convert timers
description: The two different clocks behind pending points; what's a fraud control vs. tunable, and which the UI label must match.
---

# CashClip pending points: two separate clocks

There are TWO unrelated time values; users (and the owner) confused them as "3h vs 2h fighting."

1. **Per-token 3-hour hold** (`PENDING_WINDOW_MS = 3h`, earnings.ts): a token's `claimableAt = earnedAt + 3h`. This is an anti-fraud hold — points can't convert until 3h after earning. **Keep it; it's a security/fraud control**, not a bug.
2. **Auto-convert sweep interval** (`AUTO_CONVERT_INTERVAL_MS`, earnings.ts): a singleton cron that sweeps ALL users' tokens already past their 3h hold and credits balance. Originally every 2h; lowered to **30 min** (Jun 2026) so points convert promptly after the hold clears. This interval is freely tunable — it does NOT change how long a user waits, only how often the sweep fires.

**Rule:** the user-facing pending-card label (`autoConverts` in i18n) must describe the **3-hour hold the user actually experiences**, NOT the sweep interval. Saying "Auto-converts every 2 hours" was misleading because it advertised the cron frequency, not the wait. It now reads "Auto-converts ~3 hours after earning" (EN) / "Se convierte ~3 horas después de ganar" (ES).

**Why:** owner got customer complaints about pending points; the only real defect was the mislabeled card — points always converted correctly. Don't "fix" by lowering the 3h hold (fraud control). Manual `POST /api/earnings/claim` ("Convert Now") still converts instantly once past the 3h hold.
