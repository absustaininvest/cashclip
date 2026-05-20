import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_JSON_REPO_PATH = "artifacts/cashclip/app.json";
const APP_JSON_PATH = resolve(__dirname, "../../", APP_JSON_REPO_PATH);
const SIGNING_MD_PATH = resolve(__dirname, "../../artifacts/cashclip/SIGNING.md");

type BumpType = "patch" | "minor" | "major";

const VALID_BUMP_TYPES: BumpType[] = ["patch", "minor", "major"];

function parseBumpType(): BumpType {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (args.length === 0) return "patch";
  const arg = args[0];
  if (!VALID_BUMP_TYPES.includes(arg as BumpType)) {
    console.error(
      `ERROR: Invalid bump type "${arg}". Must be one of: patch, minor, major.`
    );
    process.exit(1);
  }
  return arg as BumpType;
}

function bumpSemver(version: string, type: BumpType): string {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    console.error(
      `ERROR: expo.version "${version}" is not a valid semver (expected X.Y.Z).`
    );
    process.exit(1);
  }
  let [, major, minor, patch] = match.map(Number);
  if (type === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (type === "minor") {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
  return `${major}.${minor}.${patch}`;
}

const bumpType = parseBumpType();

type AppJson = {
  expo: {
    ios?: { buildNumber?: string };
    android?: { versionCode?: number };
    version?: string;
  };
};

const raw = readFileSync(APP_JSON_PATH, "utf-8");
const appJson = JSON.parse(raw) as AppJson;

const currentVersion = appJson.expo.version;
if (!currentVersion) {
  console.error("ERROR: expo.version is missing or empty in app.json.");
  process.exit(1);
}

const nextVersion = bumpSemver(currentVersion, bumpType);
appJson.expo.version = nextVersion;

writeFileSync(APP_JSON_PATH, JSON.stringify(appJson, null, 2) + "\n", "utf-8");

const APP_VERSION_RE = /^(\| App version\s*\|\s*`)[^`]+(`\s*\|)/m;
const signingMd = readFileSync(SIGNING_MD_PATH, "utf-8");

if (!APP_VERSION_RE.test(signingMd)) {
  console.error(
    `ERROR: SIGNING.md update failed — could not find "App version" row.\n` +
    `       The table format may have changed. Update SIGNING.md manually.`
  );
  process.exit(1);
}

const updatedSigningMd = signingMd.replace(
  APP_VERSION_RE,
  `$1${nextVersion}$2`
);

writeFileSync(SIGNING_MD_PATH, updatedSigningMd, "utf-8");

console.log(`expo.version bumped (${bumpType}): ${currentVersion} → ${nextVersion}`);
console.log(`Updated: artifacts/cashclip/app.json`);
console.log(`Updated: artifacts/cashclip/SIGNING.md`);
