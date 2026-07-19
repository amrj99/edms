-- compile-check.sql — real-PostgreSQL COMPILE smoke for 04_migrate.sql / 05_rollback.sql.
--
-- Purpose: prove the plpgsql DO blocks COMPILE (so a malformed RAISE like the
-- "%%" vs "%" placeholder/arg mismatch is caught) WITHOUT touching any real data.
--
-- How to run (scratch/throwaway DB or any DB — it only compiles inside a rolled-back tx):
--   docker exec -i <PG> psql -U <u> -d <scratchdb> -v ON_ERROR_STOP=1 -f - < tests/compile-check.sql
--
-- It wraps the two DO bodies in a transaction that ALWAYS rolls back, and feeds an
-- EMPTY _f2_map so the blocks compile then hit their own well-formed guard RAISE
-- ("map has 0 rows (expected 7)") at RUNTIME — which is the PROOF they compiled.
-- If a RAISE is malformed, psql fails earlier with "too many/few parameters
-- specified for RAISE" at compile time. Either outcome is captured; only the
-- compile-time failure means the scripts are broken.
--
-- SAFE: BEGIN … ROLLBACK; no UPDATE reaches any real row (empty map + rollback).

\set ON_ERROR_STOP off
\echo '== compile-check: 04_migrate DO block =='
BEGIN;
CREATE TEMP TABLE _f2_map(tbl text, id bigint, old_url text, new_url text) ON COMMIT DROP;
-- (empty map on purpose)
DO $$
DECLARE
  r record; n int;
  u_df int := 0; u_dr int := 0; u_ca int := 0; total int := 0;
  e_df int; e_dr int; e_ca int; e_total int;
BEGIN
  e_total := (SELECT count(*) FROM _f2_map);
  e_df    := (SELECT count(*) FROM _f2_map WHERE tbl = 'document_files');
  e_dr    := (SELECT count(*) FROM _f2_map WHERE tbl = 'document_revisions');
  e_ca    := (SELECT count(*) FROM _f2_map WHERE tbl = 'correspondence_attachments');
  IF e_total <> 7 THEN RAISE EXCEPTION 'map has % rows (expected 7)', e_total; END IF;
  IF EXISTS (SELECT 1 FROM _f2_map
             WHERE tbl NOT IN ('document_files','document_revisions','correspondence_attachments')) THEN
    RAISE EXCEPTION 'fail-closed: unexpected table in map (whitelist violated)';
  END IF;
  FOR r IN SELECT * FROM _f2_map LOOP
    EXECUTE format('UPDATE %I SET file_url = $1 WHERE id = $2 AND file_url = $3', r.tbl)
      USING r.new_url, r.id, r.old_url;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN
      RAISE EXCEPTION 'fail-closed: %#% updated % row(s) (expected 1) — optimistic guard failed', r.tbl, r.id, n;
    END IF;
    IF    r.tbl = 'document_files'      THEN u_df := u_df + 1;
    ELSIF r.tbl = 'document_revisions'  THEN u_dr := u_dr + 1;
    ELSE                                     u_ca := u_ca + 1;
    END IF;
    total := total + 1;
  END LOOP;
  IF u_df <> e_df OR u_dr <> e_dr OR u_ca <> e_ca THEN
    RAISE EXCEPTION 'fail-closed per-table mismatch: df %/%, dr %/%, ca %/%',
      u_df, e_df, u_dr, e_dr, u_ca, e_ca;
  END IF;
  IF total <> 7 THEN RAISE EXCEPTION 'fail-closed: total % (expected 7)', total; END IF;
  RAISE NOTICE 'F2 migrate OK: df=%, dr=%, ca=% (total=7) updated in one transaction.', u_df, u_dr, u_ca;
END $$;
ROLLBACK;

\echo '== compile-check: 05_rollback DO block =='
BEGIN;
CREATE TEMP TABLE _f2_map(tbl text, id bigint, old_url text, new_url text) ON COMMIT DROP;
DO $$
DECLARE
  r record; n int;
  u_df int := 0; u_dr int := 0; u_ca int := 0; total int := 0;
  e_df int; e_dr int; e_ca int; e_total int;
BEGIN
  e_total := (SELECT count(*) FROM _f2_map);
  e_df    := (SELECT count(*) FROM _f2_map WHERE tbl = 'document_files');
  e_dr    := (SELECT count(*) FROM _f2_map WHERE tbl = 'document_revisions');
  e_ca    := (SELECT count(*) FROM _f2_map WHERE tbl = 'correspondence_attachments');
  IF e_total <> 7 THEN RAISE EXCEPTION 'map has % rows (expected 7)', e_total; END IF;
  IF EXISTS (SELECT 1 FROM _f2_map
             WHERE tbl NOT IN ('document_files','document_revisions','correspondence_attachments')) THEN
    RAISE EXCEPTION 'rollback fail-closed: unexpected table in map (whitelist violated)';
  END IF;
  FOR r IN SELECT * FROM _f2_map LOOP
    EXECUTE format('UPDATE %I SET file_url = $1 WHERE id = $2 AND file_url = $3', r.tbl)
      USING r.old_url, r.id, r.new_url;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN
      RAISE EXCEPTION 'rollback fail-closed: %#% reverted % row(s) (expected 1)', r.tbl, r.id, n;
    END IF;
    IF    r.tbl = 'document_files'      THEN u_df := u_df + 1;
    ELSIF r.tbl = 'document_revisions'  THEN u_dr := u_dr + 1;
    ELSE                                     u_ca := u_ca + 1;
    END IF;
    total := total + 1;
  END LOOP;
  IF u_df <> e_df OR u_dr <> e_dr OR u_ca <> e_ca THEN
    RAISE EXCEPTION 'rollback fail-closed per-table mismatch: df %/%, dr %/%, ca %/%',
      u_df, e_df, u_dr, e_dr, u_ca, e_ca;
  END IF;
  IF total <> 7 THEN RAISE EXCEPTION 'rollback fail-closed: total % (expected 7)', total; END IF;
  RAISE NOTICE 'F2 rollback OK: df=%, dr=%, ca=% (total=7) reverted to pre-image.', u_df, u_dr, u_ca;
END $$;
ROLLBACK;

\echo '== compile-check DONE: if you see two "map has 0 rows (expected 7)" errors, both blocks COMPILED fine. =='
