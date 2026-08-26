/**
 * rls-migrator-lifecycle.test.ts — DEBT-010 RC remediation (req 6).
 *
 * End-to-end proof of the FINAL clean architecture: the MIGRATOR (the real migrate.ts,
 * run from source via tsx as the owner/migrator role) performs ALL privileged install
 * work — drizzle migrations, plan catalog + reference seed (seedPlans), H1 integrity
 * constraints (runIntegrityMigrations), and membership-aware RLS (applyMembershipRls).
 *
 * Runs migrate.ts against a dedicated scratch DATABASE (fresh install), asserts the
 * schema / constraints / plans / RLS are all present, and that a second run is
 * idempotent. The edms_app runtime never does any of this (see rls-single-source-guard
 * + rls-startup-persistence).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import pg from "pg";

const { Client } = pg;
const SCRATCH = "edms_migrator_lifecycle";
const BASE = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL!;
const SCRATCH_URL = BASE.replace(/\/[^/?]+(\?|$)/, `/${SCRATCH}$1`); // owner creds, scratch db
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, "../..");
const MIGRATE_SRC = path.join(apiRoot, "src", "migrate.ts");

let scratch: pg.Client;

async function dropScratch() {
  const c = new Client({ connectionString: BASE });
  await c.connect();
  try { await c.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`); } finally { await c.end(); }
}

/** Run the REAL migrator (source, via tsx) against the scratch DB as the owner/migrator role. */
function runMigrator(): string {
  return execSync(`pnpm exec tsx "${MIGRATE_SRC}"`, {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: SCRATCH_URL, APP_DATABASE_URL: "", APP_DB_ROLE: "owner" },
    encoding: "utf8",
    stdio: "pipe",
  });
}

async function scalar(sql: string, params: any[] = []): Promise<any> {
  return (await scratch.query(sql, params)).rows[0];
}

beforeAll(async () => {
  if (!fs.existsSync(MIGRATE_SRC)) throw new Error(`migrate source not found at ${MIGRATE_SRC}`);
  await dropScratch();
  const owner = new Client({ connectionString: BASE });
  await owner.connect();
  await owner.query(`CREATE DATABASE ${SCRATCH}`);
  await owner.end();

  // Fresh install via the REAL migrator.
  runMigrator();

  scratch = new Client({ connectionString: SCRATCH_URL });
  await scratch.connect();
}, 180_000);

afterAll(async () => {
  if (scratch) { try { await scratch.end(); } catch { /* ignore */ } }
  await dropScratch();
});

describe("DEBT-010 — migrator lifecycle (fresh install via real migrate.ts (tsx))", () => {
  it("plan catalog is created and reference-seeded (seedPlans → migrator)", async () => {
    const tbl = await scalar(`SELECT to_regclass('public.plans') AS t`);
    expect(tbl.t).not.toBeNull();
    const cnt = await scalar(`SELECT count(*)::int c FROM plans`);
    expect(cnt.c).toBeGreaterThanOrEqual(6); // trial/expired/starter/basic/professional/enterprise
  });

  it("H1 integrity constraints are applied (runIntegrityMigrations → migrator)", async () => {
    const fks = await scalar(
      `SELECT count(*)::int c FROM information_schema.table_constraints
       WHERE constraint_type='FOREIGN KEY'
         AND constraint_name IN ('users_organization_id_fkey','projects_organization_id_fkey')`,
    );
    expect(fks.c).toBe(2);
  });

  it("membership-aware RLS is installed (applyMembershipRls → migrator)", async () => {
    expect((await scalar(`SELECT count(*)::int c FROM pg_namespace WHERE nspname='app'`)).c).toBe(1);
    expect((await scalar(`SELECT count(*)::int c FROM pg_policies WHERE schemaname='public' AND policyname='org_isolation_policy'`)).c).toBe(13);
    const proj = await scalar(`SELECT qual FROM pg_policies WHERE tablename='projects' AND policyname='org_isolation_policy'`);
    expect(proj.qual).toMatch(/org_has_party_row/);
    expect((await scalar(`SELECT count(*)::int c FROM pg_trigger WHERE tgname='xa_guard' AND NOT tgisinternal`)).c).toBe(2);
  });

  it("edms_app is a least-privilege grantee, not an owner, after the migrator runs", async () => {
    const owns = await scalar(
      `SELECT count(*)::int c FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relkind='r' AND pg_get_userbyid(c.relowner)='edms_app'`,
    );
    expect(owns.c).toBe(0);
    const canSelect = await scalar(`SELECT has_table_privilege('edms_app','public.documents','SELECT') AS ok`);
    expect(canSelect.ok).toBe(true);
  });

  it("is idempotent — running the migrator again succeeds and is stable", async () => {
    expect(() => runMigrator()).not.toThrow();
    expect((await scalar(`SELECT count(*)::int c FROM pg_policies WHERE schemaname='public' AND policyname='org_isolation_policy'`)).c).toBe(13);
    expect((await scalar(`SELECT count(*)::int c FROM plans`)).c).toBeGreaterThanOrEqual(6);
  }, 120_000);
});
