import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_JSON_REPO_PATH = "artifacts/cashclip/app.json";
const APP_JSON_ABS_PATH = resolve(__dirname, "../../", APP_JSON_REPO_PATH);

type AppJson = {
  expo: {
    version?: string;
  };
};

function parseAppJson(raw: string): AppJson {
  return JSON.parse(raw) as AppJson;
}

const SAFE_GIT_REF = /^[A-Za-z0-9_.~^/\\-]+$/;

function gitShow(ref: string): AppJson {
  if (!SAFE_GIT_REF.test(ref)) {
    throw new Error(`Unsafe git ref rejected: ${JSON.stringify(ref)}`);
  }
  const raw = execSync(`git show ${ref}:${APP_JSON_REPO_PATH}`, { // nosemgrep: javascript.lang.security.detect-child-process
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  return parseAppJson(raw);
}

const BUMP_CMD = "pnpm --filter @workspace/scripts run bump-version";
const RELEASE_CMDS =
  "  pnpm run release:production:patch  # bump patch + build number\n" +
  "  pnpm run release:production:minor  # bump minor + build number\n" +
  "  pnpm run release:production:major  # bump major + build number\n";

/**
 * --committed mode (CI / post-commit):
 *   Compares HEAD (the bump commit) vs HEAD~1 (the previous commit).
 *   Use this when the bump has already been committed before the build runs.
 *
 * Default mode (local / pre-commit):
 *   Compares the working-tree app.json vs HEAD.
 *   Use this when the bump has been applied but not yet committed.
 */
const useCommitted = process.argv.includes("--committed");

let current: AppJson;
let reference: AppJson;

if (useCommitted) {
  try {
    current = gitShow("HEAD");
  } catch {
    console.error(
      "ERROR: Could not read app.json from git HEAD.\n" +
      "Make sure you are inside a git repository and app.json has been committed at least once."
    );
    process.exit(1);
  }
  try {
    reference = gitShow("HEAD~1");
  } catch {
    console.error(
      "ERROR: Could not read app.json from HEAD~1.\n" +
      "This requires at least two commits to be present in the local clone.\n" +
      "If running in CI with a shallow clone, ensure the workflow fetches at least 2 commits:\n" +
      "  git fetch --depth=2 origin HEAD\n" +
      "(The EAS workflow step for this check already does this automatically.)\n" +
      "If this is the very first commit in the repo, skip --committed mode and use the default check instead."
    );
    process.exit(1);
  }
} else {
  current = parseAppJson(readFileSync(APP_JSON_ABS_PATH, "utf-8"));
  try {
    reference = gitShow("HEAD");
  } catch {
    console.error(
      "ERROR: Could not read app.json from git HEAD.\n" +
      "Make sure you are inside a git repository and app.json has been committed at least once."
    );
    process.exit(1);
  }
}

const modeLabel = useCommitted
  ? "(comparing HEAD vs HEAD~1 — committed mode)"
  : "(comparing working tree vs HEAD — local mode)";

const currentVersion = current.expo.version ?? "0.0.0";
const referenceVersion = reference.expo.version ?? "0.0.0";

if (currentVersion === referenceVersion) {
  console.warn(
    "\n\u26A0\uFE0F  APP VERSION NOT BUMPED (warning only — build will proceed)\n" +
    `   expo.version is still "${currentVersion}" — same as the reference value ${modeLabel}.\n` +
    "   This is fine for development builds, but store submissions require a new version string.\n" +
    "   If you are targeting the App Store or Google Play, bump expo.version first:\n\n" +
    `     ${BUMP_CMD} [patch|minor|major]\n\n` +
    "   Or use a release script that bumps both the version and build number:\n\n" +
    RELEASE_CMDS
  );
  process.exit(0);
}

console.log(
  "\u2705  App version is bumped and ready.\n" +
  `   expo.version:   ${referenceVersion} \u2192 ${currentVersion}`
);
