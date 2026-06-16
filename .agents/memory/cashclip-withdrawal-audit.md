---
name: Auditing a CashClip withdrawal's backing
description: How to verify in production where a user's withdrawable balance actually came from, and why the "fake surveys drain PayPal" fear is disproven by the ledger.
---

To vet a pending withdrawal, query PRODUCTION (read-only) for that user_id:
`earnings_ledger` (group by `type`), `reward_sessions` (check `status`), and `withdrawals`.

What real data shows:
- Survey `reward_sessions` almost always sit `status='pending'` with null `provider_transaction_id` → they credited **$0** (the CPX/BitLabs webhook-401 handshake issue). Surveys are NOT the source of anyone's balance right now.
- Real withdrawable balances come from the **earn-token "bonus" ledger**: `type='bonus'`, descriptions like "Auto-converted N token(s) · X pts" / "Claimed N earn token(s) · X pts" — tiny ($0.01–$0.21) amounts accumulated over days of daily use.
- A withdrawal shows as `type='withdrawal'`, negative amount; `balance = total_earned − withdrawn`.

**Why:** Owner feared baked-in "fake surveys" would let new users drain his PayPal. The production ledger disproves it for real cases — surveys credit nothing, and no client endpoint can mint a server balance (no `req.body.amount` credit path exists; every `creditUser` call requires a verified provider, an admin action, or a server-issued claim token). A "fake survey" on screen bumps only the cosmetic local number, never the withdrawable server balance.

**How to apply:** When the owner asks "is this withdrawal safe to pay," pull the ledger by type in PRODUCTION and label it dev/prod. The genuine open question is **economic, not fraud**: whether the earn-token grants map to real ad revenue — trace what actually grants earn tokens before concluding payouts are "backed." Also: a user's PayPal payout email can legitimately differ from their signup email (common, not fraud on its own).
