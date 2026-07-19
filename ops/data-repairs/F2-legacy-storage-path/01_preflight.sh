#!/usr/bin/env bash
# 01_preflight.sh — Batch 2 (F2) — قراءة + التقاط pre-image فقط. لا نسخ، لا تحديث DB، لا حذف.
#
# المفاهيم الأربعة تأتي من config.sh (المصدر الموحّد) ولا تُخلط:
#   DB_OLD_URL_PREFIX  ما يسجّله الـDB الآن (يُطابَق/يُحرَس به)      = /app/uploads/1/document
#   DB_NEW_URL_PREFIX  عقد الخدمة القانوني بعد الترحيل             = /api/storage/onpremise/1/1/document
#   PHYSICAL_SRC_DIR   مكان البايتات فعلًا على القرص (مصدر النسخ)  = /app/uploads/1/0/document
#   PHYSICAL_DST_DIR   وجهة النسخ لتُخدَم عبر DB_NEW_URL_PREFIX     = /app/uploads/1/1/document
# انتبه: PHYSICAL_SRC_DIR ليس نفسه DB_OLD_URL_PREFIX (انفصال مُثبَت بالأدلة).
#
# التسلسل: (1) جرد حيّ→mapping، (1b) حارس انحراف بادئات الـSQL مقابل config.sh،
#          (2) مقارنة mapping يدوي اختياري، (3) فحوص فيزيائية (المصدر + الوجهة مستقلًّا) + pre-image.
#
# DRY_RUN=1 (يضبطه 00_dry_run): الفحوص الفيزيائية تُسجَّل ولا تُوقِف (تشخيص كامل). الوضع الصارم يُوقِف.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/config.sh"

APP="${APP_CONTAINER:?export APP_CONTAINER=<app container>}"
DB="${DB_CONTAINER:?export DB_CONTAINER=<db container>}"
PGUSER="${PGUSER:-edms}"; PGDB="${PGDB:-edms}"
MANUAL_MAP="${1:-}"
DRY_RUN="${DRY_RUN:-0}"
GEN="mapping.gen.tsv"; PREIMAGE="preimage.tsv"

fail(){ echo "PREFLIGHT ABORT: $*" >&2; exit 1; }
PHYS_ISSUES=0
phys_note(){ if [[ "$DRY_RUN" == "1" ]]; then echo "    ⚠ $1"; PHYS_ISSUES=$((PHYS_ISSUES+1)); else fail "$1"; fi; }

echo "── (1) الجرد الحيّ + توليد الـmapping ──"
docker exec -i "$DB" psql -U "$PGUSER" -d "$PGDB" -v ON_ERROR_STOP=1 -f - < "$HERE/00_inventory.sql" > "$GEN" \
  || fail "inventory assertions failed (see stderr above) — no mapping produced"
awk -F'\t' 'NF==7' "$GEN" > "${GEN}.clean" && mv "${GEN}.clean" "$GEN"
rows=$(wc -l < "$GEN" | tr -d ' ')
[[ "$rows" -eq 7 ]] || fail "generated mapping has $rows rows (expected 7)"
echo "  mapping.gen.tsv = 7 صفوف ✓"
cut -f1,2,5,6 "$GEN" > mapping.mig.tsv
echo "  mapping.mig.tsv مكتوب (4 أعمدة لـmigrate/rollback) ✓"

echo "── (1b) حارس انحراف: بادئات الـDB في 00_inventory.sql تطابق config.sh ──"
grep -qF "${DB_OLD_URL_PREFIX}/" "$HERE/00_inventory.sql" || fail "drift: 00_inventory.sql missing DB_OLD_URL_PREFIX=$DB_OLD_URL_PREFIX"
grep -qF "${DB_NEW_URL_PREFIX}/" "$HERE/00_inventory.sql" || fail "drift: 00_inventory.sql missing DB_NEW_URL_PREFIX=$DB_NEW_URL_PREFIX"
echo "  بادئات الـDB متطابقة مع config.sh ✓"

echo "── (2) مقارنة الملف اليدوي (إن وُجد) ──"
if [[ -n "$MANUAL_MAP" ]]; then
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
echo "  PHYSICAL_SRC_DIR=$PHYSICAL_SRC_DIR"
echo "  PHYSICAL_DST_DIR=$PHYSICAL_DST_DIR"
{
  echo "# F2 Batch2 pre-image"
  echo "# generated_by_host: $(hostname 2>/dev/null || echo unknown)"
  echo "# app_container: $APP"
  echo "# db_container: $DB"
  docker exec "$DB" psql -U "$PGUSER" -d "$PGDB" -tAc \
    "SELECT '# db_identity: db='||current_database()||' server='||coalesce(host(inet_server_addr()),'local')||' now='||now()"
  echo "# db_old_url_prefix: $DB_OLD_URL_PREFIX"
  echo "# db_new_url_prefix: $DB_NEW_URL_PREFIX"
  echo "# physical_src_dir: $PHYSICAL_SRC_DIR"
  echo "# physical_dst_dir: $PHYSICAL_DST_DIR"
  echo "# columns: table<TAB>id<TAB>old_url<TAB>new_url<TAB>filename"
} > "$PREIMAGE"

