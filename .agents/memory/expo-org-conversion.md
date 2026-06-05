---
name: Expo account converted to organization
description: Login username changed after org conversion; app.json owner already correct.
---

Jun 2026: the Expo account `absustainabilityinvestments` was converted from a personal account to an ORGANIZATION.
- CLI/EAS/expo.dev login is now the renamed personal owner account `@absustainabilityinvestments-Owner` (NOT the old plain name).
- `app.json` `expo.owner` is already `absustainabilityinvestments` (the org slug), so projects stay linked to the org — no app.json edit is needed for the conversion.
- If EAS build auth fails after this, regenerate the token (`EXPO_TOKLAST`) while logged in as the `-Owner` account.

**Note:** replit.md still lists the old Expo username/email under the CashClip section — treat as stale until the owner approves updating it.
