/**
 * helpers/db.ts
 *
 * Database helpers for integration tests.
 *
 * ── Transaction Rollback Pattern ─────────────────────────────────────────────
 *
 * Each test that touches the DB should call withTestTransaction():
 *
 *   let cleanup: () => Promise<void>;
 *
 *   beforeEach(async () => {
 *     cleanup = await beginTestTransaction();
 *   });
 *
 *   afterEach(async () => {
 *     await cleanup();
 *   });
 *
 * Everything inside the test runs in the same transaction.
 * The cleanup function rolls it back, leaving the DB pristine.
 *
 * ── Raw PG Client ────────────────────────────────────────────────────────────
 *
 * Drizzle wraps pg — for DDL or raw SQL in tests, use getTestPool() directly.
 */

import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@workspace/db";

const { Pool } = pg;

// ── Singleton pool for tests ──────────────────────────────────────────────────

let _pool: pg.Pool | null = null;

export function getTestPool(): pg.Pool {
  if (!_pool) {
    const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!url) throw new Error("TEST_DATABASE_URL is not set");
    _pool = new Pool({ connectionString: url, max: 5 });
  }
  return _pool;
}

export function getTestDb() {
  return drizzle(getTestPool(), { schema });
}

// ── Transaction rollback helper ───────────────────────────────────────────────

/**
 * Opens a transaction and returns a cleanup function that rolls it back.
 *
 * Usage:
 *   const cleanup = await beginTestTransaction();
 *   // ... run tests ...
 *   await cleanup(); // rolls back all inserts/updates
 */
export async function beginTestTransaction(): Promise<() => Promise<void>> {
  const client = await getTestPool().connect();
  await client.query("BEGIN");

  return async () => {
    await client.query("ROLLBACK");
    client.release();
  };
}

// ── Truncate helper (alternative to rollback — slower but simpler) ────────────

/**
 * Truncates all application tables in dependency-safe order.
 * Use this in globalSetup teardown or when rollback is not sufficient.
 */
export async function truncateAllTables(): Promise<void> {
  const client = await getTestPool().connect();
  try {
    // CASCADE handles FK ordering automatically.
    // We list the root tables and let CASCADE clean up dependents.
    await client.query(`
      TRUNCATE TABLE
        audit_logs,
        notifications,
        wf_instances,
        wf_templates,
        transmittals,
        correspondence,
        document_revisions,
        document_files,
        documents,
        folders,
        tasks,
        project_members,
        projects,
        departments,
        org_config,
        org_feature_overrides,
        refresh_tokens,
        password_reset_tokens,
        users,
        organizations,
        plans
      RESTART IDENTITY CASCADE
    `);
  } finally {
    client.release();
  }
}

// ── Graceful pool shutdown ────────────────────────────────────────────────────

export async function closeTestPool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}
