#!/usr/bin/env bash
# 01_preflight.sh — Batch 2 (F2) — قراءة + التقاط pre-image فقط. لا نسخ، لا تحديث DB، لا حذف.
# يُشغَّل من قِبل المالك على الـVPS.
#
# التسلسل:
#   1) يشغّل 00_inventory.sql على DB الحيّة → يثبت الشروط السبعة → يولّد mapping.gen.tsv (المصدر الموثوق).
#   2) إن مُرِّر mapping.tsv يدوي: مقارنة كاملة (diff) — أي اختلاف = توقف. الجرد الحيّ هو الحَكَم.
#   3) فحوص فيزيائية لكل صف: المصدر موجود/مقروء، الوجهة غائبة أو مطابقة بالـsha256 (لا تعارض).
#   4) الملفات الفريدة = 4 بالضبط.
#   5) كتابة pre-image غنيّ (هوية البيئة/DB + الوقت + الجدول + id + old_url + new_url).
set -euo pipefail

APP="${APP_CONTAINER:?export APP_CONTAINER=<app container>}"
DB="${DB_CONTAINER:?export DB_CONTAINER=<db container>}"
PGUSER="${PGUSER:-edms}"; PGDB="${PGDB:-edms}"
SRC_DIR="${SRC_DIR:-/app/uploads/1/0/document}"   # حيث توجد البايتات فعليًا (أثبته find)
DST_DIR="${DST_DIR:-/app/uploads/1/1/document}"   # الوجهة القانونية للمشروع 1
MANUAL_MAP="${1:-}"                                # اختياري: mapping.tsv يدوي للمقارنة
GEN="mapping.gen.tsv"; PREIMAGE="preimage.tsv"

fail(){ echo "PREFLIGHT ABORT: $*" >&2; exit 1; }

echo "── (1) الجرد الحيّ + توليد الـmapping ──"
docker exec -i "$DB" psql -U "$PGUSER" -d "$PGDB" -v ON_ERROR_STOP=1 -f - < 00_inventory.sql > "$GEN" \
  || fail "inventory assertions failed (see stderr above) — no mapping produced"
# أزل أي أسطر NOTICE/فارغة (الإخراج الجدولي فقط: 7 أعمدة مفصولة Tab)
grep -P '\t' "$GEN" | awk -F'\t' 'NF==7' > "${GEN}.clean" && mv "${GEN}.clean" "$GEN"
rows=$(wc -l < "$GEN" | tr -d ' ')
[[ "$rows" -eq 7 ]] || fail "generated mapping has $rows rows (expected 7)"
echo "  mapping.gen.tsv = 7 صفوف ✓"
# نسخة مختصرة (tbl,id,old_url,new_url) تُغذّى إلى 04_migrate/05_rollback عبر \copy
cut -f1,2,5,6 "$GEN" > mapping.mig.tsv
echo "  mapping.mig.tsv مكتوب (4 أعمدة لـmigrate/rollback) ✓"

echo "── (2) مقارنة الملف اليدوي (إن وُجد) ──"
if [[ -n "$MANUAL_MAP" ]]; then
  # نقارن الأعمدة الحاسمة فقط (tbl,id,old_url,new_url) لتفادي فروق التنسيق
  cut -f1,2,5,6 "$GEN"        | sort > /tmp/f2_gen.key
  cut -f1,2,5,6 "$MANUAL_MAP" | sort > /tmp/f2_man.key
  if ! diff -u /tmp/f2_man.key /tmp/f2_gen.key; then
    fail "manual mapping.tsv DIFFERS from live inventory (see diff above). Live inventory is authoritative."
  fi
  echo "  الملف اليدوي مطابق للجرد الحيّ ✓"
else
  echo "  (لا ملف يدوي — نعتمد mapping.gen.tsv المُولَّد من الجرد الحيّ)"
fi

echo "── (3) الفحوص الفيزيائية + pre-image ──"
# رأس pre-image غنيّ: هوية البيئة وDB والوقت
{
  echo "# F2 Batch2 pre-image"
  echo "# generated_by_host: $(hostname 2>/dev/null || echo unknown)"
  echo "# app_container: $APP"
  echo "# db_container: $DB"
  docker exec "$DB" psql -U "$PGUSER" -d "$PGDB" -tAc \
    "SELECT '# db_identity: db='||current_database()||' server='||coalesce(host(inet_server_addr()),'local')||' now='||now()"
  echo "# src_dir: $SRC_DIR"
  echo "# dst_dir: $DST_DIR"
  echo "# columns: table<TAB>id<TAB>old_url<TAB>new_url<TAB>filename"
} > "$PREIMAGE"

declare -A seen_file
uniq_files=0
while IFS=$'\t' read -r tbl id org proj old_url new_url filename; do
  echo "  [$tbl #$id] file=$filename"
  src="$SRC_DIR/$filename"; dst="$DST_DIR/$filename"

  docker exec "$APP" test -r "$src" || fail "[$tbl#$id] source missing/unreadable: $src"

  if docker exec "$APP" test -e "$dst"; then
    s=$(docker exec "$APP" sha256sum "$src" | awk '{print $1}')
    d=$(docker exec "$APP" sha256sum "$dst" | awk '{print $1}')
    [[ "$s" == "$d" ]] || fail "[$tbl#$id] dst exists and DIFFERS (name conflict): $dst"
    echo "    dst موجود ومطابق (آمن)"
  else
    echo "    dst غير موجود (سيُنشأ في 02_copy) — لا إنشاء الآن"
  fi
  # فحص قابلية الإنشاء دون إنشاء فعلي (dry-run لا يُغيّر شيئًا): أقرب سلف موجود قابل للكتابة.
  probe="$DST_DIR"
  while ! docker exec "$APP" test -e "$probe"; do probe=$(dirname "$probe"); done
  docker exec "$APP" test -w "$probe" || fail "[$tbl#$id] dst not creatable: no writable ancestor for $DST_DIR (nearest: $probe)"

  if [[ -z "${seen_file[$filename]:-}" ]]; then seen_file[$filename]=1; uniq_files=$((uniq_files+1)); fi

  printf '%s\t%s\t%s\t%s\t%s\n' "$tbl" "$id" "$old_url" "$new_url" "$filename" >> "$PREIMAGE"
done < "$GEN"

# (4) الملفات الفريدة = 4
[[ "$uniq_files" -eq 4 ]] || fail "unique physical files = $uniq_files (expected 4)"
echo "── (4) ملفات فريدة = 4 ✓"

echo "PREFLIGHT PASS — 7 صفوف، 4 ملفات فريدة، كلها project=1/org=1، pre-image مكتوب في $PREIMAGE. لا بيانات تغيّرت."
