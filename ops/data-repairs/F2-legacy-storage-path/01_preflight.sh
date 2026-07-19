#!/usr/bin/env bash
# 01_preflight.sh — Batch 2 (F2) — قراءة + التقاط pre-image فقط. لا نسخ، لا تحديث DB، لا حذف.
# يُشغَّل من قِبل المالك على الـVPS.
#
# التسلسل:
#   1) يشغّل 00_inventory.sql على DB الحيّة → يثبت الشروط السبعة → يولّد mapping.gen.tsv (المصدر الموثوق).
#   2) إن مُرِّر mapping.tsv يدوي: مقارنة كاملة (diff) — أي اختلاف = توقف. الجرد الحيّ هو الحَكَم.
#   3) فحوص فيزيائية لكل ملف فريد: المصدر موجود/مقروء، الوجهة غائبة أو مطابقة بالـsha256 (لا تعارض).
#   4) الملفات الفريدة = 4 بالضبط.
#   5) كتابة pre-image غنيّ (هوية البيئة/DB + الوقت + الجدول + id + old_url + new_url).
#
# وضع التشخيص (DRY_RUN=1، يضبطه 00_dry_run.sh): الفحوص الفيزيائية تُسجَّل ولا تُوقِف التشغيل،
# كي يبقى الـdry-run أداة تشخيص كاملة حتى لو كان المسار نفسه هو المشكلة. الحالة تُلخَّص في تقرير
# جاهزية فيزيائية (PHYSICAL READINESS). النسخ الحقيقي (02_copy) يفحص المصدر بصرامة مستقلًّا،
# فإضعاف الفحص هنا لا يقلّل أمان النسخ. في الوضع الصارم (DRY_RUN غير مضبوط) تبقى الفحوص مانعة.
set -euo pipefail

APP="${APP_CONTAINER:?export APP_CONTAINER=<app container>}"
DB="${DB_CONTAINER:?export DB_CONTAINER=<db container>}"
PGUSER="${PGUSER:-edms}"; PGDB="${PGDB:-edms}"
SRC_DIR="${SRC_DIR:-/app/uploads/1/0/document}"   # حيث توجد البايتات فعليًا (أثبته find)
DST_DIR="${DST_DIR:-/app/uploads/1/1/document}"   # الوجهة القانونية للمشروع 1
MANUAL_MAP="${1:-}"                                # اختياري: mapping.tsv يدوي للمقارنة
DRY_RUN="${DRY_RUN:-0}"                            # 1 = تشخيص (سجّل ولا تُوقِف)؛ غير ذلك = صارم
GEN="mapping.gen.tsv"; PREIMAGE="preimage.tsv"

fail(){ echo "PREFLIGHT ABORT: $*" >&2; exit 1; }
# طفرة فيزيائية: في dry-run تُسجَّل كملاحظة وتُحصى؛ في الوضع الصارم تُوقِف.
PHYS_ISSUES=0
phys_note(){
  if [[ "$DRY_RUN" == "1" ]]; then echo "    ⚠ $1"; PHYS_ISSUES=$((PHYS_ISSUES+1)); else fail "$1"; fi
}

echo "── (1) الجرد الحيّ + توليد الـmapping ──"
docker exec -i "$DB" psql -U "$PGUSER" -d "$PGDB" -v ON_ERROR_STOP=1 -f - < 00_inventory.sql > "$GEN" \
  || fail "inventory assertions failed (see stderr above) — no mapping produced"
# أبقِ الأسطر الجدولية فقط (7 حقول مفصولة Tab)؛ awk يستبعد أسطر NOTICE/الفارغة تلقائيًا.
# (نتجنّب grep -P: يفشل في locales غير UTF-8 على بعض الخوادم فيُفرغ الـmapping زورًا.)
awk -F'\t' 'NF==7' "$GEN" > "${GEN}.clean" && mv "${GEN}.clean" "$GEN"
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

