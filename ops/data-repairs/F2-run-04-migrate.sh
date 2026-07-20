#!/usr/bin/env bash
# F2-run-04-migrate.sh — one-file runner for the APPROVED 04_migrate wrapper.
# Content is the owner-approved execution wrapper VERBATIM (not rewritten):
# path check → mapping presence + 7 rows → host SHA → fail-closed docker cp with
# host/container SHA match → run 04_migrate.sql (real, frozen) → stop on failure →
# fail-closed post-verify (RAISE asserts) → print exits + outputs.
# Runs the real, reviewed 04_migrate.sql; touches only edms_postgres/edms DB and a
# transient /tmp map inside the DB container. No 05_rollback, no 06, no cleanup of
# backups/artifacts, no touch to /1/0.
# Lives OUTSIDE the frozen package dir so package bytes stay unchanged.

# (0) التحقق من المسار الصحيح
cd /var/www/edms/ops/data-repairs/F2-legacy-storage-path || { echo "ABORT: wrong dir"; exit 1; }
PWD_NOW="$(pwd)"; EXPECT="/var/www/edms/ops/data-repairs/F2-legacy-storage-path"
[ "$PWD_NOW" = "$EXPECT" ] || { echo "ABORT: pwd=$PWD_NOW != $EXPECT"; exit 1; }
echo "pwd OK: $PWD_NOW"

DB_CONTAINER=edms_postgres   # الحاوية
PGDB=edms                    # قاعدة البيانات
PGUSER=edms                  # الهوية

# (1) التحقق من ملف الخريطة + عدد الصفوف = 7
[ -f mapping.mig.tsv ] || { echo "ABORT: mapping.mig.tsv missing"; exit 1; }
MAP_ROWS="$(wc -l < mapping.mig.tsv | tr -d ' ')"
echo "mapping.mig.tsv rows = $MAP_ROWS (expected 7)"
[ "$MAP_ROWS" -eq 7 ] || { echo "ABORT: mapping.mig.tsv has $MAP_ROWS rows, expected 7"; exit 1; }
echo "-- mapping.mig.tsv (للمراجعة) --"; cat mapping.mig.tsv

# (1b) بصمة الخريطة على المضيف
echo "===== MAPPING FINGERPRINT (host) ====="
HOST_MAP_SHA="$(sha256sum mapping.mig.tsv | awk '{print $1}')"
echo "host mapping sha256 : $HOST_MAP_SHA"

# (2) نقل fail-closed: حذف أي نسخة قديمة داخل الحاوية → نسخ جديد → مطابقة بصمة
docker exec "$DB_CONTAINER" rm -f /tmp/mapping.mig.tsv || { echo "ABORT: cannot clear stale container mapping"; exit 1; }
docker cp mapping.mig.tsv "$DB_CONTAINER":/tmp/mapping.mig.tsv || { echo "ABORT: docker cp failed"; exit 1; }
CONTAINER_MAP_SHA="$(docker exec "$DB_CONTAINER" sha256sum /tmp/mapping.mig.tsv | awk '{print $1}')"
echo "container mapping sha256: $CONTAINER_MAP_SHA"
[ "$HOST_MAP_SHA" = "$CONTAINER_MAP_SHA" ] || {
  echo "ABORT: mapping fingerprint mismatch after docker cp"
  docker exec "$DB_CONTAINER" rm -f /tmp/mapping.mig.tsv
  exit 1
}
echo "mapping fingerprint match ✓"

# (3) تشغيل 04_migrate.sql (cwd=/tmp) + Exit + المخرجات
docker exec -i -w /tmp "$DB_CONTAINER" psql -U "$PGUSER" -d "$PGDB" -v ON_ERROR_STOP=1 -f - < 04_migrate.sql > 04_migrate.out 2>&1
MIGRATE_EXIT=$?
echo "MIGRATE_EXIT=$MIGRATE_EXIT"
echo "===== 04_migrate.out ====="
cat 04_migrate.out

# (4) توقّف فوري عند الفشل
if [ "$MIGRATE_EXIT" -ne 0 ]; then
  echo "MIGRATE FAILED (exit=$MIGRATE_EXIT) — transaction rolled back by ON_ERROR_STOP."
  docker exec "$DB_CONTAINER" rm -f /tmp/mapping.mig.tsv
  echo "temp map removed. STOP (no verify, no rollback, no cleanup)."
