---
name: AdMob mediation state
description: CashClip AdMob earnings snapshot, mediation groups, ad units, and Unity Ads setup as of Jun 3 2026; all screenshots purged per owner request.
---

## Snapshot date
June 3, 2026 — two batches of screenshots, all purged per owner request.

## App identity (iOS)
- Name: CashClip: Earn Real Money
- App Store ID: 6759931285
- App verification: Verified | Approval status: Ready
- Frequency capping: No cap | High-engagement ads: On

## Earnings (as of Jun 3 ~1:43 AM)
| Period | Amount |
|---|---|
| Today so far | $0.04 |
| Yesterday (Jun 2) | $2.34 |
| This month so far | $5.48 |
| Last month (May) | $46.72 |
| Last 7 days by source | $6.90 (+1,303%) |

Requests last 7 days: 860 (+173%). Spike around May 31–Jun 1 = Colombia promotion start.

## Mediation groups (3 total)
| Priority | Name | Ad unit | Platform | Est. earnings (7d) | Notes |
|---|---|---|---|---|---|
| 1 | Cash-Clip Reward... | CashClip Rewarded Video | **Android** | $0 | Zero traffic = Android not publicly live yet (Play Store internal testing). NOT broken — correct setup. |
| 2 | CashClip Rewarde... | (iOS rewarded) | **iOS** | $6.62 (+1,732%) | Doing all the revenue work. 127 impressions last 7d. |
| — | AdMob (default) | fallback | both | $0.28 | Fallback when groups don't match. |

## Unity Ads status
- **Partnership: Active** ✅ (confirmed in Partnership tab)
- Direct relationship with Unity Ads
- Android: 1 mapping — CashClip Rewarded → Placement ID: `Rewarded_Android` → 1 mediation group, Active ✅
- iOS: 2 mappings configured (detail collapsed in screenshot)
- Bidding sources: AdMob Network (Active) + Unity Ads (Active) both in Priority 1 group

## Unity Ads placement IDs (confirmed Jun 3 2026 from cloud.unity.com)
| Format | iOS Placement ID | Android Placement ID |
|---|---|---|
| Interstitial | `Interstitial_iOS` | `Interstitial_Android` |
| Rewarded | `Rewarded_iOS` | `Rewarded_Android` |
| Banner | `Banner_iOS` | `Banner_Android` |

Game IDs stored in secrets: UNITY_ADS_GAME_ID_IOS (6110340), UNITY_ADS_GAME_ID_ANDROID (6110341)

## iOS ad units (7 total — CashClip: Earn Real Money iOS)
| Ad unit name | Format | Active mediation groups |
|---|---|---|
| Bees | Banner | 0 ← no mediation |
| CashClip App Open | App open | 0 ← no mediation |
| CashClip Banner | Banner | 0 ← no mediation |
| CashClip Interstitial | Interstitial | 0 ← no mediation |
| CashClip Rewarded Video | Rewarded | **1 active** |
| Set Paced | Interstitial | 0 ← no mediation |
| Viewers Choice | Rewarded | **1 active** |

**Gap**: Banner, App Open, and Interstitial iOS units have no mediation groups — only AdMob default fills them. Adding Unity Ads bidding to those groups would increase fill rate and eCPM for those formats.

## Key action items (for owner to do in AdMob)
1. Create mediation groups for iOS Banner + Interstitial ad units and add Unity Ads as bidding source
2. Once Android goes public (promote Play Store build 38 from internal → production), Priority 1 group will start earning

## Important correction (owner-confirmed Jun 3 2026)
Unity Ads SDK (GoogleMobileAdsMediationUnity plugin) IS compiled into build 29 (the live App Store build). Unity Ads is already serving through AdMob mediation for live iOS users right now. No new App Store build is required to activate Unity. Earlier agent notes saying "Unity only in build 38" were wrong.
