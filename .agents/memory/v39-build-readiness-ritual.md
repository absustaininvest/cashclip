---
name: New-build readiness ritual (owner-required)
description: What owner Jorge means by "ready" before kicking off any NEW native build (e.g. V39).
---

# New-build readiness ritual

Before any NEW native build, owner Jorge requires a COMPLETE preservation bundle saved
to the "grail" (`exports/expo-artifacts/`) FIRST. He calls this being "prepared," and
treats it as non-negotiable. The bundle must contain:

- All native build binaries (`.ipa`/`.aab`) catalogued in `MANIFEST.txt` with download links.
- The proven-live build-29 OTA source (good commit `9c71ec4`, group `26fa0d4c-…`).
- The latest full workspace source (HEAD) — includes the V39 app + the OWL / "Mail Lady"
  support-inbox backend + `/sc-portal`.
- Signing credentials: the Apple Distribution Certificate (`.zip`/`.p12`) and reference
  notes for the App Store Connect API key (the actual ASC key lives in Replit secrets
  `APPLE_ASC_PRIVATE_KEY` / `APPLE_ASC_ISSUER_ID` / `APPLE_ASC_KEY_ID`, plus inside Expo).

**Storage rule:** heavy archives (`*.tar.gz`) and the `credentials/` folder are LOCAL-ONLY
(gitignored) — too big and/or sensitive (a signing cert must never enter git). The
human-readable catalogue (`MANIFEST.txt`, `README.md`) stays tracked in git. Source is
also recoverable from git history at the noted commits via `git archive`.

**Why:** he's been burned before — prior project trees were wiped, and an agent
"disconnected" (context compression) mid-session. This backup ritual is how he protects
years of work and defines confidence before spending on a new build.

**How to apply:** when he says "new build," refresh/confirm the grail bundle BEFORE
kicking the EAS build. Don't fire a non-interactive production build until signing
credentials are confirmed wired into Expo (Apple dist cert + provisioning + ASC key;
Android `.aab` MUST reuse the same keystore as live Play build 38 or Play rejects it).
