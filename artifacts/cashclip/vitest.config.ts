import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  define: {
    __DEV__: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "app/**/*.test.tsx", "components/**/*.test.tsx"],
  },
});
