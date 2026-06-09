# V39 Prep — Complete Preservation Bundle

Everything we prepared for CashClip **build 39 (v1.1.0)**, plus the **proven-live build-29
OTA scripts**, captured June 9 2026 so nothing is ever lost — even if the workspace
disconnects.

> The heavy archives (`*.tar.gz`) and the `credentials/` folder are **LOCAL-ONLY**
> (see `../.gitignore`) — too big for git and/or sensitive signing material. They live
> in this grail folder on disk. The source they contain is **also** permanently in git
> history at the commits noted below, so they can be regenerated anytime with `git archive`.

## Contents

1. **`full-source-HEAD_f6e07a0.tar.gz`** _(local-only, ~447 MB)_
   The ENTIRE current workspace source at HEAD commit `f6e07a0` (git-tracked files, no
   `node_modules`). Contains everything we prepared for V39:
   - `artifacts/cashclip` — the **V39 app** (build 39, v1.1.0) with **all the latest fixes**
   - `artifacts/api-server` — the backend, including the **OWL / "Mail Lady"** unified support inbox
   - `artifacts/absustain` — corporate site + **`/sc-portal` admin** (where the OWL lives)
   - all docs (`V29_LIVE_FIXES.md`, `STORE_LISTING.md`, `snapshots/`, etc.)
   - Regenerate: `git archive -o out.tar.gz HEAD`

2. **`cashclip-OTA-live-good_9c71ec4.tar.gz`** _(local-only, ~4.4 MB)_
   The **proven-LIVE build-29 OTA source** — `artifacts/cashclip` at commit `9c71ec4`
   (good update group `26fa0d4c-44c7-49ca-9e7c-35a7cf835f86`, the version that ran clean
   for 36 h with correct consent). This is "what was successfully implemented on 29 — the
   actual live app in distribution."
   - Regenerate: `git archive -o out.tar.gz 9c71ec4 artifacts/cashclip`

3. **`_layout.build29.tsx`**
   The single build-29-safe layout override (HEAD's `_layout` with the 3 build-39-only
   native modules removed) used to ship JS-only OTAs onto live build 29. See
   `../../snapshots/build29-delivery/README.md` for the publish procedure.

4. **`credentials/`** _(local-only, SENSITIVE — never commit)_
   - `DistCert_CGHKZMC5AY.zip` — Apple iOS **Distribution Certificate** for V39 signing.
   - `CREDENTIALS-NOTES.txt` — reference notes for the Apple / Expo signing identifiers.

## Apple signing ("the apples") 🍎
- The **App Store Connect API key** (+ issuer + key id) is stored as Replit **secrets**
  (`APPLE_ASC_PRIVATE_KEY` / `APPLE_ASC_ISSUER_ID` / `APPLE_ASC_KEY_ID`) **and** inside
  Expo — so the actual key material is already safe.
- **Apple Team:** AB Sustainability Investments LLC (Company/Organization).
- The **Distribution Certificate** `.p12` is in `credentials/` (local-only).
- No Apple Push Keys needed; Android signing uses the existing CashClip keystore (must
  match the live Play build 38).
