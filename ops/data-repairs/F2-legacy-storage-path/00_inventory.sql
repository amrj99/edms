-- 00_inventory.sql — Batch 2 (F2) — الجرد الحيّ = المصدر الموثوق الوحيد للـmapping.
-- قراءة فقط. لا UPDATE/DELETE/DDL.
--
-- منطق الاكتشاف (طلب المالك — العلاقات أساس، file_url حارس):
--   • الأساس  = العلاقة: سجلات org=1 المرتبطة بكيان أمّ (documents/correspondence) مشروعه = 1.
--   • الحارس  = file_url يطابق الشكل التاريخي المقصود بالضبط:
--                '^/api/storage/onpremise/1/document/[^/]+$' (3 مقاطع، بلا مقطع مشروع).
--   نُحدّث فقط تقاطع (العلاقة الصحيحة) ∩ (الحارس التاريخي). أي سجل مشروعه=1 لكن file_url
--   بشكل آخر (سليم 4-مقاطع أو R2/S3 أو NULL) لا يُلمس؛ وأي سجل بالشكل التاريخي لكن مشروعه≠1
--   يُوقِف التنفيذ (تناقض غير متوقع).
--
-- الشروط التي تُوقِف التنفيذ (RAISE → خروج غير صفري → لا mapping):
--   1) لا سجل يحمل الحارس التاريخي ومشروعه ≠ 1 أو org ≠ 1 أو NULL (في أيٍّ من الجداول الثلاثة).
--   2) الإجمالي (بالعلاقة + الحارس) = 7 بالضبط.
--   3) الملفات الفيزيائية الفريدة = 4 بالضبط.

\set ON_ERROR_STOP on

-- الحارس التاريخي (guard) — يُستخدم في الاكتشاف وكحارس تحديث لاحقًا في 04_migrate.
\set legacy_re '^/api/storage/onpremise/1/document/[^/]+$'

DO $$
DECLARE
  c_df int; c_dr int; c_ca int; c_total int; c_files int; bad int;
  re text := '^/api/storage/onpremise/1/document/[^/]+$';
