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

const { Client } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");

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

  // Enable RLS policies on the test DB so rls.test.ts can verify them.
  // initRlsPolicies() is normally called at server startup — we replicate
  // that here so the test DB mirrors the production DB configuration.
  console.log("[test:setup] Initialising RLS policies...");
  const client = new Client({ connectionString: testDbUrl });
  await client.connect();

  const RLS_TABLES = [
    "documents", "document_revisions", "document_files",
    "projects", "tasks", "notifications", "rules",
    "correspondence", "transmittals",
  ];
  const POLICY_NAME = "org_isolation_policy";

  for (const table of RLS_TABLES) {
    try {
      await client.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await client.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
      await client.query(`DROP POLICY IF EXISTS "${POLICY_NAME}" ON "${table}"`);
      await client.query(`
        CREATE POLICY "${POLICY_NAME}" ON "${table}"
        AS PERMISSIVE FOR ALL
        USING (
          organization_id IS NULL
          OR COALESCE(NULLIF(current_setting('app.current_org_id', TRUE), ''), NULL) IS NULL
          OR organization_id = NULLIF(current_setting('app.current_org_id', TRUE), '')::integer
        )
      `);
    } catch {
      // Table may not have organization_id — skip silently
    }
  }

  // Create a non-superuser role for RLS tests.
  // Superusers bypass RLS even with FORCE ROW LEVEL SECURITY.
  // rls_tester is a regular role that is subject to RLS policies.
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rls_tester') THEN
        CREATE ROLE rls_tester LOGIN PASSWORD 'rls_tester_pw';
      END IF;
    END $$
  `);

  // Grant rls_tester SELECT/INSERT/UPDATE/DELETE on all RLS-protected tables
  // so the test queries can actually run (just filtered by policy).
  for (const table of RLS_TABLES) {
    try {
      await client.query(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "${table}" TO rls_tester`,
      );
    } catch {
      // skip tables that don't exist
    }
  }

  // Also grant usage on the public schema and all sequences
  // (needed for INSERT in seed helpers that run as the main user, not rls_tester)
  await client.query(`GRANT USAGE ON SCHEMA public TO rls_tester`);
  await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rls_tester`);

  await client.end();
  console.log("[test:setup] RLS policies initialised ✓\n");
}

export async function teardown(): Promise<void> {
  // Nothing to do — the test DB container is managed externally.
  // In CI, the container is stopped after the job finishes.
}
