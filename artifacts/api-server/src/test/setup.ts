/**
 * setup.ts
 *
 * Runs before EACH test file (setupFiles in vitest.config.ts).
 * Responsibilities:
 *   1. Load .env.test if present
 *   2. Set NODE_ENV=test so app.ts skips seedDefaultAdmin and cron jobs
 *   3. Ensure DATABASE_URL points to the test DB
 *   4. Silence pino logs during tests (to keep output clean)
 */

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, "../..");

// Load .env.test from api-server root (optional — overrides nothing if absent)
config({ path: path.join(apiRoot, ".env.test"), override: false });

// Enforce test environment
process.env.NODE_ENV = "test";

// Route DATABASE_URL to the test DB
const testDbUrl = process.env.TEST_DATABASE_URL;
if (testDbUrl) {
  process.env.DATABASE_URL = testDbUrl;
}

// Silence pino in tests (set LOG_LEVEL=debug to see logs while debugging)
if (!process.env.LOG_LEVEL) {
  process.env.LOG_LEVEL = "silent";
}

// Provide a JWT_SECRET for token generation in tests
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET =
    "test-secret-do-not-use-in-production-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
}

// Stub external services that would fail without real credentials
// (Sentry, Stripe, AI, S3 — we don't want tests calling external APIs)
process.env.SENTRY_DSN = "";
process.env.STRIPE_SECRET_KEY = "sk_test_stub";
process.env.OPENAI_API_KEY = "sk-test-stub";
