const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const CDN_SOURCE = "source 'https://cdn.cocoapods.org/'";
const CHARTBOOST_SOURCE = "source 'https://cboost.jfrog.io/artifactory/chartboost-cocoapods/'";
const HEADER = `${CDN_SOURCE}\n${CHARTBOOST_SOURCE}\n`;

const withChartboostPodSource = (config) => {
  return withDangerousMod(config, [
    'ios',
    (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfilePath, 'utf8');

      if (!contents.includes(CHARTBOOST_SOURCE)) {
        // Remove any existing explicit CDN source to avoid duplication
        contents = contents.replace(/^source 'https:\/\/cdn\.cocoapods\.org\/'\n?/m, '');
        contents = HEADER + contents;
        fs.writeFileSync(podfilePath, contents);
      }

      return config;
    },
  ]);
};

module.exports = withChartboostPodSource;
