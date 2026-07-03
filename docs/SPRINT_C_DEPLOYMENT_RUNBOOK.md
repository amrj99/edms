# Sprint C — Production Deployment Runbook

**الإصدار:** 1.0  
**تاريخ الإعداد:** 2026-07-02  
**يُطبَّق على:** VPS الإنتاج — الخدمات: `edms_api` (port 8080)، `edms_postgres` (internal)  
**المدة المتوقعة:** 20-25 دقيقة  

> **تحذير:** endpoint الـ health تغيّر شكله في Sprint C (C-3).  
> الـ response القديم `{"status":"ok","database":"connected"}` لم يعد صحيحاً.  
> راجع الخطوة 7 لشكل الـ response الجديد قبل تنفيذ أي تحقق.

---

## ما الذي سيُنشر

| Sprint | التغيير |
|---|---|
| C-1 | scripts جديدة: `backup-files.sh` (R2 sync) + تعديل `backup.sh` + `restore-verify.sh` |
| C-2 | خدمة `storage-quota.ts` — تحديث `storage_used_mb` عند رفع/حذف ملف |
| C-3 | إعادة كتابة `GET /api/health` — shape جديد مع فحوصات disk/uploads/database |
| C-4 | عمود `sha256 TEXT` في `document_files` (Migration 0019) — hash يُحسب عند كل رفع |
| C-5 | Input Validation — `parseBody()` middleware + Zod schemas على users/documents/correspondence |

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
□ 6c.  sha256 column: موجود في document_files (information_schema)
□ 7.   Health: GET /api/health → status=ok، disk/uploads/database موجودان
□ 8.   Runtime logs: لا UnhandledRejection أو FATAL
□ 9.   Login: token صالح
□ C-1. Smoke: backup-files.sh موجود + يُنفَّذ بنجاح
□ C-2. Smoke: storage_used_mb يُحدَّث بعد رفع ملف
□ C-3. Smoke: /api/health — shape جديد مع usedPercent + latencyMs
□ C-4. Smoke: رفع ملف → sha256 في الـ response (64 حرف hex)
□ C-5. Smoke: POST /api/users بـ email ناقص → 400 VALIDATION_ERROR + fields.email
□ C-5. Smoke: POST /api/users بـ role=system_owner → 400 VALIDATION_ERROR + fields.role
□ P1.  Perf: documents list < 2s
□ P2.  Perf: correspondence list < 2s
□ P3.  Perf: health endpoint < 1s
□ 10.  Post-deployment report: موثَّق
□ 11.  Post-deploy task: cron لـ backup-files.sh مُضاف
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

# 1.2 تحقق من الـ API (الـ health القديم — قبل الـ deploy)
curl -s http://localhost:8080/api/health | python3 -m json.tool
# ملاحظة: قبل الـ deploy سيظهر الشكل القديم — هذا متوقع

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
# مراجعة الـ commits المتوقعة (Sprint C-1 إلى C-5)

# 3.3 تطبيق التحديثات
git pull origin main

# 3.4 تأكيد
git log --oneline -5
```

---

## الخطوة 4 — Build

```bash
cd /var/www/edms

# 4.1 بناء الـ image الجديدة (تشمل الكود الجديد + migration 0019)
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

### 6.3 — تأكيد وجود عمود sha256 في قاعدة البيانات

> Migration 0019 يُضيف عموداً واحداً فقط: `sha256 TEXT` على `document_files`.  
> هذا التحقق يؤكد الأثر الفعلي في قاعدة البيانات بشكل مستقل عن رسائل الـ logs.

```bash
docker exec edms_postgres psql -U edms -d edms -t -c "
SELECT column_name, is_nullable, data_type
FROM information_schema.columns
WHERE table_name = 'document_files'
  AND column_name = 'sha256';"
```

**المتوقع: صف واحد — `sha256 | YES | text`**

```
 sha256 | YES | text
```

إذا لم يظهر أي صف:
```bash
# تحقق من أن الـ migration ظهر في تاريخ الـ migrations
docker exec edms_postgres psql -U edms -d edms -c "
SELECT tag, applied_at
FROM drizzle.__drizzle_migrations
ORDER BY applied_at DESC
LIMIT 5;"
```

ثم أوقف الـ deployment وراجع الـ migration logs كاملاً.

---

## الخطوة 7 — Health Check

> **تغيير مهم في Sprint C:** الـ health endpoint الآن يُعيد shape جديداً مختلفاً كلياً عن Sprint B.  
> HTTP 200 = ok أو warn. HTTP 503 = critical أو error.

