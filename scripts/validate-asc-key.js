#!/usr/bin/env node
/**
 * validate-asc-key.js
 *
 * Validates that an App Store Connect API key can authenticate with Apple.
 * Requires a fresh Admin Team Key (not App Manager — Admin needed for cert/profile management).
 *
 * USAGE:
 *   node scripts/validate-asc-key.js <path-to-AuthKey_XXXXXX.p8> <KEY_ID> <ISSUER_ID>
 *
 * Example:
 *   node scripts/validate-asc-key.js ~/Downloads/AuthKey_ABC123DEF.p8 ABC123DEF 45944549-8278-4477-a1c6-3348ec45c3f0
 *
 * A healthy key returns 200 on all three checks (apps, certificates, profiles).
 * A revoked / mismatched key returns 401.
 * An App Manager key (not Admin) returns 403 on certificates/profiles.
 *
 * The Issuer ID is ACCOUNT-WIDE and visible in:
 *   App Store Connect → Integrations → App Store Connect API → Team Keys (header area)
 * It stays the same when you revoke/create keys.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── Parse args ────────────────────────────────────────────────────────────────
const [,, p8Path, keyId, issuerId] = process.argv;

if (!p8Path || !keyId || !issuerId) {
  console.error('Usage: node scripts/validate-asc-key.js <AuthKey_XXX.p8> <KEY_ID> <ISSUER_ID>');
  console.error('');
  console.error('  KEY_ID    — the 10-char alphanumeric ID (shown as filename: AuthKey_<KEY_ID>.p8)');
  console.error('  ISSUER_ID — the UUID on the Team Keys page header in ASC (account-wide constant)');
  process.exit(1);
}

// ── Load and rewrap the .p8 ────────────────────────────────────────────────────
// The .p8 from Apple is already properly formatted with real newlines,
// but workspace secrets may store it flattened. We normalise either way.
let rawPem = fs.readFileSync(path.resolve(p8Path), 'utf8').trim();

// If the secret was flattened (all one line, escaped \n, or spaces instead of newlines),
// rewrap it to proper PEM so Node's crypto layer can parse it.
if (!rawPem.includes('\n')) {
  // Single-line — extract the base64 body and rewrap
  const body = rawPem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\\n/g, '')
    .replace(/\s+/g, '');
  const wrapped = body.match(/.{1,64}/g).join('\n');
  rawPem = `-----BEGIN PRIVATE KEY-----\n${wrapped}\n-----END PRIVATE KEY-----\n`;
}

let privateKey;
try {
  privateKey = crypto.createPrivateKey(rawPem);
} catch (e) {
  console.error('ERROR: Could not parse .p8 file as a private key.');
  console.error('  Make sure you downloaded the correct AuthKey_<KEYID>.p8 from App Store Connect.');
  console.error('  Detail:', e.message);
  process.exit(1);
}

if (privateKey.asymmetricKeyType !== 'ec') {
  console.error('ERROR: Expected an EC (P-256) private key but got:', privateKey.asymmetricKeyType);
  process.exit(1);
}

// ── Build ES256 JWT ───────────────────────────────────────────────────────────
function base64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const header  = { alg: 'ES256', kid: keyId, typ: 'JWT' };
const now     = Math.floor(Date.now() / 1000);
const payload = {
  iss: issuerId,
  iat: now,
  exp: now + 300,  // 5-minute window — plenty for a spot check
  aud: 'appstoreconnect-v1',
};

const headerB64  = base64url(JSON.stringify(header));
const payloadB64 = base64url(JSON.stringify(payload));
const signingInput = `${headerB64}.${payloadB64}`;

// Apple requires JOSE (r||s) encoding, not DER. Node returns DER by default for EC.
const derSig = crypto.sign('SHA256', Buffer.from(signingInput), { key: privateKey, dsaEncoding: 'ieee-p1363' });
const jwt    = `${signingInput}.${base64url(derSig)}`;

// ── Hit Apple endpoints ───────────────────────────────────────────────────────
const BASE = 'https://api.appstoreconnect.apple.com/v1';
const CHECKS = [
  { label: 'Apps (read-only — any key role should pass)',            url: `${BASE}/apps?limit=1` },
  { label: 'Certificates (Admin only — needed for eas build)',       url: `${BASE}/certificates?limit=1` },
  { label: 'Profiles (Admin only — needed for eas build)',           url: `${BASE}/profiles?limit=1` },
];

async function checkEndpoint(label, url) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
  });
  const icon = res.status === 200 ? '✅' : res.status === 403 ? '⚠️ ' : '❌';
  console.log(`  ${icon}  ${res.status}  ${label}`);
  if (res.status !== 200) {
    const body = await res.text().catch(() => '(unreadable body)');
    console.log(`         ${body.slice(0, 200)}`);
  }
  return res.status;
}

async function main() {
  console.log('');
  console.log('══════════════════════════════════════════════');
  console.log('  App Store Connect API Key Validation');
  console.log('══════════════════════════════════════════════');
  console.log(`  Key ID:    ${keyId}`);
  console.log(`  Issuer ID: ${issuerId}`);
  console.log(`  .p8 file:  ${path.resolve(p8Path)}`);
  console.log('');
  console.log('Hitting Apple endpoints…');
  console.log('');

  const statuses = await Promise.all(CHECKS.map(c => checkEndpoint(c.label, c.url)));

  console.log('');
  const allGood = statuses.every(s => s === 200);
  if (allGood) {
    console.log('✅  ALL CHECKS PASSED — this key is valid and has Admin access.');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Save to workspace secrets:');
    console.log(`       APPLE_ASC_KEY_ID  = ${keyId}`);
    console.log('       APPLE_ASC_PRIVATE_KEY = <contents of the .p8 file>');
    console.log('  2. Run: bash scripts/store-asc-key-in-eas.sh <path-to-AuthKey_XXX.p8>');
    console.log('     (stores the key in EAS so eas build can use it for cert/profile management)');
    console.log('  3. Revoke the old key 36377NCG8Z in ASC → Integrations → App Store Connect API.');
  } else if (statuses[0] === 200 && statuses.slice(1).some(s => s === 403)) {
    console.log('⚠️   Key authenticates but lacks Admin access (likely App Manager role).');
    console.log('    eas build needs Admin for cert/profile management.');
    console.log('    Create a new Team Key with the Admin role in ASC.');
  } else {
    console.log('❌  VALIDATION FAILED — key is revoked, mismatched, or the .p8 is wrong.');
    console.log('    A 401 = Apple rejected the token (revoked key or wrong Key ID for this .p8).');
    console.log('    Create a fresh Admin Team Key in:');
    console.log('      App Store Connect → Integrations → App Store Connect API → Team Keys → (+)');
    console.log('    Download the .p8, note the Key ID from the filename: AuthKey_<KEY_ID>.p8');
    console.log('    Re-run this script with the new file.');
  }
  console.log('');
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
