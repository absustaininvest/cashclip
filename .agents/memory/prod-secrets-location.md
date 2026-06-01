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

Cross-ref: `cashclip-login-failure-diagnosis.md` (stale secret snapshot until republish).