```bash
curl -s http://localhost:8080/api/health | python3 -m json.tool
```

**الشكل الجديد المتوقع:**
```json
{
  "status": "ok",
  "timestamp": "2026-07-02T...",
  "uptime": 45,
  "version": "1.0.0",
  "environment": "production",
  "database": {
    "status": "ok",
    "latencyMs": 3
  },
  "disk": {
    "status": "ok",
    "path": "/",
    "usedPercent": 42,
    "availableGb": 87.5,
    "totalGb": 150.0
  },
  "uploads": {
    "status": "ok",
    "path": "/app/uploads",
    "usedPercent": 15,
    "availableGb": 127.3,
    "totalGb": 150.0
  }
}
```

**للتحقق البرمجي:**
```bash
curl -s http://localhost:8080/api/health | python3 -c "
import sys, json
r = json.load(sys.stdin)
print('status:', r.get('status'))
print('database.status:', r.get('database', {}).get('status'))
print('database.latencyMs:', r.get('database', {}).get('latencyMs'), 'ms')
print('disk.usedPercent:', r.get('disk', {}).get('usedPercent'), '%')
print('uploads.usedPercent:', r.get('uploads', {}).get('usedPercent'), '%')

assert r.get('status') in ('ok', 'warn'), 'FAIL: status is critical or error'
assert 'database' in r, 'FAIL: database key missing'
assert 'disk' in r, 'FAIL: disk key missing'
assert 'uploads' in r, 'FAIL: uploads key missing'
print('✓ Health shape verified')
"
# إذا لم يرد: انتظر 10 ثواني إضافية وأعد المحاولة مرة واحدة فقط
```

| status | HTTP code | الإجراء |
|---|---|---|
| `ok` | 200 | ✓ تابع |
| `warn` | 200 | ⚠ تابع — وثّق في التقرير (disk أو uploads > 75%) |
| `critical` | 503 | ✗ أوقف — disk > 90% أو database error |
| `error` | 503 | ✗ أوقف — راجع الـ Rollback Plan |

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
| `[backup-files] NOTE: FILES_HEALTHCHECK_URL not set.` | ✓ متوقع (يظهر فقط إذا شُغّل backup) |
| `UnhandledPromiseRejection` | ✗ أوقف — راجع الـ Rollback Plan |
| `Cannot find module` | ✗ أوقف — Build ناقص |
| `FATAL` / `SyntaxError` | ✗ أوقف — راجع الـ Rollback Plan |
| Warning لا تعرف مصدره | ⚠ وثّقه في تقرير ما بعد النشر |

---

## الخطوة 9 — Login (الحصول على Token)

**احصل على token أولاً (بدون كتابة كلمة المرور في الـ terminal history):**

```bash
# 1. اقرأ كلمة المرور بدون echo — اكتبها ثم اضغط Enter
read -s PASS

# 2. تسجيل الدخول والحصول على الـ token
TOKEN=$(curl -s -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"amr_j_98@hotmail.com\",\"password\":\"$PASS\"}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])") && unset PASS

echo "Token: ${TOKEN:0:30}..."
# إذا كان فارغاً أو ظهر KeyError: الـ login فشل — تحقق من الـ email وأعد المحاولة
```

> **تحذير:** لا تستخدم `read -s` ثم تضغط `Ctrl+C` — سيُفرِّغ `$PASS` ويُفشِل الـ login.

---

## الخطوة 10 — Smoke Tests

### 10.C1 — File Backup Scripts (C-1)

```bash
# 10.C1.1 تأكد أن السكريبتات موجودة بعد الـ git pull
ls -lh /var/www/edms/scripts/backup-files.sh \
        /var/www/edms/scripts/backup.sh \
        /var/www/edms/scripts/restore-verify.sh
# المتوقع: الملفات الثلاثة موجودة وحجمها > 0

# 10.C1.2 تأكد أن backup-files.sh قابل للتنفيذ
chmod +x /var/www/edms/scripts/backup-files.sh
bash /var/www/edms/scripts/backup-files.sh
# إذا كانت R2 credentials مضبوطة في .env: سيُجري sync فعلي
# إذا لم تكن مضبوطة: exit 1 مع رسالة FATAL واضحة — أضف credentials في .env
# إذا لم يوجد uploads directory: exit 0 مع رسالة SKIP — هذا متوقع لبيئة فارغة
```

### 10.C2 — Storage Quota (C-2)

