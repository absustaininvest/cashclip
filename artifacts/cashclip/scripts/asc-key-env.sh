# ── Materialize ASC key + export EXPO_ASC_* from Replit Secrets ───────────────
# Shared by both `eas build` (eas-build-ios-46.sh) and `eas submit`
# (eas-submit-ios.sh). Resolves the active App Store Connect API key ENTIRELY
# from Replit Secrets — no key ID, issuer ID, or .p8 path is ever baked into
# source, so a future key rotation only needs the secrets updated.
#
#   APPLE_ASC_PRIVATE_KEY  — the .p8 contents (never stored in the repo)
#   APPLE_ASC_KEY_ID       — the key ID
#   APPLE_ASC_ISSUER_ID    — the issuer ID
#
# The .p8 is written to /tmp at run time and discarded with the sandbox.
# Exports EXPO_ASC_API_KEY_PATH / EXPO_ASC_KEY_ID / EXPO_ASC_ISSUER_ID, which
# both `eas build` and `eas submit` read. This file is meant to be sourced; it
# exits non-zero (aborting the caller) if any required secret is missing.

if [ -z "$APPLE_ASC_KEY_ID" ]; then
  echo "ERROR: APPLE_ASC_KEY_ID secret is not set." >&2
  exit 1
fi
if [ -z "$APPLE_ASC_ISSUER_ID" ]; then
  echo "ERROR: APPLE_ASC_ISSUER_ID secret is not set." >&2
  exit 1
fi

KEY_ID="$APPLE_ASC_KEY_ID"
KEY_PATH="/tmp/AuthKey_${KEY_ID}.p8"
KEY_PATH="$KEY_PATH" node -e 'const s=(process.env.APPLE_ASC_PRIVATE_KEY||"").replace(/\\n/g,"\n").trim(); if(!s){console.error("ERROR: APPLE_ASC_PRIVATE_KEY secret is not set.");process.exit(1)} const pem=s.includes("\n")?s:`-----BEGIN PRIVATE KEY-----\n${s.replace(/-----[^-]+-----/g,"").replace(/\s+/g,"").match(/.{1,64}/g).join("\n")}\n-----END PRIVATE KEY-----`; require("fs").writeFileSync(process.env.KEY_PATH, pem.endsWith("\n")?pem:pem+"\n");' || exit 1
echo "Wrote ASC key $KEY_ID to $KEY_PATH"

export EXPO_ASC_API_KEY_PATH="$KEY_PATH"
export EXPO_ASC_KEY_ID="$KEY_ID"
export EXPO_ASC_ISSUER_ID="$APPLE_ASC_ISSUER_ID"
