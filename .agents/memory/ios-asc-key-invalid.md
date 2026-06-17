---
name: iOS ASC API key — Admin Team Key required for EAS builds
description: The iOS signing 401 was a revoked key; fix is a fresh Admin Team Key. Includes how to validate any ASC key, the PEM-rewrap gotcha, and the exact env vars for non-interactive EAS iOS builds.
---

# iOS App Store Connect API key — what makes signing work (V39 build)

**Root cause of the long 401 streak:** the ASC key saved in secrets was a
**revoked** key. The App Store Connect → Integrations → App Store Connect API →
Team Keys page showed the only Admin key (`F74QC35BH2`) was Revoked (May 2026);
the one Active key (`87Z27CQ96U`, "[Expo] EAS Submit") is **App Manager** (can
submit, can't manage certs/profiles). Signing a correct ES256 JWT
(aud `appstoreconnect-v1`) against `/v1/apps`,`/v1/profiles`,`/v1/certificates`
returned **401** for the saved trio and for `kid=87Z27CQ96U` → the saved `.p8`
matched neither and was a dead key. A 401 (not 403) = token rejected
(wrong/revoked key), not a permissions problem.

**Fix that worked:** owner created a **fresh App Store Connect *Team* Key with the
Admin role** (App Manager/Developer can't manage certs/profiles → EAS credential
generation needs Admin; an Individual Key is a different, per-user thing — use a
Team Key). Apple names the download `AuthKey_<KEYID>.p8`, so the filename reveals
the Key ID. The new Admin key validated **200** on `/v1/apps`,`/v1/certificates`,
`/v1/profiles`,`/v1/bundleIds`. Saved into `APPLE_ASC_KEY_ID` +
`APPLE_ASC_PRIVATE_KEY`.

**Why issuer never needed changing:** the Issuer ID
(`45944549-8278-4477-a1c6-3348ec45c3f0`, shown on the Team Keys page header) is
**account-wide and constant** — it stays the same across key create/revoke, so a
matching issuer proves nothing about whether a specific Key ID/.p8 pair is valid.

**How to apply / re-validate:** never trust an ASC key by issuer match alone —
prove it by signing an ES256 JWT and hitting the App Store Connect API; want
**200** on `/v1/profiles` and `/v1/certificates` (Admin) before building. If 401,
the key is revoked/mismatched → make a new Admin Team Key. Credential-setup
failures in `eas build` are FREE (machine starts only after creds succeed), so
iterate freely.

## PEM-flattening gotcha (must fix before use)
`APPLE_ASC_PRIVATE_KEY` is stored **flattened to a single line** — no real newlines
and no escaped `\n`. Writing it to a file raw yields a malformed PEM
(`error:1E08010C:DECODER routines::unsupported`), which by itself causes Apple 401.
Before use, rewrap: extract the base64 body between the BEGIN/END markers, strip all
whitespace, re-emit as `-----BEGIN PRIVATE KEY-----\n<body in 64-char lines>\n-----END PRIVATE KEY-----\n`.
Node: `crypto.createPrivateKey(rewrapped)` → `ec` key. Apple needs ES256 with
`crypto.sign('SHA256', input, {key, dsaEncoding:'ieee-p1363'})` (JOSE r||s, not DER).
This rewrap also matters when writing the temp `.p8` for `eas build`.

## EAS non-interactive iOS build env vars (eas-cli 18.11.0)
Read by `eas-cli/build/credentials/ios/appstore/resolveCredentials.js`:
`EXPO_ASC_API_KEY_PATH`, `EXPO_ASC_KEY_ID`, `EXPO_ASC_ISSUER_ID`,
`EXPO_APPLE_TEAM_ID`, `EXPO_APPLE_TEAM_TYPE` (enum: `IN_HOUSE`,
`COMPANY_OR_ORGANIZATION`, `INDIVIDUAL`), plus `EXPO_APPLE_ID`/`EXPO_APPLE_PASSWORD`
fallback. For this app: `EXPO_APPLE_TEAM_ID=FAX932PG78` (AB Sustainability
Investments LLC) + `EXPO_APPLE_TEAM_TYPE=COMPANY_OR_ORGANIZATION`. Setting team type
removed the "Select your Apple Team Type" prompt; the next wall was the ASC 401.

**Credential-setup failures are FREE** — the EAS build machine only starts after
credentials succeed, so iterating on signing costs nothing from the plan.

## In-session secret-snapshot staleness + file bypass (V39 build, Jun 2026)
When a secret is rotated **mid-session**, the workspace runtime stays pinned to the
session-start snapshot: `$APPLE_ASC_KEY_ID` in bash kept reading the OLD revoked key
after the owner saved the new one, and it did **not** refresh via workflow restart, a
2-min wait, or even a full publish/deploy. `code_execution` has no `process.env`, so
the new value can't be read there either. A real `eas build` confirmed it grabbed the
stale key and 401'd at `Fetching Apple provisioning profiles`.
**Bypass that worked:** have the owner re-drop the `AuthKey_<KID>.p8` file into chat,
then build **env-independent** — point `EXPO_ASC_API_KEY_PATH` at the file and
**hardcode** `EXPO_ASC_KEY_ID` + `EXPO_ASC_ISSUER_ID` (don't read them from env).
With the good Admin key this sailed past creds (`✔ Updated provisioning profile`,
`All credentials are ready`) and queued build 39. Purge the `.p8` right after the
build queues. NOTE: this only fixes the build; the saved secret is still stale for
everything else until a fresh session reloads the snapshot — re-verify later.

## `eas submit` credential override — RESOLVED (Jun 2026)
`eas submit` IGNORES the `EXPO_ASC_API_KEY_PATH`/`EXPO_ASC_KEY_ID`/`EXPO_ASC_ISSUER_ID`
env vars that work for `eas build`. It reads credentials from the EAS-stored key (set via
`eas credentials --platform ios`) or from explicit fields in `submit.production.ios` in
`eas.json` (`ascApiKeyPath`, `ascApiKeyIssuerId`, `ascApiKeyId`).

**Current state (verified Jun 12 2026):** Two separate keys in use:

| Key | Key ID | Role | Where stored | Purpose |
|-----|--------|------|--------------|---------|
| EAS submit key | `87Z27CQ96U` | APP_MANAGER | EAS (private key held by EAS, not in workspace secrets) | `eas submit` — uploading IPA to App Store Connect. App Manager is sufficient for this. |
| Workspace secret | `36377NCG8Z` | Unknown | `APPLE_ASC_KEY_ID` + `APPLE_ASC_PRIVATE_KEY` secrets | `eas build` — signing certs/profiles. **REVOKED at Apple (returns 401).** |

**EAS submit key `87Z27CQ96U` validation evidence (Jun 12 2026 — re-confirmed active Jun 12 2026):**
- `eas submit --platform ios --latest --non-interactive` confirmed: EAS loaded key
  `87Z27CQ96U` and moved past credential validation (`✔ App Store Connect API Key already
  set up.`), then scheduled and submitted to Apple. Test runs errored at Apple's side (not
  at auth), consistent with "already submitted" rejections for build 40 (which was already
  uploaded on 2026-05-28).
- EAS submission history query confirms: submission `3735d8dd` on 2026-05-28 has
  `status=FINISHED` — direct evidence `87Z27CQ96U` successfully authenticated with Apple
  to deliver build 40. Key does not auto-expire; valid unless manually revoked.
- The EAS key's private key is held by EAS only — it cannot be read from the workspace.
  Owner can confirm it's still Active in App Store Connect → Integrations → App Store
  Connect API → Team Keys (look for `87Z27CQ96U` status).

**Current workspace key: `4CZ93ZJV6B` (Admin Team Key).** Saved in
`APPLE_ASC_KEY_ID` + `APPLE_ASC_PRIVATE_KEY`. Re-validated Jun 17 2026 → **200** on
`/v1/apps`, `/v1/certificates`, `/v1/profiles`, `/v1/bundleIds` (authenticates cleanly,
Admin role). Issuer unchanged (`45944549-8278-4477-a1c6-3348ec45c3f0`).
**The previously-exposed key `DGVBV8VV95` has been REVOKED by the owner (Jun 17 2026)** —
exposed-key concern resolved. Owner submitted build 46 to the App Store himself and does
NOT want an agent-run `eas submit`/build (see `cashclip-current-build-state.md`).

**Prior key (history):** `DGVBV8VV95` (Admin, created Jun 15 2026) — now revoked.

**Replacement process (for future rotations):**
1. Owner creates a new Admin Team Key in ASC → Integrations → App Store Connect API → Team Keys → (+).
2. Download the `.p8`; the filename reveals the Key ID: `AuthKey_<KEY_ID>.p8`.
3. Validate with `node scripts/validate-asc-key.js <file.p8> <KEY_ID> 45944549-8278-4477-a1c6-3348ec45c3f0` — want 200 on all three endpoints (apps, certificates, profiles).
4. Save `APPLE_ASC_KEY_ID` + `APPLE_ASC_PRIVATE_KEY` workspace secrets (one at a time).
5. Run `bash scripts/store-asc-key-in-eas.sh <file.p8>` to push the key into EAS credential storage.
6. Revoke old key in ASC.
7. Due to in-session snapshot staleness: drop the `.p8` file into chat again at build time so the build script can reference it by path rather than reading the stale env var.

**Query to read EAS-stored submit key (via Expo GraphQL API):**
```js
// POST https://api.expo.dev/graphql  Authorization: Bearer $EXPO_TOKLAST
query {
  app { byId(appId: "aac2a3d9-56b6-49ab-b254-9b80e98bab2f") {
    iosAppCredentials {
      appStoreConnectApiKeyForSubmissions {
        keyIdentifier name roles createdAt updatedAt
      }
    }
  }}
}
```
