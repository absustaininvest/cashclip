const path = require("path");

const baseConfig = require("./app.json");

const isDev = process.env.EXPO_PUBLIC_ENV === "development";

const devProjectId = "76c17169-4863-4e2c-9008-83e2d47d5461";
const prodProjectId = "aac2a3d9-56b6-49ab-b254-9b80e98bab2f";

// Resolve the expo-updates-interface iOS podspec directory at config-eval time.
// Hardcoding this path is brittle under pnpm because the virtual-store folder
// name encodes the resolved peer version (e.g. `_expo@54.0.34`). Every expo
// patch bump renames that folder, so a static path silently breaks `pod install`
// on the next EAS build. require.resolve always points at wherever pnpm actually
// placed the package, so this stays correct across version bumps.
function resolveExpoUpdatesInterfacePodPath() {
  const projectRoot = __dirname;
  let interfacePkgJson;
  try {
    const expoUpdatesPkgJson = require.resolve("expo-updates/package.json", {
      paths: [projectRoot],
    });
    interfacePkgJson = require.resolve("expo-updates-interface/package.json", {
      paths: [path.dirname(expoUpdatesPkgJson), projectRoot],
    });
  } catch (err) {
    throw new Error(
      "[app.config] Could not resolve expo-updates-interface for the " +
        "EXUpdatesInterface pod. Ensure expo-updates is installed. " +
        "Original error: " +
        err.message,
    );
  }

  const interfaceIosDir = path.join(path.dirname(interfacePkgJson), "ios");
  // extraPods paths are interpreted relative to the generated ios/ Podfile dir.
  const podfileDir = path.join(projectRoot, "ios");
  let relativePath = path.relative(podfileDir, interfaceIosDir);
  if (path.sep === "\\") {
    relativePath = relativePath.split("\\").join("/");
  }
  return relativePath;
}

// Inject the dynamically-resolved path into the EXUpdatesInterface extraPod.
function withDynamicExtraPods(plugins) {
  if (!Array.isArray(plugins)) return plugins;
  return plugins.map((plugin) => {
    if (!Array.isArray(plugin) || plugin[0] !== "expo-build-properties") {
      return plugin;
    }
    const [name, options = {}] = plugin;
    const existingPods = Array.isArray(options?.ios?.extraPods)
      ? options.ios.extraPods
      : [];

    // EXUpdatesInterface is injected here (with a freshly-resolved path) rather
    // than stored in app.json, so the brittle pnpm virtual-store path is never
    // hardcoded anywhere. Drop any stale copy and prepend the resolved one.
    const otherPods = existingPods.filter(
      (pod) => !(pod && pod.name === "EXUpdatesInterface"),
    );
    const extraPods = [
      { name: "EXUpdatesInterface", path: resolveExpoUpdatesInterfacePodPath() },
      ...otherPods,
    ];

    return [name, { ...options, ios: { ...options.ios, extraPods } }];
  });
}

module.exports = {
  ...baseConfig.expo,
  name: isDev ? "CashClip (Dev)" : baseConfig.expo.name,
  plugins: withDynamicExtraPods(baseConfig.expo.plugins),
  ios: {
    ...baseConfig.expo.ios,
    bundleIdentifier: isDev
      ? "app.replit.cashclip.dev"
      : baseConfig.expo.ios.bundleIdentifier,
  },
  android: {
    ...baseConfig.expo.android,
    package: isDev
      ? "app.replit.cashclip.dev"
      : baseConfig.expo.android.package,
  },
  extra: {
    ...(baseConfig.expo.extra ?? {}),
    appVisitProofKey: process.env.APP_VISIT_PROOF_KEY,
    eas: {
      projectId: isDev ? devProjectId : prodProjectId,
    },
  },
  updates: {
    ...baseConfig.expo.updates,
    url: isDev
      ? `https://u.expo.dev/${devProjectId}`
      : `https://u.expo.dev/${prodProjectId}`,
  },
};
