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
- The outage is typically **intermittent and self-healing** — observed flickering up/down
  over ~1hr then recovering on its own (prod `SELECT 1` went from 40s-timeout to 5s-OK with
  no intervention; live login endpoint returned to ~0.3s HTTP 400 once DB recovered).
  The transient control-plane outage itself is not "cured" by a redeploy — but **do not tell a
  non-technical owner that re-publishing is useless.** Republishing is exactly how corrected
  config/secrets reach the live app (see next bullet), and a fresh deploy restarts DB
  connection pools, so a republish that coincides with recovery is not pure coincidence.
- **No app-side change can restore login during the outage**: user accounts/credentials live
  in the prod DB, so while it's unreachable nobody can authenticate regardless of code.
- Prod and dev are **separate databases**: dev stays healthy throughout (good for proving
  "data isn't lost, just unreachable" and reassuring a panicking non-technical owner).
- **Secrets vs. the live app — the subtle, important part.** `viewEnvVars({environment})` reads
  the *workspace* secret store and showed the correct current names (`JWT_ACCESS_SECRET`,
  `JWT_REFRESH_SECRET`, `DATABASE_URL`). BUT a Replit deployment runs on the **secret snapshot
  captured at publish time** — workspace edits do NOT reach the live published app until you
  **republish**. So "I checked the secrets, they're fine" can be misleading: the live app may
  still be running an OLDER snapshot (the Publishing panel showed stale obfuscated names like
  `INVECE`, `JWT_TRIDENTE`, `RIPRENDERE` long after the code/workspace had moved to clean names).
  The obfuscated names were once wired into real auth/session/refresh code and have since been
  renamed in source; only some `*.test.ts` files still reference `JWT_TRIDENTE` (harmless).
  **Lesson:** don't flatly tell the owner "secrets aren't it" — there is a real workspace-vs-
  published divergence, and deleting the old duplicates + republishing legitimately re-aligns
  the live app. Confirm the live state (curl the endpoint), don't just read `viewEnvVars`.
- Best non-support action: **monitor and wait** (loop prod `SELECT 1`); it usually clears in
  minutes–hours. Owner considers Replit support a dead end, so don't over-rely on a ticket.

# AdMob: two separate "moneys" — don't conflate them

The app **does** use Google AdMob (real publisher units, live in prod) **alongside** Unity Ads —
do not say "there's no AdMob, it's only Unity." Two unrelated money paths:
- **User-reward crediting (our system):** rewarded ads credit the user via a **server-side
  verification (SSV) callback from Google to the API**, which **writes to the prod DB**. So a
  prod DB outage silently drops ad-reward credits during the outage window; it recovers when the
  DB does. This path *is* affected by the DB/deploy health discussed above.
- **Publisher payout (NOT our system):** Google paying the owner into PayPal is governed entirely
  by the **AdMob account → Payments** (≈$100 threshold, verified payment profile, address PIN, tax
  forms). App secrets / server changes can't fix it. If payouts aren't arriving, point the owner
  to the AdMob console, not the code.

# "Tracking is Off" gate reappearing (separate, minor)

`components/TrackingConsentGate.tsx` shows the "Tracking is Off" screen when iOS ATT
status for the app is `denied` and the `tracking_consent_dismissed_v1` AsyncStorage key
isn't set. It has a "Continue Without Tracking" button — it does **not** block login.
On a fresh install the first open runs the OLD embedded store build while the OTA
downloads in the background; fully closing and reopening loads the new code. So a
re-appearing gate on the 2nd open is expected right after an OTA lands on a fresh install.
