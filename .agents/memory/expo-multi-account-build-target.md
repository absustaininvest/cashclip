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
  A third lowercase `absustainabilityinvest...` account also exists — also not the target.

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

**Open question (not yet resolved):** the live build-29 OTA path's projectId was not
confirmed here; OTA to build 29 is empirically working, so don't disturb it. The two
projects showed *different* recent OTA update messages, so updates may have history on more
than one project — verify projectId before publishing OTA, don't assume.
