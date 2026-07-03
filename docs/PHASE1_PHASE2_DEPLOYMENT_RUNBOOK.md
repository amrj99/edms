# Phase 1 + Phase 2 — Production Deployment Runbook
# Entity Directory + Project Participants

**الإصدار:** 1.0  
**تاريخ الإعداد:** 2026-07-03  
**يُطبَّق على:** VPS الإنتاج — الخدمات: `edms_api` (port 8080)، `edms_postgres` (internal)  
**المدة المتوقعة:** 20–25 دقيقة  
**نقطة البداية:** Production تعمل حالياً على commit `350bab7` (Sprint C) — آخر migration مطبَّق: `0019_file_content_hash`

---

## ما الذي سيُنشر

| Migration | التغيير | النوع |
|-----------|---------|-------|
| 0020_entity_directory | CREATE TYPE entity_type + CREATE TABLE entities | جديد |
| 0021_contacts_directory | CREATE TABLE contacts | جديد |
| 0022_org_entity_link | ALTER TABLE organizations ADD COLUMN entity_id | additive |
| 0023_project_participants | CREATE TYPE participant_role + CREATE TABLE project_participants | جديد |

**API endpoints الجديدة:**
- `GET/POST /api/entities` — إدارة الكيانات (شركات، حكومات، أفراد، NGO، consortium)
- `GET/POST/PUT/DELETE /api/entities/:id/contacts` — جهات الاتصال لكيان
- `GET/POST/PUT/DELETE /api/projects/:projectId/participants` — مشاركو المشروع بدور

**لا يوجد UI** — backend-only. لا frontend verification.

**لا تغيير في:**
- أي route قائم أو middleware
- منطق Authorization أو JWT
- بيانات الإنتاج الموجودة

---

## Migration Safety Review (Pre-Deploy Analysis)

> **قرأتها بالكامل قبل نشرها. الملخص للمنفِّذ:**

### 0020_entity_directory.sql

| الفحص | النتيجة |
|-------|---------|
| `ALTER TYPE ADD VALUE` بدون guard | ✅ لا يوجد — استخدام `CREATE TYPE` جديد |
| `CREATE TYPE` without `IF NOT EXISTS` | ⚠ موجود — ولكن آمن (انظر تحليل أدناه) |
| `DROP` في migration للأمام | ✅ لا يوجد |
| `ensureEnumValues()` محتاج تحديث؟ | ✅ لا — `CREATE TYPE` جديد، ليس `ADD VALUE` |

> **تحليل `CREATE TYPE entity_type` بدون `IF NOT EXISTS`:**  
> المخاوف في MIGRATION_GOVERNANCE.md تخص الحالات التي يمكن أن تعيد تشغيل migration مرتين.  
> Drizzle يمنع ذلك عبر تتبع hash في `drizzle.__drizzle_migrations`.  
> `repairStaleBaseline` يزيل فقط migrations بـ indexes غائبة — لا يمس migrations بـ `CREATE TYPE`.  
> **النتيجة: آمن. الـ type غير موجود في Production حالياً (تُؤكَّد في Preflight الخطوة 1.5).**

### 0021_contacts_directory.sql

| الفحص | النتيجة |
|-------|---------|
| `ALTER TYPE ADD VALUE` | ✅ لا يوجد |
| `CREATE TYPE` | ✅ لا يوجد |
| `DROP` | ✅ لا يوجد |
| `ensureEnumValues()` | ✅ لا تغيير مطلوب |
| FK إلى `entities` | ✅ 0020 يجب أن يسبقه — محقَّق بالترتيب في journal |

### 0022_org_entity_link.sql

| الفحص | النتيجة |
|-------|---------|
| `ALTER TABLE ADD COLUMN` | ✅ nullable — instant، بدون lock، بدون default blocking |
| تأثير على صفوف موجودة | ✅ لا — NULL هو الـ default |
| `ensureEnumValues()` | ✅ لا تغيير مطلوب |

### 0023_project_participants.sql

