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

## `eas submit` credential override (Jun 2026)
`eas submit` IGNORES the `EXPO_ASC_API_KEY_PATH`/`EXPO_ASC_KEY_ID`/`EXPO_ASC_ISSUER_ID`
env vars that work for `eas build`. It always uses the EAS-stored key.
**To bypass the EAS-stored key**, add ALL THREE fields to `submit.production.ios` in
`eas.json`: `ascApiKeyPath` (local .p8 file path), `ascApiKeyIssuerId`, `ascApiKeyId`.
The CLI reads the file locally and sends the key content to EAS servers. If the file
path doesn't exist, it falls back to interactive prompt → fails in non-interactive mode.
**Jun 2026 status:** both keys revoked at Apple — EAS-stored `87Z27CQ96U` and workspace
`36377NCG8Z` both return 401. Verified with `@expo/apple-utils` Token class directly.
Owner must create a new Team Admin key in ASC, update `APPLE_ASC_KEY_ID`+`APPLE_ASC_PRIVATE_KEY`
secrets, re-drop the .p8 in chat, write to `/tmp/asc_key.p8`, add the three eas.json
submit fields pointing to it, and run `eas submit --platform ios --latest --profile production --non-interactive`.