# تشخيص عام لمجلد المصدر الفيزيائي (لا يُوقِف)
if docker exec "$APP" test -d "$PHYSICAL_SRC_DIR"; then
  src_dir_count=$(docker exec "$APP" sh -c "ls -1 '$PHYSICAL_SRC_DIR' 2>/dev/null | wc -l" | tr -d '[:space:]')
  echo "  SRC_DIR_EXISTS=true  SRC_DIR_FILE_COUNT=$src_dir_count  ($PHYSICAL_SRC_DIR)"
else
  phys_note "PHYSICAL_SRC_DIR missing: $PHYSICAL_SRC_DIR"
  echo "  SRC_DIR_EXISTS=false ($PHYSICAL_SRC_DIR)"
fi

declare -A seen_file
uniq_files=0
src_present=0; dst_absent=0; dst_identical=0; dst_conflict=0; dst_present_src_missing=0; not_creatable=0
while IFS=$'\t' read -r tbl id org proj old_url new_url filename; do
  echo "  [$tbl #$id] file=$filename"
  src="$PHYSICAL_SRC_DIR/$filename"; dst="$PHYSICAL_DST_DIR/$filename"

  if [[ -z "${seen_file[$filename]:-}" ]]; then
    seen_file[$filename]=1; uniq_files=$((uniq_files+1))

    # فحص المصدر
    src_exists=false
    if docker exec "$APP" test -r "$src"; then src_exists=true; fi
    # فحص الوجهة — مستقلّ تمامًا عن المصدر (طلب المالك)
    dst_exists=false
    if docker exec "$APP" test -e "$dst"; then dst_exists=true; fi

    if $src_exists; then echo "    SRC_EXISTS=true"; src_present=$((src_present+1));
    else echo "    SRC_EXISTS=false"; phys_note "[$filename] source missing/unreadable: $src"; fi

    if $dst_exists; then
      if $src_exists; then
        s=$(docker exec "$APP" sha256sum "$src" | awk '{print $1}')
        d=$(docker exec "$APP" sha256sum "$dst" | awk '{print $1}')
        if [[ "$s" == "$d" ]]; then echo "    DST=exists-identical (آمن)"; dst_identical=$((dst_identical+1));
        else dst_conflict=$((dst_conflict+1)); phys_note "[$filename] dst exists and DIFFERS (name conflict): $dst"; fi
      else
        # وجهة موجودة والمصدر مفقود — حالة مهمّة (ربما نُسخ سابقًا). نُبلِّغ دائمًا.
        echo "    DST=exists but SRC missing (already migrated? investigate): $dst"
        dst_present_src_missing=$((dst_present_src_missing+1))
      fi
    else
      echo "    DST=absent"; dst_absent=$((dst_absent+1))
    fi

    # قابلية إنشاء الوجهة دون إنشاء فعلي
    probe="$PHYSICAL_DST_DIR"
    while ! docker exec "$APP" test -e "$probe"; do probe=$(dirname "$probe"); done
    docker exec "$APP" test -w "$probe" \
      || { not_creatable=$((not_creatable+1)); phys_note "[$filename] dst not creatable: no writable ancestor for $PHYSICAL_DST_DIR (nearest: $probe)"; }
  fi

  printf '%s\t%s\t%s\t%s\t%s\n' "$tbl" "$id" "$old_url" "$new_url" "$filename" >> "$PREIMAGE"
done < "$GEN"

# (4) الملفات الفريدة = 4 (سلامة الـmapping — مانعة دائمًا)
[[ "$uniq_files" -eq 4 ]] || fail "unique mapping files = $uniq_files (expected 4)"
echo "── (4) ملفات فريدة = 4 ✓"

# (5) ملخّص الجاهزية الفيزيائية
echo "── PHYSICAL READINESS ──"
echo "  sources_present = $src_present/$uniq_files"
echo "  dst: absent=$dst_absent identical=$dst_identical conflict=$dst_conflict present_but_src_missing=$dst_present_src_missing"
echo "  dst_not_creatable = $not_creatable"
echo "  physical_issues = $PHYS_ISSUES"
if [[ "$PHYS_ISSUES" -eq 0 ]]; then
  echo "  READINESS = READY (كل المصادر حاضرة، لا تعارض، الوجهة قابلة للإنشاء)"
else
  echo "  READINESS = NOT READY ($PHYS_ISSUES مشكلة فيزيائية) — راجع الملاحظات أعلاه قبل 02_copy"
fi

echo "PREFLIGHT PASS (diagnostic) — 7 صفوف، 4 ملفات فريدة، كلها project=1/org=1، pre-image مكتوب في $PREIMAGE. لا بيانات تغيّرت."
