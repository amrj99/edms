# Sprint B — Production Deployment Runbook

**الإصدار:** 1.3 (Post-Validation Run — Sprint B رُسمياً مغلق)  
**تاريخ الإعداد:** 2026-07-01  
**يُطبَّق على:** VPS الإنتاج — الخدمات: `edms_api` (port 8080)، `edms_postgres` (internal)  
**المدة المتوقعة:** 15-20 دقيقة  

> **ملاحظة v1.2:** تصحيحات Validation Run — Port صحيح 8080، psql user = edms،
> مسار المشروع = `/var/www/edms`، أمر deploy = `docker compose`.
> Migrations تعمل تلقائياً عبر `docker-entrypoint.sh` → لا حاجة لتشغيلها يدوياً.
>
> **ملاحظة v1.3:** تحديثات ما بعد Validation Run:
> · token generation: استخدم `read -s PASS` بدلاً من كتابة كلمة المرور مباشرة
> · لا تستخدم `PATH` كاسم متغير في shell scripts — يُلغي متغير النظام
> · repairStaleBaseline أصلحت `0010_audit_schema` كـ bonus repair (موثَّق في Deployment History)

---

## ما الذي سيُنشر

| المكوّن | التغيير |
|---|---|
| API code | B-1: SQL pagination · B-2: folder projection + security · B-3: correspondence SQL filtering · B-4: scheduler concurrency · B-7: CSV export fix |
| Migration 0017 | 7 indexes على folders, correspondence, recipients, cc, attachments |
| Migration 0018 | 1 index على meetings(organization_id, project_id) |

---

## كيف يعمل الـ Deploy على هذا الـ VPS

```
/var/www/edms/         ← source code مع git
  docker-compose.yml   ← تعريف الـ services
  lib/db/drizzle/      ← ملفات الـ migrations (تُنسخ داخل الـ image)

deploy flow:
  git pull → docker compose build --no-cache api → docker compose up -d --force-recreate api
               ↓
  عند start: docker-entrypoint.sh يشغّل migrate.mjs تلقائياً
             إذا فشل: container يخرج بـ exit 1 (لا يبدأ الـ server)
             إذا نجح: يكمل seed ثم يبدأ الـ server
```

---

## Deployment Checklist

```
□ 1.   Pre-flight: docker ps + health (8080) + disk + git status
□ 2.   Backup: pg_dump جديد محفوظ في /var/backups/edms/ — size > 0
□ 3.   Git pull: آخر commit على main
□ 4.   Build: docker compose build --no-cache api ← بدون أخطاء
□ 5.   Restart: docker compose up -d --force-recreate api
□ 6a.  Migration logs: [entrypoint] Migrations complete. ظهر
□ 6b.  Migration errors: لا أخطاء أو Stack Trace في الـ logs
□ 6c.  Indexes in DB: count = 8 في pg_indexes
□ 7.   Health: GET /api/health → {"status":"ok"}
□ 8r.  Runtime logs: لا UnhandledRejection أو FATAL
□ 9.   Smoke: login → token
□ 10.  Smoke: documents list (B-1) → total + totalPages
□ 11.  Smoke: folders (B-2) → 200 OK
□ 12.  Smoke: correspondence (B-3) → 200 OK
□ 13.  Smoke: scheduler logs (B-4) → لا أخطاء
□ 14.  Smoke: search (B-6) → engine:sql
□ 15.  Smoke: CSV export (B-7) → 7 أعمدة، بدون passwordHash
□ P1.  Perf: documents list < 2s
□ P2.  Perf: correspondence list < 2s
□ P3.  Perf: search < 3s
□ P4.  Perf: audit CSV export < 5s
□ 16.  Post-deployment report: موثَّق
```

---

## قبل البدء — قرأت الـ Runbook كاملاً؟

> **وقف.** لا تبدأ أي خطوة قبل قراءة القسم الكامل أولاً.  
> الـ Rollback Plan موجود في نهاية الوثيقة — اعرفه قبل أن تحتاجه.

---

## الخطوة 1 — Pre-flight Checks

