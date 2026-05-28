import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    // ── Environment ──────────────────────────────────────────────────────────
    // node environment — we are testing an Express API, not a browser app.
    environment: "node",

    // ── Global setup / teardown ──────────────────────────────────────────────
    // globalSetup runs once before all test files (creates test DB, runs migrations).
    // setupFiles runs before each test file (resets per-file state if needed).
    globalSetup: ["./src/test/global-setup.ts"],
    setupFiles: ["./src/test/setup.ts"],

    // ── Test file pattern ────────────────────────────────────────────────────
    include: ["src/**/*.test.ts", "src/**/*.spec.ts"],
    exclude: ["node_modules", "dist"],

    // ── Timeout ─────────────────────────────────────────────────────────────
    // Integration tests hit a real DB — 10s per test is generous but safe.
    testTimeout: 10_000,
    hookTimeout: 30_000,

    // ── Reporter ─────────────────────────────────────────────────────────────
    reporter: process.env.CI ? ["verbose", "github-actions"] : ["verbose"],

    // ── Coverage ─────────────────────────────────────────────────────────────
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/test/**",
        "src/**/*.test.ts",
        "src/**/*.spec.ts",
        "src/index.ts",       // entrypoint — no logic
        "src/instrument.ts",  // Sentry init — no logic
      ],
    },

    // ── Sequence ─────────────────────────────────────────────────────────────
    // Run test files sequentially to avoid parallel DB conflicts.
    // Within a file, tests still run in order (default).
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true, // single process per run — safe for shared test DB
      },
    },
  },

  resolve: {
    // Mirror the path aliases in tsconfig so imports resolve correctly in tests.
    alias: {
      "@workspace/db/schema": path.resolve(__dirname, "../../lib/db/src/schema/index.ts"),
      "@workspace/db": path.resolve(__dirname, "../../lib/db/src/index.ts"),
      "@workspace/api-zod": path.resolve(__dirname, "../../lib/api-zod/src/index.ts"),
      "@workspace/integrations-openai-ai-server": path.resolve(
        __dirname,
        "../../lib/integrations-openai-ai-server/src/index.ts",
      ),
    },
  },
});
