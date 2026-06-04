---
name: Zoho IMAP inbox vs SMTP
description: Why the admin Inbox "Failed to connect to mail server" even though email sending works.
---

# Zoho IMAP inbox ("Failed to connect to mail server")

The admin Inbox panel (absustain `/sc-portal`) reads mail over **IMAP** (`imap.zoho.com`) and is a *separate* path from email **sending** (SMTP `smtp.zoho.com:465`). Sending uses `ZOHO_SMTP_PASSWORD`; the inbox reader uses `ZOHO_IMAP_PASSWORD` and only falls back to `ZOHO_SMTP_PASSWORD` if the IMAP one is unset.

So SMTP (OTPs, receipts, support mail) can work fine while the Inbox still shows "Failed to connect to mail server. Check ZOHO_SMTP_PASSWORD."

**Root causes, in order of likelihood:**
1. Zoho requires **IMAP access to be explicitly enabled** for the mailbox (Zoho Mail → Settings → Mail Accounts → IMAP) AND typically a **separate application-specific password** when 2FA is on. The SMTP app-password often won't authenticate IMAP. Fix: enable IMAP, generate an app-specific password, store it as the `ZOHO_IMAP_PASSWORD` secret.
2. Production runs a **stale secret snapshot** — a newly added secret only reaches the live deployment after a re-publish (see prod-secrets-location note).

**How to apply:** this is owner/Zoho-side config + a secret value the agent can't read or generate. Diagnose, then ask the owner to enable IMAP + create the app password; wire it as `ZOHO_IMAP_PASSWORD`; re-publish prod. Don't assume a missing `ZOHO_SMTP_PASSWORD` — confirm which protocol actually failed.

**Two-level IMAP enablement gotcha (confirmed Jun 4 2026):** enabling IMAP on the personal mailbox (Settings → Mail Accounts → IMAP) is necessary but NOT sufficient for a custom-domain Zoho org. If auth still fails with `NO [ALERT] You are yet to enable IMAP for your account. Please contact your administrator`, IMAP is blocked at the **org/admin** level — owner must also enable it in the Zoho Mail Admin Console (mailadmin.zoho.com → Security & Compliance → Email Protocols / Settings → Mail → IMAP & POP). Once both are on, the app password authenticates. To diagnose precisely, run an ImapFlow connect from `artifacts/api-server` (imapflow isn't resolvable from repo root) and read `err.responseText`.
