import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./packages/test-utils/src/global-setup.ts"],
    pool: "forks",
    testTimeout: 30_000,
    hookTimeout: 180_000,
    projects: [
      {
        test: {
          name: "unit",
          include: ["packages/**/src/**/*.test.ts", "apps/**/src/**/*.test.ts"],
          exclude: ["**/node_modules/**", "**/dist/**", "**/*.integration.test.ts"],
        },
      },
      {
        test: {
          name: "integration",
          include: [
            "packages/**/src/**/*.integration.test.ts",
            "apps/**/src/**/*.integration.test.ts",
          ],
          exclude: ["**/node_modules/**", "**/dist/**"],
          fileParallelism: false,
          testTimeout: 60_000,
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
    },
  },
});
