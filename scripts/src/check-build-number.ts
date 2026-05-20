import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_JSON_REPO_PATH = "artifacts/cashclip/app.json";
const APP_JSON_ABS_PATH = resolve(__dirname, "../../", APP_JSON_REPO_PATH);

type AppJson = {
  expo: {
    ios?: { buildNumber?: string };
    android?: { versionCode?: number };
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

const BUMP_CMD = "pnpm --filter @workspace/scripts run bump-build-number";
const RELEASE_CMD = "pnpm run release:production  # (from artifacts/cashclip/)";

/**
 * --committed mode (CI / post-commit):
 *   Compares HEAD (the bump commit) vs HEAD~1 (the previous commit).
 *   Use this when the bump has already been committed before the build runs,
 *   i.e. when triggered by `release:production` or `release:preview`.
 *
 * Default mode (local / pre-commit):
 *   Compares the working-tree app.json vs HEAD.
 *   Use this when the bump has been applied but not yet committed,
 *   i.e. when running `eas:build:production` directly via the npm pre-hook.
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

const currentIosBuild = parseInt(current.expo.ios?.buildNumber ?? "0", 10);
const referenceIosBuild = parseInt(reference.expo.ios?.buildNumber ?? "0", 10);

const currentAndroidCode = current.expo.android?.versionCode ?? 0;
const referenceAndroidCode = reference.expo.android?.versionCode ?? 0;

const notBumpedHint = useCommitted
  ? `   Use the release script to bump, commit, and build in one step:\n\n     ${RELEASE_CMD}\n`
  : `   Run the bump script before triggering a build:\n\n     ${BUMP_CMD}\n\n` +
    "   Do NOT commit app.json before building — the check reads the working-tree value.\n" +
    "   Commit app.json after the build succeeds.\n";

let failed = false;

if (currentIosBuild <= referenceIosBuild) {
  if (currentIosBuild === referenceIosBuild) {
    console.error(
      "\n\u274C  BUILD NUMBER NOT BUMPED\n" +
      `   ios.buildNumber is still "${current.expo.ios?.buildNumber}" \u2014 same as the reference value ${modeLabel}.\n` +
      notBumpedHint
    );
  } else {
    console.error(
      "\n\u274C  BUILD NUMBER WENT BACKWARDS\n" +
      `   ios.buildNumber is ${currentIosBuild} but the reference value is ${referenceIosBuild} ${modeLabel}.\n` +
      `   Run the bump script to restore a valid forward value:\n\n     ${BUMP_CMD}\n`
    );
  }
  failed = true;
} else if (currentIosBuild > referenceIosBuild + 1) {
  const ahead = currentIosBuild - referenceIosBuild;
  console.error(
    "\n\u274C  POSSIBLE DOUBLE-BUMP: ios.buildNumber\n" +
    `   ios.buildNumber is ${ahead} ahead of the reference value ${modeLabel} (${referenceIosBuild} \u2192 ${currentIosBuild}).\n` +
    "   This suggests bump-build-number was run more than once without committing in between.\n" +
    "   To fix: manually restore app.json ios.buildNumber to the correct next value,\n" +
    "   or commit the current value if only one build will be submitted.\n"
  );
  failed = true;
}

if (currentAndroidCode <= referenceAndroidCode) {
  if (currentAndroidCode === referenceAndroidCode) {
    console.error(
      "\n\u274C  VERSION CODE NOT BUMPED\n" +
      `   android.versionCode is still ${currentAndroidCode} \u2014 same as the reference value ${modeLabel}.\n` +
      notBumpedHint
    );
  } else {
    console.error(
      "\n\u274C  VERSION CODE WENT BACKWARDS\n" +
      `   android.versionCode is ${currentAndroidCode} but the reference value is ${referenceAndroidCode} ${modeLabel}.\n` +
      `   Run the bump script to restore a valid forward value:\n\n     ${BUMP_CMD}\n`
    );
  }
  failed = true;
} else if (currentAndroidCode > referenceAndroidCode + 1) {
  const ahead = currentAndroidCode - referenceAndroidCode;
  console.error(
    "\n\u274C  POSSIBLE DOUBLE-BUMP: android.versionCode\n" +
    `   android.versionCode is ${ahead} ahead of the reference value ${modeLabel} (${referenceAndroidCode} \u2192 ${currentAndroidCode}).\n` +
    "   This suggests bump-build-number was run more than once without committing in between.\n" +
    "   To fix: manually restore app.json android.versionCode to the correct next value,\n" +
    "   or commit the current value if only one build will be submitted.\n"
  );
  failed = true;
}

if (failed) {
  process.exit(1);
}

console.log(
  "\u2705  Build numbers are bumped and ready.\n" +
  `   ios.buildNumber:       ${referenceIosBuild} \u2192 ${currentIosBuild}\n` +
  `   android.versionCode:   ${referenceAndroidCode} \u2192 ${currentAndroidCode}`
);
