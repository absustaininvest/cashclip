---
name: iOS ASC API key invalid + EAS non-interactive build setup
description: Why V39 iOS builds fail at signing — the saved APPLE_ASC_* trio doesn't authenticate to Apple — plus the exact env vars and PEM-rewrap gotcha for non-interactive EAS iOS builds.
---

# iOS App Store Connect API key is invalid (V39 build blocker)

The saved `APPLE_ASC_KEY_ID` / `APPLE_ASC_ISSUER_ID` / `APPLE_ASC_PRIVATE_KEY` trio
does **not** authenticate to Apple. Proven by signing a correct ES256 JWT
(aud `appstoreconnect-v1`) and calling the App Store Connect API directly:
every endpoint returns **401 "Authentication credentials are missing or invalid"**
(`/v1/apps`, `/v1/profiles`, `/v1/certificates`, `/v1/bundleIds`). A 401 (not 403)
means the token itself is rejected → the Key ID and private key don't belong
together, or the key was revoked. Re-testing with `kid=87Z27CQ96U` (the real
"[Expo] EAS Submit" key, App Manager) + the same `.p8` also 401s, so the saved
`.p8` is neither known key.

**Why:** the trio was assumed self-consistent only because the issuer UUID matched
the account; that assumption was wrong. Issuer IDs are account-wide, so a matching
issuer proves nothing about the key/.p8 pairing.

**How to apply:** don't keep retrying iOS builds with the current secrets — they
will always 401. Owner must create a **fresh App Store Connect API key with the
Admin role** (App Manager/Developer can't manage certs/profiles, so EAS credential
generation needs Admin), download the one-time `.p8`, and save: new Key ID + the
`.p8` into `APPLE_ASC_KEY_ID` / `APPLE_ASC_PRIVATE_KEY`. The Issuer ID is
account-wide and stays the same. Re-verify with the JWT probe below before building.

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
