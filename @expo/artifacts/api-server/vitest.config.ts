import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Some test files import the large `src/routes/cashclip.ts` route module
    // inside a `beforeAll` hook. Under full-suite parallel load, transforming
    // that 4,000+ line file can exceed vitest's default 10s hook timeout,
    // causing flaky "Hook timed out" failures. Raise the global hook/test
    // timeouts so individual files don't need ad-hoc per-hook timeouts.
    hookTimeout: 30000,
    testTimeout: 30000,
  },
});
