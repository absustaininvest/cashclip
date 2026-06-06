---
name: Domain registrar / DNS / email provider
description: Where the owner manages domains, DNS, and email per domain. Stop asking who the registrar is.
---

# Domain registrar / DNS / email — split by domain

**Per-domain split (owner-confirmed Jun 6 2026):**
- **`cash-clip.app` DNS is managed in the Replit Domains panel** (Workspace → Domains → row `cash-clip.app`, Registered With "Replit", Verified → **Manage**). Add/edit DNS records (TXT, CNAME, etc.) THERE, not in Zoho. The Zoho-looking TXT records on cash-clip.app (zmverify, SPF include zoho.com) are just email records living inside the Replit-hosted zone.
- **`absustaininvest.com` is the Zoho domain** — Zoho is used for that domain's email (and DNS). `ZOHO_SMTP_PASSWORD` is the Zoho SMTP password.

**How to apply:**
- DNS changes for **cash-clip.app** (e.g. CNAME `api.cash-clip.app` → `cash-clip.replit.app`, ad-network domain-verification TXT like `unity-as-publisher-verification=...`) → **Replit Domains panel → Manage cash-clip.app**.
- Email aliases/mailboxes (support@cash-clip.app alias etc.) and `absustaininvest.com` → **Zoho Mail**.
- The agent cannot edit Replit DNS records directly — guide the owner through the Replit Domains → Manage UI one step at a time.
- Legal domains in use: `absustaininvest.com`, `cash-clip.app` (never Replit subdomains in production-facing config).

**Email delivery (DONE):** the brand support mailbox on `cash-clip.app` is set up as a **Zoho alias** on the primary `absustaininvest.com` support mailbox, so it can send/receive, and it also works as an admin login in the app DB. Manage any further aliases/mailboxes in Zoho Mail.

**Note:** never store Zoho login credentials or any secret values here — only the fact that Zoho is the provider.
