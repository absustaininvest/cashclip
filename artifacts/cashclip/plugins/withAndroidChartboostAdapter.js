const { withAppBuildGradle } = require('expo/config-plugins');

/**
 * Adds the Google Mobile Ads Chartboost mediation adapter to the Android build.
 * Required for Chartboost to bid/serve through AdMob mediation on Android.
 *
 * The adapter (com.google.ads.mediation:chartboost) is on Google's Maven, but it
 * transitively depends on the Chartboost SDK (com.chartboost:chartboost-sdk), which is
 * NOT published to Maven Central (that caps at 9.2.1). The 9.x Chartboost SDK is served
 * only from Chartboost's own Maven repo, so that repo is added via expo-build-properties
 * android.extraMavenRepos ("https://cboost.jfrog.io/artifactory/chartboost-ads/").
 * Companion to the iOS GoogleMobileAdsMediationChartboost pod in extraPods.
 */
const withAndroidChartboostAdapter = (config) => {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.contents.includes('com.google.ads.mediation:chartboost')) {
      return config;
    }
    config.modResults.contents = config.modResults.contents.replace(
      /dependencies\s*\{/,
      'dependencies {\n    implementation "com.google.ads.mediation:chartboost:9.8.3.0"'
    );
    return config;
  });
};

module.exports = withAndroidChartboostAdapter;