| الفحص | النتيجة |
|-------|---------|
| `ALTER TYPE ADD VALUE` بدون guard | ✅ لا يوجد — `CREATE TYPE` جديد |
| `CREATE TYPE participant_role` without `IF NOT EXISTS` | ⚠ موجود — نفس تحليل 0020 أعلاه |
| `DROP` | ✅ لا يوجد |
| FK إلى `entities` | ✅ 0020 يجب أن يسبقه — محقَّق بالترتيب في journal |
| `ensureEnumValues()` | ✅ لا تغيير مطلوب — `CREATE TYPE` لا يحتاج pre-commit |

**الخلاصة: جميع الـ migrations آمنة. لا تعديل مطلوب على `migrate.ts`.**

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
             migrate.mjs: ensureBaseline → repairStaleBaseline → ensureEnumValues → migrate()
             إذا فشل: container يخرج بـ exit 1 (لا يبدأ الـ server)
             إذا نجح: يكمل seed ثم يبدأ الـ server
```

---

## Deployment Checklist

```
□ 1.    Pre-flight: docker ps + health + disk + git status + DB type check
□ 2.    Backup: pg_dump جديد — size > 0
□ 3.    Git pull: commit 22052a2 على main
□ 4.    Build: docker compose build --no-cache api ← بدون أخطاء
□ 5.    Restart: docker compose up -d --force-recreate api
□ 6a.   Migration logs: [entrypoint] Migrations complete. ظهر
□ 6b.   Migration errors: لا أخطاء في الـ logs
□ 6c.   entities table: موجودة (information_schema)
□ 6d.   contacts table: موجودة
□ 6e.   organizations.entity_id: column موجود
□ 6f.   project_participants table: موجودة
□ 6g.   entity_type enum: موجودة مع القيم الخمس
□ 6h.   participant_role enum: موجودة مع القيم السبع
□ 6i.   UNIQUE constraint uq_project_entity: موجود
□ 7.    Health: status=ok، disk/uploads/database موجودان
□ 8.    Runtime logs: لا UnhandledRejection أو FATAL
□ 9.    Login: token صالح
□ S1.   Smoke: GET /api/entities → 200 []
□ S2.   Smoke: POST /api/entities → 201 + id
□ S3.   Smoke: GET /api/entities/:id → 200 + name/type
□ S4.   Smoke: POST /api/entities/:id/contacts → 201 + id
□ S5.   Smoke: GET /api/entities/:id/contacts → 200 + array
□ S6.   Smoke: GET /api/projects/:id/participants → 200 []
□ S7.   Smoke: POST /api/projects/:id/participants → 201 + role
□ S8.   Smoke: GET /api/projects/:id/participants → 200 + entity embedded
□ S9.   Smoke: POST /api/entities/:id/contacts (invalid role) → 400 تحقق الـ validation
□ S10.  Smoke: POST /api/projects/:id/participants duplicate → 409
□ 10.   Post-deployment report: موثَّق
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
# المتوقع: status=ok أو warn، database.status=ok

# 1.3 تحقق من مساحة القرص
df -h /
# المطلوب: > 2GB متاحة

# 1.4 git status
cd /var/www/edms && git status
# المتوقع: nothing to commit, working tree clean
# إذا كان هناك uncommitted changes: أوقف وحدد السبب

# 1.5 تأكيد أن الـ types الجديدة غير موجودة بعد (Pre-flight safety check)
docker exec edms_postgres psql -U edms -d edms -t -c "
SELECT typname FROM pg_type
WHERE typname IN ('entity_type', 'participant_role');"
# المتوقع: لا صفوف — إذا ظهرت صفوف: أوقف وتحقق من سبب وجودها
```

**إذا فشل أي من هذه:** أوقف الـ deployment وحدد السبب قبل المتابعة.

---

## الخطوة 2 — Database Backup

> **قاعدة غير قابلة للاستثناء:** يجب إنشاء backup جديد لكل deployment — حتى لو يوجد backup سابق.  
> إذا لم يكتمل الـ backup بنجاح (size > 0)، أوقف الـ deployment.

```bash
# 2.1 مجلد الـ backup موجود مسبقاً: /var/backups/edms/
BACKUP_FILE=/var/backups/edms/pre-deploy-$(date +%Y%m%d_%H%M%S).dump

