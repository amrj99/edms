/**
 * rls-membership.ts — DEBT-010 Decision B (membership-aware RLS).
 *
 * Single source of truth for the membership-aware Row-Level Security model:
 *   • the `app` schema + SECURITY DEFINER authority-lookup functions,
 *   • the per-category `org_isolation_policy` (still ONE `FOR ALL` policy per table,
 *     same name — the posture gate depends on that),
 *   • the X-a cross-org write-column triggers (correspondence, transmittals),
 *   • the least-privilege GRANTs for the runtime role.
 *
 * SECURITY MODEL (Security-Definer Gate, owner-approved):
 *   • Definer functions are OWNED by `edms_rls_owner` (NOLOGIN, NOSUPERUSER,
 *     NOBYPASSRLS) — never by the runtime role `edms_app`.
 *   • Every definer function is `LANGUAGE sql STABLE`, `SET search_path = ''`, with
 *     EVERY identifier schema-qualified — no dynamic SQL, no object shadowing.
 *   • Definer functions read ONLY non-RLS authority tables (project_parties,
 *     project_members, correspondence_recipients/cc, users) so there is no policy
 *     recursion and no dependency on the runtime role's direct grants.
 *   • `REVOKE EXECUTE … FROM PUBLIC`, then `GRANT EXECUTE` only to `edms_app`.
 *   • `edms_app` gets USAGE (never CREATE) on `app` and `public`; CREATE on public
 *     is revoked so shadow objects cannot be planted.
 *
 * RLS is VISIBILITY + tenant/project anchoring ONLY. It never replaces RBAC and
 * never grants edit/delete/approve/admin just because a row is visible.
 *
 * This module is the SINGLE authoritative installer for the RLS model. It is invoked
 * by (a) the test global-setup and (b) the deploy-time migrator (migrate.ts) — NEVER
 * by the runtime app pool. It is idempotent and upgrades in place from the legacy
 * org-only `org_isolation_policy` baseline (per-table DROP POLICY IF EXISTS → CREATE,
 * CREATE SCHEMA IF NOT EXISTS, CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS).
 * It does not switch DATABASE_URL, does not create the LOGIN role edms_app in
 * Production (that is an out-of-band cutover step with a real secret), and performs no
 * cutover itself. The runtime only VERIFIES the model is present (see
 * assertMembershipRlsInstalled) and never installs or modifies it.
 */

/** A raw-SQL executor. `global-setup` passes a pg Client's query; other callers a wrapper. */
export type SqlExec = (sqlText: string) => Promise<unknown>;

/** All 13 RLS-protected tables. */
export const MEMBERSHIP_RLS_TABLES = [
  "documents", "document_revisions", "document_files",
  "projects", "tasks", "notifications", "rules",
  "correspondence", "transmittals",
  "inspection_requests", "ncr_records", "noc_records", "metadata_fields",
] as const;

export const OWNER_ROLE = "edms_rls_owner";
export const APP_ROLE = "edms_app";
export const POLICY_NAME = "org_isolation_policy"; // unchanged name — posture gate depends on it

/**
 * Apply the full membership-aware RLS model. Run this connected as a superuser /
 * table owner (test global-setup connects as the owning role).
 *
 * @param exec       raw SQL executor (superuser connection)
 * @param opts.createRoles  create edms_rls_owner + edms_app (isolated env only)
 * @param opts.appPassword  password for edms_app LOGIN (isolated env only)
 */
