---
name: AdMob mediation state
description: CashClip AdMob earnings snapshot and mediation group config as of Jun 3 2026; screenshots purged per owner request.
---

## Snapshot date
June 3, 2026 (owner-provided screenshots, now purged from attached_assets/)

## App identity
- Name: CashClip: Earn Real Money
- Platform in AdMob: iOS only (Android not yet added — Play Store still internal testing)
- Status: Ready

## Earnings (as of Jun 3 2026 ~1:43 AM)
| Period | Amount |
|---|---|
| Today so far | $0.04 |
| Yesterday (Jun 2) | $2.34 |
| This month so far | $5.48 |
| Last month (May) | $46.72 |
| Last 7 days by source | $6.90 (+1,303%) |

Requests last 7 days: 860 (+173%). Strong growth spike around May 31–Jun 1 (Colombia promotion start).

## Mediation groups (3 total)
| Priority | Name | Est. earnings (7d) | Impressions (7d) | Notes |
|---|---|---|---|---|
| 1 | Cash-Clip Reward... | — (none) | — (none) | Active/green but ZERO traffic — likely misconfigured or newly created with no matching ad units |
| 2 | CashClip Rewarde... | $6.62 (+1,732%) | 127 (+2,440%) | Doing the heavy lifting |
| — | AdMob (default) | $0.28 (+114%) | 223 (+757%) | Fallback group |

**Action needed**: Investigate Priority 1 group — it has no impressions despite being highest priority. Likely missing ad unit assignments or network adapter config. If broken, it's blocking revenue that should flow to Priority 2.

## Unity Ads mediation status
- Unity Ads SDK baked into build 38 (rejected) as AdMob mediation adapter (GoogleMobileAdsMediationUnity iOS + Gradle Android)
- NOT yet active on live build 29
- Game IDs stored as secrets: UNITY_ADS_GAME_ID_ANDROID, UNITY_ADS_GAME_ID_IOS
- To activate: AdMob dashboard → Mediation → add Unity Ads network to a group → enter Game IDs

## LevelPlay (ironSource)
- App key hardcoded in levelplay.ts: `2690d87e5`
- Handles rewarded video only (separate from AdMob)
- Also only in build 38, not live on build 29
