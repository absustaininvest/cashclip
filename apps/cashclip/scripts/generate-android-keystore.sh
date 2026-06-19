#!/usr/bin/env bash
set -euo pipefail

KEYSTORE_DIR="$(dirname "$0")/../credentials"
KEYSTORE_FILE="${KEYSTORE_DIR}/release.keystore"
ALIAS="cashclip-release"

if [ -z "${KEYSTORE_PASSWORD:-}" ]; then
  echo "ERROR: KEYSTORE_PASSWORD environment variable is required."
  echo "Usage: KEYSTORE_PASSWORD=<password> KEY_PASSWORD=<password> $0"
  exit 1
fi

if [ -z "${KEY_PASSWORD:-}" ]; then
  echo "ERROR: KEY_PASSWORD environment variable is required."
  echo "Usage: KEYSTORE_PASSWORD=<password> KEY_PASSWORD=<password> $0"
  exit 1
fi

if [ ${#KEYSTORE_PASSWORD} -lt 8 ]; then
  echo "ERROR: KEYSTORE_PASSWORD must be at least 8 characters."
  exit 1
fi

if [ ${#KEY_PASSWORD} -lt 8 ]; then
  echo "ERROR: KEY_PASSWORD must be at least 8 characters."
  exit 1
fi

if [ -f "$KEYSTORE_FILE" ]; then
  echo "Keystore already exists at ${KEYSTORE_FILE}"
  echo "Delete it first if you want to regenerate."
  exit 1
fi

mkdir -p "$KEYSTORE_DIR"

echo "Generating Android release keystore for app.replit.cashclip..."

keytool -genkeypair \
  -v \
  -storetype JKS \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -storepass "$KEYSTORE_PASSWORD" \
  -keypass "$KEY_PASSWORD" \
  -alias "$ALIAS" \
  -keystore "$KEYSTORE_FILE" \
  -dname "CN=CashClip, OU=Mobile, O=CashClip, L=Unknown, ST=Unknown, C=US"

echo ""
echo "Keystore generated at: ${KEYSTORE_FILE}"
echo ""
echo "IMPORTANT: Store these values as EAS Secrets:"
echo "  eas secret:create --name ANDROID_KEYSTORE_PASSWORD --value '<your password>'"
echo "  eas secret:create --name ANDROID_KEY_PASSWORD --value '<your password>'"
echo "  eas secret:create --name ANDROID_KEY_ALIAS --value '${ALIAS}'"
echo ""
echo "Then configure EAS Build with this keystore:"
echo "  eas credentials -p android"