BEGIN
  -- ── الشرط (1): تناقض العلاقة مع الحارس ─────────────────────────────────────
  -- أي سجل بالشكل التاريخي لكن كيانه الأمّ ليس (project=1 & org=1) أو NULL = حالة غير متوقعة.

  -- document_files: الأساس = f.organization_id=1 و d.project_id=1؛ الحارس = f.file_url.
  SELECT count(*) INTO bad
    FROM document_files f JOIN documents d ON d.id = f.document_id
   WHERE f.file_url ~ re
     AND (d.project_id IS DISTINCT FROM 1
       OR d.organization_id IS DISTINCT FROM 1
       OR f.organization_id IS DISTINCT FROM 1);
  IF bad > 0 THEN RAISE EXCEPTION 'ABORT: % document_files carry the legacy file_url but are not (doc.project=1 & org=1) — unexpected', bad; END IF;

  SELECT count(*) INTO bad
    FROM document_revisions r JOIN documents d ON d.id = r.document_id
   WHERE r.file_url ~ re
     AND (d.project_id IS DISTINCT FROM 1
       OR d.organization_id IS DISTINCT FROM 1
       OR r.organization_id IS DISTINCT FROM 1);
  IF bad > 0 THEN RAISE EXCEPTION 'ABORT: % document_revisions carry the legacy file_url but are not (doc.project=1 & org=1) — unexpected', bad; END IF;

  SELECT count(*) INTO bad
    FROM correspondence_attachments a JOIN correspondence c ON c.id = a.correspondence_id
   WHERE a.file_url ~ re
     AND (c.project_id IS DISTINCT FROM 1
       OR c.organization_id IS DISTINCT FROM 1);
  IF bad > 0 THEN RAISE EXCEPTION 'ABORT: % correspondence_attachments carry the legacy file_url but are not (corr.project=1 & org=1) — unexpected', bad; END IF;

  -- ── العدّ عبر (العلاقة الصحيحة ∩ الحارس) ────────────────────────────────────
  SELECT count(*) INTO c_df
    FROM document_files f JOIN documents d ON d.id = f.document_id
   WHERE d.project_id = 1 AND d.organization_id = 1 AND f.organization_id = 1
     AND f.file_url ~ re;
  SELECT count(*) INTO c_dr
    FROM document_revisions r JOIN documents d ON d.id = r.document_id
   WHERE d.project_id = 1 AND d.organization_id = 1 AND r.organization_id = 1
     AND r.file_url ~ re;
  SELECT count(*) INTO c_ca
    FROM correspondence_attachments a JOIN correspondence c ON c.id = a.correspondence_id
   WHERE c.project_id = 1 AND c.organization_id = 1
     AND a.file_url ~ re;

  -- ── الشرط (2): الإجمالي = 7 ────────────────────────────────────────────────
  c_total := c_df + c_dr + c_ca;
  IF c_total <> 7 THEN
    RAISE EXCEPTION 'ABORT: expected 7 legacy rows, found % (df=%, dr=%, ca=%)', c_total, c_df, c_dr, c_ca;
  END IF;

  -- ── الشرط (3): ملفات فريدة = 4 ─────────────────────────────────────────────
  SELECT count(DISTINCT regexp_replace(u, '^.*/', '')) INTO c_files FROM (
      SELECT f.file_url u FROM document_files f JOIN documents d ON d.id = f.document_id
       WHERE d.project_id = 1 AND d.organization_id = 1 AND f.organization_id = 1 AND f.file_url ~ re
    UNION ALL
      SELECT r.file_url u FROM document_revisions r JOIN documents d ON d.id = r.document_id
       WHERE d.project_id = 1 AND d.organization_id = 1 AND r.organization_id = 1 AND r.file_url ~ re
    UNION ALL
      SELECT a.file_url u FROM correspondence_attachments a JOIN correspondence c ON c.id = a.correspondence_id
       WHERE c.project_id = 1 AND c.organization_id = 1 AND a.file_url ~ re
  ) s;
  IF c_files <> 4 THEN RAISE EXCEPTION 'ABORT: expected 4 unique files, found %', c_files; END IF;

  RAISE NOTICE 'INVENTORY OK: df=%, dr=%, ca=% (total=7), unique files=% — discovered by relation (project=1/org=1), guarded by legacy file_url', c_df, c_dr, c_ca, c_files;
END $$;

-- ── إصدار الـmapping التنفيذي (tab-separated, بلا رؤوس) ─────────────────────
-- الاكتشاف بالعلاقة (project=1 & org=1) + الحارس (file_url التاريخي).
-- الأعمدة: tbl  id  org_id  project_id  old_url  new_url  filename
\pset tuples_only on
\pset format unaligned
\pset fieldsep '\t'

SELECT 'document_files', f.id, f.organization_id, d.project_id,
       f.file_url,
       regexp_replace(f.file_url, '^/api/storage/onpremise/1/document/', '/api/storage/onpremise/1/1/document/'),
       regexp_replace(f.file_url, '^.*/', '')
  FROM document_files f JOIN documents d ON d.id = f.document_id
 WHERE d.project_id = 1 AND d.organization_id = 1 AND f.organization_id = 1
   AND f.file_url ~ :'legacy_re'
UNION ALL
SELECT 'document_revisions', r.id, r.organization_id, d.project_id,
       r.file_url,
       regexp_replace(r.file_url, '^/api/storage/onpremise/1/document/', '/api/storage/onpremise/1/1/document/'),
       regexp_replace(r.file_url, '^.*/', '')
  FROM document_revisions r JOIN documents d ON d.id = r.document_id
 WHERE d.project_id = 1 AND d.organization_id = 1 AND r.organization_id = 1
   AND r.file_url ~ :'legacy_re'
UNION ALL
SELECT 'correspondence_attachments', a.id, c.organization_id, c.project_id,
       a.file_url,
       regexp_replace(a.file_url, '^/api/storage/onpremise/1/document/', '/api/storage/onpremise/1/1/document/'),
       regexp_replace(a.file_url, '^.*/', '')
  FROM correspondence_attachments a JOIN correspondence c ON c.id = a.correspondence_id
 WHERE c.project_id = 1 AND c.organization_id = 1
   AND a.file_url ~ :'legacy_re'
ORDER BY 1, 2;
