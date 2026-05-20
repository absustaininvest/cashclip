import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_JSON_REPO_PATH = "artifacts/cashclip/app.json";
const APP_JSON_PATH = resolve(__dirname, "../../", APP_JSON_REPO_PATH);
const SIGNING_MD_PATH = resolve(__dirname, "../../artifacts/cashclip/SIGNING.md");

type AppJson = {
  expo: {
    ios?: { buildNumber?: string };
    android?: { versionCode?: number };
    version?: string;
  };
};

// --- Read the committed (HEAD) values ---
let headAppJson: AppJson;
try {
  const headRaw = execSync(`git show HEAD:${APP_JSON_REPO_PATH}`, {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  headAppJson = JSON.parse(headRaw) as AppJson;
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(
    "\nERROR: Could not read app.json from git HEAD.\n" +
    "Make sure you are inside a git repository and app.json has been committed at least once.\n" +
    `\nDetails: ${msg.split("\n")[0]}\n`
  );
  process.exit(1);
}

// --- Read the working-tree values ---
const workingRaw = readFileSync(APP_JSON_PATH, "utf-8");
const workingAppJson = JSON.parse(workingRaw) as AppJson;

const headIosBuildNumber = headAppJson.expo.ios?.buildNumber ?? "0";
const headAndroid = headAppJson.expo.android?.versionCode ?? 0;
const workingIosBuildNumber = workingAppJson.expo.ios?.buildNumber ?? "0";
const workingAndroid = workingAppJson.expo.android?.versionCode ?? 0;

// Numeric forms used for reporting and SIGNING.md patterns
const headIos = parseInt(headIosBuildNumber, 10);
const workingIos = parseInt(workingIosBuildNumber, 10);

// --- Guard: nothing to do if working tree already matches HEAD ---
if (workingIosBuildNumber === headIosBuildNumber && workingAndroid === headAndroid) {
  console.log(
    "\nNothing to reset — working-tree app.json already matches HEAD:\n" +
    `  ios.buildNumber:     ${headIosBuildNumber}\n` +
    `  android.versionCode: ${headAndroid}\n`
  );
  process.exit(0);
}

// --- Apply HEAD values to working-tree app.json ---
if (!workingAppJson.expo.ios) {
  workingAppJson.expo.ios = {};
}
// Restore the exact committed string, not a re-serialised integer form
workingAppJson.expo.ios.buildNumber = headIosBuildNumber;

if (!workingAppJson.expo.android) {
  workingAppJson.expo.android = {};
}
workingAppJson.expo.android.versionCode = headAndroid;

writeFileSync(APP_JSON_PATH, JSON.stringify(workingAppJson, null, 2) + "\n", "utf-8");

// --- Report ---
const iosChanged = workingIos !== headIos;
const androidChanged = workingAndroid !== headAndroid;

if (iosChanged) {
  console.log(`ios.buildNumber restored:    ${workingIos} → ${headIos}`);
} else {
  console.log(`ios.buildNumber unchanged:   ${headIos}`);
}

if (androidChanged) {
  console.log(`android.versionCode restored: ${workingAndroid} → ${headAndroid}`);
} else {
  console.log(`android.versionCode unchanged: ${headAndroid}`);
}

console.log(`Updated: artifacts/cashclip/app.json`);
// SIGNING.md removed from version control — skip gracefully if absent
if (existsSync(SIGNING_MD_PATH)) {
  const appVersion = workingAppJson.expo.version ?? headAppJson.expo.version ?? "";
  const signingMd = readFileSync(SIGNING_MD_PATH, "utf-8");
  // Each pattern restores one field in SIGNING.md to match the HEAD values.
  // The snapshot header ("Saved state as of build number **X**") is restored
  // alongside the table rows so the prose introduction stays consistent.
  const SIGNING_PATTERNS: Array<{ label: string; re: RegExp; replacement: string }> = [
    { label: "snapshot header build number", re: /^(Saved state as of build number \*\*)\d+(\*\*)/m, replacement: `$1${headIos}$2` },
    { label: "iOS build number row", re: /^(\| iOS build number\s*\|\s*`)\d+(`\s*\|)/m, replacement: `$1${headIos}$2` },
    { label: "Android version code row", re: /^(\| Android version code\s*\|\s*`)\d+(`\s*\|)/m, replacement: `$1${headAndroid}$2` },
    ...(appVersion ? [{ label: "App version row", re: /^(\| App version\s*\|\s*`)[^`]+(`\s*\|)/m, replacement: `$1${appVersion}$2` }] : []),
  ];
  let updatedSigningMd = signingMd;
  const restored: string[] = [];
  for (const { label, re, replacement } of SIGNING_PATTERNS) {
    if (!re.test(updatedSigningMd)) {
      console.warn(`⚠️  SIGNING.md update skipped — could not find "${label}".`);
      continue;
    }
    updatedSigningMd = updatedSigningMd.replace(re, replacement);
    restored.push(label);
  }
  writeFileSync(SIGNING_MD_PATH, updatedSigningMd, "utf-8");
  console.log(`Updated: artifacts/cashclip/SIGNING.md (${restored.join(", ")})`);
}
