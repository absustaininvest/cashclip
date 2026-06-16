---
name: CashClip banner ads (native-only)
description: Banner ad format constraints, collapse-to-zero pattern, and what can/can't be verified in the workspace.
---

# CashClip banner ads

Banners are a **native AdMob format**: they render only in an EAS native build,
never in Expo Go, the web preview, or the workspace. The web variants
(`components/InFeedBanner.tsx`, `components/BackgroundBanner.tsx`) are intentional
no-op stubs returning `null`; the real logic lives in the `.native.tsx` siblings.

**Collapse-to-zero requirement:** an unfilled `<BannerAd>` still reserves its
native pixel height (BANNER = 320×50), which pushes/overlaps surrounding content.
Both native banner components must wrap the `<BannerAd>` and apply a
`hidden` style (`height: 0` + `overflow: "hidden"`, plus zeroing any margin) while
`!visible`, flipping `visible` on `onAdLoaded` and back on `onAdFailedToLoad`.
The ad still loads while clipped, then reveals itself. InFeedBanner originally
lacked this and left an empty gap; it was aligned to BackgroundBanner's pattern.

**Why:** the task acceptance criterion is "collapse to zero height when no ad
fills" — a label-only hide is not enough.

**How to apply:** when adding/auditing any banner placement, confirm the wrapper
collapses to zero height on no-fill. Placements live at:
`app/(tabs)/index.tsx` (in-feed, Home), `app/game/_layout.tsx` + `app/games.tsx`
(anchored, bottom of game screens).

**Cannot be verified here:** actual fill, on-device layout, and AdMob dashboard
impressions need a real EAS build on a physical device — out of reach of the
workspace. Do NOT autonomously trigger an EAS build to "verify" (owner manages
ad-revenue wiring one step at a time). Banners share no state with the rewarded
flow (`lib/admob.ts` `showRewardedAd`), so they don't affect reward crediting.
