---
name: AdMob mediation state
description: CashClip AdMob earnings snapshot, mediation groups, ad units, Unity Ads setup, and step-by-step mediation group creation playbook. All screenshots purged per owner request.
---

## Snapshot date
June 3, 2026 — all screenshots purged per owner request.

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

## Mediation groups (as of Jun 3 2026)
| Priority | Name | Ad units | Platform | Est. earnings (7d) | Notes |
|---|---|---|---|---|---|
| 1 | Cash-Clip Reward... | CashClip Rewarded Video | **Android** | $0 | Zero traffic = Android not publicly live yet (Play Store internal testing). NOT broken — correct setup. |
| 2 | CashClip Rewarde... | (iOS rewarded) | **iOS** | $6.62 (+1,732%) | Doing all the revenue work. 127 impressions last 7d. |
| — | Banner Mediation iOS | Bees + CashClip Banner | **iOS** | — | **COMPLETED Jun 3 2026** — AdMob Network + Unity Ads (bidding) both Active ✅ |
| — | AdMob (default) | fallback | both | $0.28 | Fallback when groups don't match. |

## Unity Ads status
- **Partnership: Active** ✅ (confirmed in Partnership tab)
- Direct relationship with Unity Ads
- Android: 1 mapping — CashClip Rewarded → Placement ID: `Rewarded_Android` → 1 mediation group, Active ✅
- iOS banner: Bees + CashClip Banner both mapped to `Banner_iOS`, Unity Ads Active ✅ (completed Jun 3 2026)
- Bidding sources confirmed working: AdMob Network + Unity Ads both show green Active in Banner Mediation iOS group

## Unity Ads placement IDs (confirmed Jun 3 2026 from cloud.unity.com)
| Format | iOS Placement ID | Android Placement ID |
|---|---|---|
| Interstitial | `Interstitial_iOS` | `Interstitial_Android` |
| Rewarded | `Rewarded_iOS` | `Rewarded_Android` |
| Banner | `Banner_iOS` | `Banner_Android` |

Game IDs stored in secrets: UNITY_ADS_GAME_ID_IOS (6110340), UNITY_ADS_GAME_ID_ANDROID (6110341)

## iOS ad units (7 total — CashClip: Earn Real Money iOS)
| Ad unit name | Format | Mediation status |
|---|---|---|
| Bees | Banner | ✅ Banner Mediation iOS (AdMob + Unity Ads bidding) |
| CashClip Banner | Banner | ✅ Banner Mediation iOS (AdMob + Unity Ads bidding) |
| CashClip Interstitial | Interstitial | ⏳ Pending — create Interstitial Mediation iOS group |
| Set Paced | Interstitial | ⏳ Pending — add to Interstitial Mediation iOS group |
| CashClip App Open | App open | ⏳ Pending — no mediation group yet |
| CashClip Rewarded Video | Rewarded | ✅ Existing rewarded group (iOS, Priority 2) |
| Viewers Choice | Rewarded | ✅ Existing rewarded group (iOS, Priority 2) |

## Step-by-step playbook: Create a new mediation group with Unity Ads bidding
*(Use this for Interstitial Mediation iOS and any future groups)*

1. Go to **AdMob → Mediation** → tap **Create mediation group**
2. Set **Ad format** (e.g. Interstitial), **Platform** (iOS), **Name** (e.g. `Interstitial Mediation iOS`) → Save & continue
3. Under **Ad units** → **Add ad units** → select the matching iOS ad units → Save
4. Under **Ad sources → Bidding** → tap **Add ad source**
5. In the search box type `Unity` → tap **Select** next to Unity Ads (shows Active partnership)
6. In the **Map ad units** dialog:
   - For each ad unit row tap **Add mapping**
   - **Game ID field** (top): type the placement ID (e.g. `Interstitial_iOS`) → "To save this ID, add it to a mapping"
   - Per-row fields: **Mapping name** = leave blank | **Placement ID** = type the placement ID (e.g. `Interstitial_iOS`)
   - Tap Save after each unit
7. Tap **Done** — both AdMob Network and Unity Ads should show green Active
8. Screenshot to confirm, then send to Papi for vault update

## Remaining action items
1. ⏳ **Interstitial Mediation iOS** — create group, add CashClip Interstitial + Set Paced, add Unity Ads bidding (placement: `Interstitial_iOS`)
2. ⏳ **App Open Mediation iOS** — create group, add CashClip App Open, add Unity Ads if they support app-open format
3. ⏳ **Promote Android Play Store** — promote build 38 from Internal testing → Production so Priority 1 rewarded group starts earning

## Important correction (owner-confirmed Jun 3 2026)
Unity Ads SDK (GoogleMobileAdsMediationUnity plugin) IS compiled into build 29 (the live App Store build). Unity Ads is already serving through AdMob mediation for live iOS users right now. No new App Store build is required to activate Unity. Earlier agent notes saying "Unity only in build 38" were wrong.