# 2.2 pg_dump كامل (custom format)
docker exec edms_postgres pg_dump \
  -U edms \
  -d edms \
  -F c \
  -f /tmp/pre-deploy.dump

# 2.3 نسخ الملف من الـ container إلى الـ host
docker cp edms_postgres:/tmp/pre-deploy.dump "$BACKUP_FILE"

# 2.4 تحقق من حجم الـ backup — شرط إلزامي
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
# المتوقع:
#   22052a2 feat(phase-2): add Project Participants — Entity + Role per Project
#   f2f246b feat: Entity & Contact Directory Layer (Phase 1)
#   7153ddb fix: resolve pre-existing type error in metadata schema
# إذا ظهرت commits إضافية غير متوقعة: أوقف وراجع

# 3.3 تطبيق التحديثات
git pull origin main

# 3.4 تأكيد
git log --oneline -3
# يجب أن يكون أول سطر: 22052a2 feat(phase-2): add Project Participants...
```

---

## الخطوة 4 — Build

```bash
cd /var/www/edms

# 4.1 بناء الـ image الجديدة
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

# 5.2 انتظر حتى تكتمل الـ migrations (4 migrations جديدة + seed)
sleep 25

# 5.3 تحقق أن الـ container لا يزال يعمل
docker ps | grep edms_api
# يجب أن يكون Status: "Up X seconds" وليس "Restarting"
```

---

## الخطوة 6 — Migration Verification

> **أهم خطوة في هذا الـ deployment.**  
> 4 migrations جديدة ستُطبَّق للمرة الأولى.  
> لا تنتقل للخطوة 7 قبل اجتياز جميع الفحوصات هنا.

### 6.1 — تأكيد وجود رسائل النجاح

```bash
docker logs edms_api 2>&1 | grep -E "\[entrypoint\]|\[migrate\]"
```

**يجب أن تظهر هذه الأسطر بهذا الترتيب:**
```
[entrypoint] Running database migrations...
[migrate] All migrations applied successfully.
[entrypoint] Migrations complete.
[entrypoint] Seeding document types...
[entrypoint] Document type seed complete.
[entrypoint] Seeding default workflow templates...
[entrypoint] Workflow template seed complete.
[entrypoint] Starting API server...
```

**يُتوقع أيضاً ظهور:**
```
[migrate] ensureEnumValues: committed subscription_status → 'expired'
```

| ما تراه | الإجراء |
|---------|---------|
| `Migrations complete.` | ✓ تابع لـ 6.2 |
| `ERROR: Migration failed` | ✗ أوقف فوراً — راجع الـ Rollback Plan |
| `[entrypoint]` غائب كلياً | ✗ أوقف — الـ container لم يبدأ صحيح |

### 6.2 — تأكيد غياب أخطاء الـ Migration

```bash
docker logs edms_api 2>&1 | grep -iE "migration.*error|migration.*fail|stack trace|Error:" | head -20
```

**المتوقع: لا output على الإطلاق.**  
أي سطر يظهر → أوقف وراجع:
```bash
docker logs edms_api 2>&1 | head -80
```

### 6.3 — تحقق DB: entities table

```bash
docker exec edms_postgres psql -U edms -d edms -t -c "
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'entities'
ORDER BY ordinal_position;"
```

**المتوقع (9 columns):**
```
 id                  | integer   | NO
 organization_id     | integer   | NO
 name                | text      | NO
 type                | USER-DEFINED | NO
 country             | text      | YES
 registration_number | text      | YES
 parent_entity_id    | integer   | YES
 created_at          | timestamp without time zone | NO
 updated_at          | timestamp without time zone | NO
```

### 6.4 — تحقق DB: contacts table

```bash
docker exec edms_postgres psql -U edms -d edms -t -c "
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'contacts'
ORDER BY ordinal_position;"
```

**المتوقع (9 columns):**
```
 id         | integer   | NO
 entity_id  | integer   | NO
 name       | text      | NO
 email      | text      | YES
 phone      | text      | YES
 job_title  | text      | YES
 user_id    | integer   | YES
 created_at | timestamp without time zone | NO
 updated_at | timestamp without time zone | NO
