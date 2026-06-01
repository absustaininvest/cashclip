---
name: Expo splash-screen launch deadlock
description: Why an Expo app can freeze on the native splash at launch, and the rule that prevents it.
---

# Never gate the native splash hide on a user-interaction step

**Rule:** call `SplashScreen.hideAsync()` as soon as the app can render its first frame
(fonts/assets ready), NOT after a step that requires the user to tap something
(ATT/tracking consent, onboarding, a "Continue" button, etc.).

**Why:** the native splash sits ON TOP of the JS UI until `hideAsync()` runs. If you only
hide it after consent/onboarding "completes," then on a **fresh install** the consent screen
renders *behind* the still-visible splash — the user can't tap it, the completion callback
never fires, and the splash never lifts. Result: app frozen on the logo. This is a textbook
**Apple Guideline 2.1(a)** rejection ("app stuck on splash screen"), and reviewers fresh-install
every time (often on iPad), so it reliably bites review even when returning users are fine.

**How to apply:**
- Hide the splash on `fontsLoaded || fontError` (don't wait on `fontsLoaded` alone either —
  a font load error must not strand the app).
- Keep consent/version/maintenance gates as normal screens that render *after* the splash is gone.
- Any launch-time network check (force-update / maintenance / config) must have a short
  abort timeout and fail **open**, so an unreachable/slow API can't stall the first frame.
- States that render their own full-screen UI instead of children (blocked/maintenance) must
  also be reachable with the splash already hidden — never tie the splash hide to only one branch.
