---
name: AdMob rewarded-ad crediting (SSV)
description: Why rewarded ads can show but never credit, and the rules that keep crediting correct and per-user.
---

# Rewarded ads credit ONLY via Google's server-side verification (SSV)

In CashClip the ONLY path that credits a rewarded-ad reward is Google's SSV
server callback to the API. The client-side "I watched an ad" report is rejected
on purpose (anti-fraud) — so if the SSV callback can't identify the user, the ad
plays fine but **nobody gets paid**. This was the real-world "rewards not
crediting" complaint on the live build.

**Root cause class:** the ad request was created without an SSV user id, so
Google's callback arrived with an empty `user_id` and the server (correctly)
credited no one.

## Rules to keep it correct

- The rewarded-ad request MUST carry the logged-in user's id as the SSV user id
  (`serverSideVerificationOptions.userId` in `react-native-google-mobile-ads`).
  No id → no credit.
- Set that identity **centrally at the auth layer**, not per-screen. More than one
  screen shows rewarded ads, and an ad can be preloaded before any screen mounts,
  so a single screen setting it is too late / incomplete.
- The preload cache is dangerous across identity changes. A cached ad is bound to
  the user it was requested for. Never serve a cached ad whose bound id is `null`
  (uncreditable) or differs from the current user (credits the WRONG account).
  On login/logout/user-switch, discard the cache; and use a generation counter so
  an in-flight preload that finishes AFTER the identity changed is dropped, not
  cached.
- Don't show a rewarded ad at all when the user id is unknown — burning an
  impression that can never be credited is worse than skipping it.

**Why:** missed credits and cross-account misattribution are both money-integrity
bugs and both come from the same place — the SSV identity not matching the user
who actually watched the ad.

**OTA note:** this whole fix is JS-only (no native change), so it ships to an
already-released build via an expo-updates OTA without bumping runtimeVersion.
