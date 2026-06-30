/**
 * Cross-platform development entry point.
 *
 * Replaces the Unix-only `export NODE_ENV=development` pattern in the dev script.
 * Sets NODE_ENV, runs the esbuild bundle, then starts the server — on any OS.
 *
 * Usage (from the api-server directory):
 *   node --enable-source-maps dev.mjs
 *   pnpm dev
 *
 * The equivalent Docker dev workflow uses docker-compose.dev.yml, which mounts
 * src/ from the host and overrides the container command to run this file.
 * Edit source on the host, then restart the api container to pick up changes.
 */
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Set development mode if not already provided by the environment.
// Uses ??= so an explicit NODE_ENV=production in the env still wins.
process.env.NODE_ENV ??= "development";

// Run esbuild synchronously (exits 1 on failure, which throws here).
execFileSync(process.execPath, [resolve(__dirname, "build.mjs")], {
  stdio: "inherit",
  cwd: __dirname,
  env: process.env,
});

// Start the server. start.mjs loads .env (if present) then imports dist/index.mjs.
await import("./start.mjs");
