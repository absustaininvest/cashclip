const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * iOS: let React Native Firebase compile under use_frameworks! :static.
 *
 * Under static frameworks, the RNFBApp pod compiles as a framework module
 * and imports React-Core headers (RCTConvert.h, RCTBridgeModule.h,
 * RCTEventEmitter.h) that aren't part of a Clang module. Xcode promotes that
 * to a fatal error via -Wnon-modular-include-in-framework-module -Werror.
 *
 * Fix: scoped ONLY to the RNFB* pod targets (not all pods, so the AdMob
 * mediation adapters keep their proven settings), relax the two Clang flags
 * that drive the warning->error promotion. EAS re-runs prebuild every build,
 * so this re-injects each time. Idempotent via markers; fails fast if the
 * Podfile post_install anchor is missing.
 */

const BEGIN = '# BEGIN RNFB NON_MODULAR PATCH';
const END = '# END RNFB NON_MODULAR PATCH';

module.exports = function withIosRnfbNonModularPatch(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      let podfile = fs.readFileSync(podfilePath, 'utf8');

      if (podfile.includes(BEGIN) && podfile.includes(END)) return cfg;

      const anchor = /post_install do \|installer\|\n/;
      if (!anchor.test(podfile)) {
        throw new Error(
          'withIosRnfbNonModularPatch: post_install anchor not found in Podfile',
        );
      }

      const snippet = `${BEGIN}\n  installer.pods_project.targets.each do |target|\n    next unless target.name.start_with?('RNFB')\n    target.build_configurations.each do |config|\n      config.build_settings['CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES'] = 'YES'\n      config.build_settings['CLANG_WARN_NON_MODULAR_INCLUDE_IN_FRAMEWORK_MODULE'] = 'NO'\n    end\n  end\n  ${END}\n`;

      podfile = podfile.replace(anchor, (m) => m + snippet);
      fs.writeFileSync(podfilePath, podfile);
      return cfg;
    },
  ]);
};