# تشخيص عام لمجلد المصدر (لا يُوقِف): موجود؟ كم ملفًا يحوي؟
if docker exec "$APP" test -d "$SRC_DIR"; then
  src_dir_count=$(docker exec "$APP" sh -c "ls -1 '$SRC_DIR' 2>/dev/null | wc -l" | tr -d '[:space:]')
  echo "  SRC_DIR_EXISTS=true  SRC_DIR_FILE_COUNT=$src_dir_count  ($SRC_DIR)"
else
  src_dir_count=0
  phys_note "SRC_DIR missing: $SRC_DIR"
  echo "  SRC_DIR_EXISTS=false ($SRC_DIR)"
fi

declare -A seen_file
uniq_files=0
src_present=0; dst_absent=0; dst_identical=0; dst_conflict=0; not_creatable=0
while IFS=$'\t' read -r tbl id org proj old_url new_url filename; do
  echo "  [$tbl #$id] file=$filename"
  src="$SRC_DIR/$filename"; dst="$DST_DIR/$filename"

  # الفحص الفيزيائي مرة واحدة لكل ملف فريد (7 صفوف → 4 ملفات)
  if [[ -z "${seen_file[$filename]:-}" ]]; then
    seen_file[$filename]=1; uniq_files=$((uniq_files+1))
    if docker exec "$APP" test -r "$src"; then
      echo "    SRC_EXISTS=true"
      src_present=$((src_present+1))
      if docker exec "$APP" test -e "$dst"; then
        s=$(docker exec "$APP" sha256sum "$src" | awk '{print $1}')
        d=$(docker exec "$APP" sha256sum "$dst" | awk '{print $1}')
        if [[ "$s" == "$d" ]]; then
          echo "    DST=exists-identical (آمن)"; dst_identical=$((dst_identical+1))
        else
          dst_conflict=$((dst_conflict+1)); phys_note "[$filename] dst exists and DIFFERS (name conflict): $dst"
        fi
      else
        echo "    DST=absent (سيُنشأ في 02_copy)"; dst_absent=$((dst_absent+1))
      fi
    else
      echo "    SRC_EXISTS=false"; phys_note "[$filename] source missing/unreadable: $src"
    fi
    # قابلية إنشاء الوجهة دون إنشاء فعلي: أقرب سلف موجود قابل للكتابة
    probe="$DST_DIR"
    while ! docker exec "$APP" test -e "$probe"; do probe=$(dirname "$probe"); done
    docker exec "$APP" test -w "$probe" \
      || { not_creatable=$((not_creatable+1)); phys_note "[$filename] dst not creatable: no writable ancestor for $DST_DIR (nearest: $probe)"; }
  fi

  printf '%s\t%s\t%s\t%s\t%s\n' "$tbl" "$id" "$old_url" "$new_url" "$filename" >> "$PREIMAGE"
done < "$GEN"

# (4) الملفات الفريدة = 4 (سلامة الـmapping — تبقى مانعة حتى في dry-run لأنها لا تخصّ المسار الفيزيائي)
[[ "$uniq_files" -eq 4 ]] || fail "unique mapping files = $uniq_files (expected 4)"
echo "── (4) ملفات فريدة = 4 ✓"

# (5) ملخّص الجاهزية الفيزيائية (تشخيص؛ لا يُوقِف في dry-run)
echo "── PHYSICAL READINESS ──"
echo "  sources_present = $src_present/$uniq_files"
echo "  dst: absent=$dst_absent identical=$dst_identical conflict=$dst_conflict"
echo "  dst_not_creatable = $not_creatable"
echo "  physical_issues = $PHYS_ISSUES"
if [[ "$PHYS_ISSUES" -eq 0 ]]; then
  echo "  READINESS = READY (كل المصادر حاضرة، لا تعارض، الوجهة قابلة للإنشاء)"
else
  echo "  READINESS = NOT READY ($PHYS_ISSUES مشكلة فيزيائية) — راجع الملاحظات أعلاه قبل 02_copy"
fi

echo "PREFLIGHT PASS (diagnostic) — 7 صفوف، 4 ملفات فريدة، كلها project=1/org=1، pre-image مكتوب في $PREIMAGE. لا بيانات تغيّرت."
