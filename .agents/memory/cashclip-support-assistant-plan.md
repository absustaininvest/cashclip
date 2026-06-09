---
name: CashClip Support Assistant (deferred build)
description: Owner-approved plan for an Operator-Portal support assistant that drafts honest, data-backed replies for human review. Build AFTER the Google Play launch.
---

# CashClip Support Assistant — owner-approved direction (deferred)

Owner (Jorge) spends significant daily time hand-answering CashClip support email and
wants this automated to "get the load off his shoulders" so he can focus on building.
Approved as the **next major build right after** the Google Play public launch is sent for review.
**Priority: HIGH** (owner-set, Jun 2026).

## What it must do
- Lives in the existing **Operator Portal inbox** (absustain `/sc-portal`-style admin surface; inbox already reads Zoho IMAP, sends via Zoho SMTP).
- For each inbound support email, **look up the real user on the server** and pull live account state: balance, pending points + next auto-convert time, withdrawal status, email-verified state, account/recovery state.
- **Draft** a warm, precise, *honest* reply grounded ONLY in real server data — never fabricated numbers or promises.
- Covers the common cases: "where are my points / not accumulating" (usually the pending-points 2h auto-convert, not lost money), balance questions, login/password resets, account recovery, withdrawal status.

## Hard requirements (owner-stated)
- **Draft → owner reviews → owner sends.** Nothing auto-sends. Human in the loop.
- **Reply in the language the message was received in** (auto-detect; e.g. French in → French out).
- Tone: warm, honest, retention-minded. No overpromising. Same honesty bar as the rest of the app.

## Known bugs to fix (part of this build)
- Operator Portal → **Inbox → "Sent Replies" tab errors with "No token provided"** (Jun 2026). The sent-replies fetch isn't sending the admin token, so the audit-trail/history list won't load. Fix when building the assistant (same inbox surface).

## Notes / gotchas learned
- Inbound sender email may NOT match a registered account (people write from a different address than they signed up with). Match by username when the email isn't found; ask for username if needed.
- "Video points not accumulating" is typically the **Pending Points → auto-convert every 2 hours** design, confirmed healthy on server + owner test phones (Jun 2026). Confirm per-user before claiming it's fine.
- Reuse existing Zoho IMAP/SMTP wiring (see zoho-imap-inbox memory) — don't add new mail infra.
