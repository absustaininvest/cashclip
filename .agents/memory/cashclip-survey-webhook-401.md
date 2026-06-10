---
name: CashClip surveys never credit — webhook 401 (integration setup, not the app)
description: Surveys complete on provider side but users never get paid because CPX+BitLabs postbacks are rejected 401 in prod; server-only secret fix, never a rebuild.
---

# Surveys don't pay users — it's the integration webhook handshake, NOT the app/build

**Symptom (owner-reported, repeatedly):** users finish surveys but never get credited
in-app. Owner correctly insisted "it's the integration setup," not the app, and was
frustrated by repeated suggestions to rebuild/ship a new native version.

**Confirmed via production read-only SQL (Jun 2026):**
- `webhook_audit`: every CPX postback rejected `401` reason "Invalid provider-specific
  signature for cpx" (dozens/day since ~Jun 5). BitLabs identical: `401` "Invalid
  provider-specific signature for bitlabs".
- `reward_sessions` (source=survey): CPX = **162 pending, 0 ever completed**; BitLabs = 0
  sessions. So crediting has NEVER worked, it is not a delay.
- CPX publisher dashboard shows REAL completes + money (~$1.64/day, ~3 DAU) — proof the
  money exists on the provider side; only the callback to our server is broken.

**Root cause:** provider webhook signature mismatch. The webhook secret our server uses
must equal the provider dashboard's signing salt:
- CPX verifier (webhookAuth.ts): compares `md5(`${trans_id}-${secret}`)` to the
  `secure_hash`/`hash` query param, secret = `CPX_WEBHOOK_SECRET`. Guard DISABLES
  crediting if `CPX_WEBHOOK_SECRET === CPX_API_KEY`. 401 = it reached the compare and
  mismatched → prod `CPX_WEBHOOK_SECRET` ≠ CPX dashboard "Secure Hash" salt.
- BitLabs verifier: HMAC-SHA1 over the cleaned full URL using `BITLABS_WEBHOOK_SECRET`.

**Fix is SERVER-ONLY — no native build, no App Store/Play review:**
1. Match the secret: set prod `CPX_WEBHOOK_SECRET` to the CPX dashboard "Secure Hash"
   (Apps → app → Postback/Secure Hash), and `BITLABS_WEBHOOK_SECRET` to BitLabs' signing
   secret. One secret at a time (batching secret boxes has pasted values into wrong
   fields before).
2. These must live in **Production app secrets (Publishing)**, not just the workspace
   Secrets tab, then **re-publish the API** to take effect.
3. Re-test: a real completion should flip a `reward_sessions` row pending→completed and
   write an `earnings_ledger` entry; `webhook_audit` should show 200 instead of 401.

**Why this matters:** do NOT answer "surveys don't pay" with a rebuild — build 29 (iOS)
is live and a new build risks rejection (38 froze on splash). The same single handshake
fix makes BOTH CPX and BitLabs pay. Native treadmill ≠ this fix.

**How to apply:** verify with prod read-only SQL on `webhook_audit` (provider, reason,
status_code) and `reward_sessions` (status by provider) before/after; fix is secret match
in Production + republish.
