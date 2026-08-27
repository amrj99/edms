/**
 * rls-migrator-lifecycle.test.ts — DEBT-010 RC remediation (req 6) + Deployment Artifact Gate.
 *
 * Proves the FINAL clean architecture using the EXACT production deployment artifact:
 * `node --enable-source-maps dist/migrate.mjs` with NODE_ENV=production — literally the
 * command docker-entrypoint.sh runs on every container start. The migrator (owner role)
 * performs ALL privileged install work — drizzle migrations, plan catalog + reference
 * seed (seedPlans), H1 integrity constraints (runIntegrityMigrations), and
 * membership-aware RLS (applyMembershipRls). The edms_app runtime never does any of it.
 *
 * beforeAll runs a clean `node build.mjs` so the artifact is (re)built from current
 * source, then runs it against a dedicated scratch DATABASE. Scenarios:
 *   • fresh install,
 *   • upgrade from the legacy prod baseline (13 fail-open policies + no app schema),
 *   • idempotent re-run.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import pg from "pg";
import { MEMBERSHIP_RLS_TABLES, POLICY_NAME } from "../lib/rls-membership.js";

const { Client } = pg;
const SCRATCH = "edms_migrator_lifecycle";
const BASE = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL!;
const SCRATCH_URL = BASE.replace(/\/[^/?]+(\?|$)/, `/${SCRATCH}$1`); // owner creds, scratch db
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, "../..");
const MIGRATE_MJS = path.join(apiRoot, "dist", "migrate.mjs");

// Legacy fail-open policy body (the exact production baseline, D1).
const OLD_QUAL =
  `organization_id IS NULL ` +
  `OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL ` +
  `OR organization_id = NULLIF(current_setting('app.current_org_id', true), '')::integer`;

let scratch: pg.Client;

async function dropScratch() {
  const c = new Client({ connectionString: BASE });
  await c.connect();
  try { await c.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`); } finally { await c.end(); }
}

/**
 * Run the EXACT production deployment artifact against the scratch DB.
 * Mirrors docker-entrypoint.sh: `node --enable-source-maps dist/migrate.mjs`,
 * NODE_ENV=production, DATABASE_URL = the migrator/owner connection.
 */
function runMigrator(envOverride: Record<string, string> = {}): string {
  return execSync(`node --enable-source-maps "${MIGRATE_MJS}"`, {
    cwd: apiRoot,
    env: { ...process.env, NODE_ENV: "production", DATABASE_URL: SCRATCH_URL, APP_DATABASE_URL: "", APP_DB_ROLE: "owner", ...envOverride },
    encoding: "utf8",
    stdio: "pipe",
  });
}

async function scalar(sql: string, params: any[] = []): Promise<any> {
  return (await scratch.query(sql, params)).rows[0];
}

beforeAll(async () => {
  // Clean build so the test exercises the CURRENT source's deployment artifact.
  execSync("node build.mjs", { cwd: apiRoot, stdio: "pipe" });
  if (!fs.existsSync(MIGRATE_MJS)) throw new Error(`deployment artifact not built at ${MIGRATE_MJS}`);

  await dropScratch();
  const owner = new Client({ connectionString: BASE });
  await owner.connect();
  await owner.query(`CREATE DATABASE ${SCRATCH}`);
  await owner.end();

  runMigrator(); // fresh install via the real artifact

  scratch = new Client({ connectionString: SCRATCH_URL });
  await scratch.connect();
}, 180_000);

afterAll(async () => {
  if (scratch) { try { await scratch.end(); } catch { /* ignore */ } }
  await dropScratch();
});

