#!/usr/bin/env bash
# 00_dry_run.sh — Batch 2 (F2) — تشغيل جاف كامل. لا Copy، لا Verify، لا Migration، لا حذف.
# يفعل فقط: الجرد الحيّ + Preflight (فحوص القراءة + توليد mapping/pre-image) + تقرير نهائي.
# آمن للتشغيل المتكرر. الغرض: مراجعة ما سيحدث قبل أي تنفيذ فعلي.
set -euo pipefail

APP="${APP_CONTAINER:?export APP_CONTAINER=<app container>}"
DB="${DB_CONTAINER:?export DB_CONTAINER=<db container>}"
SRC_DIR="${SRC_DIR:-/app/uploads/1/0/document}"
DST_DIR="${DST_DIR:-/app/uploads/1/1/document}"
MANUAL_MAP="${1:-}"
REPORT="dry_run_report.txt"

echo "════════════════════════════════════════════════════════════"
echo " F2 Batch 2 — DRY RUN (قراءة فقط؛ لا نسخ/تحقق/ترحيل/حذف)"
echo "════════════════════════════════════════════════════════════"

# 01_preflight يقوم بالجرد + التوليد + الفحوص الفيزيائية + pre-image (كله قراءة/التقاط فقط).
# نمرّر الملف اليدوي إن وُجد ليقارَن بالجرد الحيّ.
bash 01_preflight.sh ${MANUAL_MAP:+"$MANUAL_MAP"}

echo ""
echo "── تقرير الـDry Run ──" | tee "$REPORT"
{
  echo "التاريخ: $(date 2>/dev/null || echo n/a)"
  echo "app_container=$APP  db_container=$DB"
  echo "src_dir=$SRC_DIR  dst_dir=$DST_DIR"
  echo ""
  echo "الصفوف المكتشَفة (mapping.gen.tsv): $(wc -l < mapping.gen.tsv | tr -d ' ')  (متوقّع 7)"
  echo "الأعمدة: tbl id org project old_url new_url filename"
  echo "----------------------------------------------------------------"
  column -t -s $'\t' mapping.gen.tsv 2>/dev/null || cat mapping.gen.tsv
  echo "----------------------------------------------------------------"
  echo "توزّع الجداول:"
  cut -f1 mapping.gen.tsv | sort | uniq -c
  echo ""
  echo "أسماء الملفات الفريدة (متوقّع 4):"
  cut -f7 mapping.gen.tsv | sort -u | sed 's/^/  - /'
  echo ""
  echo "ماذا سيحدث عند التنفيذ الفعلي (لن يحدث الآن):"
  echo "  • 02_copy    : نسخ 4 ملفات $SRC_DIR → $DST_DIR (Copy لا Move)"
  echo "  • 03_verify  : size + sha256 + cmp + قابلية القراءة"
  echo "  • 04_migrate : UPDATE 7 صفوف (معاملة واحدة، fail-closed، per-table+total)"
  echo "  • 06_download: تنزيل عبر التطبيق + عزل cross-org"
  echo ""
  echo "المخرجات المكتوبة الآن (قراءة/التقاط فقط، بلا تغيير بيانات):"
  echo "  - mapping.gen.tsv / mapping.mig.tsv / preimage.tsv"
} | tee -a "$REPORT"

echo ""
echo "DRY RUN PASS — لا شيء نُسخ أو حُدِّث. راجع $REPORT ثم ابدأ التنفيذ خطوة بخطوة بإذنك."
