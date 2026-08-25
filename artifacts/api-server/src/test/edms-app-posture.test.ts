/**
 * edms-app-posture.test.ts — DEBT-010 Application-under-edms_app Gate.
 *
 * Proves the runtime role `edms_app` is least-privilege (connecting AS edms_app):
 *   • NOT superuser, NOT bypassrls, NOT createrole/createdb.
 *   • No CREATE on schema public or app (object-shadowing impossible).
 *   • Owns NONE of the 13 tenant tables (a table owner would bypass RLS unless FORCEd;
 *     posture requires pure grantee).
 *   • Has the required DML grants on tenant tables + EXECUTE on the app.* authority
 *     functions, and USAGE (not CREATE) on schema app.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";

const { Client } = pg;
function appUrl(): string {
  const base = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL!;
  return base.replace(/^(postgresql:\/\/)[^@]+(@)/, "$1edms_app:edms_app_pw$2");
}

const TENANT_TABLES = [
  "documents", "document_revisions", "document_files", "projects", "tasks",
  "notifications", "rules", "correspondence", "transmittals",
  "inspection_requests", "ncr_records", "noc_records", "metadata_fields",
];

let c: pg.Client;
beforeAll(async () => { c = new Client({ connectionString: appUrl() }); await c.connect(); });
afterAll(async () => { await c.end(); });

describe("DEBT-010 — edms_app runtime posture", () => {
  it("is the edms_app role, NOT superuser / bypassrls / createrole / createdb", async () => {
    const r = await c.query(
      "SELECT rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = current_user",
    );
    expect(r.rows[0].rolname).toBe("edms_app");
    expect(r.rows[0].rolsuper).toBe(false);
    expect(r.rows[0].rolbypassrls).toBe(false);
    expect(r.rows[0].rolcreaterole).toBe(false);
    expect(r.rows[0].rolcreatedb).toBe(false);
  });

  it("has NO CREATE on schema public or app", async () => {
    const r = await c.query(
      "SELECT has_schema_privilege(current_user,'public','CREATE') AS pub, has_schema_privilege(current_user,'app','CREATE') AS app, has_schema_privilege(current_user,'app','USAGE') AS app_use",
    );
    expect(r.rows[0].pub).toBe(false);
    expect(r.rows[0].app).toBe(false);
    expect(r.rows[0].app_use).toBe(true); // USAGE is granted (to EXECUTE the functions)
  });

  it("owns NONE of the 13 tenant tables", async () => {
    const r = await c.query(
      `SELECT c.relname, pg_get_userbyid(c.relowner) AS owner
       FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relname = ANY($1)`, [TENANT_TABLES],
    );
    const owned = r.rows.filter((row) => row.owner === "edms_app").map((row) => row.relname);
    expect(owned).toEqual([]);
  });

  it("has the required DML grants on tenant tables", async () => {
    for (const t of TENANT_TABLES) {
      const r = await c.query(
        `SELECT has_table_privilege(current_user, $1, 'SELECT') s,
                has_table_privilege(current_user, $1, 'INSERT') i,
                has_table_privilege(current_user, $1, 'UPDATE') u,
                has_table_privilege(current_user, $1, 'DELETE') d`, [t],
      );
      expect({ t, ...r.rows[0] }).toEqual({ t, s: true, i: true, u: true, d: true });
    }
  });

  it("can EXECUTE the app.* authority functions", async () => {
    const r = await c.query(
      "SELECT has_function_privilege(current_user, 'app.session_org()', 'EXECUTE') AS ok",
    );
    expect(r.rows[0].ok).toBe(true);
  });
});
