---
name: Unity mediation restructuring plan (CashClip)
description: The owner-defined 4-part plan to get Unity (and ironSource/Pangle) actually serving ads. Follow this order; do NOT re-litigate the build-29 caveat every time.
---

# Unity restructuring — owner's 4-part plan (Jun 2026)

The owner ("papi") drove this scope himself. When Unity comes up, EXECUTE this —
do not re-ask which part, and do not keep repeating the "needs a new build" point.
He already knows it. The 4 parts, in order:

1. **Game ID verification** — confirm Unity Game IDs are correct and verified in
   AdMob's mediation source config. Owner-attested IDs: **iOS `6110340`,
   Android `6110341`**; Unity org core ID `2475979924671`.
2. **Units remaking** — rebuild the AdMob ad units cleanly. App's current AdMob
   app id `ca-app-pub-8679658921848348~6212139107`; ad units live in
   `artifacts/cashclip/lib/admob.ts` (`AD_UNITS`: rewarded/interstitial/banner/
   native). If units are recreated in AdMob, the new IDs MUST be updated there.
3. **Placements** — Unity-side placements for each format (Rewarded, Interstitial,
   Banner). Note: Interstitial_iOS was NOT attached as of the last check.
4. **Mediation** — AdMob mediation groups: add Unity + ironSource + Pangle as ad
   sources to EACH ad unit (rewarded, interstitial, banner). "All of them are
   being changed" (owner). Parts 1–3 mostly happen in the Unity + AdMob dashboards
   (guide ONE step at a time, wait for confirmation each time).

## State that's already DONE (don't re-diagnose as missing)
- The native adapters ARE wired into the **build-39** config:
  iOS `extraPods` (`GoogleMobileAdsMediationUnity/IronSource/Pangle`) via
  expo-build-properties + custom Android plugins
  (`plugins/withAndroidUnityAdapter.js` etc., Unity adapter `4.13.0.0`).
- **app.json is set for the NEXT build**: buildNumber 39 / versionCode 39 /
  version 1.1.0 / runtimeVersion 1.1.0. LIVE App Store build is still **29**
  (runtime 1.0.0), which has NO adapters — so Unity revenue only starts once a
  build containing the adapters (39) is approved + live. This is known; state it
  ONCE if needed, then move on with the dashboard restructuring (it's valid prep
  that the new build needs anyway).

**Why this file exists:** the owner got frustrated that the plan kept getting
re-asked/re-explained instead of executed. Treat this as the source of truth for
the Unity effort and just drive the steps.

## Units "from scratch" rebuild (decided Jun 7, 2026)

Owner wants ALL AdMob ad units **remade from scratch** — one clean unit per
format per platform, matched end-to-end: app request ("recepting") → bidding
(Unity/ironSource/Pangle) → reporting. Target set = the 4 types the app actually
requests (rewarded, interstitial, banner, native). Unity has **no Native** ad
type, so Native stays AdMob-only (no Unity/ironSource/Pangle bid on it).

**Current messy state (from AdMob screenshots Jun 7):**
- Duplicate iOS units mapped to the same Unity placement: Banner = "Bees" +
  "CashClip Ban…"; Interstitial = "CashClip Inter…" + "Set Paced"; Rewarded =
  "CashClip Rew…" + "Viewers Choice". Strays to delete once clean set is live.
- "App Open iOS" mediation group is empty (no source, —/— earnings); app serves
  no app-open ads. Remove it.
- Android barely wired: only `Rewarded_Android` mapped, no Banner/Interstitial;
  Android Unity store ID "Not configured".

## CORRECTION: AdMob Unity mapping REQUIRES a Placement ID (even for bidding)

Confirmed in AdMob UI Jun 7, 2026: the Unity Ads (bidding) ad-unit mapping has a
**Placement ID field marked "This field is required"** — Game ID alone is NOT
enough, contrary to the "bidding needs only Game ID" assumption. Do NOT tell the
owner placement is optional for Unity bidding. The Placement ID comes from the
Unity dashboard (Monetize → the iOS project, Game ID 6110340 → Ad Units /
Placements). Unity's default rewarded placement is commonly named `Rewarded_iOS`
but read the owner's REAL one from his Unity dashboard — never fabricate it.

## New clean unit IDs as created (NOT in app code yet — held per guardrail)

App ID (iOS): `ca-app-pub-8679658921848348~6212139107`

| Unit | New ad unit ID | Status |
|------|----------------|--------|
| CashClip_Rewarded_iOS | `ca-app-pub-8679658921848348/6536378948` | DONE Jun 7: clean unit + mediation group "CashClip_Rewarded_iOS" SAVED (priority 1) with 3 bidding sources: AdMob Network + Unity Ads (Game 6110340 / placement Rewarded_iOS) + ironSource (App Key 2690d87e5 / instance 24953583). Pangle DEFERRED. |

**Pangle deferred (Jun 7):** owner has NO Pangle *publisher* account — he confused TikTok-for-Business (advertiser side) with Pangle (publisher side, pangle.io). Adding Pangle as the 4th bidder needs its own onboarding (sign up at pangle.io → add the iOS app → create rewarded slot → wait for approval) before the AdMob "App ID + Slot ID" mapping fields can be filled. Its own future session; the unit is fully functional with 3 bidders meanwhile.

**Owner comms guardrail (Jun 7):** he got frustrated and said to STOP telling him "needs a new App Store version / build 39" — he's heard it enough. Don't repeat the build-39 caveat unprompted. Just execute the dashboard work.

**Mediation group recovery note:** a half-built "New mediation group" looks LOST if you Cancel before the final Save (header stays "New mediation group", group not in the list). It's recoverable: the ad UNIT and the per-source mappings (Unity/ironSource) are saved at ACCOUNT level, so re-creating the group → "Add ad source" → Bidding tab auto-lists the saved mappings pre-checked → Add → Save. Confirm a save really stuck by checking the Mediation groups LIST (greyed Save button alone is ambiguous).

(Old/live Rewarded iOS still in `lib/admob.ts` = `/7282036986` — the live earner; leave it until new unit is fully built + verified, ideally shipped with build 39.)

**🚨 MONEY GUARDRAIL — do NOT violate:** the live **Rewarded iOS** unit is
actively earning on build 29 (~$37 / 7d and climbing as of Jun 7). The ad-unit
ID strings live in `artifacts/cashclip/lib/admob.ts` (`AD_UNITS`) and are JS, so
they *can* be changed via OTA to build 29 — which makes it dangerously easy to
break live revenue. Rule: **build the new units alongside the old, verify them,
and only repoint the app once proven** — ideally ship the new IDs with build 39
(which also has the Unity adapters). Never delete/repoint the working live unit
on a guess. Unity fill itself still requires build 39 live (29 has no adapter);
new units on build 29 serve AdMob-base only.
