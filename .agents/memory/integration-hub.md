---
name: Admin Integration Hub
description: How the /sc-portal Integration Hub derives its live status, online-user count, and deploy timestamp — and the operational caveats.
---

# Admin Integration Hub

The absustain `/sc-portal` admin portal has an "Integration Hub" tab backed by
`GET /api/admin/integration-hub` (adminMiddleware). It returns per-integration
status, API+website service health, app version + last deploy time, and a
"users online (last 5 min)" count. The page auto-refreshes client-side.

**Integration status semantics:** green = configured AND (no public probe URL, or
probe reachable); amber = configured but the provider's public endpoint is
unreachable; red = credentials missing. Live probes reuse the shared
`checkIntegrationsHealth` helper (also used by `/api/integrations/health`).
**Why:** "configured" alone was a weak signal; amber distinguishes a real outage
from a missing key without crying wolf when a provider has no cheap health URL.

**"Last deployed" timestamp = esbuild `define` of `process.env.BUILD_TIME`** in
`artifacts/api-server/build.mjs`, stamped at build time.
**Why/caveat:** it advances only when the bundle is rebuilt — i.e. on Publish or
a dev restart — NOT when you merely change a production env var. Same family of
gotcha as prod secrets only taking effect after re-publish. In tests (no esbuild)
it is undefined and the handler reports `lastDeployedAt: null`.

**"Users online" = `users.lastSeenAt`**, touched best-effort in `authMiddleware`
(per-replica ~60s throttle map) with the DB UPDATE additionally guarded by a
`lastSeenAt < now() - 50s` WHERE clause so it stays correct across autoscaled
replicas with independent in-memory throttles. The column needs the usual
post-merge `@workspace/db` push to reach the dev DB and a Publish to reach prod.
