---
name: Domain registrar / DNS / email provider
description: Where the owner manages domains, DNS, and email per domain. Stop asking who the registrar is.
---

# Domain registrar / DNS / email — split by domain

**Confirmed Jun 6 2026 (verified via NS lookup):**
- **BOTH `cash-clip.app` AND `absustaininvest.com` DNS are managed in the Replit Domains panel** (Workspace → Domains → row → **Manage**). Both use the SAME name.com nameservers (ns{1cny,2ckr,3jkl,4hny}.name.com) — Replit domain registration is powered by name.com. Add/edit ALL DNS records (TXT, CNAME, etc.) in the **Replit Domains panel**, NOT Zoho, for either domain.
- **Zoho is ONLY email** — for `absustaininvest.com` mailboxes (and the `support@cash-clip.app` alias). `ZOHO_SMTP_PASSWORD` is the Zoho SMTP password. The Zoho-looking TXT records (zoho-verification, SPF include zoho.com) live inside the Replit/name.com-hosted zones but are just email records.

**How to apply:**
- DNS changes for **cash-clip.app** (e.g. CNAME `api.cash-clip.app` → `cash-clip.replit.app`, ad-network domain-verification TXT like `unity-as-publisher-verification=...`) → **Replit Domains panel → Manage cash-clip.app**.
- Email aliases/mailboxes (support@cash-clip.app alias etc.) and `absustaininvest.com` → **Zoho Mail**.
- The agent cannot edit Replit DNS records directly — guide the owner through the Replit Domains → Manage UI one step at a time.
- Legal domains in use: `absustaininvest.com`, `cash-clip.app` (never Replit subdomains in production-facing config).

**Email delivery (DONE):** the brand support mailbox on `cash-clip.app` is set up as a **Zoho alias** on the primary `absustaininvest.com` support mailbox, so it can send/receive, and it also works as an admin login in the app DB. Manage any further aliases/mailboxes in Zoho Mail.

**Note:** never store Zoho login credentials or any secret values here — only the fact that Zoho is the provider.
