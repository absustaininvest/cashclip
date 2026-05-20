import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_JSON_REPO_PATH = "artifacts/cashclip/app.json";
const APP_JSON_PATH = resolve(__dirname, "../../", APP_JSON_REPO_PATH);
const SIGNING_MD_PATH = resolve(__dirname, "../../artifacts/cashclip/SIGNING.md");

const force = process.argv.includes("--force");

type AppJson = {
  expo: {
    ios?: { buildNumber?: string };
    android?: { versionCode?: number };
    version?: string;
  };
};

const raw = readFileSync(APP_JSON_PATH, "utf-8");
const appJson = JSON.parse(raw) as AppJson;

// --- Guard: warn if a bump was already done since the last commit ---
let headAppJson: AppJson | null = null;
try {
  let headRaw: string;
  try {
    headRaw = execSync(`git show HEAD:${APP_JSON_REPO_PATH}`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (gitErr) {
    const msg = gitErr instanceof Error ? gitErr.message : String(gitErr);
    // Expected bootstrap cases: HEAD doesn't exist yet (no commits) or the
    // file hasn't been committed — silently skip the guard.
    if (
      msg.includes("does not exist in") ||
      msg.includes("unknown revision") ||
      msg.includes("bad revision") ||
      msg.includes("not a git repository")
    ) {
      headRaw = "";
    } else {
      // Unexpected git failure (binary missing, permission error, etc.) —
      // warn but don't block the bump.
      console.warn(
        `\n⚠️  Could not read app.json from git HEAD (double-bump guard skipped):\n   ${msg.split("\n")[0]}\n`
      );
      headRaw = "";
    }
  }

  if (headRaw) {
    headAppJson = JSON.parse(headRaw) as AppJson;
  }
} catch (parseErr) {
  // app.json in HEAD exists but is not valid JSON — warn and skip the guard.
  const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
  console.warn(
    `\n⚠️  Could not parse app.json from git HEAD (double-bump guard skipped):\n   ${msg}\n`
  );
}

if (headAppJson !== null) {
  const workingIos = parseInt(appJson.expo.ios?.buildNumber ?? "0", 10);
  const headIos = parseInt(headAppJson.expo.ios?.buildNumber ?? "0", 10);
  const workingAndroid = appJson.expo.android?.versionCode ?? 0;
  const headAndroid = headAppJson.expo.android?.versionCode ?? 0;

  const alreadyBumped = workingIos > headIos || workingAndroid > headAndroid;

  if (alreadyBumped && !force) {
    console.error(
      "\n⚠️  BUMP ALREADY APPLIED SINCE LAST COMMIT\n" +
      "   The working-tree app.json is already ahead of HEAD:\n" +
      `     ios.buildNumber:      HEAD=${headIos}  working=${workingIos}\n` +
      `     android.versionCode:  HEAD=${headAndroid}  working=${workingAndroid}\n` +
      "\n" +
      "   Running the bump script again would create a double-bump.\n" +
      "   Commit (or revert) the previous bump before bumping again.\n" +
      "\n" +
      "   To skip this check and bump anyway, pass --force:\n" +
      "     pnpm --filter @workspace/scripts run bump-build-number -- --force\n"
    );
    process.exit(1);
  }

  if (alreadyBumped && force) {
    console.warn(
      "\n⚠️  --force: skipping double-bump guard. Proceeding with another bump.\n"
    );
  }
}
// --- End guard ---

// Bump iOS buildNumber
const currentIos = appJson.expo.ios?.buildNumber ?? "0";
const currentIosNum = parseInt(currentIos, 10);

if (isNaN(currentIosNum)) {
  console.error(`ERROR: ios.buildNumber "${currentIos}" is not a valid integer.`);
  process.exit(1);
}

const nextIos = currentIosNum + 1;

if (!appJson.expo.ios) {
  appJson.expo.ios = {};
}
appJson.expo.ios.buildNumber = String(nextIos);

// Bump Android versionCode
const currentAndroid = appJson.expo.android?.versionCode ?? 0;

if (!Number.isInteger(currentAndroid) || currentAndroid < 0) {
  console.error(`ERROR: android.versionCode "${currentAndroid}" is not a valid non-negative integer.`);
  process.exit(1);
}

const nextAndroid = currentAndroid + 1;

if (!appJson.expo.android) {
  appJson.expo.android = {};
}
appJson.expo.android.versionCode = nextAndroid;

writeFileSync(APP_JSON_PATH, JSON.stringify(appJson, null, 2) + "\n", "utf-8");

console.log(`ios.buildNumber bumped:    ${currentIosNum} → ${nextIos}`);
console.log(`android.versionCode bumped: ${currentAndroid} → ${nextAndroid}`);
console.log(`Updated: artifacts/cashclip/app.json`);

// SIGNING.md was removed from version control (security: it contained Apple
// credentials and internal release metadata). Skip the update silently when
// the file is absent so the bump script continues to work correctly.
if (existsSync(SIGNING_MD_PATH)) {
  const appVersion = appJson.expo.version ?? "";
  const signingMd = readFileSync(SIGNING_MD_PATH, "utf-8");
  // Each pattern rewrites one field in SIGNING.md to match the bumped values.
  // The snapshot header ("Saved state as of build number **X**") is kept in
  // sync alongside the table rows so the prose introduction never drifts.
  const SIGNING_PATTERNS: Array<{ label: string; re: RegExp; replacement: string }> = [
    { label: "snapshot header build number", re: /^(Saved state as of build number \*\*)\d+(\*\*)/m, replacement: `$1${nextIos}$2` },
    { label: "iOS build number row", re: /^(\| iOS build number\s*\|\s*`)\d+(`\s*\|)/m, replacement: `$1${nextIos}$2` },
    { label: "Android version code row", re: /^(\| Android version code\s*\|\s*`)\d+(`\s*\|)/m, replacement: `$1${nextAndroid}$2` },
    { label: "App version row", re: /^(\| App version\s*\|\s*`)[^`]+(`\s*\|)/m, replacement: `$1${appVersion}$2` },
  ];
  let updatedSigningMd = signingMd;
  const updated: string[] = [];
  for (const { label, re, replacement } of SIGNING_PATTERNS) {
    if (!re.test(updatedSigningMd)) {
      console.warn(`⚠️  SIGNING.md update skipped — could not find "${label}".`);
      continue;
    }
    updatedSigningMd = updatedSigningMd.replace(re, replacement);
    updated.push(label);
  }
  writeFileSync(SIGNING_MD_PATH, updatedSigningMd, "utf-8");
  console.log(`Updated: artifacts/cashclip/SIGNING.md (${updated.join(", ")})`);
}
