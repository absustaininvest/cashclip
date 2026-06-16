#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');

const result = spawnSync(
  'pnpm',
  ['exec', 'expo', 'install', '--check', '--json'],
  { cwd: root, encoding: 'utf8' }
);

if (result.error) {
  process.stderr.write(
    'Failed to run expo install --check: ' + result.error.message + '\n'
  );
  process.exit(1);
}

if (result.status !== 0 && !result.stdout) {
  process.stderr.write(
    'expo install --check exited with status ' +
      result.status +
      (result.stderr ? ':\n' + result.stderr : '') +
      '\n'
  );
  process.exit(1);
}

let data;
try {
  data = JSON.parse(result.stdout || '');
} catch {
  process.stderr.write(
    'expo install --check --json produced unexpected output:\n' +
      (result.stdout || result.stderr || '(none)') +
      '\n'
  );
  process.exit(1);
}

if (data.upToDate) {
  console.log('All Expo packages match the expected SDK versions.');
  process.exit(0);
}

console.error('Expo package version mismatches detected:');
(data.dependencies || []).forEach((d) => {
  console.error(
    `  ${d.packageName}: installed ${d.actualVersion}, expected ${d.expectedVersionOrRange} (${d.packageType})`
  );
});
console.error('');
console.error(
  'Fix: pnpm --filter @workspace/cashclip exec expo install --fix'
);
process.exit(1);
