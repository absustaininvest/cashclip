#!/usr/bin/env tsx
/**
 * check-vitest-configs.ts
 *
 * Walks every workspace package and asserts that each vitest.config.ts either:
 *   (a) imports from the shared `vitest.config.base`, OR
 *   (b) explicitly sets `passWithNoTests: false`
 *
 * Without one of these two guarantees, an empty test suite silently passes in CI,
 * defeating the no-empty-suite guardrail.
 *
 * Run via:   pnpm run check-vitest-configs
 */

import * as fs from "node:fs";
import * as path from "node:path";

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, "../..");

const PACKAGE_GLOBS: string[] = [
  "artifacts",
  "lib",
  path.join("lib", "integrations"),
  "scripts",
];

function findVitestConfigs(): string[] {
  const configs: string[] = [];

  for (const dir of PACKAGE_GLOBS) {
    const abs = path.join(WORKSPACE_ROOT, dir);
    if (!fs.existsSync(abs)) continue;

    const entries = fs.readdirSync(abs, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(abs, entry.name, "vitest.config.ts");
      if (fs.existsSync(candidate)) {
        configs.push(candidate);
      }
    }

    const topLevel = path.join(abs, "vitest.config.ts");
    if (fs.existsSync(topLevel)) {
      configs.push(topLevel);
    }
  }

  return configs;
}

function check(configPath: string): { ok: boolean; reason: string } {
  const content = fs.readFileSync(configPath, "utf8");

  const importsBase = /vitest\.config\.base/.test(content);
  if (importsBase) {
    return { ok: true, reason: "imports vitest.config.base" };
  }

  const setsPassWithNoTestsFalse = /passWithNoTests\s*:\s*false/.test(content);
  if (setsPassWithNoTestsFalse) {
    return { ok: true, reason: "explicitly sets passWithNoTests: false" };
  }

  return {
    ok: false,
    reason:
      "does not import vitest.config.base and does not set passWithNoTests: false",
  };
}

function main(): void {
  const configs = findVitestConfigs();

  if (configs.length === 0) {
    console.log("check-vitest-configs: no vitest.config.ts files found — nothing to check.");
    process.exit(0);
  }

  const failures: string[] = [];

  for (const configPath of configs) {
    const rel = path.relative(WORKSPACE_ROOT, configPath);
    const result = check(configPath);
    if (result.ok) {
      console.log(`  ✓  ${rel}  (${result.reason})`);
    } else {
      console.error(`  ✗  ${rel}  — ${result.reason}`);
      failures.push(rel);
    }
  }

  console.log("");
  console.log(
    `check-vitest-configs: ${configs.length - failures.length}/${configs.length} passed.`
  );

  if (failures.length > 0) {
    console.error("");
    console.error(
      "FAIL: The following vitest configs do not enforce the no-empty-suite rule."
    );
    console.error(
      "Each config must either import from vitest.config.base or set `passWithNoTests: false`."
    );
    for (const f of failures) {
      console.error(`  - ${f}`);
    }
    process.exit(1);
  }
}

main();
