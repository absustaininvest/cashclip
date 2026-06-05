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

## Diagnosing "rewarded ads still don't pay": client-identity vs Google-not-calling

Two distinct failure modes — separate them with **production logs**, because the
SSV handler logs on EVERY outcome (success and each rejection):

- **If `/api/admob/ssv` lines appear** with "unknown user" / "missing required
  params" → Google IS calling but the user id is empty/unmatched → client
  identity problem (see rules above).
- **If there are ZERO `/api/admob/ssv` lines at all** (despite normal `/api/*`
  traffic and `POST /api/ad-events/batch` ad activity) → **Google is not calling
  the callback at all.** The code is fine; the fix is in the **AdMob console**.

**Most common root cause = the Server-side verification callback URL is not set
(or is wrong) on the rewarded ad UNIT in the AdMob console.** There is NO way to
set the base callback URL from client code — only the per-impression `userId` is
sent from the app. The base URL must be configured per ad unit in:
AdMob → Apps → CashClip → Ad units → Rewarded unit `ca-app-pub-8679658921848348/7282036986`
→ Server-side verification → callback URL = `https://api.cash-clip.app/api/admob/ssv`.

**Why:** verified Jun 2026 — endpoint returns `200 OK` in ~0.27s on BOTH
`api.cash-clip.app` and `cash-clip.replit.app`, client sets `serverSideVerificationOptions.userId`
centrally, real units in use (app id `ca-app-pub-8679658921848348~6212139107`),
yet prod logs showed zero SSV hits → console URL was never wired. A reachable
endpoint + correct client is useless if the console URL is blank.
