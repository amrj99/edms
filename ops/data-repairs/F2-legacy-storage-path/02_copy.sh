#!/usr/bin/env bash
# 02_copy.sh — Batch 2 (F2) — نسخ الملفات الأربعة الفريدة (Copy لا Move). لا يمسّ المصدر. لا يمسّ DB.
# يعمل على mapping.gen.tsv (مخرَج 01). idempotent وآمن للإعادة.
#
# المصدر/الوجهة من config.sh (PHYSICAL_SRC_DIR / PHYSICAL_DST_DIR) — لا خلط مع بادئات الـDB.
#
# fail-closed (طلب المالك):
#   • فحص مسبق all-or-nothing لكل الملفات الأربعة قبل نسخ أيّ ملف:
#       - أي مصدر مفقود/غير مقروء → توقف (لا ننسخ شيئًا).
#       - أي وجهة موجودة بمحتوى مختلف (size/sha256) → توقف (تعارض، لا استبدال).
#   • بعد نجاح الفحص المسبق فقط ننسخ. Copy لا Move. لا حذف لأي مصدر إطلاقًا.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/config.sh"

APP="${APP_CONTAINER:?export APP_CONTAINER=<app container>}"
GEN="${1:-mapping.gen.tsv}"

fail(){ echo "COPY ABORT: $*" >&2; exit 1; }

# قائمة الملفات الفريدة من الـmapping
mapfile -t FILES < <(cut -f7 "$GEN" | awk 'NF' | sort -u)
[[ "${#FILES[@]}" -eq 4 ]] || fail "expected 4 unique files, got ${#FILES[@]}"

echo "── فحص مسبق all-or-nothing (لا نسخ قبل نجاح الكل) ──"
for filename in "${FILES[@]}"; do
  src="$PHYSICAL_SRC_DIR/$filename"; dst="$PHYSICAL_DST_DIR/$filename"
  docker exec "$APP" test -r "$src" || fail "source missing/unreadable: $src"
  if docker exec "$APP" test -e "$dst"; then
    ss=$(docker exec "$APP" stat -c %s "$src"); ds=$(docker exec "$APP" stat -c %s "$dst")
    sh=$(docker exec "$APP" sha256sum "$src" | awk '{print $1}')
    dh=$(docker exec "$APP" sha256sum "$dst" | awk '{print $1}')
    { [[ "$ss" == "$ds" ]] && [[ "$sh" == "$dh" ]]; } \
      || fail "dst exists but DIFFERS (size/sha) — refusing to overwrite: $dst"
    echo "  = موجود ومطابق (سيُتخطّى بأمان): $dst"
  else
    echo "  + جاهز للنسخ: $src → $dst"
  fi
done
echo "الفحص المسبق نجح (4/4)."

echo "── النسخ (Copy لا Move) ──"
for filename in "${FILES[@]}"; do
  src="$PHYSICAL_SRC_DIR/$filename"; dst="$PHYSICAL_DST_DIR/$filename"
  if docker exec "$APP" test -e "$dst"; then
    echo "  = موجود ومطابق، تخطٍّ: $dst"; continue
  fi
  docker exec "$APP" sh -c "
    set -e
    mkdir -p '$PHYSICAL_DST_DIR' && chmod 0750 '$PHYSICAL_DST_DIR'
    cp '$src' '$dst'
    chmod 0640 '$dst'
  " || fail "copy failed: $src → $dst"
  echo "  + نُسخ → $dst"
done

echo "COPY DONE — 4 ملفات فريدة، المصادر سليمة (Copy لا Move). التالي: 03_verify.sh"
