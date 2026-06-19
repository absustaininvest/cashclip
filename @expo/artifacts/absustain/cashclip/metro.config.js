const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");
const fs = require("fs");
const { resolvePkgDir, resolvePnpmStorePkg } = require("./scripts/metro-resolve-helpers");

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

const REACT_PATH = resolvePkgDir("react", workspaceRoot, projectRoot);
const REACT_DOM_PATH = resolvePkgDir("react-dom", workspaceRoot, projectRoot);

// assert is a Node.js built-in polyfilled in the browser/RN context.
// pnpm strict isolation means Metro can't find it from virtual-store paths.
// require.resolve("assert") returns the bare core-module string "assert" (not
// a file path), so we scan the pnpm store directly to get the npm package.
const ASSERT_PATH = (() => {
  const pkgDir = resolvePnpmStorePkg("assert", workspaceRoot);
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
