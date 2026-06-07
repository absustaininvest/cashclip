---
name: AdMob reporting operator alerts
description: How AdMob staleness/divergence alerts fire, their knobs, and the "only on route hit" caveat.
---

# AdMob reporting operator alerts

`lib/admobAlerts.ts` watches two conditions and routes them through the same
operator-alert path as `webhookAlerts.ts` (structured `admob_report_alert` log
+ in-memory buffer + optional POST to `ADMIN_ALERT_WEBHOOK_URL`):
- `stale_sync` — no fresh snapshot within `ADMOB_ALERT_STALE_HOURS` (default 6h).
- `revenue_divergence` — |official-vs-app pct| ≥ `ADMOB_ALERT_DIVERGENCE_PCT`
  (default 25%), gated by `ADMOB_ALERT_MIN_EARNINGS_USD` (default $1) so pennies
  don't read as huge percentages. Cooldown: `ADMOB_ALERT_COOLDOWN_MS` (default 6h).

**Caveat — evaluation is request-driven, not scheduled.** `evaluateAdmobAlerts`
is called only inside GET `/api/admin/admob/revenue`. If no admin opens the hub,
nothing evaluates, so a stale/divergent state can sit silent. A scheduled job
(advisory-lock guarded, like `jobs/conversionRateJob.ts`) is the planned fix.

**Why in-memory per-replica:** matches the existing `webhookAlerts` mechanism the
task said to reuse; alert state (firing/cooldown) is NOT shared across the
autoscaled fleet, so each replica de-dups independently.

**Delivery fan-out (all in `fireAlert`, the single per-transition chokepoint, so
all inherit the cooldown de-dup):** structured log + in-memory buffer + optional
`ADMIN_ALERT_WEBHOOK_URL` POST + operator email via Zoho SMTP
(`email.sendAdmobReportAlert`, same channel as OTPs/support). Email is best-effort
and a no-op without `ZOHO_SMTP_PASSWORD`; recipient defaults to
support@absustaininvest.com (override `ADMIN_ALERT_EMAIL`); disable just the email
with `ADMOB_ALERT_EMAIL_DISABLED`. Resolved transitions send a "back to normal"
notice.
