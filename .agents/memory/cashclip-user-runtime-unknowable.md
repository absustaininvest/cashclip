---
name: CashClip user runtime/app-version is not server-knowable
description: Why you can't look up a specific account's runtime/build, and the real force-upgrade trap (MIN_APP_VERSION) — for diagnosing "is this user stuck/trapped" questions.
---

# You cannot look up a specific account's runtime or app/build version

The server stores **nothing** about which runtime/build/version any account is on.

- `device_installs` (lib/db/src/schema/schema.ts) holds only opaque hashes (tokenHash, deviceHash, userId, createdAt). No version/runtime/build column exists anywhere in the DB schema.
- The app sends an `x-app-version` header (the **display** version like "1.1.0", NOT the runtimeVersion). `appVersionMiddleware` (artifacts/api-server/src/lib/versionCheck.ts) only *checks* it in the moment and **discards** it — it's never persisted to the account. The only trace is a transient `logger.warn` line *if* a too-old client is rejected.

**How to apply:** When the owner asks "what runtime/version is <user> on?" or "did this account get trapped on a runtime?", the honest answer is: not recoverable from server data. Runtime lives only on the phone's installed binary. Ways to know: ask the user, or catch a 426 rejection in live logs.

# Runtime can't trap an *account* — accounts are server-side

runtimeVersion binds to the app **install** (native binary), not the account. Balances/history/payouts are server-side and survive any reinstall/runtime change. So an account is never "trapped" by a runtime; only an install is bound to one.

# The real force-upgrade trap lever = MIN_APP_VERSION

`MIN_APP_VERSION` (env, defaults to **"1.1.0"** if unset) is the only mechanism that actually locks real users out: clients sending `x-app-version` below it get **426 UPGRADE_REQUIRED** on gated routes (auth/webhooks/static are exempt). 

**Why:** raising MIN_APP_VERSION above what the LIVE App Store build (build 29) reports would 426-lock live users until they update — that *is* "catching accounts in the middle."

**How to apply:** treat MIN_APP_VERSION as a loaded gun; change only deliberately. To check if anyone is actually being trapped, grep PRODUCTION deployment logs for `UPGRADE_REQUIRED` / "outdated app version" / 426. (Jun 16 2026: checked — zero hits, nobody trapped.)