```

### 6.5 — تحقق DB: organizations.entity_id column

```bash
docker exec edms_postgres psql -U edms -d edms -t -c "
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'organizations' AND column_name = 'entity_id';"
```

**المتوقع:**
```
 entity_id | integer | YES
```

إذا لم يظهر صف: migration 0022 لم تُطبَّق → أوقف فوراً.

### 6.6 — تحقق DB: project_participants table + UNIQUE constraint

```bash
docker exec edms_postgres psql -U edms -d edms -t -c "
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'project_participants'
ORDER BY ordinal_position;"
```

**المتوقع (8 columns):**
```
 id         | integer   | NO
 project_id | integer   | NO
 entity_id  | integer   | NO
 role        | USER-DEFINED | NO
 notes      | text      | YES
 created_at | timestamp without time zone | NO
 updated_at | timestamp without time zone | NO
```

```bash
# تأكيد UNIQUE constraint
docker exec edms_postgres psql -U edms -d edms -t -c "
SELECT constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_name = 'project_participants';"
```

**المتوقع:**
```
 project_participants_pkey | PRIMARY KEY
 uq_project_entity         | UNIQUE
```

### 6.7 — تحقق DB: enum values

```bash
# entity_type — يجب أن تحوي 5 قيم
docker exec edms_postgres psql -U edms -d edms -t -c "
SELECT e.enumlabel
FROM pg_enum e
JOIN pg_type t ON e.enumtypid = t.oid
WHERE t.typname = 'entity_type'
ORDER BY e.enumsortorder;"
```

**المتوقع:**
```
 company
 government
 individual
 ngo
 consortium
```

```bash
# participant_role — يجب أن تحوي 7 قيم
docker exec edms_postgres psql -U edms -d edms -t -c "
SELECT e.enumlabel
FROM pg_enum e
JOIN pg_type t ON e.enumtypid = t.oid
WHERE t.typname = 'participant_role'
ORDER BY e.enumsortorder;"
```

**المتوقع:**
```
 owner
 consultant
 main_contractor
 sub_contractor
 supplier
 authority
 other
```

### 6.8 — تحقق DB: drizzle migration history

```bash
docker exec edms_postgres psql -U edms -d edms -t -c "
SELECT created_at, hash
FROM drizzle.__drizzle_migrations
ORDER BY created_at DESC
LIMIT 6;"
```

**المتوقع: 6 أحدث rows تشمل timestamps:**
- `1751500803000` — 0023_project_participants
- `1751500802000` — 0022_org_entity_link
- `1751500801000` — 0021_contacts_directory
- `1751500800000` — 0020_entity_directory
- `1783069200000` — 0019_file_content_hash (Sprint C — آخر migration سابق)

---

## الخطوة 7 — Health Check

```bash
curl -s http://localhost:8080/api/health | python3 -m json.tool
```

```bash
# التحقق البرمجي
curl -s http://localhost:8080/api/health | python3 -c "
import sys, json
r = json.load(sys.stdin)
print('status:', r.get('status'))
print('database.status:', r.get('database', {}).get('status'))
print('database.latencyMs:', r.get('database', {}).get('latencyMs'), 'ms')
print('disk.usedPercent:', r.get('disk', {}).get('usedPercent'), '%')

assert r.get('status') in ('ok', 'warn'), f'FAIL: status={r.get(\"status\")}'
assert r.get('database', {}).get('status') == 'ok', 'FAIL: database not ok'
print('✓ Health check passed')
"
```

| status | HTTP | الإجراء |
|--------|------|---------|
| `ok` | 200 | ✓ تابع |
| `warn` | 200 | ⚠ تابع — وثّق في التقرير |
| `critical` | 503 | ✗ أوقف |
| `error` | 503 | ✗ أوقف — راجع الـ Rollback Plan |

---

## الخطوة 8 — Runtime Log Analysis

```bash
echo "=== CRITICAL ERRORS ==="
docker logs edms_api --since 5m 2>&1 | grep -iE \
  "unhandledrejection|uncaughtexception|FATAL|Cannot find module|SyntaxError|ReferenceError" \
  | head -20

