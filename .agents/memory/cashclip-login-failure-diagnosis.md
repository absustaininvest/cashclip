---
name: CashClip live login failure diagnosis
description: How to diagnose "Login failed" on the live CashClip app; the DB-backed rate limiter makes a prod DB outage look like a login bug.
---

# "Login failed" on the live app is usually a production DB problem, not the app

**Symptom:** Users (incl. owner) can reach the app but login spins then shows a generic
"Login failed". GET endpoints work; POST `/api/auth/login` and `/api/auth/register`
return **503** very fast (~1-2ms) or hang.

**Root cause pattern:** The login/register handlers call the DB-backed rate limiter
(`recordLoginAttempt`, `dbRateLimit.ts`) *before* checking credentials. If the
production PostgreSQL is unreachable, that first DB write throws and the route 503s —
so a database outage presents as a login bug.

**Tell-tale log line:** Drizzle query error on `INSERT INTO login_attempts ...` with
`caused by: error: Control plane request failed` (a Replit/Neon serverless Postgres
control-plane error = new DB connections failing). Some warm-pooled requests still
succeed intermittently, which is why a few routes work while login fails.

**How to confirm fast:**
- `fetch_deployment_logs` filtered for `Control plane request failed` / `503` / `login_attempts`.
- Direct DB probe: agent `executeSql` against `environment:"production"` times out while
  `environment:"development"` `SELECT 1` succeeds.
- `curl https://cash-clip.app/` (GET) → 200, but `curl -X POST .../api/auth/login` → hangs/000.

**Key implications:**
- This is a **server/database infrastructure** issue, NOT app code and NOT fixable by an
  expo-updates OTA. Don't ship client changes to "fix" it.
- First recovery step: restart / re-publish the production deployment (refreshes DB
  connections). If it persists, it's a Replit managed-Postgres service issue.

# "Tracking is Off" gate reappearing (separate, minor)

`components/TrackingConsentGate.tsx` shows the "Tracking is Off" screen when iOS ATT
status for the app is `denied` and the `tracking_consent_dismissed_v1` AsyncStorage key
isn't set. It has a "Continue Without Tracking" button — it does **not** block login.
On a fresh install the first open runs the OLD embedded store build while the OTA
downloads in the background; fully closing and reopening loads the new code. So a
re-appearing gate on the 2nd open is expected right after an OTA lands on a fresh install.
