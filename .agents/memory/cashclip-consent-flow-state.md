---
name: CashClip consent flow state
description: Current state of TrackingConsentGate, TERMS_KEY storage, ATT re-enable detection, and pending OTA.
---

## Current state (Jun 20 2026)

**File:** `apps/cashclip/components/TrackingConsentGate.tsx`
- TERMS_KEY ("terms_done_v1") lives in **AsyncStorage** (not Keychain/SecureStore)
- Wiped on app deletion → every fresh install triggers full consent flow
- Legacy Keychain keys migrated via `migrateLegacyConsent()` on first run

**ATT re-enable detection (added this session):**
- `lastAttStatusRef` tracks previous ATT status
- AppState listener at step "done": if ATT changes to "authorized" from anything else, calls `acceptDisclosures()` — reinitializes AdMob with personalized ads
- Handles the case: user inside app → goes to Settings → toggles tracking ON → returns

**Stale test deleted:**
- `TrackingConsentGate.test.tsx` was removed — was testing old Keychain TERMS_KEY behavior, picked up by vitest glob `components/**/*.test.tsx`, would have failed

**app.json NSUserTrackingUsageDescription fix:**
- Removed "Your earnings depend on this" / "maximize your payouts" (Apple ATT violation)
- Replaced with compliant factual text
- **Native-only change** — stuck in dev world until next EAS build

**OTA pending:**
- All TrackingConsentGate.tsx changes are JS-only, OTA-deliverable
- Run: `cd apps/cashclip && EXPO_PUBLIC_ENV=production eas update --channel production --platform ios --message "Consent flow cleanup"` then same for android

**Why:**
Owner established hierarchy rule: files live where they belong in the ecosystem (dev world vs prod world), not flat-dumped by extension. The strangler fig pattern ends here.
