---
name: Domain registrar / DNS / email provider
description: Where the owner manages domains, DNS, and email. Stop asking who the registrar is.
---

# Domain registrar / DNS / email — Zoho

**Owner-stated:** the domain registrar / domain provider is **Zoho**, and email is run on **Zoho Mail** (`ZOHO_SMTP_PASSWORD` secret is the Zoho SMTP password). Do NOT ask the owner who the registrar/domain provider is — it is Zoho.

**How to apply:**
- DNS changes (e.g. CNAME `api.cash-clip.app` → `cash-clip.replit.app`, custom-domain verification records) are made in the **Zoho** control panel.
- Email aliases/mailboxes are managed in **Zoho Mail**.
- Legal domains in use: `absustaininvest.com`, `cash-clip.app` (never Replit subdomains in production-facing config).

**Email delivery (DONE):** the brand support mailbox on `cash-clip.app` is set up as a **Zoho alias** on the primary `absustaininvest.com` support mailbox, so it can send/receive, and it also works as an admin login in the app DB. Manage any further aliases/mailboxes in Zoho Mail.

**Note:** never store Zoho login credentials or any secret values here — only the fact that Zoho is the provider.
