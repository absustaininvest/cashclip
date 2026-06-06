---
name: Prod deploy log noise — healthcheck cold-starts, SSL warning, orphaned-user FK
description: How to read the recurring scary-looking lines in the CashClip production deployment logs (mostly benign) and the one item worth fixing.
---

# Prod deployment is a 2-artifact autoscale deploy

The live production deployment runs **two artifacts together**: `artifacts/cashclip`
(its `server/serve.js` serves `/` — the web app + app-ads.txt) and
`artifacts/api-server` (serves `/api`). This is the "Published 2 artifacts"
(web + phone icons) shown in the Publish dialog. Republishing that one deployment
rebuilds BOTH — so it's the correct target to push an app-ads.txt change live.

**Why:** explains why the platform healthcheck pings both `/` and `/api`, and why a
serve.js edit only goes live after that deployment is republished.

# The scary log lines, decoded (mostly benign)

- `healthcheck failed ... connection refused` then `... returned status 500`, immediately
  followed by `artifact process started` for both artifacts, then normal `request completed`
  200/201 — this is the **autoscale cold-start window** (deploy sleeps when idle, wakes on
  traffic; pings knock for ~2-3s before both processes listen). NOT a crash.
- `artifact process exited with error error=signal: terminated` = graceful shutdown on
  scale-down / redeploy. Routine.
- `SECURITY WARNING: The SSL modes 'prefer'/'require'/'verify-ca' ... pg-connection-string v3.0.0`
  = harmless pg deprecation notice. Cosmetic. Deferred (don't touch DATABASE_URL sslmode on a
  money app without strong reason + approval).
- `Connection terminated due to connection timeout / unexpectedly` on background jobs
  (auto-convert, dedupe_slots prune) = DB connection dropped during idle/sleep; the job misses
  one cycle and self-heals next cycle (pool has idle-error handler + limits).

**How to apply:** when the owner pastes a wall of these, FIRST curl the legal prod domains
(cash-clip.app/, /app-ads.txt, api.cash-clip.app/api) — if they're 200 the app is fine and
these are noise. Don't alarm him.

# The one real item: orphaned-user FK violation (worth a cleanup)

Recurring prod error: `auto-convert: user transaction failed, skipping ... insert ... violates
foreign key constraint "earnings_ledger_user_id_users_id_fk"`. Cause: a user row was deleted
but their `earn_tokens` (pending) remained, so the periodic auto-convert job tries to credit a
non-existent user every cycle, the FK insert fails, it's caught and skipped (non-fatal, no
crash). Fix options (owner-approval-gated, prod DB): one-time cleanup of orphaned earn rows for
deleted users, and/or guard auto-convert to skip user_ids absent from `users` before insert.
**Why:** it's noisy but safe; only matters as recurring log spam + tokens that can never convert.
