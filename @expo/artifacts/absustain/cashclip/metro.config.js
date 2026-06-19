const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");
const fs = require("fs");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../../../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

// Exclude directories that don't contain source code to stay within the
// OS inotify watch limit (ENOSPC) on Replit.
config.resolver.blockList = [
  /\/\.local\/.*/,
  /\/\.git\/.*/,
  /\/attached_assets\/.*/,
  /\/scripts\/node_modules\/.*/,
  // Never bundle test/spec files into the app. expo-router's require.context
  // globs everything under app/, so a stray *.test.tsx there would otherwise
  // pull vitest/vite into the production bundle and crash Metro.
  /\.(test|spec)\.[jt]sx?$/,
];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

config.resolver.unstable_enableSymlinks = true;

/**
 * Resolve a package to its root directory dynamically via package.json.
 * Uses require.resolve so the version is never hardcoded here; pnpm
 * satisfies the lookup from whichever virtual-store entry is current.
 * Throws a clear startup-time error if the package is missing.
 */
function resolvePkgDir(packageName) {
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
 */
function resolvePnpmStorePkg(packageName) {
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

const REACT_PATH = resolvePkgDir("react");
const REACT_DOM_PATH = resolvePkgDir("react-dom");

// assert is a Node.js built-in polyfilled in the browser/RN context.
// pnpm strict isolation means Metro can't find it from virtual-store paths.
// require.resolve("assert") returns the bare core-module string "assert" (not
// a file path), so we scan the pnpm store directly to get the npm package.
const ASSERT_PATH = (() => {
  const pkgDir = resolvePnpmStorePkg("assert");
  const entryPath = path.join(pkgDir, "build", "assert.js");
  if (!fs.existsSync(entryPath)) {
    throw new Error(
      `[metro.config.js] Expected "assert" entry at "${entryPath}" but the file does not exist. ` +
        `Run "pnpm install" from the workspace root and try again.`
    );
  }
  return entryPath;
})();

const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "react") {
    return { filePath: path.join(REACT_PATH, "index.js"), type: "sourceFile" };
  }
  if (moduleName === "react-dom") {
    return {
      filePath: path.join(REACT_DOM_PATH, "index.js"),
      type: "sourceFile",
    };
  }
  if (moduleName === "assert") {
    return { filePath: ASSERT_PATH, type: "sourceFile" };
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
