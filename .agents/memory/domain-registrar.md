---
name: Domain registrar / DNS / email provider
description: Where the owner manages domains, DNS, and email. Stop asking who the registrar is.
---

# Domain registrar / DNS / email — Zoho

**Owner-stated (Jorge Ballen, May 29, 2026):** the domain registrar / domain provider is **Zoho**, and email is run on **Zoho Mail** (`ZOHO_SMTP_PASSWORD` secret is the Zoho SMTP password). Do NOT ask the owner who his registrar/domain provider is — it is Zoho.

**How to apply:**
- DNS changes (e.g. CNAME `api.cash-clip.app` → `cash-clip.replit.app`, custom-domain verification records) are made in the **Zoho** control panel.
- Email aliases/mailboxes are managed in **Zoho Mail**.
- Legal domains in use: `absustaininvest.com`, `cash-clip.app` (never Replit subdomains in production-facing config).

**Email delivery (DONE May 29, 2026):** `support@cash-clip.app` is added as a **Zoho alias** on the `support@absustaininvest.com` mailbox, so it can send/receive. It also works as an admin login in the app DB. (Other aliases on that mailbox include `apple-review@absustaininvest.com` and `jorge.ballen@cash-clip.app`.)

**Note:** never store Zoho login credentials or any secret values here — only the fact that Zoho is the provider.