echo "=== PROMISE REJECTIONS ==="
docker logs edms_api --since 5m 2>&1 | grep -iE \
  "UnhandledPromiseRejection|PromiseRejectionHandledWarning" \
  | head -20

echo "=== WARNINGS ==="
docker logs edms_api --since 5m 2>&1 | grep -iE "warn" | head -20
```

| ما تراه | التقييم |
|---------|---------|
| `[search] ELASTICSEARCH_URL not set` | ✓ متوقع |
| `[sentry] SENTRY_DSN not set` | ✓ متوقع |
| `UnhandledPromiseRejection` | ✗ أوقف |
| `Cannot find module` | ✗ أوقف — Build ناقص |
| `FATAL` / `SyntaxError` | ✗ أوقف |

---

## الخطوة 9 — Login (الحصول على Token)

```bash
# اقرأ كلمة المرور بدون echo
read -s PASS

# تسجيل الدخول
TOKEN=$(curl -s -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"amr_j_98@hotmail.com\",\"password\":\"$PASS\"}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])") && unset PASS

echo "Token: ${TOKEN:0:30}..."
# إذا كان فارغاً: الـ login فشل — تحقق من الـ email وأعد المحاولة
```

---

## الخطوة 10 — API Smoke Tests

> **لا يوجد UI** — جميع الـ smoke tests عبر curl مباشرة.  
> هذه الاختبارات تلمس بيانات الإنتاج (تُنشئ صفوفاً حقيقية).  
> استخدم بيانات اختبار واضحة التسمية لتسهيل حذفها لاحقاً.

### 10.1 — Entity CRUD

```bash
# S1: قائمة الكيانات (يجب أن تكون فارغة في الإنتاج الجديد أو بها بيانات موجودة)
curl -s http://localhost:8080/api/entities \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "
import sys, json
r = json.load(sys.stdin)
print('type:', type(r).__name__, '— count:', len(r) if isinstance(r, list) else 'N/A')
assert isinstance(r, list), f'FAIL: expected array, got {type(r)}'
print('✓ S1: GET /api/entities → 200 array — PASS')
"

