#!/usr/bin/env node
/**
 * Tests the resolvePkgDir / resolvePnpmStorePkg helpers from
 * scripts/metro-resolve-helpers.js — the same module metro.config.js imports.
 * Because this script exercises the real helpers (not a duplicate), any
 * regression in metro.config.js will fail here before Metro is started.
 *
 * Run with:  node scripts/test-metro-resolve.js
 *
 * Exit code 0 = all assertions passed.
 * Exit code 1 = at least one assertion failed (details printed to stderr).
 */

"use strict";

const path = require("path");
const fs = require("fs");
const assert = require("assert/strict");
const { resolvePkgDir, resolvePnpmStorePkg } = require("./metro-resolve-helpers");

const projectRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(projectRoot, "../../../..");

// ---------------------------------------------------------------------------
// Mini test runner
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

function assertThrows(fn, pattern, label) {
  let threw = false;
  let caught = null;
  try {
    fn();
  } catch (err) {
    threw = true;
    caught = err;
  }
  assert.ok(threw, `${label}: expected a throw but the function returned normally`);
  assert.match(
    caught.message,
    pattern,
    `${label}: error message did not match pattern ${pattern}`
  );
}

// ---------------------------------------------------------------------------
// resolvePkgDir — error paths
// ---------------------------------------------------------------------------

console.log("\nresolvePkgDir — missing package:");

const MISSING = "__this-package-does-not-exist-at-all__";

test("throws when package is missing", () => {
  assertThrows(
    () => resolvePkgDir(MISSING, workspaceRoot, projectRoot),
    /Run "pnpm install" from the workspace root/,
    "resolvePkgDir(missing)"
  );
});

test("error message names the missing package", () => {
  assertThrows(
    () => resolvePkgDir(MISSING, workspaceRoot, projectRoot),
    new RegExp(MISSING.replace(/[-]/g, "\\-")),
    "resolvePkgDir(missing) package name"
  );
});

test("error message contains the [metro.config.js] prefix", () => {
  assertThrows(
    () => resolvePkgDir(MISSING, workspaceRoot, projectRoot),
    /\[metro\.config\.js\]/,
    "resolvePkgDir(missing) prefix"
  );
});

// ---------------------------------------------------------------------------
// resolvePkgDir — happy path
// ---------------------------------------------------------------------------

console.log("\nresolvePkgDir — happy path (react):");

test("resolves 'react' to an absolute path", () => {
  const dir = resolvePkgDir("react", workspaceRoot, projectRoot);
  assert.ok(path.isAbsolute(dir), `expected absolute path, got "${dir}"`);
});

test("resolved 'react' directory exists on disk", () => {
  const dir = resolvePkgDir("react", workspaceRoot, projectRoot);
  assert.ok(fs.existsSync(dir), `directory does not exist: "${dir}"`);
});

test("resolved 'react' directory contains package.json", () => {
  const dir = resolvePkgDir("react", workspaceRoot, projectRoot);
  const pkgJson = path.join(dir, "package.json");
  assert.ok(fs.existsSync(pkgJson), `package.json missing at: "${pkgJson}"`);
});

test("resolved 'react-dom' directory exists on disk", () => {
  const dir = resolvePkgDir("react-dom", workspaceRoot, projectRoot);
  assert.ok(fs.existsSync(dir), `directory does not exist: "${dir}"`);
});

// ---------------------------------------------------------------------------
// resolvePnpmStorePkg — error paths
// ---------------------------------------------------------------------------

console.log("\nresolvePnpmStorePkg — missing package:");

test("throws when package is missing", () => {
  assertThrows(
    () => resolvePnpmStorePkg(MISSING, workspaceRoot),
    /Run "pnpm install" from the workspace root/,
    "resolvePnpmStorePkg(missing)"
  );
});

test("error message names the missing package", () => {
  assertThrows(
    () => resolvePnpmStorePkg(MISSING, workspaceRoot),
    new RegExp(MISSING.replace(/[-]/g, "\\-")),
    "resolvePnpmStorePkg(missing) package name"
  );
});

test("error message contains the [metro.config.js] prefix", () => {
  assertThrows(
    () => resolvePnpmStorePkg(MISSING, workspaceRoot),
    /\[metro\.config\.js\]/,
    "resolvePnpmStorePkg(missing) prefix"
  );
});

// ---------------------------------------------------------------------------
// resolvePnpmStorePkg — happy path (assert)
// ---------------------------------------------------------------------------

console.log("\nresolvePnpmStorePkg — happy path (assert npm package):");

test("resolves 'assert' npm package to an absolute path", () => {
  const dir = resolvePnpmStorePkg("assert", workspaceRoot);
  assert.ok(path.isAbsolute(dir), `expected absolute path, got "${dir}"`);
});

test("resolved 'assert' directory exists on disk", () => {
  const dir = resolvePnpmStorePkg("assert", workspaceRoot);
  assert.ok(fs.existsSync(dir), `directory does not exist: "${dir}"`);
});

test("resolved 'assert' entry file (build/assert.js) exists on disk", () => {
  const dir = resolvePnpmStorePkg("assert", workspaceRoot);
  const entry = path.join(dir, "build", "assert.js");
  assert.ok(fs.existsSync(entry), `entry file missing at: "${entry}"`);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exit(1);
}
