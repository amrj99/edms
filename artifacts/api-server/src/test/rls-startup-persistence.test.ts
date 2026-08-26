/**
 * rls-startup-persistence.test.ts — DEBT-010 RC remediation (req 6).
 *
 * Proves the REAL runtime bootstrap path does NOT install, modify, or clobber RLS:
 *   1. snapshot the full RLS model (policies + qual/with_check, app functions,
 *      X-a triggers, FORCE flags),
 *   2. run the real runCriticalStartup() twice (start + restart),
 *   3. assert the snapshot is byte-identical,
 *   4. assert the membership predicates (the rules that grant legitimate cross-org
 *      party/member access) survive — startup never reverted them to org-only.
 *
 * The runtime runs as edms_app; its privileged startup steps (integrity/seed) are
 * non-fatal (caught) and CANNOT touch RLS. RLS is owned solely by the migrator.
 * Functional cross-org behavior itself is proven by membership-rls*.test.ts.
 */
import { describe, it, expect, afterAll } from "vitest";
import { runCriticalStartup } from "../bootstrap.js";
import { getTestPool, truncateAllTables } from "./helpers/index.js";
import { MEMBERSHIP_RLS_TABLES, POLICY_NAME } from "../lib/rls-membership.js";

async function snapshotRls(): Promise<string> {
  const pool = getTestPool();
  const tableList = MEMBERSHIP_RLS_TABLES.map((t) => `'${t}'`).join(",");
  const policies = (await pool.query(
    `SELECT tablename, policyname, qual, with_check FROM pg_policies
     WHERE schemaname='public' AND policyname=$1 ORDER BY tablename`, [POLICY_NAME],
  )).rows;
  const funcs = (await pool.query(
    `SELECT p.proname, pg_get_userbyid(p.proowner) AS owner FROM pg_proc p
     JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' ORDER BY p.proname`,
  )).rows;
  const triggers = (await pool.query(
    `SELECT tgname, tgrelid::regclass::text AS tbl FROM pg_trigger
     WHERE tgname='xa_guard' AND NOT tgisinternal ORDER BY tbl`,
  )).rows;
  const forced = (await pool.query(
    `SELECT c.relname, c.relforcerowsecurity AS forced FROM pg_class c
     JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname IN (${tableList}) ORDER BY c.relname`,
  )).rows;
  return JSON.stringify({ policies, funcs, triggers, forced });
}

afterAll(async () => {
  // runCriticalStartup runs seed/backfill on non-RLS tables — reset for other files.
  await truncateAllTables();
});

describe("DEBT-010 — startup/restart RLS persistence", () => {
  it("the real bootstrap path runs twice and leaves RLS byte-identical", async () => {
    const before = await snapshotRls();

    await runCriticalStartup(); // start
    const afterStart = await snapshotRls();
    expect(afterStart, "startup modified the RLS model").toBe(before);

    await runCriticalStartup(); // restart
    const afterRestart = await snapshotRls();
    expect(afterRestart, "restart modified the RLS model").toBe(before);
  }, 60_000);

  it("membership predicates survive startup (never reverted to org-only)", async () => {
    await runCriticalStartup();
    const pool = getTestPool();
    const proj = (await pool.query(
      `SELECT qual FROM pg_policies WHERE schemaname='public' AND tablename='projects' AND policyname=$1`, [POLICY_NAME],
    )).rows[0];
    const docs = (await pool.query(
      `SELECT qual, with_check FROM pg_policies WHERE schemaname='public' AND tablename='documents' AND policyname=$1`, [POLICY_NAME],
    )).rows[0];
    expect(proj.qual).toMatch(/org_has_party_row/);      // party cross-org visibility rule intact
    expect(docs.qual).toMatch(/user_is_project_member/); // project-member visibility rule intact
    expect(docs.with_check).not.toBeNull();               // membership WITH CHECK intact (not legacy org-only)
  }, 30_000);

  it("all 13 tables remain FORCE-RLS with exactly one org_isolation_policy", async () => {
    const pool = getTestPool();
    const forced = (await pool.query(
      `SELECT count(*)::int c FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relforcerowsecurity
         AND c.relname IN (${MEMBERSHIP_RLS_TABLES.map((t) => `'${t}'`).join(",")})`,
    )).rows[0];
    expect(forced.c).toBe(13);
    const pol = (await pool.query(
      `SELECT count(*)::int c FROM pg_policies WHERE schemaname='public' AND policyname=$1`, [POLICY_NAME],
    )).rows[0];
    expect(pol.c).toBe(13);
  });
});
