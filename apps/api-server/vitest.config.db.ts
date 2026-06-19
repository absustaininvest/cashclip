import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    typecheck: {
      tsconfig: path.resolve(__dirname, "tsconfig.json"),
    },
    hookTimeout: 30000,
    testTimeout: 30000,
    include: [
      "**/*.realDb.test.ts",
      "**/*.concurrent.test.ts",
    ],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
    ],
  },
});
