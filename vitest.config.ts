import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    // Integration tests share ONE Postgres database (mm6_test) and reset it
    // between tests, so test files must never run concurrently. This is a
    // root-level option (project-level fileParallelism is not honored).
    fileParallelism: false,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          // Integration tests share ONE Postgres database (mm6_test): each test
          // truncates + re-seeds, so files must run strictly serially — no two
          // files racing on the shared schema (DROP/CREATE/TRUNCATE).
          sequence: { concurrent: false },
          poolOptions: { threads: { singleThread: true } },
        },
      },
      {
        extends: true,
        test: {
          name: "components",
          include: ["tests/components/**/*.test.tsx"],
          environment: "jsdom",
        },
      },
    ],
  },
});