```bash
# 1.1 تحقق أن الخدمات تعمل
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
# المتوقع: edms_api و edms_postgres كلاهما "Up"

# 1.2 تحقق من الـ API
curl -s http://localhost:8080/api/health | python3 -m json.tool
# المتوقع: {"status":"ok","database":"connected",...}

# 1.3 تحقق من مساحة القرص
df -h /
# المطلوب: > 2GB متاحة

# 1.4 git status
cd /var/www/edms && git status
# المتوقع: nothing to commit, working tree clean
# إذا كان هناك uncommitted changes: أوقف وحدد السبب
```

**إذا فشل أي من هذه:** أوقف الـ deployment وحدد السبب قبل المتابعة.

---

## الخطوة 2 — Database Backup

> **قاعدة غير قابلة للاستثناء:** يجب إنشاء backup جديد لكل deployment — حتى لو يوجد backup سابق.  
> لا تعتمد على backup قديم. إذا لم يكتمل الـ backup بنجاح (size > 0)، أوقف الـ deployment.

```bash
# 2.1 مجلد الـ backup موجود مسبقاً: /var/backups/edms/
BACKUP_FILE=/var/backups/edms/pre-deploy-$(date +%Y%m%d_%H%M%S).dump

# 2.2 pg_dump كامل (custom format — يدعم الاستعادة الانتقائية)
docker exec edms_postgres pg_dump \
  -U edms \
  -d edms \
  -F c \
  -f /tmp/pre-deploy.dump

# 2.3 نسخ الملف من الـ container إلى الـ host
docker cp edms_postgres:/tmp/pre-deploy.dump "$BACKUP_FILE"

# 2.4 تحقق من حجم الـ backup — شرط إلزامي قبل المتابعة
ls -lh "$BACKUP_FILE"
# إذا كان 0 bytes أو الأمر فشل: أوقف الـ deployment فوراً

echo "✓ Backup saved: $BACKUP_FILE"
```

---

## الخطوة 3 — Git Update

```bash
cd /var/www/edms

# 3.1 جلب التحديثات
git fetch origin main

# 3.2 تحقق مما سيُطبَّق قبل التطبيق
git log HEAD..origin/main --oneline
# مراجعة الـ commits المتوقعة (Sprint B)

# 3.3 تطبيق التحديثات
git pull origin main

# 3.4 تأكيد
git log --oneline -5
```

---

## الخطوة 4 — Build

```bash
cd /var/www/edms

# 4.1 بناء الـ image الجديدة (تشمل الكود الجديد + migrations الجديدة)
docker compose build --no-cache api

# 4.2 تحقق أن الـ image بُنيت حديثاً
docker images | grep edms-api
# المتوقع: edms-api:latest بتاريخ الآن

# إذا فشل الـ build:
#   → لا تكمل
#   → راجع أخطاء الـ build
#   → الخدمة لا تزال تعمل على القديم — لا حاجة لـ rollback
```

---

## الخطوة 5 — إعادة تشغيل الخدمة

```bash
cd /var/www/edms

# 5.1 استبدال الـ container بالـ image الجديدة
docker compose up -d --force-recreate api

# 5.2 انتظر حتى يصبح جاهزاً (migrations + seeds تأخذ 5-15 ثانية)
sleep 20

# 5.3 تحقق أن الـ container لا يزال يعمل (لم يُعد التشغيل في loop)
docker ps | grep edms_api
# يجب أن يكون Status: "Up X seconds" وليس "Restarting"
```

---

## الخطوة 6 — Migration Verification

> الـ migrations تعمل تلقائياً داخل `docker-entrypoint.sh` — لكن "تشغيل تلقائي" لا يعني "تحقق تلقائي".
> هذه الخطوة تُنفَّذ قبل أي شيء آخر. إذا فشل أي تحقق من التحققات الثلاثة → أوقف الـ deployment فوراً.

### 6.1 — تأكيد وجود رسائل النجاح

```bash
docker logs edms_api 2>&1 | grep -E "\[entrypoint\]"
```

**يجب أن تظهر هذه الأسطر بهذا الترتيب:**
```
[entrypoint] Running database migrations...
[entrypoint] Migrations complete.
[entrypoint] Seeding document types...
[entrypoint] Document type seed complete.
[entrypoint] Seeding default workflow templates...
[entrypoint] Workflow template seed complete.
[entrypoint] Starting API server...
```

| ما تراه | الإجراء |
|---|---|
| `Running database migrations...` + `Migrations complete.` | ✓ تابع للتحقق 6.2 |
| `ERROR: Migration failed — aborting startup` | ✗ أوقف فوراً — راجع الـ Rollback Plan |
| لا `[entrypoint]` logs على الإطلاق | ✗ أوقف — الـ container لم يبدأ صحيح |

