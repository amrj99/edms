-- 00_inventory.sql — Batch 2 (F2) — الجرد الحيّ = المصدر الموثوق الوحيد للـmapping.
-- قراءة فقط. لا UPDATE/DELETE/DDL.
--
-- العقد (Canonical Contract) — مُثبَت من الكود/التاريخ + الجرد الحيّ:
--   • OLD (أثر تاريخي يُرحَّل): file_url مسار فيزيائي مطلق ذو 3 مقاطع، بلا مقطع مشروع:
--       '^/app/uploads/1/document/[^/]+$'
--     نشأ من تخزين buildOnPremPath (مسار fs) كـfile_url + علّة truthiness التي أسقطت مقطع المشروع.
--   • NEW (العقد الرسمي الحالي، لا يُمَسّ): صيغة رابط الخدمة التي يقرؤها serve route:
--       '^/api/storage/onpremise/1/1/document/[^/]+$'
--   • التحويل: OLD → NEW عبر استبدال البادئة فقط (اسم الملف يبقى كما هو).
--
-- منطق الاكتشاف (العلاقات أساس، والعقد حارس صريح — لا regex عام ولا توسيع):
--   الأساس  = العلاقة: صفوف org=1 المرتبطة بكيان أمّ (documents/correspondence) مشروعه = 1.
--   الحارس  = صيغة OLD أعلاه بالضبط. نُرحّل فقط (العلاقة ∩ OLD).
--
-- FAIL-CLOSED (توقف عند المجهول، لا تخمين):
--   1) أي صفّ داخل النطاق (project=1/org=1) بمسار '/app/uploads/%' لا يطابق OLD بالضبط
--      → شكل قديم مجهول → ABORT (لا نوسّع الاكتشاف لالتقاط ما لا نفهمه).
--   2) الإجمالي (العلاقة ∩ OLD) = 7 بالضبط، وإلا ABORT.
--   3) الملفات الفريدة (حسب اسم الملف) = 4 بالضبط، وإلا ABORT.

\set ON_ERROR_STOP on
\set old_re '^/app/uploads/1/document/[^/]+$'

DO $$
DECLARE
  c_df int; c_dr int; c_ca int; c_total int; c_files int; bad int;
  re_old text := '^/app/uploads/1/document/[^/]+$';
