---
name: CashClip disabled client-timed reward paths
description: Which reward-earning server endpoints are intentionally disabled (410 / empty) because they can't be proven from an untrusted client, and why.
---

# Disabled reward paths (do not re-enable without a trusted server-verifiable signal)

These CashClip API endpoints were deliberately disabled as security fixes. They
all share one root cause: an **untrusted client cannot produce trustworthy proof**
of the rewarded event, and the threat model rejects client-timed / replayable
choreography as proof for money-like rewards.

## Game & in-app rewarded-ad fallback — return 410 Gone
`POST /api/earn/game/begin`, `/api/earn/game/complete`, `/api/earn/ad/begin`,
`/api/earn/ad/complete` (in `artifacts/api-server/src/routes/earnings.ts`).
- The begin→complete ceremony only proved elapsed time on a same-user challenge
  token — trivially scriptable (begin → sleep → complete) and farmable across
  accounts. No gameplay-result or attested ad-impression signal exists.
- The CashClip client (`artifacts/cashclip/lib/earn-client.ts`) was already
  written to treat 410 as "no server reward" and degrade gracefully — the win
  animation still shows; nothing credits. So disabling server-side is safe.
- **Real rewarded-ad rewards still flow** only via AdMob SSV (`GET /api/admob/ssv`,
  ECDSA-verified). Spin begin/complete is a SEPARATE feature and was left intact.

## Sponsored visits — fully disabled
`GET /api/earn/sponsored` returns `{ campaigns: [] }`; `POST /…/:id/begin` and
`POST /…/:id/visit` return 410 (in `artifacts/api-server/src/routes/cashclip.ts`).
- The whole witness chain (/r redirect, /ack + /c ack token, witness cookie,
  /delivery pixel) travels through the client and is replayable by a script, so
  visits to a 3rd-party advertiser page can be faked to mint balance and drain
  publisher campaign budgets. Existing IP/account/dedup/budget caps only bound
  the loss; they don't make a faked visit detectable.
- **Why disable rather than harden:** there is no trusted provider callback or
  proof-of-delivery for arbitrary advertiser URLs — nothing exists to harden
  against. Owner (Jorge) explicitly approved disabling after a full-transparency
  explanation (he asked "is disabling the recommended way?").
- The old ~450-line settlement handler was DELETED (not just shadowed) — an
  earlier attempt to keep it under a `/visit/_disabled_legacy` path accidentally
  re-exposed the exploit; never re-register settlement logic under any path.
- Publisher campaign *creation/management* is untouched; only visitor crediting
  is off. **To re-enable:** add a genuinely server-verifiable proof-of-visit
  (e.g. a signed ad-network postback the user can't forge), not more dwell timers.

**Why (general):** client possesses every token/cookie in these flows, so any
"proof" it returns is replayable. Elapsed-time + same-user token ≠ proof of a
real impression/visit/win. Live money product — fail closed.
