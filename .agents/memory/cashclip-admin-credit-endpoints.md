---
name: CashClip admin balance-change endpoints
description: The two admin balance-adjustment API routes, who calls which, and the invariant they must share.
---

# Admin balance-change endpoints (two of them)

There are TWO admin endpoints that move a CashClip user's balance, called by two different clients:

- `POST /api/admin/credit-balance` — used by the **mobile app** admin screen. Positive amounts only (0–1000).
- `POST /api/admin/credit` — used by the **website /sc-portal** (`CashClipUsersPanel`: credit/correct field AND the "Zero Balance" button). Accepts **signed** amounts (negative = correction/reset, via `debitUser`).

**Invariant:** every manual balance change must (1) write an `earnings_ledger` row of `type = "adjustment"`, (2) emit an attributed server log with `adminId`, and (3) fire `sendAdminCreditReceipt` (user receipt + copy to support@absustaininvest.com). The website audit panel reads these via `GET /api/admin/adjustments` (joins ledger→users, filters `type='adjustment'`). If you add a third path or change one endpoint, keep all three behaviors in lockstep or the audit log / receipts silently diverge.

**Why:** the website portal historically POSTed to `/api/admin/credit` while only `/api/admin/credit-balance` existed server-side, so every credit/zero done from the website returned 404 and **no ledger row was ever written** — the owner saw credits "not land anywhere." The fix added the route; the lesson is that the two clients use different routes and both must persist + receipt identically.

**How to apply:** when touching admin crediting, grep both route names and `sendAdminCreditReceipt`/`getAdjustmentLedger`. Adjustments intentionally do NOT bump `totalEarned` (creditUser excludes `type "adjustment"` from earnings). Negative adjustments use `debitUser`, which throws `INSUFFICIENT_BALANCE` → return 400, never let balance go negative.
