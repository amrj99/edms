import { defineConfig } from "vitest/config";

// Minimal, standalone Vitest config (C7-0). Deliberately does NOT import
// vite.config.ts — it would pull in the React plugin and dev-server settings the
// unit tests don't need. `unwrapList` is pure logic, so the `node` environment
// is sufficient; jsdom is intentionally omitted and added only if/when component
// tests need a DOM. No path aliases are configured because the current test uses
// only a relative import.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
