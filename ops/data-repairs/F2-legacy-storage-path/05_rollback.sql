-- 05_rollback.sql — Batch 2 (F2) — Rollback مستقل (DB فقط). fail-closed + فحص per-table + الإجمالي.
-- يُعيد file_url إلى القيمة القديمة. لا يحذف الملفات المنسوخة (غير ضارّة). المصادر لم تُنقل → لا استرجاع فيزيائي.
-- يستخدم نفس mapping.mig.tsv:
--   docker exec -i $DB_CONTAINER psql -U edms -d edms -v ON_ERROR_STOP=1 -f - < 05_rollback.sql

\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE _f2_map(tbl text, id bigint, old_url text, new_url text) ON COMMIT DROP;
\copy _f2_map FROM 'mapping.mig.tsv' WITH (FORMAT text, DELIMITER E'\t')

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
    -- حارس: نُعيد فقط ما يزال يحمل new_url (لم يُلمس يدويًا بعد الترحيل)
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
    RAISE EXCEPTION 'rollback fail-closed per-table mismatch: df %/%%, dr %/%%, ca %/%%',
      u_df, e_df, u_dr, e_dr, u_ca, e_ca;
  END IF;
  IF total <> 7 THEN RAISE EXCEPTION 'rollback fail-closed: total % (expected 7)', total; END IF;

  RAISE NOTICE 'F2 rollback OK: df=%, dr=%, ca=% (total=7) reverted to pre-image.', u_df, u_dr, u_ca;
END $$;

COMMIT;