# S2: إنشاء entity
ENTITY_RESULT=$(curl -s -X POST http://localhost:8080/api/entities \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"[SMOKE-TEST] AECOM Middle East","type":"company","country":"AE"}')

echo "$ENTITY_RESULT" | python3 -c "
import sys, json
r = json.load(sys.stdin)
print('id:', r.get('id'), '— name:', r.get('name'), '— type:', r.get('type'))
assert r.get('id'), f'FAIL: no id in response — {r}'
assert r.get('name') == '[SMOKE-TEST] AECOM Middle East', f'FAIL: name mismatch'
assert r.get('type') == 'company', f'FAIL: type mismatch'
print('✓ S2: POST /api/entities → 201 — PASS')
"

# استخرج الـ ENTITY_ID للاستخدام في الاختبارات التالية
ENTITY_ID=$(echo "$ENTITY_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "ENTITY_ID = $ENTITY_ID"

# S3: قراءة entity بـ id
curl -s http://localhost:8080/api/entities/$ENTITY_ID \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "
import sys, json
r = json.load(sys.stdin)
print('id:', r.get('id'), '— name:', r.get('name'))
assert str(r.get('id')) == '$ENTITY_ID', f'FAIL: id mismatch'
print('✓ S3: GET /api/entities/:id → 200 — PASS')
"
```

### 10.2 — Contacts Sub-Resource

```bash
# S4: إضافة contact لـ entity
CONTACT_RESULT=$(curl -s -X POST http://localhost:8080/api/entities/$ENTITY_ID/contacts \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"[SMOKE-TEST] Ahmed Al-Rashidi","email":"smoke-test@example.com","jobTitle":"Project Manager"}')

echo "$CONTACT_RESULT" | python3 -c "
import sys, json
r = json.load(sys.stdin)
print('id:', r.get('id'), '— name:', r.get('name'))
assert r.get('id'), f'FAIL: no id in response — {r}'
assert r.get('entityId') == $ENTITY_ID, f'FAIL: entityId mismatch'
print('✓ S4: POST /api/entities/:id/contacts → 201 — PASS')
"

CONTACT_ID=$(echo "$CONTACT_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

# S5: قائمة contacts
curl -s http://localhost:8080/api/entities/$ENTITY_ID/contacts \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "
import sys, json
r = json.load(sys.stdin)
print('contacts count:', len(r))
assert isinstance(r, list) and len(r) >= 1, f'FAIL: expected at least 1 contact'
print('✓ S5: GET /api/entities/:id/contacts → 200 array — PASS')
"
```

### 10.3 — Project Participants

> **يتطلب معرفة project_id حقيقي من الإنتاج.**  
> احصل عليه من الـ DB قبل تنفيذ هذه الاختبارات.

```bash
# الحصول على project_id من الـ DB
PROJECT_ID=$(docker exec edms_postgres psql -U edms -d edms -t -c "
SELECT id FROM projects ORDER BY id LIMIT 1;" | tr -d ' ')
echo "PROJECT_ID = $PROJECT_ID"

# إذا كانت النتيجة فارغة (لا مشاريع في الإنتاج):
# → استخدم PROJECT_ID=1 (أي رقم) لاختبار S9 (الـ 404 متوقع) وتجاهل S6/S7/S8
# → وثّق ذلك في التقرير

# S6: قائمة المشاركين (فارغة)
curl -s http://localhost:8080/api/projects/$PROJECT_ID/participants \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "
import sys, json
r = json.load(sys.stdin)
print('participants:', r)
assert isinstance(r, list), f'FAIL: expected array — {r}'
print('✓ S6: GET /api/projects/:id/participants → 200 array — PASS')
"

# S7: إضافة entity كمشارك في المشروع
PP_RESULT=$(curl -s -X POST http://localhost:8080/api/projects/$PROJECT_ID/participants \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"entityId\":$ENTITY_ID,\"role\":\"consultant\",\"notes\":\"[SMOKE-TEST]\"}")

echo "$PP_RESULT" | python3 -c "
import sys, json
r = json.load(sys.stdin)
print('id:', r.get('id'), '— role:', r.get('role'), '— entityId:', r.get('entityId'))
assert r.get('id'), f'FAIL: no id — {r}'
assert r.get('role') == 'consultant', f'FAIL: role mismatch'
print('✓ S7: POST /api/projects/:id/participants → 201 — PASS')
"

PP_ID=$(echo "$PP_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

# S8: قائمة المشاركين مع entity data مدمجة
curl -s http://localhost:8080/api/projects/$PROJECT_ID/participants \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "
import sys, json
r = json.load(sys.stdin)
print('count:', len(r))
if r:
    first = r[0]
    print('role:', first.get('role'), '— entity.name:', first.get('entity', {}).get('name'))
    assert 'entity' in first, f'FAIL: entity not embedded'
    assert 'name' in first['entity'], f'FAIL: entity.name missing'
print('✓ S8: GET → 200 with embedded entity — PASS')
"
```

### 10.4 — Validation & Duplicate Checks

```bash
# S9: participant_role غير صحيح → 400
curl -s -X POST http://localhost:8080/api/projects/$PROJECT_ID/participants \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"entityId\":$ENTITY_ID,\"role\":\"invalid_role\"}" \
  | python3 -c "
import sys, json
r = json.load(sys.stdin)
print('error:', r.get('error'))
# Status code يجب أن يكون 400 (نتحقق عبر curl -o)
print('✓ S9: invalid role sent — check error field above (should be validation error)')
"

# للتأكيد من status code:
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST http://localhost:8080/api/projects/$PROJECT_ID/participants \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"entityId\":$ENTITY_ID,\"role\":\"invalid_role\"}")
echo "Status: $STATUS (expected: 400)"

# S10: محاولة إضافة نفس الـ entity مرة ثانية → 409
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST http://localhost:8080/api/projects/$PROJECT_ID/participants \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"entityId\":$ENTITY_ID,\"role\":\"owner\"}")
echo "Status: $STATUS (expected: 409 — duplicate)"
[ "$STATUS" = "409" ] && echo "✓ S10: duplicate entity → 409 — PASS" || echo "✗ S10: FAIL — got $STATUS"
```

### 10.5 — Cleanup Smoke Test Data

```bash
# احذف بيانات الـ smoke test من الإنتاج
# المشارك أولاً (FK)
if [ -n "$PP_ID" ]; then
  curl -s -X DELETE http://localhost:8080/api/projects/$PROJECT_ID/participants/$PP_ID \
    -H "Authorization: Bearer $TOKEN" \
    | python3 -c "import sys,json; r=json.load(sys.stdin); print('deleted participant:', r)"
fi

# الـ contact
if [ -n "$CONTACT_ID" ]; then
  curl -s -X DELETE http://localhost:8080/api/entities/$ENTITY_ID/contacts/$CONTACT_ID \
    -H "Authorization: Bearer $TOKEN" \
    | python3 -c "import sys,json; r=json.load(sys.stdin); print('deleted contact:', r)"
fi

# الـ entity
if [ -n "$ENTITY_ID" ]; then
  curl -s -X DELETE http://localhost:8080/api/entities/$ENTITY_ID \
    -H "Authorization: Bearer $TOKEN" \
    | python3 -c "import sys,json; r=json.load(sys.stdin); print('deleted entity:', r)"
fi

echo "✓ Cleanup complete"

# تأكيد من DB أن البيانات حُذفت
docker exec edms_postgres psql -U edms -d edms -t -c "
SELECT COUNT(*) FROM entities WHERE name LIKE '%SMOKE-TEST%';"
# المتوقع: 0
```

---

## الخطوة 11 — Post-Deployment Verification Report

```
== Phase 1 + Phase 2 — Post-Deployment Verification Report ==

التاريخ/الوقت: _______________
المنفذ:        _______________
git commit:    22052a2

── Deploy ──────────────────────────────────
  git pull                □ نجح
  docker compose build    □ نجح (بدون أخطاء)
  docker compose up       □ نجح (container يعمل)

── Migration Verification ──────────────────
  6.1 Migrations complete.       □ ظهر في logs
  6.2 Migration errors           □ لا يوجد
  6.3 entities table             □ موجودة (9 columns)
  6.4 contacts table             □ موجودة (9 columns)
  6.5 organizations.entity_id    □ column موجود (nullable)
  6.6 project_participants table □ موجودة + uq_project_entity
  6.7 entity_type enum           □ 5 قيم: company/government/individual/ngo/consortium
  6.7 participant_role enum      □ 7 قيم: owner/consultant/.../other
  6.8 drizzle migration history  □ 0020/0021/0022/0023 مسجَّلة

── Runtime Logs ────────────────────────────
  UnhandledRejection      □ لا يوجد
  FATAL / SyntaxError     □ لا يوجد
  Cannot find module      □ لا يوجد
  Warnings غير متوقعة    □ لا يوجد  / □ موثَّقة أدناه

── Health ──────────────────────────────────
  HTTP 200               □ نعم
  status                 □ ok / warn: ______
  disk.usedPercent       □ ____%
  uploads.usedPercent    □ ____%
  database.latencyMs     □ ____ms

── Login ───────────────────────────────────
  Token صالح             □ نعم

── API Smoke Tests ─────────────────────────
  S1:  GET /api/entities → 200 []                □ PASS
  S2:  POST /api/entities → 201 + id             □ PASS  (id: ___)
  S3:  GET /api/entities/:id → 200               □ PASS
  S4:  POST /api/entities/:id/contacts → 201     □ PASS  (id: ___)
  S5:  GET /api/entities/:id/contacts → 200      □ PASS
  S6:  GET /api/projects/:id/participants → 200  □ PASS  / □ N/A (no projects)
  S7:  POST /api/projects/:id/participants → 201 □ PASS  / □ N/A
  S8:  GET → 200 with embedded entity            □ PASS  / □ N/A
  S9:  invalid role → 400                        □ PASS
  S10: duplicate entity → 409                    □ PASS  / □ N/A
  Cleanup: smoke data حُذف                      □ نعم

── النتيجة النهائية ────────────────────────
  □ PASS — Phase 1 + Phase 2 مغلقتان رسمياً
  □ FAIL — انظر Rollback Plan

ملاحظات / warnings موثَّقة:
_______________________________________________
```

---

## Rollback Plan

### متى تُطبَّق الـ Rollback؟

| الحالة | الإجراء |
|--------|---------|
| Build فشل (الخطوة 4) | لا حاجة لـ rollback — الخدمة لم تتغير |
| Migration فشلت (الخطوة 5) | → Rollback A فوراً |
| Container يُعيد التشغيل في loop | → Rollback A فوراً |
| entities/contacts/project_participants table غائبة | → Rollback A |
| enum values ناقصة | → Rollback A |
| Smoke test حرج فشل | → Rollback A إذا كانت الأخطاء في كود الـ API |

### Rollback A — رجوع إلى الكود السابق (Sprint C)

```bash
cd /var/www/edms

# 1. رجوع إلى commit Sprint C
git log --oneline -5    # تأكد من الـ commit hash لـ Sprint C
git checkout 350bab7    # commit Sprint C (آخر نشر ناجح)

# 2. إعادة البناء والتشغيل
docker compose build --no-cache api
docker compose up -d --force-recreate api

# 3. تحقق
sleep 20
curl -s http://localhost:8080/api/health | python3 -m json.tool
docker logs edms_api 2>&1 | grep "\[entrypoint\]"
```

**ملاحظة مهمة عن الـ migrations عند Rollback:**
> الـ migrations (0020/0021/0022/0023) ستُبقى في قاعدة البيانات عند Rollback الكود.  
> الكود القديم (Sprint C) لا يعرف هذه الجداول ولن يلمسها — فقط يتجاهلها.  
> **لا حاجة لـ rollback قاعدة البيانات** في الحالة الاعتيادية.  
> الـ rollback الكودي وحده كافٍ لاستعادة Sprint C الوظيفي.

### Rollback B — استعادة قاعدة البيانات (حالات data corruption فقط)

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

# 4. إعادة تشغيل مع الكود القديم
docker compose start api

# 5. تحقق
curl -s http://localhost:8080/api/health
```

---

## ملاحظات مهمة

- **لا UI:** جميع الـ smoke tests عبر curl — لا frontend في هذا الـ deployment.
- **4 migrations آمنة:** 3 منها `CREATE TYPE/TABLE` والرابع `ALTER TABLE ADD COLUMN` — لا lock، لا data migration، لا تغيير في صفوف موجودة.
- **entity_type و participant_role:** تُنشأ بـ `CREATE TYPE` (ليس `ADD VALUE`) — لا تحتاج إدخالاً في `ensureEnumValues()` ولا pre-commit خاص.
- **organizations.entity_id nullable:** جميع صفوف organizations الحالية تبقى دون تأثير مع `entity_id = NULL`.
- **Tenant isolation محفوظ:** entities مرتبطة بـ organization_id — كل tenant يرى entities تابعة له فقط.
- **لا بيانات إنتاج تُلمس:** لا INSERT/UPDATE/DELETE على أي جدول موجود.
- **JWT_SECRET:** استخدم secret الإنتاج — لا `dev-jwt-secret-not-for-production`.
- **Cleanup إلزامي:** احذف بيانات الـ smoke test ([SMOKE-TEST]) بعد اكتمال التحقق.

---

## Deployment History

| Date | Version | Commit | Deployed By | Result | Rollback | Notes |
|------|---------|--------|-------------|--------|----------|-------|
| 2026-07-01 | Sprint A+B | `7059f90` | amr_j_98@hotmail.com | ✅ PASS | N/A | First production deployment |
| 2026-07-03 | Sprint C (C-1..C-5) | `350bab7` | amr_j_98@hotmail.com | ✅ PASS | N/A | Migration 0019 (sha256). Cron 03:15 مُضاف |
| __________ | Phase 1+2 Entity Directory | `22052a2` | amr_j_98@hotmail.com | ⬜ | | Migrations 0020–0023 |

*أضف صفاً جديداً بعد كل عملية نشر ناجحة أو فاشلة.*

---

*آخر تحديث: 2026-07-03 — الإصدار 1.0*
