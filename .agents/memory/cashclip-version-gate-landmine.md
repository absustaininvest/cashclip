---
name: CashClip force-update version gate landmine
description: Why the app version gate is balanced on a knife's edge and the one prod env change that would brick all live users.
---

# CashClip force-update version gate

The client sends header `X-App-Version` from a **hardcoded** constant
(`artifacts/cashclip/constants/app.ts` → `APP_VERSION = "1.1.0"`) that ships in the JS/OTA
bundle — it is NOT read from the native build/version number. The server gate
(`appVersionMiddleware`) compares it against `MIN_APP_VERSION ?? "1.1.0"`; if
`clientVersion < minVersion` it returns **426** and `ForceUpdateGate` hard-blocks the user.
No header => allowed through (web). Network error in the gate => fails OPEN (`catch` sets ok).

**The landmine — NEVER raise `MIN_APP_VERSION` above `1.1.0` in production while iOS build 29
is live.** Live iOS build 29 (Apple-frozen; newer builds rejected) runs an OTA bundle that
also reports `1.1.0`, and you cannot ship those phones a new native iOS build to change it.
Raising the floor above 1.1.0 would 426/brick every live iOS user with no escape hatch.

**Why it works today:** purely because the hardcoded client `1.1.0` == the default floor
`1.1.0` (equal is not `< floor`). It's coincidental alignment, not design.

**Why the gate can't distinguish builds:** marketing version is stuck at `1.1.0` for both the
old iOS 29 bundle and the new Android build 39, and the gate compares the marketing-version
string, not the build/versionCode. So a "force everyone ≥39 to update" cannot be expressed
via `MIN_APP_VERSION` without also catching older bundles. To make forced updates actually
targetable in future you'd have to send the build number (or bump marketing version per
release) — a deliberate change, gated on owner approval.

**Decision (Jun 2026, owner-approved):** leave `APP_VERSION` and the gate UNTOUCHED. Keep iOS
on frozen build 29; ship Android build 39 fresh (no prior public Android release → zero users
to brick there). Owner's real market is Android / South America; iOS is secondary and frozen.
