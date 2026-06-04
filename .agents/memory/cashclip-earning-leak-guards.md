---
name: CashClip earning-leak guards
description: Non-obvious rules for the survey/offerwall reward path — CPX geo IP, and the unsettled-completions reconciliation table.
---

# CashClip earning-leak guards

## CPX returns 0 surveys without the real end-user PUBLIC IP
CPX (and similar geo-targeted survey providers) match inventory on the user's
public IP. Hand them a missing/private IP and they return **zero** surveys, which
collapses the in-app list to a single offerwall card — looks like "no surveys",
is actually a wiring bug.

**Why:** behind a reverse proxy, the abuse-control IP helper returns the
*rightmost* `X-Forwarded-For` hop (the proxy's own private `10.x`), not the
client. That private IP is useless for geo.

**How to apply:** geo-targeting calls must use the *leftmost public* XFF entry
(scan left→right, skip private/loopback/link-local/CGNAT/multicast). Keep the
rightmost-hop helper for rate limiting / audit — leftmost XFF is client-spoofable
so it must never gate money or throttles. Never log the resolved IP value (PII);
log presence only.

## Unsettled-completion catch MUST be dedup-guarded or it double-pays
We persist verified-but-uncredited provider completions (webhook passed
signature check but no matching *pending* reward session: TTL expiry, id
mismatch, or the user never started a session) into an audit table instead of
silently 200-dropping them, so earnings can be reconciled.

**Why:** providers **retry/resend** webhooks. After the first webhook credits a
completion, the session flips pending→completed, so every later resend finds no
pending session. Recording those blindly creates false "unsettled" rows — and
reconciling them would pay the user twice.

**How to apply:** before writing an unsettled row, check whether the completion
was already credited (a `completed` reward session for the same
user+externalId, or same provider transaction id) and skip if so.
`completeRewardSessionAndCredit` returns two conflict kinds — treat them
differently: `duplicate` (provider-txn unique violation) = definitely already
credited → settled; but `not_claimable` is ambiguous — usually a racing webhook
consumed the session, yet it can also be a session that expired in the window
between find and update (never credited). So do NOT treat `not_claimable` as
settled; return not-settled and let the dedup-guarded recorder decide via the
already-credited check (racing → suppressed, genuine expiry → recorded). The
recording itself must be best-effort (swallow errors) so it never breaks the
webhook's 200 response or the primary credit path. For CPX, only flag unsettled
after BOTH the per-survey and the `cpx_wall` fallback fail.
