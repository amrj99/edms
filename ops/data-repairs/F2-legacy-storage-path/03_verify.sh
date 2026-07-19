#!/usr/bin/env bash
# 03_verify.sh — Batch 2 (F2) — التحقق بالحجم + sha256 للملفات الأربعة الفريدة قبل لمس DB.
# بوّابة صارمة: لا يجوز تشغيل 04_migrate.sql إلا بعد نجاح هذا 4/4.
# (طلب المالك: لا يُحدَّث DB قبل نجاح التحقق للأربعة ملفات كلها.)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/config.sh"

APP="${APP_CONTAINER:?export APP_CONTAINER=<app container>}"
APP_UID="${APP_UID:-node}"                 # المستخدم الذي يقرأ به التطبيق الملفات
GEN="${1:-mapping.gen.tsv}"
declare -A done_file
ok=0

fail(){ echo "VERIFY FAIL: $*" >&2; exit 1; }

while IFS=$'\t' read -r tbl id org proj old_url new_url filename; do
  [[ "$filename" =~ ^#|^$ ]] && continue
  [[ -n "${done_file[$filename]:-}" ]] && continue
  done_file[$filename]=1
  src="$PHYSICAL_SRC_DIR/$filename"; dst="$PHYSICAL_DST_DIR/$filename"

  ss=$(docker exec "$APP" stat -c %s "$src"); ds=$(docker exec "$APP" stat -c %s "$dst")
  [[ "$ss" == "$ds" ]] || fail "size mismatch [$filename]: src=$ss dst=$ds"

  sh=$(docker exec "$APP" sha256sum "$src" | awk '{print $1}')
  dh=$(docker exec "$APP" sha256sum "$dst" | awk '{print $1}')
  [[ "$sh" == "$dh" ]] || fail "sha256 mismatch [$filename]"

  # مقارنة بايتات مباشرة بعد الحجم+sha256 (رخيصة، تأكيد نهائي مستقل عن الهاش)
  docker exec "$APP" cmp -s "$src" "$dst" || fail "cmp byte mismatch [$filename]: $src vs $dst"

  docker exec -u "$APP_UID" "$APP" test -r "$dst" || fail "dst not readable by app uid [$filename]: $dst"

  echo "  OK [$filename] size=$ds sha256=${dh:0:12}… cmp=identical"
  ok=$((ok+1))
done < "$GEN"

[[ "$ok" -eq 4 ]] || fail "verified $ok/4 unique files"
echo "VERIFY PASS — 4/4 (size + sha256 + app-readable). الآن فقط يجوز 04_migrate.sql."
