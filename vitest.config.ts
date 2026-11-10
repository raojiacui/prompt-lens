import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["tests/**/*.{test,spec}.{ts,tsx,js,jsx,mjs,mts,cts,cjs}"],
    environment: "node",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 30000,
    exclude: ["tests/e2e/**", "node_modules/**", ".next/**", ".worktrees/**",
      "tests/fly-machine-lifecycle.test.mjs", "tests/reconciliation-scheduler.test.mjs", "tests/scene-segments.test.mjs"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});