describe("DEBT-010 — deployment artifact lifecycle (node dist/migrate.mjs, NODE_ENV=production)", () => {
  it("the standalone artifact runs with no missing worker/module (fresh install succeeded)", async () => {
    // If migrate.mjs had a broken worker/package split it would have thrown in beforeAll.
    // Reaching here with a live scratch connection proves the artifact executed end-to-end.
    expect((await scalar(`SELECT 1 AS ok`)).ok).toBe(1);
  });

  it("plan catalog is created and reference-seeded (seedPlans → migrator)", async () => {
    expect((await scalar(`SELECT to_regclass('public.plans') AS t`)).t).not.toBeNull();
    expect((await scalar(`SELECT count(*)::int c FROM plans`)).c).toBeGreaterThanOrEqual(6);
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
    expect((await scalar(`SELECT count(*)::int c FROM pg_policies WHERE schemaname='public' AND policyname='${POLICY_NAME}'`)).c).toBe(13);
    const proj = await scalar(`SELECT qual FROM pg_policies WHERE tablename='projects' AND policyname='${POLICY_NAME}'`);
    expect(proj.qual).toMatch(/org_has_party_row/);
    expect((await scalar(`SELECT count(*)::int c FROM pg_trigger WHERE tgname='xa_guard' AND NOT tgisinternal`)).c).toBe(2);
  });

  it("edms_app is a least-privilege grantee, not an owner, after the migrator runs", async () => {
    const owns = await scalar(
      `SELECT count(*)::int c FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relkind='r' AND pg_get_userbyid(c.relowner)='edms_app'`,
    );
    expect(owns.c).toBe(0);
    expect((await scalar(`SELECT has_table_privilege('edms_app','public.documents','SELECT') AS ok`)).ok).toBe(true);
  });

  it("upgrades from the legacy prod baseline when the artifact re-runs (no clean DB)", async () => {
    // Downgrade the scratch DB to the exact production baseline: legacy fail-open
    // policies, no schema app, no X-a triggers — then run the real artifact again.
    for (const [tbl, fn] of [["correspondence", "xa_correspondence"], ["transmittals", "xa_transmittals"]] as const) {
      await scratch.query(`DROP TRIGGER IF EXISTS xa_guard ON "${tbl}"`);
    }
    for (const t of MEMBERSHIP_RLS_TABLES) {
      await scratch.query(`DROP POLICY IF EXISTS "${POLICY_NAME}" ON "${t}"`);
      await scratch.query(`CREATE POLICY "${POLICY_NAME}" ON "${t}" AS PERMISSIVE FOR ALL USING (${OLD_QUAL})`);
    }
    await scratch.query(`DROP SCHEMA app CASCADE`);
    // baseline sanity
    expect((await scalar(`SELECT count(*)::int c FROM pg_namespace WHERE nspname='app'`)).c).toBe(0);
    expect((await scalar(`SELECT count(*)::int c FROM pg_policies WHERE policyname='${POLICY_NAME}' AND with_check IS NOT NULL`)).c).toBe(0);

    runMigrator(); // the artifact upgrades in place

    expect((await scalar(`SELECT count(*)::int c FROM pg_namespace WHERE nspname='app'`)).c).toBe(1);
    const proj = await scalar(`SELECT qual, with_check FROM pg_policies WHERE tablename='projects' AND policyname='${POLICY_NAME}'`);
    expect(proj.qual).toMatch(/org_has_party_row/);
    expect(proj.with_check).not.toBeNull();
    expect((await scalar(`SELECT count(*)::int c FROM pg_trigger WHERE tgname='xa_guard' AND NOT tgisinternal`)).c).toBe(2);
  }, 120_000);

  it("is idempotent — running the artifact again is stable", async () => {
    expect(() => runMigrator()).not.toThrow();
    expect((await scalar(`SELECT count(*)::int c FROM pg_policies WHERE schemaname='public' AND policyname='${POLICY_NAME}'`)).c).toBe(13);
    expect((await scalar(`SELECT count(*)::int c FROM plans`)).c).toBeGreaterThanOrEqual(6);
  }, 120_000);

  it("migrator connects via MIGRATION_DATABASE_URL (owner), NOT DATABASE_URL (edms_app)", async () => {
    // Proves the deploy-time role split: run the artifact with DATABASE_URL pointing at the
    // NON-owner edms_app role (which cannot run DDL) and MIGRATION_DATABASE_URL pointing at a
    // fresh owner scratch DB. If migrate honored DATABASE_URL it would fail (no DDL privilege);
    // a successful full install into the MIGRATION_DATABASE_URL scratch proves migrate bound to
    // the migrator/owner role, while the runtime keeps DATABASE_URL (edms_app).
    const SCRATCH2 = "edms_migrator_split";
    const scratch2Url = BASE.replace(/\/[^/?]+(\?|$)/, `/${SCRATCH2}$1`);
    const appNonOwnerUrl = BASE.replace(/^(postgresql:\/\/)[^@]+(@)/, "$1edms_app:edms_app_pw$2"); // edms_app on the base DB — cannot DDL

    const o = new Client({ connectionString: BASE });
    await o.connect();
    await o.query(`DROP DATABASE IF EXISTS ${SCRATCH2} WITH (FORCE)`);
    await o.query(`CREATE DATABASE ${SCRATCH2}`);
    await o.end();

    try {
      runMigrator({ DATABASE_URL: appNonOwnerUrl, MIGRATION_DATABASE_URL: scratch2Url });
      const s2 = new Client({ connectionString: scratch2Url });
      await s2.connect();
      try {
        // Installed into the MIGRATION_DATABASE_URL scratch (owner) → migrate used the migrator role.
        expect((await s2.query(`SELECT count(*)::int c FROM pg_namespace WHERE nspname='app'`)).rows[0].c).toBe(1);
        expect((await s2.query(`SELECT count(*)::int c FROM pg_policies WHERE policyname='${POLICY_NAME}'`)).rows[0].c).toBe(13);
        expect((await s2.query(`SELECT count(*)::int c FROM plans`)).rows[0].c).toBeGreaterThanOrEqual(6);
      } finally {
        await s2.end();
      }
    } finally {
      const d = new Client({ connectionString: BASE });
      await d.connect();
      await d.query(`DROP DATABASE IF EXISTS ${SCRATCH2} WITH (FORCE)`);
      await d.end();
    }
  }, 120_000);
});
