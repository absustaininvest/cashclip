const { withAppBuildGradle } = require('@expo/config-plugins');

/**
 * Adds the Google Mobile Ads Pangle (TikTok Audience Network) mediation adapter
 * to the Android build. Required for Pangle/TikTok to bid/serve through AdMob
 * mediation on Android. Companion to the iOS GoogleMobileAdsMediationPangle pod
 * in extraPods. The Pangle SDK is published to Maven Central, so no extra repo
 * is needed.
 *
 * Phase 5 — added with the native build that bumps versionCode to 39.
 */
const withAndroidPangleAdapter = (config) => {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.contents.includes('com.google.ads.mediation:pangle')) {
      return config;
    }
    config.modResults.contents = config.modResults.contents.replace(
      /dependencies\s*\{/,
      'dependencies {\n    implementation "com.google.ads.mediation:pangle:8.0.0.5"'
    );
    return config;
  });
};

module.exports = withAndroidPangleAdapter;
