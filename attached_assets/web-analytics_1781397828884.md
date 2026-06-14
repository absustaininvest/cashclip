# Web Analytics

First-party, **cookieless** web analytics for the two public web surfaces:

| Surface key        | What it is                                  | Where the tracker lives                                            |
| ------------------ | ------------------------------------------- | ----------------------------------------------------------------- |
| `absustain`        | AB Sustainability corporate site (React/Vite) | `artifacts/absustain/src/lib/analytics.ts` + `<AnalyticsTracker>` in `App.tsx` |
| `cashclip-landing` | CashClip landing page served by the API      | inline `<script>` at the bottom of `artifacts/api-server/src/templates/landing-page.html` |

## How it works

- Each surface sends fire-and-forget events to the API collector
  **`POST /api/analytics/collect`** (`artifacts/api-server/src/routes/analytics.ts`).
- Events are sent via `navigator.sendBeacon` with a `fetch(..., { keepalive: true })`
  fallback. The collector always replies `204` so beacons never error or retry.
- The endpoint is **same-origin** on every deployment (the corporate site and the
  landing page are both served from the same host that proxies `/api`), so the
  existing Helmet CSP (`connect-src 'self'`) and the absustain `_headers` need
  **no changes** — no external script or domain is allowlisted.
- Events are stored append-only in the `analytics_events` table
  (`lib/db/src/schema/schema.ts`).

## Privacy

- **No cookies, no localStorage, no consent banner.** Nothing is persisted on
  the client.
- **No IP address is stored.** The collector keeps only the user-agent string
  (for device/browser breakdown), the page path, the referrer, and any UTM
  parameters.
- Unknown event names or surfaces are silently dropped server-side, and a
  per-IP rate limit (`ANALYTICS_RATE_LIMIT`, default 240 / 5 min) bounds abuse.

## Traffic-source attribution

Captured once at first page load and attached to **every** event in the session:

- `referrer` — `document.referrer`.
- `utmSource` / `utmMedium` / `utmCampaign` / `utmTerm` / `utmContent` — read from
  the `utm_*` query parameters on the landing URL.

This is what lets paid / social / organic be separated later.

## Event taxonomy

All events carry the common fields above (`surface`, `path`, `referrer`, `utm*`).
The table lists the event-specific `props`.

| Event              | Fires when…                                                                                 | `props`                         |
| ------------------ | ------------------------------------------------------------------------------------------- | ------------------------------- |
| `pageview`         | Initial page load; on absustain also on every client-side (wouter) route change.            | —                               |
| `app_store_click`  | A link to `apps.apple.com` or `play.google.com` is clicked.                                  | `{ store: "ios" \| "android" }` |
| `download_click`   | A link to `cash-clip.app` (the product / download site) is clicked.                          | —                               |
| `referral_click`   | Any clicked link carries a `?ref=<code>` query parameter.                                    | `{ ref: "<code>" }`             |
| `lead_submit`      | The contact form (`/contact`) or the investor deck form (`/investors`) submits successfully. | `{ type: "contact" \| "investor" }` |

### Where each event fires

- **Page views** — `AnalyticsTracker` in `artifacts/absustain/src/App.tsx`
  (initial load + every wouter route change) and the inline `send('pageview')`
  on the CashClip landing page.
- **Click events** (`app_store_click`, `download_click`, `referral_click`) — a
  single delegated, capture-phase click listener on each surface
  (`initAnalyticsClickTracking` for absustain; the inline listener on the
  landing page). New links matching the hosts/`ref` rule above are tracked
  automatically with no extra wiring.
- **`lead_submit`** — explicit `trackEvent("lead_submit", { type })` calls in
  `artifacts/absustain/src/pages/Contact.tsx` and
  `artifacts/absustain/src/pages/Investors.tsx`, on a successful POST to
  `/api/leads`.

## Adding a new event

1. Add the name to `ALLOWED_EVENTS` in `artifacts/api-server/src/routes/analytics.ts`
   (events not on the allowlist are dropped).
2. Fire it with `trackEvent("my_event", { ... })` (absustain) or `send("my_event", { ... })`
   (landing page).
3. Document it in the table above so channel work stays on consistent names.

## Querying

`analytics_events` is a plain table; query it with SQL, e.g. page views per day:

```sql
SELECT date_trunc('day', created_at) AS day, surface, count(*)
FROM analytics_events
WHERE event_name = 'pageview'
GROUP BY 1, 2
ORDER BY 1 DESC;
```

UTM/source attribution:

```sql
SELECT utm_source, utm_medium, utm_campaign, count(*)
FROM analytics_events
WHERE utm_source IS NOT NULL
GROUP BY 1, 2, 3
ORDER BY 4 DESC;
```
