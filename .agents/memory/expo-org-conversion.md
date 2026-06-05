---
name: Expo account converted to organization
description: Login username changed after org conversion; app.json owner already correct.
---

Jun 2026: the Expo account `absustainabilityinvestments` was converted from a personal account to an ORGANIZATION.
- CLI/EAS/expo.dev login is now the renamed personal owner account `@absustainabilityinvestments-Owner` (NOT the old plain name).
- `app.json` `expo.owner` is already `absustainabilityinvestments` (the org slug), so projects stay linked to the org — no app.json edit is needed for the conversion.
- If EAS build auth fails after this, regenerate the token (`EXPO_TOKLAST`) while logged in as the `-Owner` account.

**Owner member of record (owner-attested, members CSV exported 2026-06-05):**
- Username `absustainabilityinvestments-owner`, display "AB Sustainability Investments", email `support@absustaininvest.com`, Role Owner, 2FA enabled, **Member since 2026-04-14**. Owner saved this CSV as the reference date for the move to the owner organization.
- Canonical business name across the new org is **"AB Sustainability Investments"** (NO "LLC"), matching the Unity org — use this form for consistency when naming other integrations (e.g. the Google Analytics/Firebase Account name). Note the older Expo Project B owner slug `absustainabilityinvestmentsllc` DID carry "llc"; the new owner org dropped it.

**Note:** replit.md still lists the old Expo username/email under the CashClip section — treat as stale until the owner approves updating it.
