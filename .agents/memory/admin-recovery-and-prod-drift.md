---
name: Admin account recovery + prod schema drift
description: How to recover a locked-out CashClip admin (TOTP/no-email) and why the deployed DB lags the dev schema.
---

# Locked-out admin recovery (TOTP enabled, no recovery email)

The recovery tool is `POST /api/admin/users/:userId/factory-reset` (regenerates password,
clears TOTP, bumps tokenVersion). It is double-gated: `adminMiddleware` (Bearer admin JWT
**or** `x-console-token: <ADMIN_TOKEN>`) **and** `secretsPassphraseMiddleware`
(`x-secrets-passphrase: <SECRETS_PASSPHRASE>`).

**You (the agent) cannot trigger this against production from the workspace.** Two hard blocks:
- `SECRETS_PASSPHRASE` is **not exposed** to the workspace env (length 0) — by design.
- The deployment's `ADMIN_TOKEN` does **not** match the workspace `ADMIN_TOKEN` (deployment
  has its own secret snapshot), so `x-console-token` is rejected with `401 "No token provided"`.

**Correct recovery path = the portal, done by the owner:** log in as a working admin with no
2FA (e.g. `support@cash-clip.app`) at the `/sc-portal` CashClip Users panel → click
**Factory Reset** on the target user → enter the `SECRETS_PASSPHRASE` value → the tool shows a
one-time new password. Then log in as the target with that password (no 2FA prompt) and change it.

**Why:** the passphrase gate intentionally keeps high-privilege account takeover off any
externally-driven path; only an operator who knows the passphrase can run it.

# Production DB schema lags dev

The deployed/production Postgres runs an **older schema** than dev. Dev `drizzle-kit push`
(and post-merge.sh) only updates the **dev** DB; the production schema only advances on
**Publish/deploy**. Symptom: read-only prod queries fail with `column "..." does not exist`
(e.g. `totp_backup_codes`, `security_audit_log` existed in dev long before prod).

**How to apply:** when querying production read-replica, select only columns that exist in the
*deployed* schema, not the latest dev schema. And before relying on any merged DB-dependent
feature in production, confirm a Publish has actually shipped that schema.
