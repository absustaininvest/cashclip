---
name: api-zod orval emits single-file output
description: Why lib/api-zod/src/index.ts must NOT export ./generated/api.schemas after codegen
---

The orval **zod** generator for `lib/api-zod` emits a single `generated/api.ts` containing all schemas — it does NOT emit a separate `generated/api.schemas.ts` (unlike the react-query client `lib/api-client-react`, which does emit both `api.ts` + `api.schemas.ts`).

**Rule:** `lib/api-zod/src/index.ts` must only `export * from "./generated/api"`. Adding `export * from "./generated/api.schemas"` breaks `typecheck:libs` with TS2307 (module not found).

**Why:** An older generation once left a stale `api.schemas.ts` on disk, so the bad export "worked" until someone re-ran `pnpm --filter @workspace/api-spec run codegen` — orval's "clean output folder" step deletes it, surfacing the latent TS2307. The only real consumer is `HealthCheckResponse` (imported by api-server `routes/health.ts`), which lives in `api.ts`.

**How to apply:** After any codegen run, if `typecheck:libs` fails on `./generated/api.schemas` for the zod package, drop that line from the index — don't try to recreate the file.
