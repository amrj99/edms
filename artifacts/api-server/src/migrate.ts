/**
 * Standalone migration runner — executed by docker-entrypoint.sh before
 * the API server starts.  Uses drizzle-orm's runtime migrator (no drizzle-kit
 * CLI required in production) to apply any pending SQL migration files from
 * lib/db/drizzle/.
 *
 * Baseline detection:
 *   If `organizations` already exists but the drizzle migration-tracking schema
 *   does not, this is a pre-migration production database.  We create the
 *   tracking table in schema "drizzle" and insert every journal entry with its
 *   original timestamp so the migrator considers them already applied.  From
 *   that point on only genuinely new migration files are executed.
 *
 * How drizzle-orm migrate() decides what to run:
 *   It queries the last row from "drizzle"."__drizzle_migrations" ordered by
 *   created_at DESC.  Any migration whose `when` timestamp (folderMillis) is
 *   greater than that last created_at is executed.  So we just need to insert
 *   every baseline entry with its correct journal timestamp.
 */

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { pool, db } from "@workspace/db";
import { createHash } from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Compiled location: /app/artifacts/api-server/dist/migrate.mjs
// Migration files:   /app/lib/db/drizzle/
const MIGRATIONS_FOLDER = path.resolve(__dirname, "../../../lib/db/drizzle");

// drizzle-orm defaults: schema "drizzle", table "__drizzle_migrations"
const DRIZZLE_SCHEMA = "drizzle";
const DRIZZLE_TABLE  = "__drizzle_migrations";

async function main() {
  if (!fs.existsSync(MIGRATIONS_FOLDER)) {
    console.error(`[migrate] Migrations folder not found: ${MIGRATIONS_FOLDER}`);
    process.exit(1);
  }

  try {
    await ensureBaseline();
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    console.log("[migrate] All migrations applied successfully.");
  } finally {
    await pool.end();
  }
}

/**
 * If this is an existing database (tables present, tracking schema absent)
 * create "drizzle"."__drizzle_migrations" and insert every journal entry as
 * "already applied" so the migrator only runs genuinely new migrations.
 */
async function ensureBaseline(): Promise<void> {
  const { rows: orgCheck } = await pool.query<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'organizations'
    ) AS "exists"
  `);

  if (!orgCheck[0].exists) {
    console.log("[migrate] Fresh database — running full migration from scratch.");
    return;
  }

  const { rows: schemaCheck } = await pool.query<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.schemata
      WHERE schema_name = $1
    ) AS "exists"
  `, [DRIZZLE_SCHEMA]);

  if (schemaCheck[0].exists) {
    return;
  }

  console.log("[migrate] Existing database detected — creating migration baseline...");

  await pool.query(`CREATE SCHEMA IF NOT EXISTS "${DRIZZLE_SCHEMA}"`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "${DRIZZLE_SCHEMA}"."${DRIZZLE_TABLE}" (
      id         SERIAL  PRIMARY KEY,
      hash       TEXT    NOT NULL,
      created_at BIGINT
    )
  `);

  const journalPath = path.join(MIGRATIONS_FOLDER, "meta/_journal.json");
  if (!fs.existsSync(journalPath)) {
    console.warn("[migrate] WARNING: journal not found at", journalPath);
    return;
  }

  const journal: { entries: Array<{ tag: string; when: number }> } =
    JSON.parse(fs.readFileSync(journalPath, "utf-8"));

  for (const entry of journal.entries) {
    const sqlPath = path.join(MIGRATIONS_FOLDER, `${entry.tag}.sql`);
    const sqlContent = fs.existsSync(sqlPath)
      ? fs.readFileSync(sqlPath, "utf-8")
      : "";
    const hash = createHash("sha256").update(sqlContent).digest("hex");

    await pool.query(
      `INSERT INTO "${DRIZZLE_SCHEMA}"."${DRIZZLE_TABLE}" (hash, created_at) VALUES ($1, $2)`,
      [hash, entry.when]
    );
    console.log(`[migrate]   baselined: ${entry.tag} (${entry.when})`);
  }

  console.log("[migrate] Baseline complete — existing schema is tracked.");
}

main().catch((err) => {
  console.error("[migrate] Fatal migration error:", err);
  process.exit(1);
});
