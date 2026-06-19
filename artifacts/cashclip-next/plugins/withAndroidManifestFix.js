const { withAndroidManifest } = require('expo/config-plugins');

/**
 * Fixes Android Manifest merger conflict with react-native-google-mobile-ads.
 *
 * The library's AndroidManifest.xml declares DELAY_APP_MEASUREMENT_INIT=false
 * while our app manifest sets it to true (via the Expo plugin). The merger
 * fails unless we explicitly tell it our value wins.
 */
const withAndroidManifestFix = (config) => {
  return withAndroidManifest(config, async (config) => {
    const androidManifest = config.modResults;

    // Ensure xmlns:tools is declared on the root manifest element
    if (androidManifest.manifest.$) {
      androidManifest.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }

    const mainApplication = androidManifest.manifest.application?.[0];
    if (!mainApplication) return config;

    const metaDataList = mainApplication['meta-data'] ?? [];
    for (const item of metaDataList) {
      if (
        item.$?.['android:name'] ===
        'com.google.android.gms.ads.DELAY_APP_MEASUREMENT_INIT'
      ) {
        item.$['tools:replace'] = 'android:value';
      }
    }

    return config;
  });
};

module.exports = withAndroidManifestFix;
