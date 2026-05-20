import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { parseAppJson, checkSigningMdSync } from "./check-signing-md-sync-lib.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_JSON_PATH = resolve(__dirname, "../../artifacts/cashclip/app.json");
const SIGNING_MD_PATH = resolve(__dirname, "../../artifacts/cashclip/SIGNING.md");

/**
 * --warn mode: all mismatches are printed as warnings but the script exits 0.
 * Default (no flag): mismatches are errors and the script exits 1.
 */
const warnOnly = process.argv.includes("--warn");

function report(message: string): void {
  if (warnOnly) {
    console.warn(message);
  } else {
    console.error(message);
  }
}

// SIGNING.md is intentionally excluded from version control; skip gracefully.
if (!existsSync(SIGNING_MD_PATH)) {
  console.log("SIGNING.md not present — nothing to check.");
  process.exit(0);
}

// --- Parse app.json ---

let appJson: ReturnType<typeof parseAppJson>;
try {
  appJson = parseAppJson(readFileSync(APP_JSON_PATH, "utf-8"));
} catch (err) {
  console.error("ERROR: " + String(err instanceof Error ? err.message : err));
  process.exit(1);
}

// --- Run checks ---

const signingMd = readFileSync(SIGNING_MD_PATH, "utf-8");
const result = checkSigningMdSync(appJson, signingMd);

for (const info of result.infos) {
  console.log(info);
}

for (const error of result.errors) {
  report("\n" + error);
}

if (result.hasIssue && !warnOnly) {
  process.exit(1);
}

if (!result.hasIssue) {
  console.log(
    "\u2705  app.json and SIGNING.md are in sync.\n" +
    `   expo.version:          ${appJson.version}\n` +
    `   ios.buildNumber:       ${appJson.iosBuildNumber}\n` +
    `   android.versionCode:   ${appJson.androidVersionCode}`
  );
}
