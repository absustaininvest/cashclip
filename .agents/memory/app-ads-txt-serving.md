---
name: cash-clip.app app-ads.txt serving
description: Which file actually serves the crawled cash-clip.app/app-ads.txt, and how to update it
---

# cash-clip.app/app-ads.txt — source of truth

The live `https://cash-clip.app/app-ads.txt` that Unity/AdMob/Tapjoy crawl is
served by **`artifacts/cashclip/server/serve.js`** (the CashClip web static
server) — a hardcoded array joined with `\n`.

**Why this matters:** `artifacts/api-server/src/app.ts` ALSO has an
`/app-ads.txt` route, but it only returns the single `google.com … DIRECT`
line. That route is a decoy for this purpose — it does NOT serve the crawled
cash-clip.app URL. Don't edit app.ts thinking it fixes the crawled file.

`artifacts/absustain/public/app-ads.txt` serves absustaininvest.com only (google
line) — also unrelated to the Unity/AdMob crawl.

**How to apply:** When an ad network (Unity, AdMob) reports "missing app-ads.txt
entries," get the network's COMPLETE current authorized-sellers list (Unity has a
copy button) and replace the array in serve.js with the google DIRECT line + that
full list. The list drifts over time, so replace wholesale rather than appending.
Then the owner must PUBLISH the CashClip web deployment for the change to go live;
republish is required (owner-approval-gated per his rule).

**Confirmed working (Jun 6, 2026):** added the Insticator authorized-seller line
(`insticator.com, …, RESELLER, …`) to the serve.js array and republished the single
`cash-clip.app` autoscale deployment. After the republish, live `cash-clip.app/app-ads.txt`
returned 200 with the Insticator line, and the Unity dashboard flipped to "Your app-ads.txt
file is up-to-date. No action needed at this time." So: edit array → republish that one
deployment → Unity's "missing entry" warning clears (crawler may lag ~24h).