```bash
# 10.C2.1 تحقق من قيمة storage_used_mb الحالية
docker exec edms_postgres psql -U edms -d edms -t -c "
SELECT id, name, storage_used_mb
FROM organizations
ORDER BY id
LIMIT 5;"
# المتوقع: صفوف بقيم storage_used_mb (رقم أو 0) — عمود موجود = C-2 مُطبَّق

# 10.C2.2 (اختياري — إذا وجد مشروع وملف اختبار)
# ارفع ملفاً عبر الـ API ثم أعد الاستعلام للتأكد أن القيمة تزداد
```

### 10.C3 — Health Endpoint Shape (C-3)

```bash
# 10.C3 تحقق أن الـ shape الجديد موجود (هذا مكرر من الخطوة 7 — تأكيد للإكمال)
curl -s http://localhost:8080/api/health | python3 -c "
import sys, json
r = json.load(sys.stdin)
checks = [
  ('status', r.get('status') in ('ok','warn','critical','error')),
  ('database.latencyMs', 'latencyMs' in r.get('database',{})),
  ('disk.usedPercent', 'usedPercent' in r.get('disk',{})),
  ('uploads.usedPercent', 'usedPercent' in r.get('uploads',{})),
]
for name, ok in checks:
  print(f'  [{\"PASS\" if ok else \"FAIL\"}] {name}')
"
```

### 10.C4 — Content Hash on Upload (C-4)

> يتطلب مشروعاً وثيقة حقيقية في الإنتاج. استبدل `<PROJECT_ID>` و`<DOCUMENT_ID>` بقيم حقيقية.

```bash
# 10.C4.1 رفع ملف اختبار وفحص الـ sha256 في الـ response
curl -s -X POST \
  "http://localhost:8080/api/projects/<PROJECT_ID>/documents/<DOCUMENT_ID>/files" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/var/www/edms/scripts/backup-files.sh" \
  | python3 -c "
import sys, json
r = json.load(sys.stdin)
print('response keys:', list(r.keys()))
sha = r.get('sha256') or (r.get('file') or {}).get('sha256')
print('sha256:', sha)
if sha and len(sha) == 64:
  print('✓ sha256 is 64-char hex — PASS')
else:
  print('FAIL: sha256 missing or wrong length')
"

# 10.C4.2 تأكيد من قاعدة البيانات
# (استخدم file ID الذي ظهر في الـ response)
docker exec edms_postgres psql -U edms -d edms -t -c "
SELECT id, filename, sha256
FROM document_files
ORDER BY created_at DESC
LIMIT 3;"
# المتوقع: عمود sha256 موجود، الملف المرفوع حديثاً له sha256 من 64 حرف
```

### 10.C5 — Input Validation (C-5)

> هذه الاختبارات آمنة تماماً على الإنتاج — الـ validation يحدث قبل أي عملية DB.  
> لا توجد بيانات تُكتب عند إرسال input خاطئ.

```bash
# 10.C5.1 POST /api/users بدون email → يجب أن يُعيد 400 VALIDATION_ERROR
curl -s -X POST http://localhost:8080/api/users \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"firstName":"Test","lastName":"User","role":"member"}' \
  | python3 -c "
import sys, json
r = json.load(sys.stdin)
print('status:', r.get('error'))
print('fields:', r.get('fields'))
assert r.get('error') == 'VALIDATION_ERROR', f'FAIL: got {r}'
assert 'email' in r.get('fields', {}), f'FAIL: fields.email missing — got {r}'
print('✓ Missing email → VALIDATION_ERROR — PASS')
"

# 10.C5.2 POST /api/users بـ role=system_owner → يجب أن يُعيد 400 VALIDATION_ERROR
curl -s -X POST http://localhost:8080/api/users \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"blocked@example.com","firstName":"T","lastName":"U","role":"system_owner"}' \
  | python3 -c "
import sys, json
r = json.load(sys.stdin)
print('status:', r.get('error'))
print('fields:', r.get('fields'))
assert r.get('error') == 'VALIDATION_ERROR', f'FAIL: got {r}'
assert 'role' in r.get('fields', {}), f'FAIL: fields.role missing — got {r}'
print('✓ role=system_owner → VALIDATION_ERROR — PASS')
"

# 10.C5.3 POST /api/correspondence بدون subject → يجب أن يُعيد 400 VALIDATION_ERROR
curl -s -X POST http://localhost:8080/api/correspondence \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"letter"}' \
  | python3 -c "
import sys, json
r = json.load(sys.stdin)
print('status:', r.get('error'))
print('fields:', r.get('fields'))
assert r.get('error') == 'VALIDATION_ERROR', f'FAIL: got {r}'
assert 'subject' in r.get('fields', {}), f'FAIL: fields.subject missing — got {r}'
print('✓ Missing subject → VALIDATION_ERROR — PASS')
"

# 10.C5.4 POST /api/projects/:id/documents بدون title → VALIDATION_ERROR
# (projectId يمكن أن يكون أي رقم — validation يحدث قبل DB lookup)
curl -s -X POST http://localhost:8080/api/projects/1/documents \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"description":"desc only, no title"}' \
  | python3 -c "
import sys, json
r = json.load(sys.stdin)
print('status:', r.get('error'))
print('fields:', r.get('fields'))
assert r.get('error') == 'VALIDATION_ERROR', f'FAIL: got {r}'
assert 'title' in r.get('fields', {}), f'FAIL: fields.title missing — got {r}'
print('✓ Missing title → VALIDATION_ERROR — PASS')
"
```