### 6.2 — تأكيد غياب أخطاء الـ Migration

```bash
docker logs edms_api 2>&1 | grep -iE "migration.*error|migration.*fail|stack trace|Error:" | head -20
```

**المتوقع: لا output على الإطلاق.**  
أي سطر يظهر هنا → أوقف الـ deployment وراجع كامل الـ logs:
```bash
docker logs edms_api 2>&1 | head -60
```

### 6.3 — تأكيد وجود الـ Indexes في قاعدة البيانات

> هذا التحقق مستقل عن رسائل الـ logs — يتحقق من الأثر الفعلي في `pg_indexes`.

```bash
docker exec edms_postgres psql -U edms -d edms -t -c "
SELECT count(*)
FROM pg_indexes
WHERE indexname IN (
  'idx_folders_project_id',
  'idx_correspondence_org_project_updated',
  'idx_corr_recipients_corr_id',
  'idx_corr_recipients_user_id',
  'idx_corr_cc_corr_id',
  'idx_corr_cc_user_id',
  'idx_corr_attachments_corr_id',
  'idx_meetings_org_project'
);"
```

**المتوقع: `8`**

إذا كانت النتيجة أقل من 8، تعرّف على الـ indexes الناقصة:
```bash
docker exec edms_postgres psql -U edms -d edms -c "
SELECT indexname, tablename
FROM pg_indexes
WHERE indexname IN (
  'idx_folders_project_id',
  'idx_correspondence_org_project_updated',
  'idx_corr_recipients_corr_id',
  'idx_corr_recipients_user_id',
  'idx_corr_cc_corr_id',
  'idx_corr_cc_user_id',
  'idx_corr_attachments_corr_id',
  'idx_meetings_org_project'
)
ORDER BY tablename, indexname;"
```

ثم أوقف الـ deployment وراجع الـ migration logs كاملاً.

---

## الخطوة 7 — Health Check

```bash
curl -s http://localhost:8080/api/health | python3 -m json.tool
# المتوقع: {"status":"ok","database":"connected",...}
# إذا لم يرد: انتظر 10 ثواني إضافية وأعد المحاولة مرة واحدة فقط
```

---

## الخطوة 8 — Runtime Log Analysis

```bash
# الأخطاء الحرجة — أي نتيجة هنا تستوجب التوقف
echo "=== CRITICAL ERRORS ==="
docker logs edms_api --since 5m 2>&1 | grep -iE \
  "unhandledrejection|uncaughtexception|FATAL|Cannot find module|SyntaxError|ReferenceError" \
  | head -20

# Promise rejections
echo "=== PROMISE REJECTIONS ==="
docker logs edms_api --since 5m 2>&1 | grep -iE \
  "UnhandledPromiseRejection|PromiseRejectionHandledWarning" \
  | head -20

# Warnings
echo "=== WARNINGS (review manually) ==="
docker logs edms_api --since 5m 2>&1 | grep -iE "warn" | head -20
```

| ما تراه | التقييم |
|---|---|
| `[search] ELASTICSEARCH_URL not set — using SQL fallback` | ✓ متوقع |
| `[sentry] SENTRY_DSN not set` | ✓ متوقع |
| `UnhandledPromiseRejection` | ✗ أوقف — راجع الـ Rollback Plan |
| `Cannot find module` | ✗ أوقف — Build ناقص |
| `FATAL` / `SyntaxError` | ✗ أوقف — راجع الـ Rollback Plan |
| Warning لا تعرف مصدره | ⚠ وثّقه في تقرير ما بعد النشر |

---

## الخطوة 9 — Smoke Tests

**احصل على token أولاً (بدون كتابة كلمة المرور في الـ terminal history):**

```bash
# 1. اقرأ كلمة المرور بدون echo — اكتبها ثم اضغط Enter
read -s PASS

# 2. تسجيل الدخول والحصول على الـ token
TOKEN=$(curl -s -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"<ADMIN_EMAIL>\",\"password\":\"$PASS\"}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])") && unset PASS

echo "Token: ${TOKEN:0:30}..."
# إذا كان فارغاً أو ظهر KeyError: الـ login فشل — تحقق من الـ email وأعد المحاولة
```

