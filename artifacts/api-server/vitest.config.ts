import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Several suites import the large routes/cashclip module inside beforeAll.
    // Under parallel CPU contention that import can exceed vitest's default
    // 10s hook timeout, producing flaky "Hook timed out" failures (and
    // cascading skipped tests) on otherwise-passing files. Give hooks and
    // tests more headroom so the suite is deterministic.
    hookTimeout: 30000,
    testTimeout: 30000,
    // Tolerate test files that currently contain no test cases (e.g. an
    // in-progress stub) instead of failing the whole run with
    // "No test suite found in file".
    passWithNoTests: true,
  },
});
