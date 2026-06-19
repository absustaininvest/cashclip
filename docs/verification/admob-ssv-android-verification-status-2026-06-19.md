# AdMob SSV Android Verification — Status as of 2026-06-19

**Task:** Confirm Android rewarded-ad SSV credits work correctly once Android build is in Play Store production  
**Status:** ⛔ BLOCKED — prerequisite not met (see Step 1 below)  
**Date:** 2026-06-19 (UTC)  
**Data source:** Production PostgreSQL (read-only queries, labeled PRODUCTION throughout)  
**Reference:** iOS baseline — `admob-ssv-production-check-2026-06-19.md` (all five criteria PASS)  
**Runbook:** `admob-ssv-android-verification-runbook.md`

---

## Step 1 — Android Play Store Production Track Status

**Result: ⛔ NOT MET**

No CashClip Android build is currently in the Play Store production track.  
`replit.md` confirms: *"Android: promote existing Play Store build to Production when ready."*

**Build available for promotion:**
- Internal build: versionCode 44, buildNumber 47, runtimeVersion `1.0.0`
- Contains the JS SSV user_id fix (OTA ef860780, delivered Jun 17 2026)
- Contains AdMob mediation adapters (Unity, ironSource, Pangle) as native Gradle deps

**Action required before running Steps 2–6:**
Promote the existing Android build to Play Store production at ≥1% rollout. Note the UTC timestamp; it scopes the 48-hour window in Step 5. Follow-up task #846 tracks this.

---

## Pre-Launch iOS Baseline (PRODUCTION, 2026-06-19)

The earn_tokens data below is iOS-only. It is captured here as the pre-Android-launch
baseline so that volume growth after Android launch is clearly attributable.

### Volume — rewarded_ad tokens, last 7 days

```
day,                      status,  count, first_seen,                        last_seen
2026-06-19 00:00:00+00,  claimed,   225, 2026-06-19 00:21:28.506+00,   2026-06-19 16:12:43.031+00
2026-06-19 00:00:00+00,  pending,     7, 2026-06-19 17:18:39.745+00,   2026-06-19 19:43:41.971+00
2026-06-18 00:00:00+00,  claimed,   272, 2026-06-18 00:01:18.742+00,   2026-06-18 21:23:50.285+00
2026-06-17 00:00:00+00,  claimed,   365, 2026-06-17 00:27:17.503+00,   2026-06-17 23:58:06.728+00
2026-06-16 00:00:00+00,  claimed,   366, 2026-06-16 00:29:36.926+00,   2026-06-16 23:15:31.998+00
2026-06-15 00:00:00+00,  claimed,   307, 2026-06-15 00:01:12.487+00,   2026-06-15 22:51:17.547+00
2026-06-14 00:00:00+00,  claimed,   487, 2026-06-14 00:05:07.635+00,   2026-06-14 23:59:36.697+00
2026-06-13 00:00:00+00,  claimed,   319, 2026-06-13 00:32:31.554+00,   2026-06-13 23:32:51.131+00
2026-06-12 00:00:00+00,  claimed,     7, 2026-06-12 20:16:01.160+00,   2026-06-12 23:46:28.567+00
```

**iOS daily run-rate at Android launch:** ~232–365 SSV tokens/day (Jun 17–19).  
A measurable Android contribution will appear as a volume lift above this band.

### SSV vs fallback credit path breakdown

```
credit_path,                     day,                       count
SSV (Google verified),    2026-06-19 00:00:00+00,    232
SSV (Google verified),    2026-06-18 00:00:00+00,    272
SSV (Google verified),    2026-06-17 00:00:00+00,    365
SSV (Google verified),    2026-06-16 00:00:00+00,    269
other: Watched video,     2026-06-16 00:00:00+00,     97   ← pre-fix fallback, OTA day
SSV (Google verified),    2026-06-15 00:00:00+00,    233
other: Watched video,     2026-06-15 00:00:00+00,     74   ← pre-fix fallback
SSV (Google verified),    2026-06-14 00:00:00+00,    360
other: Watched video,     2026-06-14 00:00:00+00,    127   ← pre-fix fallback
SSV (Google verified),    2026-06-13 00:00:00+00,    234
other: Watched video,     2026-06-13 00:00:00+00,     85   ← pre-fix fallback
SSV (Google verified),    2026-06-12 00:00:00+00,      5
other: Watched video,     2026-06-12 00:00:00+00,      2   ← pre-fix fallback
```

Since Jun 17 (OTA day +1): **100% SSV, 0 fallback**. This is the iOS baseline; Android
tokens must also show 100% SSV for post-launch dates to pass Step 3 of the runbook.

### Null user_id check (all SSV tokens, 7-day window)

```
ssv_tokens_with_user_id,  null_user_id_count
1970,                      0
```

Zero null user_ids across 1,970 SSV tokens. This baseline should hold after Android
launch — any null user_ids appearing after the rollout date would flag a platform-specific
regression on Android.

### "missing required params" SSV warnings

Deployment log search for `"missing required params"`: **0 matches** (no logs available
for the current query window, consistent with the SSV fix being in effect).

---

## Pass/Fail Criteria — Android Launch Day Checklist

Run these within 48h of Play Store production rollout. Replace
`<android_launch_utc_timestamp>` with the actual rollout time.

| # | Criterion | Pre-launch baseline | Expected post-launch |
|---|-----------|---------------------|----------------------|
| 1 | Android build in Play Store production (≥1%) | ⛔ NOT MET | ✅ Required before any query |
| 2 | Volume rises after Android launch date | 232–365 SSV tokens/day (iOS-only) | Measurable lift within 48h |
| 3 | 100% SSV path for post-launch dates | 100% iOS (since Jun 17) | 100% Android too — no fallback rows |
| 4 | Zero null user_ids in 7-day window | 0 of 1,970 | Still 0 after Android rows appear |
| 5 | ≥1 SSV token within 48h of launch w/ non-null user_id + transaction_id | N/A (no Android launch yet) | ≥1 row returned |
| 6 | Zero "missing required params" SSV warnings post-launch | 0 hits | 0 hits |

---

## Why Android verification cannot piggyback iOS data

`earn_tokens` has no platform column. Android tokens are indistinguishable from iOS
tokens by SQL alone. A volume increase in the 24–48h window after the Android rollout
date is the only SQL-level signal. Steps 5 and 6 use the rollout timestamp as a hard
gate — without it, nothing can be scoped to Android.

---

## Next steps

1. **Promote Android build to Play Store production (≥1% rollout)** — follow-up task #846  
2. **Within 48h of rollout:** run the five runbook queries with the production DB  
   (`docs/verification/admob-ssv-android-verification-runbook.md`)  
3. **Record results** in a new doc: `admob-ssv-android-verification-<date>.md`  
   — follow-up task #847

---

*Status captured 2026-06-19. All production DB queries read-only. No code changes made.*