> **تحذير:** لا تستخدم `read -s` ثم تضغط `Ctrl+C` — سيُفرِّغ `$PASS` ويُفشِل الـ login.  
> **الحساب المقترح:** `amr_j_98@hotmail.com` (system_owner) — أعلى صلاحية لتغطية جميع الـ endpoints.

### 9.1 Health

```bash
curl -s http://localhost:8080/api/health
```

### 9.2 Documents List — B-1 (SQL pagination)

```bash
curl -s "http://localhost:8080/api/documents?page=1&limit=20" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "
import sys, json
r = json.load(sys.stdin)
print('total:', r.get('total'))
print('page:', r.get('page'))
print('totalPages:', r.get('totalPages'))
print('docs count:', len(r.get('documents', [])))
# المتوقع: total و totalPages موجودان (دليل على SQL pagination)
"
```

### 9.3 Folders — B-2

```bash
# استبدل PROJECT_ID بمشروع حقيقي
curl -s "http://localhost:8080/api/projects/<PROJECT_ID>/documents/folders" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "
import sys, json
r = json.load(sys.stdin)
folders = r if isinstance(r, list) else r.get('folders', [])
print('folders count:', len(folders))
if folders:
    print('first folder keys:', list(folders[0].keys()))
"
```

### 9.4 Correspondence List — B-3

```bash
curl -s "http://localhost:8080/api/correspondence?page=1&limit=10" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "
import sys, json
r = json.load(sys.stdin)
print('total:', r.get('total', r.get('count', '?')))
print('status: OK')
"
```

### 9.5 Notification Scheduler — B-4

```bash
docker logs edms_api --since 10m 2>&1 | grep -E "\[scheduler\]" | tail -10
# لا يجب أن يظهر: "failed" أو "error"
```

### 9.6 Search — B-6 (SQL fallback)

```bash
curl -s "http://localhost:8080/api/search?q=test" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "
import sys, json
r = json.load(sys.stdin)
print('engine:', r.get('engine'))
print('total:', r.get('total'))
# المتوقع: engine = 'sql'
"
```

### 9.7 Audit CSV Export — B-7 (column projection fix)

```bash
# 9.7.1 تنزيل الـ CSV
curl -s "http://localhost:8080/api/audit-logs/export" \
  -H "Authorization: Bearer $TOKEN" \
  -o /tmp/audit-check.csv

# 9.7.2 تحقق من الـ headers — يجب أن يكون 7 أعمدة بالضبط
head -1 /tmp/audit-check.csv
# المتوقع: "ID","Date/Time","User","Action","Entity Type","Entity Title","Project ID"

# 9.7.3 تأكد أن passwordHash غير موجود
grep -i "password\|hash\|token\|mustChange" /tmp/audit-check.csv && \
  echo "FAIL: sensitive field found" || echo "PASS: no sensitive fields"

# 9.7.4 تحقق من Cache-Control header
curl -sI "http://localhost:8080/api/audit-logs/export" \
  -H "Authorization: Bearer $TOKEN" \
  | grep -i cache-control
# المتوقع: cache-control: no-store

# 9.7.5 تنظيف
rm /tmp/audit-check.csv
```

---

## الخطوة 10 — Performance Verification

```bash
perf_check() {
  local label="$1"
  local url="$2"
  local threshold="$3"

  result=$(curl -s -w "%{time_total} %{http_code}" -o /dev/null \
    -H "Authorization: Bearer $TOKEN" "$url")
  time_s=$(echo $result | awk '{print $1}')
  code=$(echo $result | awk '{print $2}')
  threshold_ms=$(echo "$threshold * 1000" | awk '{printf "%d", $1}')
  time_ms=$(echo "$time_s * 1000" | awk '{printf "%d", $1}')
  status="PASS"
  [ "$time_ms" -gt "$threshold_ms" ] && status="SLOW — راجع"

  printf "%-40s HTTP %-3s  %.2fs  [%s]\n" "$label" "$code" "$time_s" "$status"
}

echo "=== Sprint B — Performance Spot Check ==="
echo ""

perf_check "Documents list (B-1)" \
  "http://localhost:8080/api/documents?page=1&limit=20" 2.0

perf_check "Folders list (B-2)" \
  "http://localhost:8080/api/projects/<PROJECT_ID>/documents/folders" 2.0

perf_check "Correspondence list (B-3)" \
  "http://localhost:8080/api/correspondence?page=1&limit=20" 2.0

perf_check "Search SQL fallback (B-6)" \
  "http://localhost:8080/api/search?q=test" 3.0

perf_check "Audit CSV export (B-7)" \
  "http://localhost:8080/api/audit-logs/export" 5.0

echo ""
echo "Thresholds: docs/folders/corr < 2s | search < 3s | CSV export < 5s"
```

