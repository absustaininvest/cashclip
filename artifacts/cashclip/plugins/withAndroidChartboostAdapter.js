const { withAppBuildGradle } = require('@expo/config-plugins');

/**
 * Adds the Google Mobile Ads Chartboost mediation adapter to the Android build.
 * Required for Chartboost to bid/serve through AdMob mediation on Android.
 * Companion to the iOS GoogleMobileAdsMediationChartboost pod in extraPods (whose
 * CocoaPods source is added by withChartboostPodSource). The adapter and the
 * Chartboost SDK it pulls in are published to Google's Maven and Maven Central,
 * both already on the Expo Android build, so no extra repo is needed.
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
