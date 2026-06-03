import { readdirSync, existsSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = resolve(__dirname, "../..");
const ARTIFACTS_DIR = join(WORKSPACE_ROOT, "artifacts");

const BLOCKED = /\.(zip|tar|gz|tgz|7z|rar|bz2|sql|bak|env)$/i;

function scanDir(dir: string): string[] {
  const found: string[] = [];
  if (!existsSync(dir)) return found;
  const entries = readdirSync(dir, { recursive: true } as Parameters<typeof readdirSync>[1]) as string[];
  for (const entry of entries) {
    if (typeof entry === "string" && BLOCKED.test(entry)) {
      found.push(join(dir, entry));
    }
  }
  return found;
}

// Scan every artifacts/<name>/public/ directory
const artifactDirs = existsSync(ARTIFACTS_DIR)
  ? readdirSync(ARTIFACTS_DIR).map((name) => join(ARTIFACTS_DIR, name, "public"))
  : [];

const allFound: string[] = [];
for (const pubDir of artifactDirs) {
  const hits = scanDir(pubDir);
  allFound.push(...hits);
}

if (allFound.length > 0) {
  console.error("\nERROR: Archive files must not exist in public web roots.\n");
  console.error("The following files are exposed to unauthenticated visitors:");
  for (const f of allFound) {
    const rel = f.replace(WORKSPACE_ROOT + "/", "");
    console.error(`  ${rel}`);
  }
  console.error(
    "\nRemove these files from their respective public/ directories and ensure\n" +
    "they are listed in .gitignore before re-running this check.\n"
  );
  process.exit(1);
}

const checked = artifactDirs
  .filter(existsSync)
  .map((d) => d.replace(WORKSPACE_ROOT + "/", ""));

console.log("check-public-archives: no archive files found in public web roots.");
if (checked.length > 0) {
  console.log("Directories scanned:");
  for (const d of checked) console.log(`  ${d}`);
}
