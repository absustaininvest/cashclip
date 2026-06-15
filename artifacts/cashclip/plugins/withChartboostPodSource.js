const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const CHARTBOOST_SOURCE = "source 'https://cboost.jfrog.io/artifactory/chartboost-cocoapods/'";
const TRUNK_SOURCE = "source 'https://cdn.cocoapods.org/'";

const withChartboostPodSource = (config) => {
  return withDangerousMod(config, [
    'ios',
    (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfilePath, 'utf8');

      if (!contents.includes(CHARTBOOST_SOURCE)) {
        if (contents.includes(TRUNK_SOURCE)) {
          contents = contents.replace(TRUNK_SOURCE, `${TRUNK_SOURCE}\n${CHARTBOOST_SOURCE}`);
        } else {
          contents = `${CHARTBOOST_SOURCE}\n${contents}`;
        }
        fs.writeFileSync(podfilePath, contents);
      }

      return config;
    },
  ]);
};

module.exports = withChartboostPodSource;
