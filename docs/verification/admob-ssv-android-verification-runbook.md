# AdMob SSV Android Verification Runbook

**Purpose:** Confirm rewarded-ad rewards credit correctly on Android once the first Android build ships to Play Store production.  
**Prerequisite:** Android build in Play Store production track (not just internal/beta). Do not run these queries before that.  
**Reference:** iOS verification completed Jun 19 2026 — see `admob-ssv-production-check-2026-06-19.md` for the baseline.

---

## Context

The SSV `user_id` fix (OTA ef860780, delivered Jun 17 2026) is pure JS — the same `admob.ts` code runs on both iOS and Android. There are no Android-specific branches in the SSV user_id path. The server-side SSV handler (`earnings.ts`) is also platform-agnostic.

**What the fix does (recap):**
- `setAdMobUserId(userId)` discards any ad preloaded before auth settled (when `ssvUserId` was null) and kicks off a fresh preload with the real user ID.
- `isPreloadedAdValid()` enforces a hard equality check: the preloaded ad's `userId` must match `ssvUserId` exactly and not be null.
- `showRewardedAd()` guards with `if (!ssvUserId) return { rewarded: false }`.

The Android mediation adapters (Unity, ironSource, Pangle — Gradle deps in the native build) are native-only and cannot be delivered via OTA, so they only exist in builds ≥ buildNumber 47 (versionCode 44+).

---

## Step 1 — Confirm an Android build is live

Before running any queries, verify:
- Play Store Console → Production track → a CashClip build is rolled out to ≥1% of Android users
- Note the rollout date/time (UTC) — used to scope the 48h window in Step 4

---

## Step 2 — Daily rewarded_ad volume by platform

After 48h from Play Store production rollout, run against the production DB:

```sql
SELECT
  date_trunc('day', earned_at) AS day,
  COALESCE(platform, 'unknown') AS platform,
  status,
  COUNT(*) AS count,
  MIN(earned_at) AS first_seen,
  MAX(earned_at) AS last_seen
FROM earn_tokens
WHERE action_type = 'rewarded_ad'
  AND earned_at >= NOW() - INTERVAL '7 days'
GROUP BY 1, 2, 3
ORDER BY 1 DESC, 2, 3;
```

**Expected:**
- Rows with `platform = 'ios'` appear throughout (established iOS baseline).
- Rows with `platform = 'android'` begin appearing from the Android launch date onward.
- `platform = 'unknown'` covers legacy tokens issued before the platform column was added (Jun 19 2026); no new unknowns should appear after that date.

**Note:** The `platform` column is set from the AdMob SSV `custom_data` param, which the client populates via `serverSideVerificationOptions.customData = Platform.OS`. Tokens issued via the begin/complete fallback path do not carry a platform tag (they remain `null`/unknown).

---

## Step 3 — SSV vs fallback path breakdown

```sql
SELECT
  CASE
    WHEN description ILIKE '%SSV verified%' THEN 'SSV (Google verified)'
    WHEN description ILIKE '%begin/complete%' THEN 'fallback (begin/complete)'
    ELSE 'other: ' || LEFT(description, 40)
  END AS credit_path,
  date_trunc('day', earned_at) AS day,
  COUNT(*) AS count
FROM earn_tokens
WHERE action_type = 'rewarded_ad'
  AND earned_at >= NOW() - INTERVAL '7 days'
GROUP BY 1, 2
ORDER BY 2 DESC, 3 DESC;
```

**Expected:** 100% of new tokens show `SSV (Google verified)`. No `fallback (begin/complete)` or `other: Watched video` rows for post-launch dates.  
**Fail signal:** Any non-SSV rows appearing after the Android launch date would indicate the Android build is preloading ads before auth settles (the same bug the fix addressed on iOS).

---

## Step 4 — Null user_id check (7-day window)

```sql
SELECT
  COUNT(*) AS ssv_tokens_with_user_id,
  COUNT(*) FILTER (WHERE user_id IS NULL) AS null_user_id_count
FROM earn_tokens
WHERE action_type = 'rewarded_ad'
  AND description ILIKE '%SSV verified%'
  AND earned_at >= NOW() - INTERVAL '7 days';
```

**Expected:** `null_user_id_count = 0`.  
**Fail signal:** Any null user_ids would mean the Android build is sending SSV callbacks before `setAdMobUserId` is called with a real user ID.

---

## Step 5 — At least one SSV token within 48h of Android launch

```sql
SELECT
  id,
  LEFT(user_id::text, 8) || '...' AS user_id_prefix,
  description,
  transaction_id IS NOT NULL AS has_transaction_id,
  earned_at,
  status
FROM earn_tokens
WHERE action_type = 'rewarded_ad'
  AND description ILIKE '%SSV verified%'
  AND earned_at >= '<android_launch_utc_timestamp>'::timestamptz
  AND earned_at <  '<android_launch_utc_timestamp>'::timestamptz + INTERVAL '48 hours'
ORDER BY earned_at DESC
LIMIT 10;
```

Replace `<android_launch_utc_timestamp>` with the Play Store production rollout timestamp (e.g. `'2026-07-01 00:00:00+00'`).

**Expected:**
- At least 1 row returned within 48h of Android launch
- `user_id_prefix` is non-null for every row
- `has_transaction_id = true` for every row

---

## Step 6 — No "missing required params" SSV warnings

Query deployment logs for the 48h window after Android launch:

```
pattern: "missing required params"
```

**Expected:** Zero matches in the window after Android launch.  
**Fail signal:** Any hits indicate the Android build is firing SSV callbacks before `setAdMobUserId` has been called, causing the server to reject the reward. The SSV handler returns `200 OK` on missing params (to prevent Google from retrying) but logs a warning and does not issue a token.

---

## Pass / Fail Criteria

| Criterion | Pass |
|-----------|------|
| Volume rises after Android launch date | Measurable increase within 48h |
| SSV vs fallback breakdown | 100% SSV for post-launch dates |
| Null user_id count | 0 |
| Token within 48h of launch | ≥1 row, non-null user_id, has_transaction_id=true |
| "missing required params" warnings | 0 in post-launch window |

If all five pass, the Android SSV flow is confirmed correct. No code changes should be needed — the fix is already in the shipped JS.

---

## If a criterion fails

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Null user_ids appearing | `setAdMobUserId` not called before first ad show | Check `AuthContext.tsx` — `setAdMobUserId(userId)` should be called on every `userId` change |
| Fallback tokens appearing | `showRewardedAd` returning `false` due to stale preload not being refreshed | Check `isPreloadedAdValid()` and `preloadGeneration` logic in `admob.ts` |
| No volume increase after 48h | Android users haven't watched ads, or Play Store rollout is very small | Wait longer or check rollout percentage |
| "missing required params" warnings | Android build is an older version without the fix | Confirm Play Store build version includes OTA ef860780 or later |

---

*Runbook prepared Jun 19 2026. iOS baseline confirmed same day — see `admob-ssv-production-check-2026-06-19.md`.*
