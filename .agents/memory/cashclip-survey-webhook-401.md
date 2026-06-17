---
name: CashClip surveys never credit — diagnose webhook end-to-end before blaming code
description: Surveys complete on provider side but users aren't credited. Prove the server with a signed status=0 probe before touching secrets/code — a "0 credited" can simply mean the provider postback URL was never saved.
---

# Surveys don't pay users — it's the integration setup, NOT the app/build

**Symptom (owner-reported, repeatedly):** users finish surveys but never get credited
in-app. Owner correctly insisted "it's the integration setup," not the app, and was
frustrated by repeated suggestions to rebuild/ship a new native version. It is NEVER a
native build / App Store / Play review issue — same single handshake covers all providers.

## Current verified state (Jun 17 2026) — supersedes the old "401 secret mismatch" note

Re-diagnosed live. The CPX webhook server side is **correct and proven on production**:
- Route `GET /api/surveys/webhook/cpx` runs `verifyWebhook("cpx", req)`; **bad signature → 403** (not 401), good signature → 200.
- CPX secret is **`CPX_API_KEY`** (the per-app "Secure Hash"), NOT a separate `CPX_WEBHOOK_SECRET`. CPX issues no separate webhook secret; the same Secure Hash signs the wall link (`buildCpxWallUrl`) and the postback. If the wall loads (sessions get created), `CPX_API_KEY` is correct.
- CPX postback signature = `md5(`${trans_id}-${SecureHash}`)` vs `secure_hash`/`hash` query param. Replay guard: rejects `trans_id === ext_user_id`.
- Crediting only fires when `status === "1" || "completed"`; otherwise 200 with no DB write.

**Prod data at diagnosis:** `reward_sessions` source=survey → CPX **260 pending, 0 completed, 0 ever**; BitLabs 0 sessions. `unsettled_completions` **empty**. No `/api/surveys/webhook/cpx` hits in deployment logs. Zero completed AND zero unsettled AND zero log hits = **postbacks were never arriving** → the CPX Main Postback URL had not been saved in the CPX dashboard yet (owner was mid-configuration). It was NOT a signature/secret mismatch.

## RESOLVED (Jun 17 2026, owner-confirmed)

Owner tested the CPX webhook end-to-end in production and confirmed it **green/solid** — real survey completions now credit. The missing piece was exactly as diagnosed: the CPX Main Postback URL had to be saved in the CPX dashboard; once saved, completions flow and credit. CPX crediting is no longer an open concern. (BitLabs is separate: the in-app "BitLabs temporarily unavailable" banner is the designed fail-open on provider availability, not a crediting failure.)

## The safe live probe that settles it (no prod writes)

Compute `md5(`${transId}-${CPX_API_KEY}`)` in a Node script (bash env has the secret; the
code_execution sandbox does NOT), then call the **production** webhook with **`status=0`**
(so the crediting block is skipped → no credit, no unsettled row — pure verification test):
- VALID signature → **200 OK** ⇒ prod `CPX_API_KEY` matches and real completions will credit.
- INVALID signature (control) → **403 Forbidden** ⇒ verifier is actually checking.
Both `api.cash-clip.app` and apex `cash-clip.app` route `/api/*` to the API server (both
returned 200/403 identically), so the host in the dashboard URL is not the failure point.

## Correct CPX Main Postback URL (owner's was already correct)

`https://api.cash-clip.app/api/surveys/webhook/cpx?status={status}&trans_id={trans_id}&survey_id={survey_id}&ext_user_id={user_id}&amount_local={amount_local}&secure_hash={secure_hash}`
- `ext_user_id={user_id}` is required (server matches the pending session by it); `amount_local` is **ignored** server-side (reward is the server-committed `expectedReward`, clamped) — harmless to include.
- apex `cash-clip.app` host also works, but `api.cash-clip.app` is the canonical API host baked into builds.

**Why this matters / how to apply:** before answering "surveys don't pay" with code or
secret changes, run the signed status=0 probe + check `reward_sessions`/`unsettled_completions`/logs.
If the server proves out (200 valid / 403 invalid) but credits are 0, the fix is **dashboard
configuration (save the postback URL)**, then confirm a real completion flips a session
pending→completed. Only if the probe 403s on a VALID signature is it a real secret/snapshot
mismatch (then match the secret in Production Publishing secrets + republish).