BEGIN
  -- ── (1) FAIL-CLOSED: صيغ /app/uploads داخل النطاق لا تطابق OLD ────────────────
  SELECT count(*) INTO bad
    FROM document_files f JOIN documents d ON d.id = f.document_id
   WHERE d.project_id = 1 AND d.organization_id = 1 AND f.organization_id = 1
     AND f.file_url LIKE '/app/uploads/%' AND f.file_url !~ re_old;
  IF bad > 0 THEN RAISE EXCEPTION 'ABORT: % document_files in-scope /app/uploads row(s) do NOT match the OLD contract (unknown legacy form) — refusing to widen discovery', bad; END IF;

  SELECT count(*) INTO bad
    FROM document_revisions r JOIN documents d ON d.id = r.document_id
   WHERE d.project_id = 1 AND d.organization_id = 1 AND r.organization_id = 1
     AND r.file_url LIKE '/app/uploads/%' AND r.file_url !~ re_old;
  IF bad > 0 THEN RAISE EXCEPTION 'ABORT: % document_revisions in-scope /app/uploads row(s) do NOT match the OLD contract (unknown legacy form)', bad; END IF;

  SELECT count(*) INTO bad
    FROM correspondence_attachments a JOIN correspondence c ON c.id = a.correspondence_id
   WHERE c.project_id = 1 AND c.organization_id = 1
     AND a.file_url LIKE '/app/uploads/%' AND a.file_url !~ re_old;
  IF bad > 0 THEN RAISE EXCEPTION 'ABORT: % correspondence_attachments in-scope /app/uploads row(s) do NOT match the OLD contract (unknown legacy form)', bad; END IF;

  -- ── مجموعة OLD (أهداف الترحيل) عبر (العلاقة ∩ OLD) ───────────────────────────
  SELECT count(*) INTO c_df
    FROM document_files f JOIN documents d ON d.id = f.document_id
   WHERE d.project_id = 1 AND d.organization_id = 1 AND f.organization_id = 1
     AND f.file_url ~ re_old;
  SELECT count(*) INTO c_dr
    FROM document_revisions r JOIN documents d ON d.id = r.document_id
   WHERE d.project_id = 1 AND d.organization_id = 1 AND r.organization_id = 1
     AND r.file_url ~ re_old;
  SELECT count(*) INTO c_ca
    FROM correspondence_attachments a JOIN correspondence c ON c.id = a.correspondence_id
   WHERE c.project_id = 1 AND c.organization_id = 1
     AND a.file_url ~ re_old;

  -- ── (2) الإجمالي = 7 ────────────────────────────────────────────────────────
  c_total := c_df + c_dr + c_ca;
  IF c_total <> 7 THEN
    RAISE EXCEPTION 'ABORT: expected 7 legacy (OLD-contract) rows, found % (df=%, dr=%, ca=%)', c_total, c_df, c_dr, c_ca;
  END IF;

  -- ── (3) ملفات فريدة = 4 ─────────────────────────────────────────────────────
  SELECT count(DISTINCT regexp_replace(u, '^.*/', '')) INTO c_files FROM (
      SELECT f.file_url u FROM document_files f JOIN documents d ON d.id = f.document_id
       WHERE d.project_id = 1 AND d.organization_id = 1 AND f.organization_id = 1 AND f.file_url ~ re_old
    UNION ALL
      SELECT r.file_url u FROM document_revisions r JOIN documents d ON d.id = r.document_id
       WHERE d.project_id = 1 AND d.organization_id = 1 AND r.organization_id = 1 AND r.file_url ~ re_old
    UNION ALL
      SELECT a.file_url u FROM correspondence_attachments a JOIN correspondence c ON c.id = a.correspondence_id
       WHERE c.project_id = 1 AND c.organization_id = 1 AND a.file_url ~ re_old
  ) s;
  IF c_files <> 4 THEN RAISE EXCEPTION 'ABORT: expected 4 unique files, found %', c_files; END IF;

  RAISE NOTICE 'INVENTORY OK: df=%, dr=%, ca=% (total=7), unique files=% — OLD contract -> NEW contract; fail-closed passed', c_df, c_dr, c_ca, c_files;
END $$;

-- ── إصدار الـmapping التنفيذي (tab-separated, بلا رؤوس) ─────────────────────
-- الأعمدة: tbl  id  org_id  project_id  old_url  new_url  filename
-- old_url = العقد القديم؛ new_url = العقد الجديد (استبدال البادئة فقط)؛ filename = اسم الملف.
\pset tuples_only on
\pset format unaligned
\pset fieldsep '\t'

SELECT 'document_files', f.id, f.organization_id, d.project_id,
       f.file_url,
       regexp_replace(f.file_url, '^/app/uploads/1/document/', '/api/storage/onpremise/1/1/document/'),
       regexp_replace(f.file_url, '^.*/', '')
  FROM document_files f JOIN documents d ON d.id = f.document_id
 WHERE d.project_id = 1 AND d.organization_id = 1 AND f.organization_id = 1
   AND f.file_url ~ :'old_re'
UNION ALL
SELECT 'document_revisions', r.id, r.organization_id, d.project_id,
       r.file_url,
       regexp_replace(r.file_url, '^/app/uploads/1/document/', '/api/storage/onpremise/1/1/document/'),
       regexp_replace(r.file_url, '^.*/', '')
  FROM document_revisions r JOIN documents d ON d.id = r.document_id
 WHERE d.project_id = 1 AND d.organization_id = 1 AND r.organization_id = 1
   AND r.file_url ~ :'old_re'
UNION ALL
SELECT 'correspondence_attachments', a.id, c.organization_id, c.project_id,
       a.file_url,
       regexp_replace(a.file_url, '^/app/uploads/1/document/', '/api/storage/onpremise/1/1/document/'),
       regexp_replace(a.file_url, '^.*/', '')
  FROM correspondence_attachments a JOIN correspondence c ON c.id = a.correspondence_id
 WHERE c.project_id = 1 AND c.organization_id = 1
   AND a.file_url ~ :'old_re'
ORDER BY 1, 2;
