import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    typecheck: {
      tsconfig: path.resolve(__dirname, "tsconfig.json"),
    },
    // Some test files import the large `src/routes/cashclip.ts` route module
    // inside a `beforeAll` hook. Under full-suite parallel load, transforming
    // that 4,000+ line file can exceed vitest's default 10s hook timeout,
    // causing flaky "Hook timed out" failures. Raise the global hook/test
    // timeouts so individual files don't need ad-hoc per-hook timeouts.
    hookTimeout: 30000,
    testTimeout: 30000,
    // Explicitly resolve the local tsconfig so the oxc/esbuild transformer
    // never has to walk up through pnpm's virtual-store directories to find it.
    // Without this, vite can mis-resolve the tsconfig from the pnpm virtual store
    // (node_modules/.pnpm/…) and emit a [TSCONFIG_ERROR].
  },
});
