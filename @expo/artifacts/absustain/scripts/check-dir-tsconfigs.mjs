// Guard: every top-level directory that contains TypeScript source files must
// have its own tsconfig.json. Without one, vitest silently fails to collect
// tests there with a TSCONFIG_ERROR — the suite exits 0 with zero files
// collected, making CI blind to entire test directories.
//
// HOW IT WORKS
// Two complementary checks run together:
//
// 1. INCLUDE CHECK (narrow, derived from vitest.config.ts)
//    Parses the test.include array and verifies each covered top-level directory
//    has a tsconfig.json. Fails immediately if any included directory is missing
//    one — guards the directories vitest currently covers.
//
// 2. TS-DIRECTORY CHECK (broad, based on what's on disk)
//    Scans every top-level directory for .ts / .tsx source files. Any directory
//    that contains TypeScript files must have a tsconfig.json, even if it isn't
//    yet in test.include. This catches new source directories before they are
//    added to the include list, so a missing tsconfig.json is caught at add-time
//    rather than silently swallowed later.
//
// FIXING A FAILURE
// Create <dir>/tsconfig.json for each listed directory.
// Copy src/tsconfig.json as a template — all per-directory configs should
// extend the package root tsconfig.json.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hasTsconfig(dir) {
  return fs.existsSync(path.join(root, dir, "tsconfig.json"));
}

// Returns true if the directory tree rooted at `dirPath` contains at least one
// .ts or .tsx file (node_modules excluded). Uses the Node 18+ recursive flag.
function containsTypeScriptFiles(dirPath) {
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { recursive: true, withFileTypes: true });
  } catch {
    return false;
  }
  return entries.some(
    (e) =>
      e.isFile() &&
      (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) &&
      !e.parentPath?.includes("node_modules") &&
      !e.path?.includes("node_modules")
  );
}

// Top-level directory names to skip entirely (non-source, tooling, generated).
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "public",
  "scripts",
  "attached_assets",
  "cashclip",
]);

// ---------------------------------------------------------------------------
// Check 1: directories derived from vitest.config.ts test.include
// ---------------------------------------------------------------------------

const configPath = path.join(root, "vitest.config.ts");

if (!fs.existsSync(configPath)) {
  process.stderr.write(
    `[check-dir-tsconfigs] ERROR — vitest.config.ts not found at ${configPath}\n`
  );
  process.exit(1);
}

const configSource = fs.readFileSync(configPath, "utf-8");

const testBlockMatch = configSource.match(/\btest\s*:\s*\{([\s\S]*)/);
if (!testBlockMatch) {
  process.stderr.write(
    `[check-dir-tsconfigs] ERROR — could not locate test:{} in vitest.config.ts.\n` +
      `  Expected a top-level "test: { include: [...] }" shape.\n`
  );
  process.exit(1);
}

const includeMatch = testBlockMatch[1].match(/\binclude\s*:\s*\[([\s\S]*?)\]/);
if (!includeMatch) {
  process.stderr.write(
    `[check-dir-tsconfigs] ERROR — could not locate include:[...] inside test:{} in vitest.config.ts.\n`
  );
  process.exit(1);
}

const includePatterns = [...includeMatch[1].matchAll(/["']([^"']+)["']/g)].map(
  (m) => m[1]
);

if (includePatterns.length === 0) {
  process.stderr.write(
    `[check-dir-tsconfigs] ERROR — include array in vitest.config.ts is empty or could not be parsed.\n`
  );
  process.exit(1);
}

const includeDirs = [...new Set(includePatterns.map((p) => p.split("/")[0]))];
const missingFromInclude = includeDirs.filter((d) => !hasTsconfig(d));

// ---------------------------------------------------------------------------
// Check 2: every top-level directory that contains TypeScript files
// ---------------------------------------------------------------------------

const topLevelEntries = fs
  .readdirSync(root, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name));

const tsDirsWithoutTsconfig = topLevelEntries
  .filter((e) => !hasTsconfig(e.name))
  .filter((e) => containsTypeScriptFiles(path.join(root, e.name)))
  .map((e) => e.name);

// ---------------------------------------------------------------------------
// Combine and report
// ---------------------------------------------------------------------------

const missingAll = [
  ...new Set([...missingFromInclude, ...tsDirsWithoutTsconfig]),
];

const tsconfigTemplate = JSON.stringify(
  {
    extends: "../tsconfig.json",
    include: ["**/*.ts", "**/*.tsx"],
    exclude: ["node_modules"],
  },
  null,
  2
);

if (missingAll.length > 0) {
  const fileList = missingAll.map((d) => `  ${d}/tsconfig.json`).join("\n");
  const includeNote =
    missingFromInclude.length > 0
      ? `  Directories currently in vitest include: ${missingFromInclude.join(", ")}\n`
      : "";
  const tsNote =
    tsDirsWithoutTsconfig.length > 0
      ? `  Directories with TypeScript files (not yet in include): ${tsDirsWithoutTsconfig.join(", ")}\n`
      : "";

  process.stderr.write(
    `\n[check-dir-tsconfigs] ERROR — missing per-directory tsconfig.json in: ${missingAll.join(", ")}\n\n` +
      includeNote +
      tsNote +
      `\nEach directory with TypeScript files must have its own tsconfig.json, otherwise\n` +
      `vitest silently fails to collect tests there (TSCONFIG_ERROR) and exits 0 with\n` +
      `zero files collected — masking entire test directories from CI.\n\n` +
      `Create the following file(s):\n${fileList}\n\n` +
      `Each file should contain:\n${tsconfigTemplate}\n\n`
  );
  process.exit(1);
}

process.stdout.write(
  `[check-dir-tsconfigs] OK — all TypeScript source directories have tsconfig.json` +
    ` (include dirs: ${includeDirs.join(", ")})\n`
);
