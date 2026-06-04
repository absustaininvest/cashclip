---
name: api-server real-DB integration tests
description: How to test money/SQL-heavy api-server routes against a real throwaway Postgres schema instead of faking the DB.
---

# Real-DB integration tests for api-server (earn/convert money flow)

For money-moving routes whose correctness lives in SQL (COALESCE/SUM rate math,
`FOR UPDATE`, transactions, advisory locks), prefer a REAL Postgres run over a
fake DB. Faking would have to re-implement that SQL and can be subtly wrong.

**Pattern (see `artifacts/api-server/src/routes/earnings.moneyFlow.test.ts`):**

- `DATABASE_URL` is always set in this environment; `earn_tokens` is normally
  empty. The acting DB user (`postgres`) can `CREATE SCHEMA`.
- Isolate in a throwaway schema created in `beforeAll`, dropped in `afterAll`.
  Pin every pooled connection to it so the routes' unqualified queries resolve
  there, NOT to the live `public` tables:
  `pool.on("connect", c => c.query('SET search_path TO <schema>, pg_catalog'))`.
  Attach this right after importing `@workspace/db` and before any query. (This
  raises a harmless pg deprecation warning about querying a busy client — pg
  queues per-connection so ordering holds; tests pass.)
- Use the real `pool` (exported from `@workspace/db`) for DDL/seeding via
  `pool.connect()`. **`pg` is NOT a direct dep of api-server**, so `import ...
  from "pg"` fails standalone typecheck and `Awaited<ReturnType<typeof
  pool.connect>>` collapses to `void` (TS picks the callback overload). Model a
  tiny local `{ query, release }` interface and cast `(await pool.connect()) as
  unknown as SqlClient`.
- Mock ONLY: `../storage` (so `authMiddleware`'s `storage.getUser` returns a
  valid user — echo back `{id, role, tokenVersion:0}` for any id), `../lib/logger`
  (silence), and `../lib/spinChallengeSweep` (its 30s interval would hit the DB
  after teardown). Keep `@workspace/db` and `pointsEconomy` REAL — import the same
  `pointsEconomy` module the route uses and call `invalidateRateCache()` after
  seeding `conversion_rates`, and never `vi.resetModules` (would split instances).
- Only `checkin` is client-recordable via `/api/earnings/record`; spin/admob are
  server-gated. Drive spin by inserting a `spin_challenges` row with `issued_at`
  in the past (skips the 3s min-wait), then POST `/spin/complete`. Drive AdMob
  SSV by generating an EC P-256 keypair, `vi.stubGlobal('fetch', ...)` to return
  it as the Google key, and signing the exact pre-`&signature=` query string.
- The auto-convert sweep is a closure on a 5-min timer; it's exposed for tests
  via the `runAutoConvertForTests` module export set inside
  `registerEarningsRoutes` (no behaviour change).

**Caveat:** the full api-server vitest suite has unrelated PRE-EXISTING failures
(`sponsoredWitness`, `surveyProviders`, `webhookRoutes` — e.g. webhookAuth
`Cannot read properties of undefined (reading 'catch')`, hook timeouts). Don't
assume a red full-suite run is from your change; scope-check first.
