#!/usr/bin/env bash
# 02_copy.sh — Batch 2 (F2) — نسخ الملفات الأربعة الفريدة (Copy لا Move). لا يمسّ المصدر. لا يمسّ DB.
# يعمل على mapping.gen.tsv (مخرَج 01). idempotent وآمن للإعادة.
#
# ملاحظة إلزامية (طلب المالك): cp -n وحده لا يكفي.
#   • إن كانت الوجهة غير موجودة → cp ثم ضبط الصلاحيات.
#   • إن كانت الوجهة موجودة → نتحقق من الحجم وsha256 مقابل المصدر؛ عند أي اختلاف نتوقف فورًا (لا استبدال).
# لا حذف لأي مصدر ضمن Batch 2 إطلاقًا.
set -euo pipefail

APP="${APP_CONTAINER:?export APP_CONTAINER=<app container>}"
SRC_DIR="${SRC_DIR:-/app/uploads/1/document}"     # OLD contract path (source of copy)
DST_DIR="${DST_DIR:-/app/uploads/1/1/document}"
GEN="${1:-mapping.gen.tsv}"
declare -A done_file

fail(){ echo "COPY ABORT: $*" >&2; exit 1; }

while IFS=$'\t' read -r tbl id org proj old_url new_url filename; do
  [[ "$filename" =~ ^#|^$ ]] && continue
  [[ -n "${done_file[$filename]:-}" ]] && continue     # ملف فريد يُنسخ مرة واحدة (7 صفوف → 4 ملفات)
  done_file[$filename]=1
  src="$SRC_DIR/$filename"; dst="$DST_DIR/$filename"

  docker exec "$APP" test -r "$src" || fail "source unreadable: $src"

  if docker exec "$APP" test -e "$dst"; then
    ss=$(docker exec "$APP" stat -c %s "$src"); ds=$(docker exec "$APP" stat -c %s "$dst")
    sh=$(docker exec "$APP" sha256sum "$src" | awk '{print $1}')
    dh=$(docker exec "$APP" sha256sum "$dst" | awk '{print $1}')
    { [[ "$ss" == "$ds" ]] && [[ "$sh" == "$dh" ]]; } \
      || fail "dst exists but DIFFERS (size/sha) — refusing to overwrite: $dst"
    echo "  = موجود ومطابق، تخطٍّ آمن: $dst"
    continue
  fi

  docker exec "$APP" sh -c "
    set -e
    mkdir -p '$DST_DIR' && chmod 0750 '$DST_DIR'
    cp '$src' '$dst'            # Copy فقط — المصدر يبقى
    chmod 0640 '$dst'
  " || fail "copy failed: $src → $dst"
  echo "  + نُسخ → $dst"
done < "$GEN"

echo "COPY DONE — 4 ملفات فريدة، المصادر سليمة (Copy لا Move). التالي: 03_verify.sh"
