#!/usr/bin/env bash
# 06_download_and_perms_test.sh — Batch 2 (F2) — اختبار التنزيل عبر واجهة التطبيق + عزل الصلاحيات.
# يُشغَّل بعد 04_migrate. يثبت الإصلاح end-to-end عبر HTTP الحقيقي (لا وصول مباشر للقرص).
#
# ⚠️ المساعد لا يستطيع المصادقة على الإنتاج — أنت تُعيد المصادقة وتزوّد جلستين حقيقيتين:
#   AUTH_TOKEN  = جلسة مستخدم مخوّل داخل org 1 له حق قراءة مستندات مشروع 1.
#   OTHER_TOKEN = جلسة مستخدم من مؤسسة أخرى (لإثبات العزل).
# الحجم المرجعي يُؤخذ من الملف الفيزيائي في الوجهة (لأن document_revisions بلا عمود file_size).
# سياسة العزل: يُقبل 403 أو 404 بحسب سياسة النظام الحالية.
set -euo pipefail

BASE="${BASE_URL:?export BASE_URL=https://<host>}"
AUTH="${AUTH_TOKEN:?export AUTH_TOKEN=<authorized org1 user token>}"
OTHER="${OTHER_TOKEN:?export OTHER_TOKEN=<different-org user token>}"
APP="${APP_CONTAINER:?export APP_CONTAINER=<app container>}"
DST_DIR="${DST_DIR:-/app/uploads/1/1/document}"
GEN="${1:-mapping.gen.tsv}"
AUTH_HEADER="${AUTH_HEADER_NAME:-Authorization}"   # عدّله لو النظام يستخدم Cookie بدل Bearer
pass=0

fail(){ echo "DOWNLOAD/PERMS FAIL: $*" >&2; exit 1; }

while IFS=$'\t' read -r tbl id org proj old_url new_url filename; do
  [[ "$filename" =~ ^#|^$ ]] && continue
  echo "── [$tbl #$id] $new_url ──"
  ref=$(docker exec "$APP" stat -c %s "$DST_DIR/$filename")   # الحجم المرجعي من الملف الفعلي

  # (1) مستخدم مخوّل → 200 + الحجم يطابق الملف الفيزيائي
  tmp=$(mktemp)
  code=$(curl -s -o "$tmp" -w '%{http_code}' -H "$AUTH_HEADER: Bearer $AUTH" "$BASE$new_url")
  got=$(stat -c %s "$tmp" 2>/dev/null || echo 0); rm -f "$tmp"
  [[ "$code" == "200" ]] || fail "[$tbl#$id] authorized download HTTP $code (expected 200)"
  [[ "$got" == "$ref" ]] || fail "[$tbl#$id] size mismatch: disk=$ref downloaded=$got"
  echo "  ✓ authorized 200, bytes=$got (== disk)"

  # (2) مستخدم من org مختلفة → مرفوض (403 أو 404) = العزل محفوظ
  ocode=$(curl -s -o /dev/null -w '%{http_code}' -H "$AUTH_HEADER: Bearer $OTHER" "$BASE$new_url")
  [[ "$ocode" == "403" || "$ocode" == "404" ]] || fail "[$tbl#$id] ISOLATION LEAK: cross-org HTTP $ocode (expected 403/404)"
  echo "  ✓ cross-org denied ($ocode)"

  pass=$((pass+1))
done < "$GEN"

[[ "$pass" -eq 7 ]] || fail "$pass/7 records passed"
echo "DOWNLOAD + ISOLATION PASS — 7/7 قابلة للتنزيل بالمستخدم المخوّل، ومرفوضة عبر المؤسسات."
