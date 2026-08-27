-- verify-security-posture.sql  (DEBT-010 ④)
--
-- MANDATORY pre-serve gate. Run this connected AS THE RUNTIME APP ROLE (edms_app)
-- in the deploy entrypoint, BEFORE the API starts. Any failure RAISEs and must
-- abort the deploy — a mis-provisioned role/RLS silently disables tenant isolation.
--
-- Checks:
--   1. runtime role is NOT superuser and NOT BYPASSRLS
--   2. runtime role owns NO tenant table (owner would bypass RLS unless FORCEd;
--      we require the app role to be a pure grantee, never an owner)
--   3. every required tenant table has RLS ENABLED + FORCEd
--   4. every required tenant table has EXACTLY the expected isolation policy
--      (no extra/broad PERMISSIVE policy that could re-open access via OR)
--   5. fail-closed smoke: with NO tenant context set, a tenant table returns 0 rows

\set ON_ERROR_STOP on

DO $$
DECLARE
  -- Tables with a direct organization_id column (org-isolation policy applies).
  -- FK-scoped tables (document_revisions, document_files) are covered later by
  -- DEBT-010 ⑤ (Template-B EXISTS policy or denormalized organization_id) and are
  -- intentionally NOT required here yet.
  tenant_tables text[] := ARRAY[
    'documents','projects','tasks','notifications','rules',
    'correspondence','transmittals'
  ];
  t text;
  is_super  bool;
  is_bypass bool;
  n int;
  cnt bigint;
BEGIN
  -- 1. runtime role privileges
  SELECT rolsuper, rolbypassrls INTO is_super, is_bypass
  FROM pg_roles WHERE rolname = current_user;
  IF is_super OR is_bypass THEN
    RAISE EXCEPTION 'POSTURE FAIL: runtime role % is SUPERUSER=% BYPASSRLS=% — RLS would be bypassed',
      current_user, is_super, is_bypass;
  END IF;

  FOREACH t IN ARRAY tenant_tables LOOP
    -- table may not exist in every deployment; skip cleanly if absent
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;

    -- 2. runtime role must not own the tenant table
    IF EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace nsp ON nsp.oid = c.relnamespace
      WHERE nsp.nspname='public' AND c.relname=t AND pg_get_userbyid(c.relowner)=current_user
    ) THEN
      RAISE EXCEPTION 'POSTURE FAIL: runtime role % OWNS tenant table % (must be grantee only)', current_user, t;
    END IF;

    -- 3. RLS enabled + forced
    SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace nsp ON nsp.oid=c.relnamespace
      WHERE nsp.nspname='public' AND c.relname=t AND c.relrowsecurity AND c.relforcerowsecurity;
    IF n <> 1 THEN
      RAISE EXCEPTION 'POSTURE FAIL: tenant table % missing ENABLE+FORCE ROW LEVEL SECURITY', t;
    END IF;

    -- 4. exactly one policy (the expected isolation policy), no broad extras
    SELECT count(*) INTO n FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
      JOIN pg_namespace nsp ON nsp.oid=c.relnamespace
      WHERE nsp.nspname='public' AND c.relname=t;
    IF n <> 1 THEN
      RAISE EXCEPTION 'POSTURE FAIL: tenant table % has % policies (expected exactly 1)', t, n;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
        JOIN pg_namespace nsp ON nsp.oid=c.relnamespace
      WHERE nsp.nspname='public' AND c.relname=t AND p.polname='org_isolation_policy'
    ) THEN
      RAISE EXCEPTION 'POSTURE FAIL: tenant table % missing org_isolation_policy', t;
    END IF;
  END LOOP;

  -- 5. fail-closed smoke: NO context set on this connection ⇒ zero rows
  IF to_regclass('public.documents') IS NOT NULL THEN
    PERFORM set_config('app.current_org_id', '', true);
    PERFORM set_config('app.is_system_owner', '', true);
    EXECUTE 'SELECT count(*) FROM documents' INTO cnt;
    IF cnt <> 0 THEN
      RAISE EXCEPTION 'POSTURE FAIL: fail-closed smoke returned % rows with no tenant context (expected 0)', cnt;
    END IF;
  END IF;

  RAISE NOTICE 'POSTURE OK: role=% is least-privilege; RLS ENABLE+FORCE + single isolation policy on all tenant tables; fail-closed smoke = 0 rows', current_user;
END $$;
