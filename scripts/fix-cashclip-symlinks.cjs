#!/usr/bin/env node
/**
 * fix-cashclip-symlinks.js
 *
 * pnpm generates node_modules symlinks with relative paths computed from the
 * package directory depth. Because @expo/artifacts/absustain/cashclip is 4
 * levels deep from the workspace root (vs 2 for a normal artifacts/X package),
 * pnpm's generated symlinks consistently resolve 2 levels short — they land
 * at @expo/artifacts/node_modules/.pnpm/... which doesn't exist.
 *
 * This script walks every symlink in that package's node_modules, detects
 * broken ones, and re-links them to the correct target (computing a fresh
 * relative path from the symlink's own directory to the real absolute target).
 *
 * Run after every `pnpm install` via scripts/post-merge.sh.
 */

const fs = require("fs");
const path = require("path");

const workspaceRoot = path.resolve(__dirname, "..");
const nmDir = path.join(
  workspaceRoot,
  "apps/cashclip/node_modules"
);

let fixed = 0;
let skipped = 0;
let alreadyOk = 0;

function repairDir(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry === ".modules.yaml" || entry === ".package-lock.json") continue;

    const full = path.join(dir, entry);
    let stat;
    try {
      stat = fs.lstatSync(full);
    } catch {
      continue;
    }
    if (!stat.isSymbolicLink()) continue;

    const target = fs.readlinkSync(full);
    const resolved = path.resolve(path.dirname(full), target);

    // If the symlink already resolves, leave it alone.
    let targetExists = false;
    try {
      fs.statSync(resolved);
      targetExists = true;
    } catch {
      // broken
    }
    if (targetExists) {
      alreadyOk++;
      continue;
    }

    // Determine the absolute target.
    // pnpm store paths contain "node_modules/.pnpm/"; workspace-local paths contain "lib/".
    let absoluteTarget;
    const pnpmIdx = target.indexOf("node_modules/.pnpm/");
    const libIdx = target.indexOf("lib/");

    if (pnpmIdx !== -1) {
      absoluteTarget = path.join(workspaceRoot, target.slice(pnpmIdx));
    } else if (libIdx !== -1) {
      absoluteTarget = path.join(workspaceRoot, target.slice(libIdx));
    } else {
      console.warn(`  skip (unknown target pattern): ${full} -> ${target}`);
      skipped++;
      continue;
    }

    let absExists = false;
    try {
      fs.statSync(absoluteTarget);
      absExists = true;
    } catch {
      // not found
    }
    if (!absExists) {
      console.warn(
        `  skip (absolute target missing): ${full} -> ${absoluteTarget}`
      );
      skipped++;
      continue;
    }

    const newRelative = path.relative(path.dirname(full), absoluteTarget);
    fs.unlinkSync(full);
    fs.symlinkSync(newRelative, full);
    fixed++;
  }
}

if (!fs.existsSync(nmDir)) {
  console.log("fix-cashclip-symlinks: node_modules dir not found, nothing to do.");
  process.exit(0);
}

// Repair top-level packages
repairDir(nmDir);

// Repair scoped packages (@scope/pkg)
for (const entry of fs.readdirSync(nmDir)) {
  if (!entry.startsWith("@")) continue;
  const scopeDir = path.join(nmDir, entry);
  let stat;
  try {
    stat = fs.lstatSync(scopeDir);
  } catch {
    continue;
  }
  if (!stat.isDirectory()) continue;
  repairDir(scopeDir);
}

if (fixed > 0) {
  console.log(
    `fix-cashclip-symlinks: repaired ${fixed} symlink(s) (${alreadyOk} ok, ${skipped} skipped)`
  );
} else {
  console.log(
    `fix-cashclip-symlinks: all ${alreadyOk} symlink(s) ok, nothing to repair`
  );
}
