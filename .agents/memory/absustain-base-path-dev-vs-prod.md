---
name: absustain base path dev vs prod
description: Why absustain dev preview 404s at /absustain/* but prod serves both root and /absustain/, and which URLs are canonical for SEO.
---

The absustain site's Vite `base` comes from `BASE_PATH` (defaults to `/absustain/` in vite.config).

- **Dev** runs with `BASE_PATH=/` (set in `.replit` `userenv.shared`), so the dev/preview server serves the app at the **root** ("/", "/about", "/ventures"). Hitting `/absustain/about` in the dev preview returns the SPA 404 — this is expected, not a bug. Use clean root paths when screenshotting/testing dev.
- **Prod** (absustaininvest.com) serves the site at BOTH `/` (clean URLs, base `/`) and `/absustain/` (base `/absustain/`). The clean-root build is the public/canonical one and matches the existing `og:url`.

**SEO decision:** canonical URLs, sitemap `<loc>`s, and robots all use clean root URLs on `https://absustaininvest.com` (no `/absustain/` prefix). The `/absustain/` variant is consolidated to the clean URL via the per-page canonical tag.

**How to apply:** when adding routes/sitemap entries or verifying SEO, use `https://absustaininvest.com/<path>` (no prefix), and test dev at the root path, not `/absustain/...`.
