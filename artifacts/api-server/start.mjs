/**
 * Local development entry point.
 * Reads ../../.env (if it exists) and merges variables into process.env
 * WITHOUT overwriting anything already set by the environment.
 * Then dynamically imports the compiled server so every module loads
 * after env vars are populated.
 *
 * Usage (from the api-server directory):
 *   node --enable-source-maps start.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../../.env");

if (existsSync(envPath)) {
  const lines = readFileSync(envPath, "utf8").split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx < 1) continue;
    const key = line.slice(0, eqIdx).trim();
    const rawVal = line.slice(eqIdx + 1).trim();
    // Strip optional surrounding quotes
    const val = rawVal.replace(/^(["'`])(.*)\1$/, "$2");
    // Only set if not already defined (env vars from the shell take precedence)
    if (key && !(key in process.env)) {
      process.env[key] = val;
    }
  }
  console.log(`[start.mjs] Loaded .env from ${envPath}`);
}

await import("./dist/index.mjs");
