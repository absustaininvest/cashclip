const {
  withAndroidManifest,
  withInfoPlist,
  withDangerousMod,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * SSL Certificate Pinning — production only, public-key (SPKI) based.
 *
 * Pins only cash-clip.app (the custom domain we control).
 * Dev/staging use *.replit.app where Replit manages TLS keys, so we
 * skip pinning there to avoid lockouts from infrastructure rekeying.
 *
 * Two pins are always present:
 *   PRIMARY  — the current server public key hash
 *   BACKUP   — a pre-generated key held in reserve; deploy it before rekeying
 *
 * Pre-build check (run before every EAS build):
 *   bash scripts/verify-spki-hash.sh
 *   → exits non-zero if the live server key no longer matches PRIMARY.
 *
 * Rotation procedure (if you ever need to rekey cash-clip.app):
 *   1. Generate a new private key on the server
 *   2. Run scripts/verify-spki-hash.sh — it prints the live SPKI hash
 *   3. Set PRIMARY = current BACKUP hash, BACKUP = new hash from step 2
 *   4. Ship a new native app build — users must update before cert swap
 *   5. Swap the cert on the server
 *   6. Generate another fresh backup for the next rotation
 */

const PROD_DOMAIN = 'cash-clip.app';

const PINS = {
  PRIMARY: 'RyRf6jEPjlQbkYznK5pQeUf9OUTTKH6/9rD4ECjlhrk=',
  BACKUP:  '0kwFaWzW7ABjAjbQYOrNtpwK1IOeiFGsmigU9bzQEN0=',
};

function isProductionBuild() {
  return process.env.EXPO_PUBLIC_ENV === 'production';
}

const withSslPinningAndroid = (config) => {
  config = withAndroidManifest(config, (cfg) => {
    if (!isProductionBuild()) return cfg;
    const app = cfg.modResults.manifest.application?.[0];
    if (app?.$) {
      app.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    }
    return cfg;
  });

  config = withDangerousMod(config, [
    'android',
    async (cfg) => {
      if (!isProductionBuild()) return cfg;
      const xmlDir = path.join(
        cfg.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'res',
        'xml',
      );
      fs.mkdirSync(xmlDir, { recursive: true });
      const xmlContent = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <domain-config cleartextTrafficPermitted="false">
        <domain includeSubdomains="false">${PROD_DOMAIN}</domain>
        <pin-set>
            <pin digest="SHA-256">${PINS.PRIMARY}</pin>
            <pin digest="SHA-256">${PINS.BACKUP}</pin>
        </pin-set>
    </domain-config>
</network-security-config>`;
      fs.writeFileSync(path.join(xmlDir, 'network_security_config.xml'), xmlContent, 'utf8');
      return cfg;
    },
  ]);

  return config;
};

const withSslPinningIos = (config) => {
  return withInfoPlist(config, (cfg) => {
    if (!isProductionBuild()) return cfg;
    cfg.modResults.NSPinnedDomains = {
      [PROD_DOMAIN]: {
        NSIncludesSubdomains: false,
        NSPinnedLeafIdentities: [
          { 'SPKI-SHA256-BASE64': PINS.PRIMARY },
          { 'SPKI-SHA256-BASE64': PINS.BACKUP },
        ],
      },
    };
    return cfg;
  });
};

const withSslPinning = (config) => {
  config = withSslPinningAndroid(config);
  config = withSslPinningIos(config);
  return config;
};

module.exports = withSslPinning;
