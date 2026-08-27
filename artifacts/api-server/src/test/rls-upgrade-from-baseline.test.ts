/**
 * rls-upgrade-from-baseline.test.ts — DEBT-010 RC remediation (req 4 + 5).
 *
 * Proves applyMembershipRls (the single authoritative installer) upgrades IN PLACE
 * from the EXACT production baseline we documented on the VPS — 13 legacy fail-open
 * `org_isolation_policy` policies (ENABLE+FORCE) + NO schema `app` + NO membership
 * roles — to the final membership-aware model, WITHOUT a clean database, and that a
 * second run is idempotent.
 *
 * Runs in a dedicated scratch DATABASE (created + dropped here) so it never touches
 * the shared test DB. Minimal tables carry exactly the columns the policies /
 * DEFINER functions / X-a triggers reference.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { applyMembershipRls, MEMBERSHIP_RLS_TABLES, POLICY_NAME } from "../lib/rls-membership.js";

const { Client } = pg;
const SCRATCH = "edms_rls_upgrade_probe";
const BASE = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL!;
const SCRATCH_URL = BASE.replace(/\/[^/?]+(\?|$)/, `/${SCRATCH}$1`);

// Legacy fail-open policy body — copied from the live production baseline (D1).
const OLD_QUAL =
  `organization_id IS NULL ` +
  `OR NULLIF(current_setting('app.current_org_id', true), '') IS NULL ` +
  `OR organization_id = NULLIF(current_setting('app.current_org_id', true), '')::integer`;

// Minimal columns each policy / DEFINER fn / X-a trigger references.
const MINIMAL_DDL = `
  CREATE TABLE projects (id serial PRIMARY KEY, organization_id integer, collaboration_mode text);
  CREATE TABLE documents (id serial PRIMARY KEY, organization_id integer, project_id integer);
  CREATE TABLE document_revisions (id serial PRIMARY KEY, organization_id integer, document_id integer);
  CREATE TABLE document_files (id serial PRIMARY KEY, organization_id integer, document_id integer);
  CREATE TABLE tasks (id serial PRIMARY KEY, organization_id integer);
  CREATE TABLE notifications (id serial PRIMARY KEY, organization_id integer, user_id integer);
  CREATE TABLE rules (id serial PRIMARY KEY, organization_id integer);
  CREATE TABLE correspondence (id serial PRIMARY KEY, organization_id integer, is_read boolean, first_read_at timestamptz, updated_at timestamptz);
  CREATE TABLE transmittals (id serial PRIMARY KEY, organization_id integer, project_id integer, to_user_id integer, status text, acknowledged_at timestamptz, review_outcome text, updated_at timestamptz);
  CREATE TABLE inspection_requests (id serial PRIMARY KEY, organization_id integer);
  CREATE TABLE ncr_records (id serial PRIMARY KEY, organization_id integer);
  CREATE TABLE noc_records (id serial PRIMARY KEY, organization_id integer);
  CREATE TABLE metadata_fields (id serial PRIMARY KEY, organization_id integer);
  CREATE TABLE project_parties (project_id integer, organization_id integer, removed_at timestamptz);
  CREATE TABLE project_members (project_id integer, user_id integer);
  CREATE TABLE correspondence_recipients (correspondence_id integer, user_id integer);
  CREATE TABLE correspondence_cc (correspondence_id integer, user_id integer);
  CREATE TABLE users (id integer PRIMARY KEY, organization_id integer);
`;

let owner: pg.Client;   // connected to the base DB — creates/drops the scratch DB
let scratch: pg.Client; // connected to the scratch DB

async function dropScratch() {
  const c = new Client({ connectionString: BASE });
  await c.connect();
  try { await c.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`); } finally { await c.end(); }
}

beforeAll(async () => {
  await dropScratch();
  owner = new Client({ connectionString: BASE });
  await owner.connect();
  await owner.query(`CREATE DATABASE ${SCRATCH}`);
  await owner.end();

  scratch = new Client({ connectionString: SCRATCH_URL });
  await scratch.connect();

  // Build the production baseline: minimal tables + legacy fail-open policies, FORCEd.
  await scratch.query(MINIMAL_DDL);
  for (const t of MEMBERSHIP_RLS_TABLES) {
    await scratch.query(`ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY`);
    await scratch.query(`ALTER TABLE "${t}" FORCE ROW LEVEL SECURITY`);
    await scratch.query(`CREATE POLICY "${POLICY_NAME}" ON "${t}" AS PERMISSIVE FOR ALL USING (${OLD_QUAL})`);
  }
}, 60_000);

afterAll(async () => {
  if (scratch) { try { await scratch.end(); } catch { /* ignore */ } }
  await dropScratch();
});

const exec = (s: string) => scratch.query(s);
async function scalar(sql: string): Promise<any> {
  const r = await scratch.query(sql);
  return r.rows[0];
}

describe("DEBT-010 — upgrade from production baseline (no clean DB)", () => {
  it("baseline mirrors production: 13 legacy fail-open policies, no schema app", async () => {
    const pol = await scalar(`SELECT count(*)::int c FROM pg_policies WHERE schemaname='public' AND policyname='${POLICY_NAME}'`);
    expect(pol.c).toBe(13);
    const withCheck = await scalar(`SELECT count(*)::int c FROM pg_policies WHERE schemaname='public' AND policyname='${POLICY_NAME}' AND with_check IS NOT NULL`);
    expect(withCheck.c).toBe(0); // legacy policies had no WITH CHECK
    const schema = await scalar(`SELECT count(*)::int c FROM pg_namespace WHERE nspname='app'`);
    expect(schema.c).toBe(0);
  });

  it("applyMembershipRls upgrades in place to the membership-aware model", async () => {
    await applyMembershipRls(exec, { createRoles: true, appPassword: "edms_app_pw" });

    // schema app + all 7 authority/accessor functions present
    expect((await scalar(`SELECT count(*)::int c FROM pg_namespace WHERE nspname='app'`)).c).toBe(1);
    const fns = await scalar(`SELECT count(*)::int c FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app'`);
    expect(fns.c).toBeGreaterThanOrEqual(7);

    // still exactly one org_isolation_policy per table, now membership-aware
    expect((await scalar(`SELECT count(*)::int c FROM pg_policies WHERE schemaname='public' AND policyname='${POLICY_NAME}'`)).c).toBe(13);

    // the membership predicates replaced the legacy body
    const proj = await scalar(`SELECT qual FROM pg_policies WHERE schemaname='public' AND tablename='projects' AND policyname='${POLICY_NAME}'`);
    expect(proj.qual).toMatch(/org_has_party_row/);
    const docs = await scalar(`SELECT qual, with_check FROM pg_policies WHERE schemaname='public' AND tablename='documents' AND policyname='${POLICY_NAME}'`);
    expect(docs.qual).toMatch(/user_is_project_member/);
    expect(docs.with_check).not.toBeNull(); // membership adds WITH CHECK (legacy had none)

    // X-a triggers installed on correspondence + transmittals
    const trg = await scalar(`SELECT count(*)::int c FROM pg_trigger WHERE tgname='xa_guard' AND NOT tgisinternal`);
    expect(trg.c).toBe(2);
  });

  it("is idempotent — a second run does not error and leaves 13 policies", async () => {
    await expect(applyMembershipRls(exec, { createRoles: true, appPassword: "edms_app_pw" })).resolves.toBeDefined();
    expect((await scalar(`SELECT count(*)::int c FROM pg_policies WHERE schemaname='public' AND policyname='${POLICY_NAME}'`)).c).toBe(13);
  });
});