| النتيجة | الإجراء |
|---|---|
| كل القياسات `[PASS]` | ✓ متابعة |
| endpoint واحد `[SLOW]` لكن لا timeout | ⚠ وثّق في التقرير — راجع لاحقاً |
| timeout كامل (curl > 30s) | ✗ أوقف — راجع الـ Rollback Plan |
| HTTP 500 أو 403 | ✗ أوقف — راجع smoke test المقابل |

---

## الخطوة 11 — Post-Deployment Verification Report

```
== Sprint B — Post-Deployment Verification Report ==

التاريخ/الوقت: _______________
المنفذ:        _______________
git commit:    _______________

── Deploy ──────────────────────────────────
  git pull                □ نجح
  docker compose build    □ نجح (بدون أخطاء)
  docker compose up       □ نجح (container يعمل)

── Migration Verification (6a / 6b / 6c) ──
  6a. Migrations complete.   □ ظهر في logs
  6b. Migration errors       □ لا يوجد
  6c. Indexes count in DB    □ 8/8

── Indexes (8/8 detail) ────────────────────
  idx_folders_project_id                 □ موجود
  idx_correspondence_org_project_updated □ موجود
  idx_corr_recipients_corr_id            □ موجود
  idx_corr_recipients_user_id            □ موجود
  idx_corr_cc_corr_id                    □ موجود
  idx_corr_cc_user_id                    □ موجود
  idx_corr_attachments_corr_id           □ موجود
  idx_meetings_org_project               □ موجود

── Runtime Logs ────────────────────────────
  UnhandledRejection      □ لا يوجد
  FATAL / SyntaxError     □ لا يوجد
  Cannot find module      □ لا يوجد
  Warnings غير متوقعة    □ لا يوجد  / □ موثَّقة أدناه

── Smoke Tests ─────────────────────────────
  Health (8080)           □ 200 OK
  Login                   □ token صالح
  Documents list (B-1)    □ total + totalPages موجودان
  Folders (B-2)           □ 200 OK
  Correspondence (B-3)    □ 200 OK
  Scheduler logs (B-4)    □ لا أخطاء
  Search (B-6)            □ engine:sql
  CSV columns (B-7)       □ 7 أعمدة فقط
  CSV no sensitive (B-7)  □ لا passwordHash
  Cache-Control (B-7)     □ no-store

── Performance ─────────────────────────────
  Documents list          □ ___s  (< 2s)
  Folders list            □ ___s  (< 2s)
  Correspondence list     □ ___s  (< 2s)
  Search                  □ ___s  (< 3s)
  Audit CSV export        □ ___s  (< 5s)

── النتيجة النهائية ────────────────────────
  □ PASS — Sprint B مغلق رسمياً
  □ FAIL — انظر Rollback Plan

ملاحظات / warnings موثَّقة:
_______________________________________________
```

---

## Rollback Plan

### متى تُطبَّق الـ Rollback؟

| الحالة | الإجراء |
|---|---|
| Build فشل (الخطوة 4) | لا حاجة لـ rollback — الخدمة لم تتغير |
| Migration فشلت (الخطوة 5e) | → Rollback A فوراً |
| Container يُعيد التشغيل في loop | → Rollback A فوراً |
| Smoke test حرج فشل (الخطوة 9) | → Rollback A + B إذا لزم |

### Rollback A — رجوع إلى الكود السابق

```bash
cd /var/www/edms

# 1. رجوع إلى الـ commit السابق
git log --oneline -5    # حدد الـ commit السابق
git checkout <PREVIOUS_COMMIT_HASH>

# 2. إعادة البناء والتشغيل
docker compose build --no-cache api
docker compose up -d --force-recreate api

# 3. تحقق
sleep 15
curl -s http://localhost:8080/api/health
docker logs edms_api 2>&1 | grep "\[entrypoint\]"
```

