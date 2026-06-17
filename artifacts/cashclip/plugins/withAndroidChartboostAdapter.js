const { withAppBuildGradle } = require('expo/config-plugins');

/**
 * Adds the Google Mobile Ads Chartboost mediation adapter to the Android build.
 *
 * NOTE: Chartboost is iOS-only in this project. The Chartboost SDK 9.x is NOT on
 * Maven Central (caps at 9.2.1) and its private JFrog repo was removed from
 * extraMavenRepos to keep Android builds clean. This plugin file is retained for
 * reference but is NOT registered in app.json plugins. iOS side uses the
 * GoogleMobileAdsMediationChartboost pod via expo-build-properties extraPods.
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
