const baseConfig = require("./app.json");

/**
 * app.config.js — dynamic Expo config that reads EAS secrets at build time.
 *
 * APP_VISIT_PROOF_KEY is an EAS secret. It is embedded into the compiled
 * binary via Constants.expoConfig.extra — NOT via an EXPO_PUBLIC_* env var
 * (which would make it "intentionally client-exposed" per Expo security docs).
 * Extracting the key requires decompiling the compiled .jsbundle or native
 * binary, raising the bar significantly against scripted claim automation.
 *
 * The matching value must also be set as APP_VISIT_PROOF_KEY on the API server.
 */
module.exports = {
  ...baseConfig.expo,
  extra: {
    ...(baseConfig.expo.extra ?? {}),
    appVisitProofKey: process.env.APP_VISIT_PROOF_KEY ?? "dev-proof-key-replace-in-eas-build",
    eas: {
      ...(baseConfig.expo.extra?.eas ?? {}),
    },
  },
};