else
  # (5) تحقّق ما بعد الترحيل — Fail-Closed عبر حُرّاس SQL فعلية (RAISE) + تقرير بصري بعدها
  echo "===== POST-MIGRATE VERIFY (fail-closed asserts, read-only) ====="
  docker exec -i "$DB_CONTAINER" psql -U "$PGUSER" -d "$PGDB" -P pager=off -v ON_ERROR_STOP=1 > post_verify.out 2>&1 <<'SQL'
CREATE TEMP TABLE _m(tbl text, id bigint, old_url text, new_url text);
\copy _m FROM '/tmp/mapping.mig.tsv' WITH (FORMAT text, DELIMITER E'\t')

-- الحالة الفعلية للصفوف المستهدفة (بالهوية table+id) مقابل الخريطة
CREATE TEMP TABLE _chk AS
WITH actual AS (
  SELECT 'document_files'::text tbl, id, file_url FROM document_files
    WHERE id IN (SELECT id FROM _m WHERE tbl='document_files')
  UNION ALL
  SELECT 'document_revisions', id, file_url FROM document_revisions
    WHERE id IN (SELECT id FROM _m WHERE tbl='document_revisions')
  UNION ALL
  SELECT 'correspondence_attachments', id, file_url FROM correspondence_attachments
    WHERE id IN (SELECT id FROM _m WHERE tbl='correspondence_attachments')
)
SELECT m.tbl, m.id, m.old_url, m.new_url, a.file_url AS actual,
       (a.file_url IS NOT DISTINCT FROM m.new_url) AS is_new,
       (a.file_url IS NOT DISTINCT FROM m.old_url) AS is_old
FROM _m m LEFT JOIN actual a ON a.tbl=m.tbl AND a.id=m.id;

-- الحُرّاس الفعلية: أي مخالفة → RAISE → psql exit != 0
DO $$
DECLARE
  c_map int; c_new int; c_old int; c_bad int; c_df int; c_dr int; c_ca int;
BEGIN
  SELECT count(*) INTO c_map FROM _m;
  SELECT count(*) INTO c_new FROM _chk WHERE is_new;
  SELECT count(*) INTO c_old FROM _chk WHERE is_old;
  SELECT count(*) INTO c_bad FROM _chk WHERE NOT is_new;   -- مفقود/مخالف
  SELECT count(*) INTO c_df  FROM _chk WHERE is_new AND tbl='document_files';
  SELECT count(*) INTO c_dr  FROM _chk WHERE is_new AND tbl='document_revisions';
  SELECT count(*) INTO c_ca  FROM _chk WHERE is_new AND tbl='correspondence_attachments';

  IF c_map <> 7 THEN RAISE EXCEPTION 'POST-VERIFY FAIL: map rows=% (expected 7)', c_map; END IF;
  IF c_new <> 7 THEN RAISE EXCEPTION 'POST-VERIFY FAIL: now_new=% (expected 7)', c_new; END IF;
  IF c_old <> 0 THEN RAISE EXCEPTION 'POST-VERIFY FAIL: still_old=% (expected 0)', c_old; END IF;
  IF c_bad <> 0 THEN RAISE EXCEPTION 'POST-VERIFY FAIL: offending/missing rows=% (expected 0)', c_bad; END IF;
  IF c_df <> 2 THEN RAISE EXCEPTION 'POST-VERIFY FAIL: document_files new=% (expected 2)', c_df; END IF;
  IF c_dr <> 4 THEN RAISE EXCEPTION 'POST-VERIFY FAIL: document_revisions new=% (expected 4)', c_dr; END IF;
  IF c_ca <> 1 THEN RAISE EXCEPTION 'POST-VERIFY FAIL: correspondence_attachments new=% (expected 1)', c_ca; END IF;

  RAISE NOTICE 'POST-VERIFY OK: map=7, now_new=7, still_old=0, offending=0, per_table df=2/dr=4/ca=1';
END $$;

-- تقرير بصري بعد نجاح الحُرّاس
SELECT 'OFFENDING_ROW' AS kind, tbl, id, new_url AS expected, actual FROM _chk WHERE NOT is_new ORDER BY tbl, id;
SELECT tbl, id, actual AS new_url_on_disk FROM _chk ORDER BY tbl, id;
SQL
  POST_VERIFY_EXIT=$?
  echo "POST_VERIFY_EXIT=$POST_VERIFY_EXIT"
  echo "===== post_verify.out ====="
  cat post_verify.out
  docker exec "$DB_CONTAINER" rm -f /tmp/mapping.mig.tsv
  echo "== END 04_migrate =="
fi
