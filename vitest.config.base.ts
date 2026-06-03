/**
 * Shared vitest base config for all packages in this monorepo.
 *
 * Convention: every package that uses vitest MUST extend this base using
 * `mergeConfig` so the `passWithNoTests` guardrail is always active.
 *
 * Example package-level config:
 *
 *   import { mergeConfig } from "vitest/config";
 *   import base from "../../vitest.config.base";   // adjust depth as needed
 *
 *   export default mergeConfig(base, {
 *     test: {
 *       // package-specific overrides here
 *     },
 *   });
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    /**
     * Fail the test run when no test files are found.
     * This prevents empty test suites from silently passing in CI.
     */
    passWithNoTests: false,
  },
});
