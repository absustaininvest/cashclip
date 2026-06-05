---
name: Referral link landing (/r/:username)
description: Where the cash-clip.app/r/<code> referral page lives, the two-copy template sync gotcha, and its cross-origin analytics endpoint.
---

# Referral share-link landing

Shareable referral links are `https://cash-clip.app/r/<username>` (referral code == normalized username). The landing page detects platform, surfaces the code to copy, and links to the App Store.

## Where it's served (two places, kept in sync)
- **Public truth:** `cash-clip.app` is the standalone web deploy (`artifacts/cashclip/server/serve.js`), NOT the API. The `/r/:username` route + template live there. This is the surface the real shared link hits.
- **Parity/testable:** `artifacts/api-server/src/app.ts` mirrors `/r/:username` (and `/api/r/:username`) so the route is exercisable in dev/preview (api-server runs on port 3001; cash-clip.app/serve.js is not run in dev).
- The HTML template (`referral-landing.html`) is **physically duplicated** in `artifacts/cashclip/server/templates/` and `artifacts/api-server/src/templates/` because each server reads its own templates dir. **Edit both copies together or they drift.**

## Non-obvious constraints
- **Username is format-validated only, never existence-checked** (`/^[\p{L}\p{N}_-]{3,30}$/u`). Invalid/odd codes fall back to the generic marketing landing, not a broken page. Keeps the static host DB-free and avoids account enumeration.
- **Analytics endpoint differs per server** via a placeholder: serve.js beacons cross-origin to `https://api.cash-clip.app/api/analytics/collect` (allowed by the collector's CORS allowlist, which includes cash-clip.app); api-server uses same-origin `/api/analytics/collect`. Uses the existing event taxonomy (`pageview`, `referral_click {ref}`, `app_store_click {store:'ios'}`) on surface `cashclip-landing`.

**Why:** the original feature only had username-typing; the link funnel must work on the public host (serve.js) AND be testable on the API host, without a new App Store build (web/JS only → OTA-safe).