---

## الخطوة 11 — Performance Verification

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

echo "=== Sprint C — Performance Spot Check ==="
echo ""

perf_check "Health endpoint (C-3)" \
  "http://localhost:8080/api/health" 1.0

perf_check "Documents list" \
  "http://localhost:8080/api/documents?page=1&limit=20" 2.0

perf_check "Correspondence list" \
  "http://localhost:8080/api/correspondence?page=1&limit=20" 2.0

echo ""
echo "Thresholds: health < 1s | docs/corr < 2s"
```

| النتيجة | الإجراء |
|---|---|
| كل القياسات `[PASS]` | ✓ متابعة |
| endpoint واحد `[SLOW]` لكن لا timeout | ⚠ وثّق في التقرير — راجع لاحقاً |
| timeout كامل (curl > 30s) | ✗ أوقف — راجع الـ Rollback Plan |
| HTTP 503 على health | ✗ تحقق من disk space أو database |

---

## الخطوة 12 — Post-Deployment Verification Report

```
== Sprint C — Post-Deployment Verification Report ==

التاريخ/الوقت: _______________
المنفذ:        _______________
git commit:    _______________

── Deploy ──────────────────────────────────
  git pull                □ نجح
  docker compose build    □ نجح (بدون أخطاء)
  docker compose up       □ نجح (container يعمل)

── Migration Verification (6a / 6b / 6c) ──
  6a. Migrations complete.     □ ظهر في logs
  6b. Migration errors         □ لا يوجد
  6c. sha256 column (TEXT/YES) □ موجود في document_files

── Runtime Logs ────────────────────────────
  UnhandledRejection      □ لا يوجد
  FATAL / SyntaxError     □ لا يوجد
  Cannot find module      □ لا يوجد
  Warnings غير متوقعة    □ لا يوجد  / □ موثَّقة أدناه

── Health (C-3 shape) ──────────────────────
  HTTP 200               □ نعم
  status                 □ ok / warn: ______
  disk.usedPercent       □ ____%
  uploads.usedPercent    □ ____%
  database.latencyMs     □ ____ms

── Login ───────────────────────────────────
  Token صالح             □ نعم

── Smoke Tests ─────────────────────────────
  C-1: backup-files.sh موجود    □ نعم
  C-1: backup-files.sh نجح      □ exit 0 / □ SKIP (R2 غير مضبوط)
  C-2: storage_used_mb عمود موجود □ نعم
  C-3: health shape جديد         □ PASS
  C-4: sha256 في upload response □ 64-char hex: ________________
  C-4: sha256 في DB              □ موجود
  C-5: missing email → 400       □ PASS
  C-5: role=system_owner → 400   □ PASS
  C-5: missing subject → 400     □ PASS
  C-5: missing title → 400       □ PASS

── Performance ─────────────────────────────
  Health endpoint         □ ___s  (< 1s)
  Documents list          □ ___s  (< 2s)
  Correspondence list     □ ___s  (< 2s)

── النتيجة النهائية ────────────────────────
  □ PASS — Sprint C مغلق رسمياً
  □ FAIL — انظر Rollback Plan

ملاحظات / warnings موثَّقة:
_______________________________________________
```

---

## الخطوة 13 — Post-Deploy Tasks (بعد نجاح الـ deployment)

### 13.1 — إضافة Cron لـ backup-files.sh

```bash
# تأكد من تضبيط R2 credentials في .env أولاً
grep -E "R2_ENDPOINT|R2_ACCESS_KEY|R2_SECRET_KEY" /var/www/edms/.env