> **ملاحظة:** الـ indexes (0017, 0018) آمنة وتبقى — لا داعي لحذفها عند rollback الكود.  
> هي `IF NOT EXISTS` وتشغيلها مجدداً آمن تماماً.

### Rollback B — استعادة قاعدة البيانات (حالات طارئة فقط)

```bash
# لا تُنفَّذ إلا إذا كانت هناك data corruption موثَّقة

BACKUP_FILE=/var/backups/edms/pre-sprint-b-<TIMESTAMP>.dump

# 1. إيقاف الـ API أولاً
docker compose stop api

# 2. نسخ الـ backup إلى داخل الـ container
docker cp "$BACKUP_FILE" edms_postgres:/tmp/restore.dump

# 3. استعادة
docker exec edms_postgres pg_restore \
  -U edms -d edms --clean /tmp/restore.dump

# 4. إعادة تشغيل الـ API
docker compose start api

# 5. تحقق
curl -s http://localhost:8080/api/health
```

---

## ملاحظات مهمة

- **`ELASTICSEARCH_URL` غير مضبوط في الإنتاج:** البحث يعمل على SQL fallback. `engine:sql` هو السلوك الصحيح.
- **Migrations تلقائية:** لا تُشغّل الـ migrations يدوياً عبر psql — الـ entrypoint يتعامل معها.
- **لا بيانات إنتاج تُلمس:** الـ migrations تضيف indexes فقط — لا تعديل على بيانات موجودة.
- **المستخدمون التجريبيون:** `dc@contractor.local` وغيرهم يجب أن يكونوا غير موجودين في الإنتاج.
- **JWT_SECRET:** استخدم secret الإنتاج فقط — لا `dev-jwt-secret-not-for-production`.

---

## Deployment History

| Date | Version | Commit | Deployed By | Result | Rollback | Notes |
|------|---------|--------|-------------|--------|----------|-------|
| 2026-07-01 | Sprint A Security + Sprint B Performance | `7059f90` | amr_j_98@hotmail.com | ✅ PASS | N/A | First production deployment. Migration baseline bug found+fixed (repairStaleBaseline). 0010_audit_schema indexes repaired as bonus. All 8 Sprint B indexes applied. Smoke Tests 6/6 ✅. Perf: docs=0.082s, folders=0.008s, corr=0.010s, search=0.014s, csv=0.024s — جميعها ضمن الحد. |

*أضف صفاً جديداً بعد كل عملية نشر ناجحة أو فاشلة.*

---

## Validation Run Findings (2026-07-01)

> هذا القسم يوثّق ما اكتُشف خلال أول Production Validation Run — مرجع لفهم السلوك والقرارات.

### المشكلة 1 — Migration Baseline Bug

**الجذر:** `ensureBaseline()` تُسجّل جميع entries الـ journal (بما فيها migrations جديدة لم تُنفَّذ بعد) كـ "applied" في أول تشغيل على قاعدة بيانات قديمة.

**الأثر:** الـ migrations الجديدة (0017, 0018) لم تُطبَّق رغم بناء الـ image.

**الحل:** دالة `repairStaleBaseline()` في `migrate.ts` — تفحص CREATE INDEX migrations وتحذف tracking entries للـ indexes الغائبة، مما يسمح لـ Drizzle بإعادة تطبيقها.

**الملاحظة:** نفس الـ repair أصلحت `0010_audit_schema` (audit_logs indexes كانت غائبة من baseline) — هذا سلوك متوقع ومرغوب.

### المشكلة 2 — Migration Journal Timestamps

**الجذر:** timestamps لـ 0017 و 0018 في `_journal.json` كانت قبل timestamp لـ 0016 (يوليو 2025 vs مايو 2026)، مما يجعل Drizzle يتجاهلها.

**الحل:** تحديث timestamps بحيث 0017 (1782979200000) و 0018 (1782982800000) يأتيان بعد 0016 (1782777601000).

### تحذير PATH

**الجذر:** استخدام `PATH` كاسم متغير في shell script يُلغي متغير النظام `$PATH`.

**القاعدة:** لا تستخدم `PATH` كاسم متغير في أي script — استخدم `ENDPOINT` أو `URL` أو `API_PATH` بدلاً منه.

---

*آخر تحديث: 2026-07-01 — الإصدار 1.3 (Sprint B مغلق رسمياً)*
