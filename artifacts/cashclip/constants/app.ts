export const SUPPORT_EMAIL = "support@absustaininvest.com";
export const PRIVACY_POLICY_URL = "https://cash-clip.app/privacy";
export const TERMS_URL = "https://cash-clip.app/terms";

/** Must match the version in app.json — sent as X-App-Version on every API request. */
export const APP_VERSION = "1.1.0";

/**
 * Returns the sponsored-visit proof key embedded in the app binary at EAS
 * build time.
 *
 * The key is read from Constants.expoConfig.extra.appVisitProofKey, which is
 * populated by app.config.js from the APP_VISIT_PROOF_KEY EAS secret. It is
 * NOT an EXPO_PUBLIC_* environment variable (those are "intentionally
 * client-exposed" per Expo docs). Extracting this value requires decompiling
 * the compiled .jsbundle or the native binary — it is not accessible via any
 * JavaScript process.env.* lookup in a standard Expo environment.
 *
 * The server holds the matching secret in APP_VISIT_PROOF_KEY and uses it to
 * validate HMAC-SHA256 appAttestations at /visit time.
 */
export function getAppVisitProofKey(): string {
  try {
    // expo-constants is a devDependency always present in Expo managed builds.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Constants = require("expo-constants").default;
    const key = Constants.expoConfig?.extra?.appVisitProofKey;
    if (typeof key === "string" && key.length > 0) return key;
  } catch {
    /* not running inside an Expo environment (e.g. unit tests) */
  }
  return "dev-proof-key-replace-in-eas-build";
}

