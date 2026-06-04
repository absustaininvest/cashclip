const { withAppBuildGradle } = require('@expo/config-plugins');

/**
 * Adds the Google Mobile Ads ironSource mediation adapter to the Android build.
 * Required for ironSource (LevelPlay) to bid/serve through AdMob mediation on
 * Android. Companion to the iOS GoogleMobileAdsMediationIronSource pod in
 * extraPods. The ironSource SDK itself is hosted on the ironSource Maven repo
 * (https://android-sdk.is.com/), added via expo-build-properties extraMavenRepos.
 *
 * Phase 5 — added with the native build that bumps versionCode to 39.
 */
const withAndroidIronSourceAdapter = (config) => {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.contents.includes('com.google.ads.mediation:ironsource')) {
      return config;
    }
    config.modResults.contents = config.modResults.contents.replace(
      /dependencies\s*\{/,
      'dependencies {\n    implementation "com.google.ads.mediation:ironsource:9.4.2.0"'
    );
    return config;
  });
};

module.exports = withAndroidIronSourceAdapter;
