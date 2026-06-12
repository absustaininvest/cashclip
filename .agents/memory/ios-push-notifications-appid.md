---
name: iOS Push Notifications must be enabled on App ID before EAS can provision it
description: Why aps-environment entitlement is missing from provisioning profiles even after adding it to app.json, and how to fix it.
---

# Push Notifications entitlement missing from provisioning profile

## Root cause

Adding `"aps-environment": "production"` to `app.json` iOS entitlements is NOT enough. The App ID itself (`app.replit.cashclip`) must have the Push Notifications **capability enabled on Apple Developer Portal**. Provisioning profiles can only include capabilities that are enabled on the App ID — EAS cannot override this.

Symptoms: build fails with `Provisioning profile doesn't include the Push Notifications capability` / `aps-environment entitlement` even after app.json has `aps-environment`.

## Fix (one-time, already done Jun 2026)

1. developer.apple.com → Identifiers → `app.replit.cashclip`
2. Enable **Push Notifications** capability → Save → Confirm
3. EAS generates a new provisioning profile that includes the entitlement

## Non-interactive build gotcha

EAS `--non-interactive` will NOT auto-enable capabilities on the App ID or prompt to regenerate profiles. If credentials are wiped (e.g. user deletes profile from expo.dev), re-running with `--non-interactive` fails with "Credentials are not set up". Must run interactively from a real shell (Jorge's Mac terminal or Replit shell) to set up fresh credentials.

**Why:** Apple gates capability changes to the App ID behind a human confirmation ("this will invalidate existing profiles"). EAS respects this and requires interactive confirmation.

**How to apply:** If Push Notifications breaks again in a future build, check developer.apple.com first — the capability can sometimes be reset. Also ensure `app.json` has `ios.entitlements["aps-environment"] = "production"`.
