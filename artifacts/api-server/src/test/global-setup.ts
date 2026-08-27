/**
 * global-setup.ts
 *
 * Runs ONCE before all test files.
 * Responsibilities:
 *   1. Verify TEST_DATABASE_URL is set (fail early with a clear message)
 *   2. Push the Drizzle schema to the test database
 *
 * This file is referenced in vitest.config.ts → test.globalSetup.
 * It must export a default async function (or named setup/teardown).
 */

import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { config as dotenvConfig } from "dotenv";
import { applyMembershipRls } from "../lib/rls-membership.js";

const { Client } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const apiRoot  = path.resolve(__dirname, "../..");

// Load .env.test before anything else so TEST_DATABASE_URL is available
// when global-setup runs (setup.ts loads it too, but only after globalSetup).
dotenvConfig({ path: path.join(apiRoot, ".env.test"), override: false });

export async function setup(): Promise<void> {
  const testDbUrl = process.env.TEST_DATABASE_URL;

  if (!testDbUrl) {
    throw new Error(
      "\n\n" +
      "  ❌  TEST_DATABASE_URL is not set.\n\n" +
      "  Start the test database first:\n" +
      "    docker compose -f docker-compose.test.yml up -d\n\n" +
      "  Then run tests with:\n" +
      "    TEST_DATABASE_URL=postgresql://edms_test:edms_test_password@localhost:5433/edms_test pnpm test\n\n" +
      "  Or add it to a .env.test file (loaded automatically by setup.ts).\n",
    );
  }

  // Point DATABASE_URL to the test DB for Drizzle's push command
  process.env.DATABASE_URL = testDbUrl;

  console.log("\n[test:setup] Pushing schema to test database...");

  try {
    // Use drizzle-kit push to apply schema to test DB.
    // --force skips the interactive prompt in CI.
    execSync("pnpm --filter @workspace/db run push-force", {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL: testDbUrl },
      stdio: "inherit",
    });
    console.log("[test:setup] Schema push complete ✓");
  } catch (err) {
    throw new Error(`[test:setup] Schema push failed: ${String(err)}`);
  }

  // Apply the membership-aware RLS model (DEBT-010 Decision B) to the ISOLATED test
  // DB: `app` schema + SECURITY DEFINER authority functions + per-category
  // org_isolation_policy (single FOR ALL per table) + X-a triggers + least-priv
  // grants. Creates the two roles (edms_rls_owner owner, edms_app runtime) in the
  // isolated DB only — this is test-harness setup, not a Production role/cutover.
  console.log("[test:setup] Applying membership-aware RLS (roles + policies)...");
  const client = new Client({ connectionString: testDbUrl });
  await client.connect();

  await applyMembershipRls((s) => client.query(s), { createRoles: true, appPassword: "edms_app_pw" });

  // Legacy RLS tests connect as `rls_tester`; keep it working under the new model
  // by giving it the same least-privilege access as edms_app (non-superuser, subject
  // to RLS). It must be able to EXECUTE the app.* authority functions the policies call.
  await client.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rls_tester') THEN
        CREATE ROLE rls_tester LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD 'rls_tester_pw';
      END IF;
    END $$;`);
  await client.query(`REVOKE CREATE ON SCHEMA public FROM rls_tester`);
  await client.query(`GRANT USAGE ON SCHEMA public TO rls_tester`);
  await client.query(`GRANT USAGE ON SCHEMA app TO rls_tester`);
  await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rls_tester`);
  await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rls_tester`);
  await client.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO rls_tester`);

  await client.end();
  console.log("[test:setup] Membership-aware RLS applied ✓\n");
}

export async function teardown(): Promise<void> {
  // Nothing to do — the test DB container is managed externally.
  // In CI, the container is stopped after the job finishes.
}
