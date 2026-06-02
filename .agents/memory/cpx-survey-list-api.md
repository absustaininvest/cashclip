---
name: CPX get-surveys JSON API
description: How to pull the individual CPX survey list server-side (gotchas that cost several probes)
---

# CPX get-surveys JSON API

To list individual CPX surveys server-side (instead of just the offerwall):

- Endpoint host is `https://live-api.cpx-research.com/api/get-surveys.php` — **not** `live.cpx-research.com` (that host refuses the connection for this call) and not `dashboard.cpx-research.com`.
- **You must pass `output_method=api`.** `output_method=json` silently returns the **HTML offerwall fragment**, not JSON — this is the #1 trap.
- Auth params: `app_id`, `ext_user_id`, `secure_hash = md5(`${ext_user_id}-${CPX_API_KEY}`)`.
- Pass `ip_user` and `user_agent` (the end user's) so CPX geo-targets / returns results — with no IP you often get 0 surveys.
- Response shape: `{ status, count_surveys, surveys: [...] }`. Each survey: `id`, `loi` (minutes), `category`, `payout` (string), `payout_publisher_usd`, `statistics_rating_avg`, `href` (per-user signed deep link to open), `href_new` (offerwall-filtered link).

**Why payout is treated as USD:** this CPX app is configured to display/earn in **USD** (the offerwall HTML shows "earn USD!" and `payout` values like "2.10" match the on-screen "+2.10 USD"). So `payout` maps directly to the user's USD reward. **How to apply:** still clamp to `PROVIDER_REWARD_RANGES.cpx` (0.20–3.00) as a safety net; if CPX is ever reconfigured to a coin/points currency, `payout` would no longer be dollars and this mapping must change.