# أضف cron job للنسخ الاحتياطي الليلي للملفات
# يعمل يومياً الساعة 3:15 صباحاً (15 دقيقة بعد backup.sh لتجنب التعارض)
(crontab -l 2>/dev/null; echo "15 3 * * * bash /var/www/edms/scripts/backup-files.sh >> /var/log/edms-backup-files.log 2>&1") | crontab -

# تأكد من الإضافة
crontab -l | grep backup-files
```

### 13.2 — تحديث Deployment History في Sprint B Runbook

أضف صفاً في جدول `Deployment History` في `docs/SPRINT_B_DEPLOYMENT_RUNBOOK.md`:

```
| 2026-07-0X | Sprint C Production Safety (C-1..C-5) | <COMMIT_HASH> | amr_j_98@hotmail.com | ✅ PASS | N/A | ... |
```

---

## Rollback Plan

### متى تُطبَّق الـ Rollback؟

| الحالة | الإجراء |
|---|---|
| Build فشل (الخطوة 4) | لا حاجة لـ rollback — الخدمة لم تتغير |
| Migration فشلت (الخطوة 5) | → Rollback A فوراً |
| Container يُعيد التشغيل في loop | → Rollback A فوراً |
| Smoke test حرج فشل (C-5 validation) | → Rollback A إذا كانت الأخطاء في كود الـ API |
| sha256 column غائبة (6.3) | → أوقف — راجع migration logs أولاً |

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

> **ملاحظة عن Migration 0019:** عمود `sha256 TEXT` هو nullable column addition — آمن جداً.  
> الكود القديم يتجاهله تلقائياً ولا يُعيد خطأ.  
> **لا حاجة لـ rollback قاعدة البيانات** عند rollback الكود — العمود يبقى بلا أثر سلبي.

### Rollback B — استعادة قاعدة البيانات (حالات طارئة فقط)

```bash
# لا تُنفَّذ إلا إذا كانت هناك data corruption موثَّقة

BACKUP_FILE=/var/backups/edms/pre-deploy-<TIMESTAMP>.dump

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

- **شكل health endpoint تغيّر:** `{"status":"ok","database":"connected"}` لم يعد موجوداً — الشكل الجديد موثَّق في الخطوة 7.
- **Migration 0019 آمن تماماً:** `ALTER TABLE document_files ADD COLUMN sha256 TEXT;` — nullable column، instant، بدون lock.
- **sha256 للملفات الجديدة فقط:** الملفات الموجودة قبل الـ deploy تبقى بـ `sha256 = NULL` — هذا مقصود وموثَّق في الـ migration.
- **C-5 validation لا تؤثر على البيانات:** اختبارات الـ validation تُرفض قبل الوصول لـ DB — آمنة تماماً على الإنتاج.
- **ELASTICSEARCH_URL غير مضبوط:** البحث يعمل على SQL fallback — هذا السلوك الصحيح.
- **Migrations تلقائية:** لا تُشغّل الـ migrations يدوياً عبر psql — الـ entrypoint يتعامل معها.
- **لا بيانات إنتاج تُلمس:** جميع تغييرات Sprint C إضافية (column، scripts، validation logic).
- **المستخدمون التجريبيون:** `dc@contractor.local` وغيرهم يجب أن يكونوا غير موجودين في الإنتاج.
- **JWT_SECRET:** استخدم secret الإنتاج فقط — لا `dev-jwt-secret-not-for-production`.

---

## Deployment History

| Date | Version | Commit | Deployed By | Result | Rollback | Notes |
|------|---------|--------|-------------|--------|----------|-------|
| 2026-07-01 | Sprint A Security + Sprint B Performance | `7059f90` | amr_j_98@hotmail.com | ✅ PASS | N/A | First production deployment. Migration baseline bug found+fixed (repairStaleBaseline). 0010_audit_schema indexes repaired as bonus. All 8 Sprint B indexes applied. Smoke Tests 6/6 ✅. |
| 2026-07-03 | Sprint C Production Safety (C-1..C-5) | `350bab7` | amr_j_98@hotmail.com | ✅ PASS | N/A | Migration 0019 (sha256 column) طُبِّقت بنجاح. Health shape جديد (disk/uploads/database) يعمل. File backup: 8/8 ملفات → R2 ✅. C-5 validation: 4/4 scenarios ✅. Cron 03:15 UTC مُضاف. Perf: health=0.01s, docs=0.01s, corr=0.02s. |

*أضف صفاً جديداً بعد كل عملية نشر ناجحة أو فاشلة.*

---

*آخر تحديث: 2026-07-03 — الإصدار 1.1 (Sprint C مغلق رسمياً — Post-Deployment)*
