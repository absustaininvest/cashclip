---
name: Production secrets location (Publishing vs workspace Secrets tab)
description: Why integration keys "work in dev but not in production" — the deployed API reads the deployment's Production app secrets, not the workspace Secrets tab, and changes need a re-publish.
---

# Where production integration keys must live

The live/deployed CashClip **API** uses the **deployment's Production app secrets** (Publishing → Overview → Production app secrets), a SEPARATE bucket from the workspace **Secrets tab**. Keys placed only in the workspace Secrets tab power the dev workflow but never reach the deployed production API.

**Why:** workspace and deployment are separate environments. The running deployment serves the secret snapshot captured at its **last publish**; it does not read the live workspace Secrets tab.

**How to apply:**
- For any integration key to work on the LIVE API (CPX, BitLabs, PayPal, offerwalls, etc.), set it under the deployment's Production app secrets — not just the Secrets tab.
- After adding/moving a production secret, the deployment must be **re-published** for it to take effect; the live app keeps running the previous snapshot until then. (This is the API server deployment only — NOT an App Store release, and it doesn't touch build 29.)
- Symptom this explains: integrations are wired in code and work in dev, but production shows $0 / "not configured" because the keys were only in the workspace Secrets tab. Owner hit exactly this in June 2026.
- Separate concern from OTA app updates (which deliver JS to the phone). This is server-side env on the deployed API.

**Integration Hub green/red is ENV-derived, not DB-backed.** Status is computed in-memory from
`process.env` (`integrations.ts` `envOk` = all of `envKey` + `additionalEnvKeys` present);
keys persist in a file-based encrypted store (`.data/integration-keys.enc.json`), NOT Postgres.
So "turn integration X green in production" = ensure ALL its required env vars are present, then
**re-publish** — never a database change/migration. (e.g. Unity Ads needs all 4:
`UNITY_ADS_GAME_ID_IOS`, `UNITY_ADS_GAME_ID_ANDROID`, `UNITY_MONETIZATION_API_KEY`,
`UNITY_ORGANIZATION_ID` — a missing Game ID keeps it red even if reporting works.)

**Before any production re-publish:** confirm `SEED_ADMIN_FORCE_RESET` and
`SEED_ADMIN_NUKE_RECREATE` are unset/false, or a restart will rewrite admin credentials.

Cross-ref: `cashclip-login-failure-diagnosis.md` (stale secret snapshot until republish).
