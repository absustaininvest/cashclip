const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

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

const REACT_PATH = path.resolve(
  workspaceRoot,
  "node_modules/.pnpm/react@19.1.0/node_modules/react"
);
const REACT_DOM_PATH = path.resolve(
  workspaceRoot,
  "node_modules/.pnpm/react-dom@19.1.0_react@19.1.0/node_modules/react-dom"
);

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
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
