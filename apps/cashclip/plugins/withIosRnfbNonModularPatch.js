const { withDangerousMod } = require('expo/config-plugins');
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
 * A second (related) error occurs with Clang modules enabled: once a type such
 * as RCTBridgeModule has been seen through a framework module import, any
 * non-module forward-declaration of that same type triggers:
 *   "declaration of 'X' must be imported from module 'Y' before it is required"
 * Adding CLANG_ENABLE_MODULES = NO for RNFB targets disables Clang's module
 * import-ordering enforcement for those translation units, removing both errors.
 *
 * Fix: scoped ONLY to the RNFB* pod targets (not all pods, so the AdMob
 * mediation adapters keep their proven settings), relax the Clang flags
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

      const snippet = `${BEGIN}\n  installer.pods_project.targets.each do |target|\n    next unless target.name.start_with?('RNFB')\n    target.build_configurations.each do |config|\n      config.build_settings['CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES'] = 'YES'\n      config.build_settings['CLANG_WARN_NON_MODULAR_INCLUDE_IN_FRAMEWORK_MODULE'] = 'NO'\n      config.build_settings['CLANG_ENABLE_MODULES'] = 'NO'\n    end\n  end\n  ${END}\n`;

      podfile = podfile.replace(anchor, (m) => m + snippet);
      fs.writeFileSync(podfilePath, podfile);
      return cfg;
    },
  ]);
};
