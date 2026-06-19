"use strict";
/**
 * Shared Metro resolver helpers.
 *
 * Imported by both metro.config.js (runtime) and
 * scripts/test-metro-resolve.js (test) so the tested code
 * IS the code Metro runs — no duplication, no drift.
 */

const path = require("path");
const fs = require("fs");

/**
 * Resolve a package to its root directory dynamically via package.json.
 * Uses require.resolve so the version is never hardcoded; pnpm
 * satisfies the lookup from whichever virtual-store entry is current.
 * Throws a clear startup-time error if the package is missing.
 *
 * @param {string} packageName
 * @param {string} workspaceRoot  absolute path to the monorepo root
 * @param {string} projectRoot    absolute path to the app package root
 * @returns {string}
 */
function resolvePkgDir(packageName, workspaceRoot, projectRoot) {
  try {
    const pkgJson = require.resolve(packageName + "/package.json", {
      paths: [workspaceRoot, projectRoot],
    });
    const dir = path.dirname(pkgJson);
    if (!path.isAbsolute(dir) || !fs.existsSync(dir)) {
      throw new Error(`resolved to "${dir}" which is not an accessible directory`);
    }
    return dir;
  } catch (err) {
    throw new Error(
      `[metro.config.js] Cannot resolve pinned module "${packageName}": ${err.message}. ` +
        `Run "pnpm install" from the workspace root and try again.`
    );
  }
}

/**
 * Resolve a package's directory by scanning the pnpm virtual store for the
 * first entry matching "<packageName>@*". This is the correct approach for
 * packages that cannot be resolved via require.resolve because they are not
 * hoisted and/or share the name of a Node.js core built-in (e.g. "assert").
 * Throws a clear startup-time error if the package is missing.
 *
 * @param {string} packageName
 * @param {string} workspaceRoot  absolute path to the monorepo root
 * @returns {string}
 */
function resolvePnpmStorePkg(packageName, workspaceRoot) {
  const storeDir = path.join(workspaceRoot, "node_modules/.pnpm");
  let entries;
  try {
    entries = fs.readdirSync(storeDir);
  } catch (err) {
    throw new Error(
      `[metro.config.js] Cannot read pnpm store at "${storeDir}": ${err.message}. ` +
        `Run "pnpm install" from the workspace root and try again.`
    );
  }
  const prefix = packageName + "@";
  const match = entries.find((e) => e.startsWith(prefix));
  if (!match) {
    throw new Error(
      `[metro.config.js] Package "${packageName}" not found in pnpm store "${storeDir}". ` +
        `Run "pnpm install" from the workspace root and try again.`
    );
  }
  const pkgDir = path.join(storeDir, match, "node_modules", packageName);
  if (!fs.existsSync(pkgDir)) {
    throw new Error(
      `[metro.config.js] Resolved path "${pkgDir}" for "${packageName}" does not exist. ` +
        `Run "pnpm install" from the workspace root and try again.`
    );
  }
  return pkgDir;
}

module.exports = { resolvePkgDir, resolvePnpmStorePkg };
