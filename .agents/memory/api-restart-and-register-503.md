---
name: API restart exits & register 503 are not crashes
description: Two deployment-log lines that look like errors but are expected/intentional, and how the server now handles restarts/DB blips.
---

## `503` on `POST /api/auth/register` = intentional soft-launch gate
- Driven by the `REGISTRATION_PAUSED` env var (truthy = `true`/`1`/`yes`/`on`). When set, register returns `503` with `{ paused: true }`. It is **not a crash** and does not affect login or any other route.
- **Reopen path:** set `REGISTRATION_PAUSED=false` (or remove it) on the **production** deployment, then re-publish. This is an owner-authorized production env change, not a code change.

## `signal: terminated` exits = routine platform restarts
- These used to look like error exits because the server had no graceful shutdown. The server now handles `SIGTERM`/`SIGINT`: stop accepting connections, drain in-flight requests, close the DB pool, then exit cleanly (10s force-exit safety timer).

## DB pool resilience (`lib/db/src/index.ts`)
- Pool has an idle-client `error` handler (an unhandled idle-client error would otherwise crash the process on a DB failover) plus `max` (`DB_POOL_MAX`, default 10), `idleTimeoutMillis` 30s, `connectionTimeoutMillis` 5s. A brief DB blip now fails fast and self-heals instead of surfacing as a `503`.

## SSL warning (deferred, harmless)
- Prod logs print `SECURITY WARNING: SSL modes 'prefer'/'require'/'verify-ca' treated as aliases for 'verify-full'`. It is a forward-compat warning from `pg` v8, **not an error**; current connection behavior is unchanged. Owner chose to defer — only address at a deliberate `pg` upgrade, since forcing strict verify could reject the DB cert and break connectivity.
