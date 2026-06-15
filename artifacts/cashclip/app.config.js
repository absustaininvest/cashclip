const baseConfig = require("./app.json");

const isDev = process.env.EXPO_PUBLIC_ENV === "development";

const devProjectId = "76c17169-4863-4e2c-9008-83e2d47d5461";
const prodProjectId = "aac2a3d9-56b6-49ab-b254-9b80e98bab2f";

module.exports = {
  ...baseConfig.expo,
  name: isDev ? "CashClip (Dev)" : baseConfig.expo.name,
  ios: {
    ...baseConfig.expo.ios,
    bundleIdentifier: isDev
      ? "app.replit.cashclip.dev"
      : baseConfig.expo.ios.bundleIdentifier,
  },
  android: {
    ...baseConfig.expo.android,
    package: isDev
      ? "app.replit.cashclip.dev"
      : baseConfig.expo.android.package,
  },
  extra: {
    ...(baseConfig.expo.extra ?? {}),
    appVisitProofKey: process.env.APP_VISIT_PROOF_KEY,
    eas: {
      projectId: isDev ? devProjectId : prodProjectId,
    },
  },
  updates: {
    ...baseConfig.expo.updates,
    url: isDev
      ? `https://u.expo.dev/${devProjectId}`
      : `https://u.expo.dev/${prodProjectId}`,
  },
};