export async function applyMembershipRls(
  exec: SqlExec,
  opts: { createRoles?: boolean; appPassword?: string } = {},
): Promise<{ appRoleGranted: boolean }> {
  const run = (s: string) => exec(s);

  // ── Owner role (NOLOGIN, secret-free) — ALWAYS ensured ──────────────────────
  // The owner owns schema `app` + the DEFINER functions. It has no password and no
  // login, so the migrator can safely auto-provision it on any environment (fresh,
  // upgrade, or a code-first deploy that precedes the edms_app cutover).
  await run(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${OWNER_ROLE}') THEN
        CREATE ROLE ${OWNER_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS;
      END IF;
    END $$;`);

  // ── Runtime role edms_app (LOGIN, needs a real secret) ──────────────────────
  // Created here ONLY in the isolated/test env (opts.createRoles). In Production it is
  // created out-of-band at cutover with a real secret — never embedded in this code.
  // Every edms_app-dependent GRANT below is guarded by `appExists`, so this installer
  // runs cleanly on a code-first deploy (edms_app absent → schema/functions/policies/
  // triggers install, grants deferred) and applies the grants once edms_app exists.
  if (opts.createRoles) {
    await run(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
          CREATE ROLE ${APP_ROLE} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${opts.appPassword ?? "edms_app_pw"}';
        END IF;
      END $$;`);
  }
  const appExists = (await queryRows(exec, `SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}'`)).length > 0;

  // ── Schema `app` owned by the owner role; runtime gets USAGE only ───────────
  await run(`CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION ${OWNER_ROLE}`);
  await run(`REVOKE CREATE ON SCHEMA app FROM PUBLIC`);
  if (appExists) await run(`GRANT USAGE ON SCHEMA app TO ${APP_ROLE}`);

  // The owner (definer) needs SELECT on the NON-RLS authority tables it reads.
  await run(`GRANT SELECT ON public.project_parties, public.project_members,
    public.correspondence_recipients, public.correspondence_cc, public.users TO ${OWNER_ROLE}`);

  // ── Session-context accessors (GUC-only; SECURITY INVOKER, pinned path) ──────
  await run(`
    CREATE OR REPLACE FUNCTION app.session_org() RETURNS integer
    LANGUAGE sql STABLE SET search_path = '' AS
    $fn$ SELECT NULLIF(pg_catalog.current_setting('app.current_org_id', true), '')::integer $fn$;`);
  await run(`
    CREATE OR REPLACE FUNCTION app.session_user() RETURNS integer
    LANGUAGE sql STABLE SET search_path = '' AS
    $fn$ SELECT NULLIF(pg_catalog.current_setting('app.current_user_id', true), '')::integer $fn$;`);
  await run(`
    CREATE OR REPLACE FUNCTION app.is_sysowner() RETURNS boolean
    LANGUAGE sql STABLE SET search_path = '' AS
    $fn$ SELECT pg_catalog.current_setting('app.is_system_owner', true) = 'true' $fn$;`);

  // ── Authority-lookup predicates (SECURITY DEFINER; read only NON-RLS tables) ─
  // org has an ACTIVE party row on the project (removed_at IS NULL). Reads only
  // public.project_parties — no read of `projects`, so the projects policy (which
  // calls this) cannot recurse. collaboration_mode is checked by the caller using
  // the project row's OWN column, never by re-reading projects here.
  await run(`
    CREATE OR REPLACE FUNCTION app.org_has_party_row(p_project_id integer, p_org_id integer) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
    $fn$ SELECT p_org_id IS NOT NULL AND EXISTS (
           SELECT 1 FROM public.project_parties pp
           WHERE pp.project_id = p_project_id AND pp.organization_id = p_org_id AND pp.removed_at IS NULL
         ) $fn$;`);
  await run(`
    CREATE OR REPLACE FUNCTION app.user_is_project_member(p_project_id integer, p_user_id integer) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
    $fn$ SELECT p_user_id IS NOT NULL AND EXISTS (
           SELECT 1 FROM public.project_members pm
           WHERE pm.project_id = p_project_id AND pm.user_id = p_user_id
         ) $fn$;`);
  await run(`
    CREATE OR REPLACE FUNCTION app.user_is_corr_recipient(p_corr_id integer, p_user_id integer) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
    $fn$ SELECT p_user_id IS NOT NULL AND (
           EXISTS (SELECT 1 FROM public.correspondence_recipients r WHERE r.correspondence_id = p_corr_id AND r.user_id = p_user_id)
           OR EXISTS (SELECT 1 FROM public.correspondence_cc c WHERE c.correspondence_id = p_corr_id AND c.user_id = p_user_id)
         ) $fn$;`);
  await run(`
    CREATE OR REPLACE FUNCTION app.user_in_org(p_user_id integer, p_org_id integer) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
    $fn$ SELECT p_user_id IS NOT NULL AND p_org_id IS NOT NULL AND EXISTS (
           SELECT 1 FROM public.users u WHERE u.id = p_user_id AND u.organization_id = p_org_id
         ) $fn$;`);

  // Own the definer functions with the owner role; lock EXECUTE to the runtime role.
  const FUNCS = [
    "app.session_org()", "app.session_user()", "app.is_sysowner()",
    "app.org_has_party_row(integer, integer)", "app.user_is_project_member(integer, integer)",
    "app.user_is_corr_recipient(integer, integer)", "app.user_in_org(integer, integer)",
  ];
  for (const f of FUNCS) {
    await run(`ALTER FUNCTION ${f} OWNER TO ${OWNER_ROLE}`);
    await run(`REVOKE EXECUTE ON FUNCTION ${f} FROM PUBLIC`);
    if (appExists) await run(`GRANT EXECUTE ON FUNCTION ${f} TO ${APP_ROLE}`);
  }

  // ── Enable + FORCE RLS and (re)create the single per-table policy ───────────
  for (const table of MEMBERSHIP_RLS_TABLES) {
    await run(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
    await run(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
    await run(`DROP POLICY IF EXISTS "${POLICY_NAME}" ON "${table}"`);
  }

  // CP — tenant-private (org-only): rules, tasks, inspection_requests, ncr_records, noc_records
  for (const table of ["rules", "tasks", "inspection_requests", "ncr_records", "noc_records"]) {
    await run(`
      CREATE POLICY "${POLICY_NAME}" ON "${table}" AS PERMISSIVE FOR ALL
      USING (app.is_sysowner() OR organization_id = app.session_org())
      WITH CHECK (app.is_sysowner() OR organization_id = app.session_org())`);
  }

  // CU — per-user (notifications): read = my rows; write = my org (or NULL-org) so
  // the app can still create notifications for other same-org users.
  await run(`
    CREATE POLICY "${POLICY_NAME}" ON "notifications" AS PERMISSIVE FOR ALL
    USING (app.is_sysowner() OR user_id = app.session_user())
    WITH CHECK (app.is_sysowner() OR organization_id IS NULL OR organization_id = app.session_org())`);

  // CS — system-global hybrid (metadata_fields): read own-org OR global(org NULL);
  // write only own-org (globals are system_owner-only).
  await run(`
    CREATE POLICY "${POLICY_NAME}" ON "metadata_fields" AS PERMISSIVE FOR ALL
    USING (app.is_sysowner() OR organization_id = app.session_org() OR organization_id IS NULL)
    WITH CHECK (app.is_sysowner() OR organization_id = app.session_org())`);

  // CC-party — projects root: same-org OR active party (mode='parties' via own column).
  await run(`
    CREATE POLICY "${POLICY_NAME}" ON "projects" AS PERMISSIVE FOR ALL
    USING (
      app.is_sysowner()
      OR organization_id = app.session_org()
      OR (collaboration_mode = 'parties' AND app.org_has_party_row(id, app.session_org()))
    )
    WITH CHECK (app.is_sysowner() OR organization_id = app.session_org())`);

  // CC-party — documents: same-org OR project visible (via projects RLS) OR user-member.
  // WITH CHECK anchors organization_id to the project's owner org (RLS-filtered
  // subquery) → cannot forge org or write into an inaccessible project.
  await run(`
    CREATE POLICY "${POLICY_NAME}" ON "documents" AS PERMISSIVE FOR ALL
    USING (
      app.is_sysowner()
      OR organization_id = app.session_org()
      OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = documents.project_id)
      OR app.user_is_project_member(documents.project_id, app.session_user())
    )
    WITH CHECK (
      app.is_sysowner()
      OR organization_id = (SELECT p.organization_id FROM public.projects p WHERE p.id = documents.project_id)
    )`);

  // CC-party children — document_revisions / document_files: inherit visibility from
  // the parent document (documents RLS filters the EXISTS). Child org anchored to parent.
  for (const child of ["document_revisions", "document_files"]) {
    await run(`
      CREATE POLICY "${POLICY_NAME}" ON "${child}" AS PERMISSIVE FOR ALL
      USING (
        app.is_sysowner()
        OR EXISTS (SELECT 1 FROM public.documents d WHERE d.id = "${child}".document_id)
      )
      WITH CHECK (
        app.is_sysowner()
        OR EXISTS (SELECT 1 FROM public.documents d WHERE d.id = "${child}".document_id
             AND ("${child}".organization_id IS NULL OR "${child}".organization_id = d.organization_id))
      )`);
  }

  // CC-rec — correspondence: same-org OR named recipient/cc. Writes stay own-org
  // (a reply creates a replier-owned row); cross-org mark-read is constrained by the
  // X-a trigger below.
  await run(`
    CREATE POLICY "${POLICY_NAME}" ON "correspondence" AS PERMISSIVE FOR ALL
    USING (
      app.is_sysowner()
      OR organization_id = app.session_org()
      OR app.user_is_corr_recipient(id, app.session_user())
    )
    WITH CHECK (
      app.is_sysowner()
      OR organization_id = app.session_org()
      OR app.user_is_corr_recipient(id, app.session_user())
    )`);  // recipient may write; the xa_correspondence trigger restricts WHICH columns + freezes org/project

  // CC-recipient-org — transmittals: same-org OR project visible (party) OR recipient org.
  await run(`
    CREATE POLICY "${POLICY_NAME}" ON "transmittals" AS PERMISSIVE FOR ALL
    USING (
      app.is_sysowner()
      OR organization_id = app.session_org()
      OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = transmittals.project_id)
      OR app.user_in_org(transmittals.to_user_id, app.session_org())
    )
    WITH CHECK (
      app.is_sysowner()
      OR organization_id = app.session_org()
      OR app.user_in_org(to_user_id, app.session_org())
    )`);  // recipient org may write; the xa_transmittals trigger restricts WHICH columns + freezes org/project

  // ── X-a cross-org write-column triggers (correspondence, transmittals) ──────
  // A cross-org writer (session org <> OLD.organization_id, not system_owner) may
  // change ONLY the allowlisted columns. Implemented WITHOUT dynamic SQL: copy the
  // allowlist columns from NEW onto a clone of OLD, then require NEW to be otherwise
  // identical. Any new column added to the table is immutable-by-default (safe).
  await run(`
    CREATE OR REPLACE FUNCTION app.xa_correspondence() RETURNS trigger
    LANGUAGE plpgsql SET search_path = '' AS $fn$
    DECLARE
      expected public.correspondence%ROWTYPE;
      v_org integer := NULLIF(pg_catalog.current_setting('app.current_org_id', true), '')::integer;
    BEGIN
      IF pg_catalog.current_setting('app.is_system_owner', true) = 'true' THEN RETURN NEW; END IF;
      -- Only a genuine CROSS-ORG session (org set AND different from the row's owner)
      -- is column-restricted. No session org (superuser/setup/system) or same-org →
      -- governed by RLS WITH CHECK, not this trigger.
      IF v_org IS NULL OR v_org IS NOT DISTINCT FROM OLD.organization_id THEN RETURN NEW; END IF;
      expected := OLD;
      expected.is_read := NEW.is_read;
      expected.first_read_at := NEW.first_read_at;
      expected.updated_at := NEW.updated_at;
      IF NEW IS DISTINCT FROM expected THEN
        RAISE EXCEPTION 'DEBT-010 X-a: cross-org update of correspondence % may modify only {is_read, first_read_at, updated_at}', OLD.id
          USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END $fn$;`);
  await run(`
    CREATE OR REPLACE FUNCTION app.xa_transmittals() RETURNS trigger
    LANGUAGE plpgsql SET search_path = '' AS $fn$
    DECLARE
      expected public.transmittals%ROWTYPE;
      v_org integer := NULLIF(pg_catalog.current_setting('app.current_org_id', true), '')::integer;
    BEGIN
      IF pg_catalog.current_setting('app.is_system_owner', true) = 'true' THEN RETURN NEW; END IF;
      IF v_org IS NULL OR v_org IS NOT DISTINCT FROM OLD.organization_id THEN RETURN NEW; END IF;
      expected := OLD;
      expected.status := NEW.status;
      expected.acknowledged_at := NEW.acknowledged_at;
      expected.review_outcome := NEW.review_outcome;
      expected.updated_at := NEW.updated_at;
      IF NEW IS DISTINCT FROM expected THEN
        RAISE EXCEPTION 'DEBT-010 X-a: cross-org update of transmittal % may modify only {status, acknowledged_at, review_outcome, updated_at}', OLD.id
          USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END $fn$;`);
  for (const [tbl, fn] of [["correspondence", "app.xa_correspondence"], ["transmittals", "app.xa_transmittals"]] as const) {
    await run(`ALTER FUNCTION ${fn}() OWNER TO ${OWNER_ROLE}`);
    await run(`DROP TRIGGER IF EXISTS xa_guard ON "${tbl}"`);
    await run(`CREATE TRIGGER xa_guard BEFORE UPDATE ON "${tbl}" FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
  }

  // ── Runtime-role least-privilege grants ─────────────────────────────────────
  // edms_app is the application: it may touch app tables (RLS filters rows), but is
  // NOT superuser / bypassrls / owner, and has NO CREATE (no object shadowing).
  await run(`REVOKE CREATE ON SCHEMA public FROM PUBLIC`);
  if (appExists) {
    await run(`REVOKE CREATE ON SCHEMA public FROM ${APP_ROLE}`);
    await run(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
    await run(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`);
    await run(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE}`);
  }

  return { appRoleGranted: appExists };
}

/** Normalize a raw-SQL executor's result to an array of rows (pg Client/pool → .rows). */
async function queryRows(exec: SqlExec, sqlText: string): Promise<any[]> {
  const res: any = await exec(sqlText);
  if (Array.isArray(res)) return res;
  if (res && Array.isArray(res.rows)) return res.rows;
  return [];
}

/**
 * Read-only verification that the membership-aware RLS model is installed.
 *
 * The runtime bootstrap calls this as a FATAL precondition: the runtime NEVER
 * installs or modifies RLS (that is the migrator's job) — it only refuses to serve
 * if the migrator has not yet applied the model. Reads catalogs only; performs no DDL.
 */
export async function assertMembershipRlsInstalled(exec: SqlExec): Promise<void> {
  const schema = await queryRows(exec, `SELECT 1 FROM pg_namespace WHERE nspname = 'app'`);
  if (schema.length === 0) {
    throw new Error(
      `[rls] membership-aware RLS not installed: schema "app" is missing. ` +
      `The deploy-time migrator (applyMembershipRls) must run before the app starts.`,
    );
  }
  const tableList = MEMBERSHIP_RLS_TABLES.map((t) => `'${t}'`).join(", ");
  const rows = await queryRows(
    exec,
    `SELECT c.relname AS relname,
            c.relforcerowsecurity AS forced,
            EXISTS (SELECT 1 FROM pg_policies p
                    WHERE p.schemaname = 'public' AND p.tablename = c.relname
                      AND p.policyname = '${POLICY_NAME}') AS has_policy
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname IN (${tableList})`,
  );
  const problems: string[] = [];
  for (const t of MEMBERSHIP_RLS_TABLES) {
    const row = rows.find((r) => r.relname === t);
    if (!row) problems.push(`${t} (table missing)`);
    else if (!row.forced) problems.push(`${t} (RLS not FORCEd)`);
    else if (!row.has_policy) problems.push(`${t} (no ${POLICY_NAME})`);
  }
  if (problems.length > 0) {
    throw new Error(
      `[rls] membership-aware RLS incomplete — run the migrator before starting. Problems: ${problems.join(", ")}`,
    );
  }
}
