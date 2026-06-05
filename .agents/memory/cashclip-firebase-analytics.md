---
name: CashClip Firebase Analytics not wired in
description: Why Firebase shows 0 users despite an iOS app being registered, and what adding it actually requires.
---

Firebase reporting 0 users is EXPECTED, not a bug: the CashClip app binary has no Firebase SDK.
- The app ships the AdMob SDK (`react-native-google-mobile-ads`) only. There is no `@react-native-firebase/*` package, no `GoogleService-Info.plist` / `google-services.json` in the repo, and no analytics/init code.
- AdMob revenue is INDEPENDENT of Firebase — money is unaffected by the missing SDK.

Console state (Jun 2026): Firebase project "CashClip Earn Real Money", project ID `cashclip-earn-real-money`, project number `130785964499`. The iOS app `app.replit.cashclip` IS registered (bundle matches the live app) and its `GoogleService-Info.plist` is downloadable. NO Android app is registered yet.

**Why:** A registered app in the Firebase console only means the console knows the bundle ID; the installed binary still has to embed the SDK + config to send any data. The owner's hunch that "the domain"/bundle ID is the cause is wrong — the bundle ID matches perfectly; the SDK is simply absent.

**How to apply:** Don't chase "Firebase 0 users" as a runtime/domain bug. Wiring Firebase = NATIVE change (SDK + Expo config plugin + plist/json + init/events) → can't OTA; it only starts collecting once a NEW build ships. Never change the live bundle ID `app.replit.cashclip` to "fix" it — that would orphan the published App Store / Play listing.
