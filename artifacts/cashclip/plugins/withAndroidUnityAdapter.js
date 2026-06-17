const { withAppBuildGradle } = require('expo/config-plugins');

/**
 * Adds the Google Mobile Ads Unity mediation adapter to the Android build.
 * Required for Unity Ads to bid/serve as a demand source through AdMob mediation on Android.
 * Companion to the iOS GoogleMobileAdsMediationUnity pod in extraPods.
 *
 * Staged: May 2026 — activate with the June 1 build (bump versionCode).
 */
const withAndroidUnityAdapter = (config) => {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.contents.includes('com.google.ads.mediation:unity')) {
      return config;
    }
    config.modResults.contents = config.modResults.contents.replace(
      /dependencies\s*\{/,
      'dependencies {\n    implementation "com.google.ads.mediation:unity:4.13.0.0"'
    );
    return config;
  });
};

module.exports = withAndroidUnityAdapter;
