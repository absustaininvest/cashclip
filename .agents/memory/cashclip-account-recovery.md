---
name: CashClip account recovery (self-service forgot-password)
description: The in-app forgot-password flow already works; "can't recover" support emails are false-credential signups, not a bug — don't rebuild it.
---

# CashClip account recovery

A complete, secure self-service recovery flow already ships in the app and server. Do NOT
rebuild it or treat support recovery emails as a code defect.

**Flow:** app login screen has a "Forgot password" entry → user enters their **username** →
server (`POST /api/auth/forgot-password`, auth.ts ~1026) emails a 6-digit OTP to the email
**on file** → user enters code + new password (`POST /api/auth/reset-password`, auth.ts ~1074).
Codes expire in 15 min, are single-use, rate-limited per-IP and per-user, and burn after a few
wrong guesses. Email enumeration is hidden via a constant "if that username exists…" reply.

**Why support still gets recovery emails (owner-attested Jun 7 2026):** it is NOT a bug. The
flow needs (a) the user's username and (b) a real email on file. Many users **provide false
credentials at signup** — the email they later contact support from is not the one on the
account — so no code can reach them. There is nothing on our side to fix for those accounts.

**Decision:** owner chose to leave recovery as-is (Jun 7 2026). Don't spend time "fixing"
recovery for false-credential accounts. If recovery work is ever revisited, the only genuine
gaps are product choices (e.g. recover-by-email when username forgotten, or requiring a verified
email at signup) — all require explicit owner approval and are security-sensitive (online
guessing of reset codes is the threat-model concern).
