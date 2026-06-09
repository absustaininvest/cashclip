---
name: Expo multi-account build target
description: There are 3 Expo accounts; the ONE correct CashClip project is locked in code by owner+projectId, not by browser selection. Avoid the stray decoy projects.
---

# Expo multi-account landmine (CashClip)

Owner has **3 Expo accounts/orgs** visible in the account switcher. Only ONE is the real
CashClip home. Two others are strays/decoys that can waste a whole build cycle if used.

- **Correct project (the live one):**
  - Org/owner slug: `absustainabilityinvestments`
  - Project ID: `aac2a3d9-56b6-49ab-b254-9b80e98bab2f`
  - Updates URL: `https://u.expo.dev/aac2a3d9-56b6-49ab-b254-9b80e98bab2f`
  - Shown in Expo UI as the **capital "CashClip"** project under **ABSustainabilityInvestments**.
  - This is where build 38 (v1.1.0) lives and where build 39 must go.
- **Stray to AVOID:** a **lowercase `cashclip`** project under account **`Expodeveloper20`**
  (only old v1.0.0 builds ~3 weeks old). NOT the live app. Never build/OTA there.
  A third lowercase `absustainabilityinvest...` account also exists — this is the USER
  account (NOT an empty decoy): see "Three-account graph + build-39 home" below.

## Three-account graph + build-39 home (owner-verified Jun 9 2026)

Token EXPO_TOKLAST sees **3 accounts, all Role Owner** (one person, Jorge Ballen,
login `support@absustaininvest.com`):
1. **USER `absustainabilityinvestments-owner`** (display "AB Sustainability Investments") —
   his PERSONAL account. Holds the **$199 Production plan + ~$225 build credits**. Owned no
   project yet → **this is the NEW HOME for build 39.** Linked sign-ins: Google
   `andbalvan53@gmail.com` (Play), Apple `andyballen0814@icloud.com` (App Store Connect),
   GitHub `absustaininvest` — but those are LOGIN methods, not store-submit keys.
2. **ORG `absustainabilityinvestments`** — currently OWNS CashClip Project A (`aac2a3d9…`),
   the 1.1.0 / build 38-39 lineage.
3. **ORG `absustainabilityinvestmentsllc`** (display **"Expodeveloper20"**, plan **Starter/free**) —
   the ORIGINAL; owns Project B (`10994af8…`) = **live build-29 OTA + old v1.0.0 builds.**
   ✋ SACRED, has NO build credits, do not touch.

**Plan (owner-agreed):** TRANSFER Project A from org `absustainabilityinvestments` → user
`absustainabilityinvestments-owner` (browser: project settings → Transfer; no stable CLI).
projectId `aac2a3d9…` stays; update app.json `owner`. Keystore/iOS certs ride along — and
it's the **same signing key Google already accepted for build 38**, so Android 39 won't be
rejected. Build 29 (Project B / Expodeveloper20) stays untouched.

**Identity consistency (all trace to one person):** Expo home ↔ Apple
`andyballen0814@icloud.com` (team FAX932PG78, ascAppId 6759931285) ↔ Google Play owner
`andbalvan53@gmail.com` / **AB Sustainability Investments LLC** ↔ absustaininvest.com ↔
support@absustaininvest.com. Android *submit* key = a service-account JSON generated from
inside that Play Console (`credentials/` per eas.json), separate from the Google login.
The Sentry "Connected as ab-sustainability-investments" on Expodeveloper20 is just a
third-party service link, NOT what ties the Expo accounts together (the owner does).

**Why:** the build/OTA destination is determined by `owner` + `extra.eas.projectId` in
`artifacts/cashclip/app.json` plus the EXPO_TOKLAST token's org membership — **NOT** by
which account is selected in the browser. So a build can't accidentally land on the wrong
account *as long as app.json stays correct and EXPO_TOKLAST belongs to a member of
`absustainabilityinvestments`*. The risk is editing/wiping those fields or using a token
from the wrong account.

**How to apply:** before any EAS build/submit/update for CashClip, confirm app.json still
has owner `absustainabilityinvestments` + projectId `aac2a3d9…`. To verify in the Expo UI,
open a project's **Details** and check the Project ID equals `aac2a3d9…`. Ignore the
Expodeveloper20 / lowercase-cashclip project entirely.

**RESOLVED — the live build-29 OTA actually comes from a DIFFERENT project (Project B):**
Per `snapshots/original-29/RESTORE.md` (owner-verified Jun 3 2026) and git history of
`artifacts/cashclip/app.json`, two projects are braided together:
- **Project A** (everyday pointer in app.json now): projectId `aac2a3d9-56b6-49ab-b254-9b80e98bab2f`,
  owner `absustainabilityinvestments`. Where build 38 (and future 39) live.
- **Project B** (what LIVE App Store build 29 / v1.0.0 actually pulls OTA from):
  `@absustainabilityinvestmentsllc/cashclip`, projectId `10994af8-62e3-4a9d-9e35-7f4381965a31`,
  owner `absustainabilityinvestmentsllc`.

**Consequence:** publishing OTA with the current (Project A) app.json does NOT reach live
build-29 devices. To OTA build 29 you must do the documented dance: temporarily set
owner→`absustainabilityinvestmentsllc` + projectId→`10994af8…` + matching updates.url,
publish/republish (runtime 1.0.0), then REVERT app.json to Project A. Git shows this A↔B
flip happened repeatedly on Jun 3. This two-project split is exactly why OTA updates appear
"in both accounts" and why owner couldn't tell which was real.

**Why building 39 is the clean fix:** build 39 (native, from current app.json) bakes
Project A `aac2a3d9` + runtime 1.1.0, so post-39 the normal update workflow reaches users
directly with no A/B dance. Caveat: this does NOT retro-fix 29 users — they stay on the
Project-B path until they update to 39.

Note: there are 3 accounts in the Expo switcher (Expodeveloper20 has a stray lowercase
`cashclip` with old v1.0.0 builds; a capital "ABSustainabilityInvestments" holds CashClip;
a lowercase empty one). Display names != slugs, so confirm a project by its **Project ID**
(Details panel) or via read-only `eas project:info`/`eas update:list`, not by the switcher label.
