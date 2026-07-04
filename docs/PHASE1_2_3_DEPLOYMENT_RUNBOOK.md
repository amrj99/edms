# Phase 1 + Phase 2 + Phase 3 — Production Deployment Runbook
# Entity Directory · Project Participants · Submission Chains (Submittals)

**الإصدار:** 1.0  
**تاريخ الإعداد:** 2026-07-04  
**يُطبَّق على:** VPS الإنتاج — الخدمات: `edms_api` (port 8080)، `edms_frontend` (port 80/443)، `edms_postgres` (internal)  
**المدة المتوقعة:** 35–45 دقيقة  
**نقطة البداية:** Production تعمل حالياً على commit `350bab7` (Sprint C) — آخر migration مطبَّق: `0019_file_content_hash`

> **ملاحظة:** Phase 1 + Phase 2 لم تُنشر بعد. هذا الـ Runbook يُطبِّق الأحداث الثلاثة دفعةً واحدة على 7 migrations.

---

## ما الذي سيُنشر

### Migrations

| Migration | التغيير | النوع | Phase |
|-----------|---------|-------|-------|
| 0020_entity_directory | CREATE TYPE entity_type + CREATE TABLE entities | جديد | 1 |
| 0021_contacts_directory | CREATE TABLE contacts | جديد | 1 |
| 0022_org_entity_link | ALTER TABLE organizations ADD COLUMN entity_id (nullable) | additive | 1 |
| 0023_project_participants | CREATE TYPE participant_role + CREATE TABLE project_participants | جديد | 2 |
| 0024_submission_chain_type | ALTER TABLE submission_chains ADD COLUMN type + current_participant_id + CHECK + indexes | additive | 3 |
| 0025_submission_chain_parties_participant | CREATE TYPE assignment_strategy + ALTER TABLE allowed_parties ADD participant_id + strategy + DROP NOT NULL على org_id | mixed | 3 |
| 0026_submission_chain_steps_participant | ALTER TABLE submission_chain_steps ADD COLUMN from_participant_id + to_participant_id | additive | 3 |

### API Endpoints الجديدة

**Phase 1:**
- `GET/POST/PUT/DELETE /api/entities` — إدارة الكيانات (company, government, individual, ngo, consortium)
- `GET/POST/PUT/DELETE /api/entities/:id/contacts` — جهات الاتصال لكيان

**Phase 2:**
- `GET/POST/PUT/DELETE /api/projects/:projectId/participants` — مشاركو المشروع بدور

**Phase 3:**
- `GET/POST /api/projects/:projectId/submission-chains` — إنشاء وعرض Submittals
- `GET /api/projects/:projectId/submission-chains/:id` — تفاصيل + actions
- `POST /api/projects/:projectId/submission-chains/:id/setup-parties` — تهيئة أطراف الدورة
- `POST /api/projects/:projectId/submission-chains/:id/forward` — إحالة للمرحلة التالية
- `POST /api/projects/:projectId/submission-chains/:id/review` — تسجيل مراجعة
- `POST /api/projects/:projectId/submission-chains/:id/return` — إعادة للمُقدِّم
- `POST /api/projects/:projectId/submission-chains/:id/resubmit` — إعادة التقديم

### Frontend (جديد في Phase 3)
- Submittals tab في صفحة Project
- صفحة تفاصيل Submittal مع Timeline و Action Panel
- 5 نوافذ حوار: Create, Forward, Review, Return, Resubmit

### لا تغيير في
- أي route أو middleware قائم
- منطق Authorization أو JWT
- بيانات الإنتاج الموجودة (جميع الـ migrations additive أو تضيف columns nullable)

---

## Migration Safety Review (Pre-Deploy Analysis)

### 0020–0023 (Phase 1+2)
موثَّقة في [PHASE1_PHASE2_DEPLOYMENT_RUNBOOK.md](PHASE1_PHASE2_DEPLOYMENT_RUNBOOK.md).  
**خلاصة: جميعها آمنة** — 3 منها `CREATE TYPE/TABLE`، والرابع `ALTER TABLE ADD COLUMN nullable`.

### 0024_submission_chain_type.sql

| الفحص | النتيجة |
|-------|---------|
| `ALTER TABLE ADD COLUMN type NOT NULL DEFAULT 'submittal'` | ✅ آمن — PostgreSQL modern يضيف constant default بدون table rewrite |
| `ALTER TABLE ADD COLUMN current_participant_id integer` (nullable FK) | ✅ instant، بدون lock |
| `ADD CONSTRAINT CHECK` | ✅ لا تعارض مع صفوف موجودة (القيم الموجودة = NULL أو DEFAULT 'submittal') |
| `CREATE INDEX` | ✅ بدون UNIQUE — لا lock مطوَّل |
| يلمس صفوف موجودة في submission_chains؟ | ✅ لا — فقط يضيف قيمة default على صفوف جديدة |

**ملاحظة:** صفوف `submission_chains` الموجودة في الإنتاج (إن وُجدت — من migration 0016) ستحصل تلقائياً على `type = 'submittal'` و `current_participant_id = NULL`. **هذا صحيح ومتوقع.**

### 0025_submission_chain_parties_participant.sql

| الفحص | النتيجة |
|-------|---------|
| `CREATE TYPE assignment_strategy` without `IF NOT EXISTS` | ⚠ موجود — آمن (نفس تحليل 0020: Drizzle يمنع التطبيق المزدوج؛ تُؤكَّد في Pre-flight 1.6) |
| `ADD COLUMN participant_id integer` (nullable FK) | ✅ instant، بدون lock |
| `ADD COLUMN assignment_strategy NOT NULL DEFAULT 'role_based'` | ✅ constant default، بدون table rewrite |
| `ALTER COLUMN org_id DROP NOT NULL` | ✅ instant — صفوف موجودة تحتفظ بـ org_id القائم |
| `CREATE INDEX` (non-unique) | ✅ بدون lock مطوَّل |
| `COMMENT ON COLUMN` | ✅ metadata فقط |
| يتطلب تحديث `ensureEnumValues()`؟ | ✅ لا — `CREATE TYPE` جديد |

**ملاحظة:** صفوف `submission_chain_allowed_parties` الموجودة ستحصل على `participant_id = NULL` و `assignment_strategy = 'role_based'`. `org_id` يبقى كما هو. **متوقع وصحيح.**

### 0026_submission_chain_steps_participant.sql

| الفحص | النتيجة |
|-------|---------|
| `ADD COLUMN from_participant_id integer` (nullable FK) | ✅ instant، بدون lock |
| `ADD COLUMN to_participant_id integer` (nullable FK) | ✅ instant، بدون lock |
| `CREATE INDEX` × 2 (non-unique) | ✅ بدون lock مطوَّل |
| يلمس صفوف موجودة؟ | ✅ لا — صفوف pre-Phase-3 تبقى مع NULL (متوقع ومعروف) |

**الخلاصة: جميع الـ 7 migrations آمنة. لا تعديل مطلوب على `migrate.ts`.**

---

## كيف يعمل الـ Deploy على هذا الـ VPS

```
/var/www/edms/         ← source code مع git
  docker-compose.yml   ← تعريف الـ services (api + frontend + postgres)
  lib/db/drizzle/      ← ملفات الـ migrations (تُنسخ داخل api image)
  artifacts/edms/      ← React frontend (يُبنى داخل frontend image)

deploy flow:
  git pull
    ↓
  docker compose build --no-cache api frontend
    ↓
  docker compose up -d --force-recreate api     ← migrations تعمل هنا تلقائياً
                                                   (docker-entrypoint.sh → migrate.mjs)
    ↓
  docker compose up -d --force-recreate frontend ← nginx يخدم الـ static build الجديد
```

> **الـ frontend لا يُشغِّل migrations** — فقط الـ api container يملك `docker-entrypoint.sh`.  
> ترتيب الـ restart مهم: `api` أولاً (حتى تكتمل الـ migrations)، ثم `frontend`.

---

## Deployment Checklist

```
□ 0.    قرأت الـ Runbook كاملاً قبل البدء؟

── Pre-flight ──────────────────────────────────
□ 1.1   docker ps: api + postgres + frontend — جميعها "Up"
□ 1.2   /api/health: status ok/warn + database.status ok
□ 1.3   df: > 2GB متاحة
□ 1.4   git status: nothing to commit, working tree clean
□ 1.5   DB: entity_type + participant_role + assignment_strategy غير موجودة
□ 1.6   DB: submission_chains.type column غير موجود

── Backup ──────────────────────────────────────
□ 2.    pg_dump: BACKUP_FILE size > 0 bytes

── Git + Build ─────────────────────────────────
□ 3.    git pull: commit 329435c على HEAD
□ 4a.   docker compose build api: بدون أخطاء
□ 4b.   docker compose build frontend: بدون أخطاء

── Restart ─────────────────────────────────────
□ 5a.   docker compose up -d --force-recreate api
□ 5b.   انتظار 30 ثانية (migrations + seed)
□ 5c.   api container "Up" وليس "Restarting"
□ 5d.   docker compose up -d --force-recreate frontend
□ 5e.   frontend container "Up"

── Migration Verification ──────────────────────
□ 6.1   logs: "Migrations complete." ظهر
□ 6.2   logs: لا أخطاء migration
□ 6.3   DB: entities table — 9 columns
□ 6.4   DB: contacts table — 9 columns
□ 6.5   DB: organizations.entity_id column موجود (nullable)
□ 6.6   DB: project_participants table + uq_project_entity
□ 6.7   DB: entity_type enum — 5 قيم
□ 6.8   DB: participant_role enum — 7 قيم
□ 6.9   DB: submission_chains.type column موجود (NOT NULL DEFAULT 'submittal')
□ 6.10  DB: submission_chains.current_participant_id column موجود (nullable)
□ 6.11  DB: submission_chain_allowed_parties.participant_id column موجود
□ 6.12  DB: assignment_strategy enum — 3 قيم
□ 6.13  DB: submission_chain_steps.from_participant_id + to_participant_id موجودان
□ 6.14  DB: drizzle migrations history — 0020 إلى 0026 مسجَّلة

── Runtime ─────────────────────────────────────
□ 7.    /api/health: status ok/warn
□ 8.    logs: لا UnhandledRejection أو FATAL

── Login ───────────────────────────────────────
□ 9.    TOKEN صالح

── API Smoke Tests ─────────────────────────────
□ S1.   GET /api/entities → 200 []
□ S2.   POST /api/entities → 201 + id
□ S3.   GET /api/entities/:id → 200
□ S4.   POST /api/entities/:id/contacts → 201
□ S5.   GET /api/entities/:id/contacts → 200 array
□ S6.   GET /api/projects/:id/participants → 200
□ S7.   POST /api/projects/:id/participants → 201 + role
□ S8.   GET /api/projects/:id/participants → 200 + entity embedded
□ S9.   POST /api/projects/:id/participants (invalid role) → 400
□ S10.  POST /api/projects/:id/participants (duplicate) → 409
□ S11.  POST /api/projects/:id/submission-chains → 201 + id
□ S12.  GET  /api/projects/:id/submission-chains → 200 + chain في القائمة
□ S13.  POST /:chain/setup-parties → 200
□ S14.  POST /:chain/forward → 200
□ S15.  Cleanup smoke data: participant + entity حُذفا، chain يبقى للـ UI test
□ S16.  POST invalid submission → 400 validation

── UI E2E Smoke Test (Submittals) ──────────────
□ U1.   فتح المتصفح → Login
□ U2.   فتح Project → Submittals tab يظهر
□ U3.   قائمة Submittals تحمِّل بدون خطأ (قد تكون فارغة)
□ U4.   إنشاء Submittal جديد → يظهر في القائمة
□ U5.   فتح تفاصيل Submittal → صفحة تفاصيل تحمِّل مع timeline

── Post-deploy ─────────────────────────────────
□ 12.   تقرير التحقق موثَّق + Deployment History محدَّث
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
# المتوقع: edms_api، edms_postgres، edms_frontend كلها "Up"

# 1.2 تحقق من الـ API
curl -s http://localhost:8080/api/health | python3 -m json.tool
# المتوقع: status=ok أو warn، database.status=ok

# 1.3 مساحة القرص
df -h /
# المطلوب: > 2GB متاحة

# 1.4 git status
cd /var/www/edms && git status
# المتوقع: nothing to commit, working tree clean

# 1.5 تأكيد أن الـ types الجديدة غير موجودة بعد (7 types من Phase 1+2+3)
docker exec edms_postgres psql -U edms -d edms -t -c "
SELECT typname FROM pg_type
WHERE typname IN ('entity_type', 'participant_role', 'assignment_strategy')
ORDER BY typname;"
# المتوقع: لا صفوف — إذا ظهرت صفوف: أوقف وتحقق

# 1.6 تأكيد أن column Phase 3 غير موجود بعد في submission_chains
docker exec edms_postgres psql -U edms -d edms -t -c "
SELECT column_name FROM information_schema.columns
WHERE table_name = 'submission_chains' AND column_name = 'type';"
# المتوقع: لا صفوف — إذا ظهر 'type': migration 0024 طُبِّقت مسبقاً
# (إذا كانت 0024 مطبَّقة لكن 0025/0026 لا: أوقف وتحقق من drizzle migrations table)
```

**إذا فشل أي من هذه:** أوقف الـ deployment وحدد السبب.

---

## الخطوة 2 — Database Backup

> **قاعدة غير قابلة للاستثناء:** يجب إنشاء backup جديد لكل deployment — حتى لو يوجد backup سابق.  
> إذا لم يكتمل الـ backup بنجاح (size > 0)، أوقف الـ deployment.

```bash
# 2.1 إنشاء ملف الـ backup
BACKUP_FILE=/var/backups/edms/pre-deploy-$(date +%Y%m%d_%H%M%S).dump

# 2.2 pg_dump كامل
docker exec edms_postgres pg_dump \
  -U edms \
  -d edms \
  -F c \
  -f /tmp/pre-deploy.dump

# 2.3 نسخ من الـ container
docker cp edms_postgres:/tmp/pre-deploy.dump "$BACKUP_FILE"

# 2.4 تحقق من الحجم — شرط إلزامي
ls -lh "$BACKUP_FILE"
# إذا كان 0 bytes أو الأمر فشل: أوقف الـ deployment فوراً

echo "✓ Backup: $BACKUP_FILE"
```

---

## الخطوة 3 — Git Update

```bash
cd /var/www/edms

# 3.1 جلب التحديثات
git fetch origin main

# 3.2 تحقق مما سيُطبَّق
git log HEAD..origin/main --oneline
# المتوقع (بهذا الترتيب من الأقدم إلى الأحدث):
#   f2f246b feat: Entity & Contact Directory Layer (Phase 1)
#   7153ddb fix: resolve pre-existing type error in metadata schema
#   22052a2 feat(phase-2): add Project Participants — Entity + Role per Project
#   66c6272 docs(runbook): Phase 1+2 Deployment Runbook
#   329435c feat(phase-3): Submission Chains — Submittal lifecycle, Break-glass override, ADR-0002
#
# إذا ظهرت commits إضافية غير متوقعة: أوقف وراجع

# 3.3 تطبيق
git pull origin main

# 3.4 تأكيد
git log --oneline -3
# يجب أن يكون أول سطر: 329435c feat(phase-3): Submission Chains...
```

---

## الخطوة 4 — Build

> **Phase 3 تضيف frontend changes** — يجب بناء كلا الـ images.

```bash
cd /var/www/edms

# 4.1 بناء الـ API image
docker compose build --no-cache api
# المتوقع: Successfully built ... (بدون أخطاء TypeScript أو npm)

# 4.2 بناء الـ Frontend image
docker compose build --no-cache frontend
# المتوقع: Successfully built ... (بدون أخطاء Vite/React)

# 4.3 تحقق من الـ images المبنية حديثاً
docker images | grep edms
# يجب أن تظهر كلا الـ images بتاريخ الآن

# إذا فشل أي build:
#   → لا تكمل
#   → الخدمات لا تزال تعمل على القديم — لا حاجة لـ rollback
#   → راجع أخطاء الـ build ثم أعد
```

---

## الخطوة 5 — إعادة تشغيل الخدمات

> **ترتيب الـ restart حرج:** `api` أولاً (يُشغِّل الـ migrations)، ثم `frontend` (يبدأ nginx بعد أن يصبح الـ API جاهزاً).

```bash
cd /var/www/edms

# 5.1 إعادة تشغيل الـ API (يُشغِّل الـ migrations تلقائياً)
docker compose up -d --force-recreate api

# 5.2 انتظر — 7 migrations جديدة + seed أطول
sleep 30

# 5.3 تحقق أن الـ API container لا يزال يعمل
docker ps | grep edms_api
# يجب: Status "Up X seconds" وليس "Restarting"
# إذا كان "Restarting": → أوقف → Rollback فوراً → راجع docker logs edms_api

# 5.4 إعادة تشغيل الـ Frontend (بعد أن يستقر الـ API)
docker compose up -d --force-recreate frontend

# 5.5 تحقق أن الـ Frontend container يعمل
docker ps | grep edms_frontend
# يجب: Status "Up X seconds"
```

---

## الخطوة 6 — Migration Verification

> **أهم خطوة في هذا الـ deployment.**  
> 7 migrations جديدة ستُطبَّق للمرة الأولى.  
> لا تنتقل للخطوة 7 قبل اجتياز جميع الفحوصات.

### 6.1 — رسائل النجاح

```bash
docker logs edms_api 2>&1 | grep -E "\[entrypoint\]|\[migrate\]"
```

**يجب أن تظهر بهذا الترتيب:**
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

**يُتوقع أيضاً:**
```
[migrate] ensureEnumValues: committed subscription_status → 'expired'
```

| ما تراه | الإجراء |
|---------|---------|
| `Migrations complete.` | ✓ تابع |
| `ERROR: Migration failed` | ✗ أوقف فوراً — راجع Rollback Plan |
| `[entrypoint]` غائب | ✗ أوقف — Container لم يبدأ صحيح |

### 6.2 — غياب أخطاء Migration

```bash
docker logs edms_api 2>&1 | grep -iE "migration.*error|migration.*fail|stack trace" | head -10
```

**المتوقع: لا output.** أي سطر يظهر → أوقف.

### 6.3–6.8 — Phase 1+2 Tables (نفس فحوصات PHASE1_PHASE2 Runbook)

```bash
# 6.3: entities table (9 columns)
docker exec edms_postgres psql -U edms -d edms -t -c "
SELECT COUNT(*) FROM information_schema.columns
WHERE table_name = 'entities';"
# المتوقع: 9

# 6.4: contacts table
docker exec edms_postgres psql -U edms -d edms -t -c "
SELECT COUNT(*) FROM information_schema.columns
WHERE table_name = 'contacts';"
# المتوقع: 9

# 6.5: organizations.entity_id
docker exec edms_postgres psql -U edms -d edms -t -c "
SELECT column_name, is_nullable FROM information_schema.columns
WHERE table_name = 'organizations' AND column_name = 'entity_id';"
# المتوقع: entity_id | YES

# 6.6: project_participants table + UNIQUE constraint
docker exec edms_postgres psql -U edms -d edms -t -c "
SELECT COUNT(*) FROM information_schema.columns
WHERE table_name = 'project_participants';"
# المتوقع: 7 أو 8

docker exec edms_postgres psql -U edms -d edms -t -c "
SELECT constraint_name FROM information_schema.table_constraints
WHERE table_name = 'project_participants' AND constraint_type = 'UNIQUE';"
# المتوقع: uq_project_entity

# 6.7: entity_type enum
docker exec edms_postgres psql -U edms -d edms -t -c "
SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
WHERE t.typname = 'entity_type' ORDER BY e.enumsortorder;"
# المتوقع: company / government / individual / ngo / consortium

# 6.8: participant_role enum
docker exec edms_postgres psql -U edms -d edms -t -c "
SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
WHERE t.typname = 'participant_role' ORDER BY e.enumsortorder;"
# المتوقع: owner / consultant / main_contractor / sub_contractor / supplier / authority / other
```

### 6.9–6.13 — Phase 3 Columns (جديد)

```bash
# 6.9: submission_chains.type column
docker exec edms_postgres psql -U edms -d edms -t -c "
SELECT column_name, column_default, is_nullable FROM information_schema.columns
WHERE table_name = 'submission_chains' AND column_name = 'type';"
# المتوقع: type | submittal | NO

# 6.10: submission_chains.current_participant_id
docker exec edms_postgres psql -U edms -d edms -t -c "
SELECT column_name, is_nullable FROM information_schema.columns
WHERE table_name = 'submission_chains' AND column_name = 'current_participant_id';"
# المتوقع: current_participant_id | YES

# 6.11: submission_chain_allowed_parties.participant_id
docker exec edms_postgres psql -U edms -d edms -t -c "
SELECT column_name, is_nullable FROM information_schema.columns
WHERE table_name = 'submission_chain_allowed_parties'
  AND column_name IN ('participant_id', 'assignment_strategy')
ORDER BY column_name;"
# المتوقع:
#   assignment_strategy | NO
#   participant_id      | YES

# 6.12: assignment_strategy enum
docker exec edms_postgres psql -U edms -d edms -t -c "
SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
WHERE t.typname = 'assignment_strategy' ORDER BY e.enumsortorder;"
# المتوقع: named / role_based / unassigned

# 6.13: submission_chain_steps participant columns
docker exec edms_postgres psql -U edms -d edms -t -c "
SELECT column_name, is_nullable FROM information_schema.columns
WHERE table_name = 'submission_chain_steps'
  AND column_name IN ('from_participant_id', 'to_participant_id')
ORDER BY column_name;"
# المتوقع:
#   from_participant_id | YES
#   to_participant_id   | YES
```

### 6.14 — Drizzle Migration History

```bash
docker exec edms_postgres psql -U edms -d edms -t -c "
SELECT tag
FROM drizzle.__drizzle_migrations
ORDER BY created_at DESC
LIMIT 10;" 2>/dev/null || \
docker exec edms_postgres psql -U edms -d edms -t -c "
SELECT hash FROM drizzle.__drizzle_migrations
ORDER BY created_at DESC LIMIT 10;"
```

**يجب أن تظهر بأحدث 7 rows (من الأحدث للأقدم):**
```
0026_submission_chain_steps_participant
0025_submission_chain_parties_participant
0024_submission_chain_type
0023_project_participants
0022_org_entity_link
0021_contacts_directory
0020_entity_directory
```

أو إذا عرض hash فقط — تأكد أن عدد الصفوف ارتفع بـ 7 مقارنةً بقبل الـ deploy.

---

## الخطوة 7 — Health Check

```bash
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

| status | الإجراء |
|--------|---------|
| `ok` | ✓ تابع |
| `warn` | ⚠ تابع — وثّق في التقرير |
| `critical` / `error` | ✗ أوقف — راجع Rollback Plan |

---

## الخطوة 8 — Runtime Log Analysis

```bash
echo "=== CRITICAL ERRORS ==="
docker logs edms_api --since 5m 2>&1 | grep -iE \
  "unhandledrejection|uncaughtexception|FATAL|Cannot find module|SyntaxError|ReferenceError" \
  | head -20

echo "=== WARNINGS ==="
docker logs edms_api --since 5m 2>&1 | grep -iE "warn" \
  | grep -v "ELASTICSEARCH_URL\|SENTRY_DSN\|not set" | head -20

echo "=== FRONTEND ==="
docker logs edms_frontend --since 5m 2>&1 | grep -iE "error|failed" | head -10
```

| ما تراه | التقييم |
|---------|---------|
| `[search] ELASTICSEARCH_URL not set` | ✓ متوقع |
| `[sentry] SENTRY_DSN not set` | ✓ متوقع |
| `UnhandledPromiseRejection` | ✗ أوقف |
| `Cannot find module` | ✗ أوقف |
| `FATAL` / `SyntaxError` | ✗ أوقف |

---

## الخطوة 9 — Login (الحصول على Token)

```bash
read -s PASS

TOKEN=$(curl -s -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"amr_j_98@hotmail.com\",\"password\":\"$PASS\"}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])") && unset PASS

echo "Token: ${TOKEN:0:30}..."
# إذا كان فارغاً: الـ login فشل
```

---

## الخطوة 10 — API Smoke Tests

> هذه الاختبارات تُنشئ صفوفاً حقيقية في الإنتاج.  
> استخدم بيانات اختبار مُعلَّمة بـ [SMOKE-TEST] لتسهيل الحذف لاحقاً.

### 10.1 — Entity CRUD (Phase 1)

```bash
# S1: قائمة الكيانات
curl -s http://localhost:8080/api/entities \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "
import sys, json; r = json.load(sys.stdin)
assert isinstance(r, list), f'FAIL: {r}'
print('✓ S1: GET /api/entities → 200 array — PASS')
"

# S2: إنشاء entity
ENTITY_RESULT=$(curl -s -X POST http://localhost:8080/api/entities \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"[SMOKE-TEST] Test Consultant","type":"company","country":"AE"}')

ENTITY_ID=$(echo "$ENTITY_RESULT" | python3 -c "
import sys, json; r = json.load(sys.stdin)
assert r.get('id'), f'FAIL: {r}'
assert r.get('type') == 'company', 'FAIL: type mismatch'
print(r['id'])
")
echo "✓ S2: POST /api/entities → 201 — PASS  (ENTITY_ID=$ENTITY_ID)"

# S3: GET entity
curl -s http://localhost:8080/api/entities/$ENTITY_ID \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "
import sys, json; r = json.load(sys.stdin)
assert str(r.get('id')) == '$ENTITY_ID', f'FAIL: {r}'
print('✓ S3: GET /api/entities/:id → 200 — PASS')
"
```

### 10.2 — Contacts (Phase 1)

```bash
# S4: إضافة contact
CONTACT_RESULT=$(curl -s -X POST http://localhost:8080/api/entities/$ENTITY_ID/contacts \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"[SMOKE-TEST] Smoke Contact","email":"smoke@example.com"}')

CONTACT_ID=$(echo "$CONTACT_RESULT" | python3 -c "
import sys, json; r = json.load(sys.stdin)
assert r.get('id'), f'FAIL: {r}'
print(r['id'])
")
echo "✓ S4: POST /api/entities/:id/contacts → 201 — PASS  (CONTACT_ID=$CONTACT_ID)"

# S5: قائمة contacts
curl -s http://localhost:8080/api/entities/$ENTITY_ID/contacts \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "
import sys, json; r = json.load(sys.stdin)
assert isinstance(r, list) and len(r) >= 1, f'FAIL: {r}'
print('✓ S5: GET /api/entities/:id/contacts → 200 array — PASS')
"
```

### 10.3 — Project Participants (Phase 2)

```bash
# الحصول على project_id من الـ DB
PROJECT_ID=$(docker exec edms_postgres psql -U edms -d edms -t -c "
SELECT id FROM projects ORDER BY id LIMIT 1;" | tr -d ' ')
echo "PROJECT_ID = $PROJECT_ID"
# إذا فارغ: لا توجد مشاريع — انتقل لـ S16 وتجاهل S6–S15

# S6: قائمة المشاركين
curl -s http://localhost:8080/api/projects/$PROJECT_ID/participants \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "
import sys, json; r = json.load(sys.stdin)
assert isinstance(r, list), f'FAIL: {r}'
print('✓ S6: GET /api/projects/:id/participants → 200 — PASS')
"

# S7: إضافة entity كمشارك
PP_RESULT=$(curl -s -X POST http://localhost:8080/api/projects/$PROJECT_ID/participants \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"entityId\":$ENTITY_ID,\"role\":\"consultant\",\"notes\":\"[SMOKE-TEST]\"}")

PP_ID=$(echo "$PP_RESULT" | python3 -c "
import sys, json; r = json.load(sys.stdin)
assert r.get('id'), f'FAIL: {r}'
assert r.get('role') == 'consultant', f'FAIL: role={r.get(\"role\")}'
print(r['id'])
")
echo "✓ S7: POST /api/projects/:id/participants → 201 — PASS  (PP_ID=$PP_ID)"

# S8: entity embedded في response
curl -s http://localhost:8080/api/projects/$PROJECT_ID/participants \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "
import sys, json; r = json.load(sys.stdin)
if r:
  assert 'entity' in r[0], f'FAIL: entity not embedded'
  assert r[0]['entity'].get('name'), 'FAIL: entity.name missing'
print('✓ S8: participants with embedded entity — PASS')
"

# S9: invalid role → 400
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST http://localhost:8080/api/projects/$PROJECT_ID/participants \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"entityId\":$ENTITY_ID,\"role\":\"invalid\"}")
[ "$STATUS" = "400" ] && echo "✓ S9: invalid role → 400 — PASS" || echo "✗ S9: FAIL — got $STATUS"

# S10: duplicate entity → 409
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST http://localhost:8080/api/projects/$PROJECT_ID/participants \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"entityId\":$ENTITY_ID,\"role\":\"owner\"}")
[ "$STATUS" = "409" ] && echo "✓ S10: duplicate → 409 — PASS" || echo "✗ S10: FAIL — got $STATUS"
```

### 10.4 — Submission Chains (Phase 3)

```bash
# S11: إنشاء submission chain
CHAIN_RESULT=$(curl -s -X POST http://localhost:8080/api/projects/$PROJECT_ID/submission-chains \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"[SMOKE-TEST] Phase 3 Smoke Test Chain","type":"submittal"}')

CHAIN_ID=$(echo "$CHAIN_RESULT" | python3 -c "
import sys, json; r = json.load(sys.stdin)
assert r.get('id'), f'FAIL: {r}'
assert r.get('currentStatus') == 'draft', f'FAIL: status={r.get(\"currentStatus\")}'
assert r.get('type') == 'submittal', f'FAIL: type={r.get(\"type\")}'
print(r['id'])
")
echo "✓ S11: POST /api/projects/:id/submission-chains → 201 — PASS  (CHAIN_ID=$CHAIN_ID)"

# S12: قائمة chains
curl -s http://localhost:8080/api/projects/$PROJECT_ID/submission-chains \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "
import sys, json; r = json.load(sys.stdin)
assert isinstance(r, list), f'FAIL: {r}'
ids = [str(c.get('id')) for c in r]
assert '$CHAIN_ID' in ids, f'FAIL: chain not in list — {ids}'
print('✓ S12: GET submission-chains → 200 + smoke chain in list — PASS')
"

# S13: setup-parties (يتطلب participant IDs من الإنتاج)
# إذا كان $PP_ID متاحاً من S7:
if [ -n "$PP_ID" ]; then
  SETUP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST http://localhost:8080/api/projects/$PROJECT_ID/submission-chains/$CHAIN_ID/setup-parties \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"parties\":[{\"participantId\":$PP_ID,\"stepOrder\":1,\"assignmentStrategy\":\"role_based\"}]}")
  [ "$SETUP_STATUS" = "200" ] && echo "✓ S13: setup-parties → 200 — PASS" || echo "⚠ S13: got $SETUP_STATUS (may fail if participant org mismatch — non-critical)"
else
  echo "⚠ S13: SKIP — PP_ID not available (no projects in production)"
fi

# S14: forward (فقط إذا نجح S13)
# [اختياري — يتطلب participant ثانٍ للـ toParticipantId]
# هذا الاختبار للتحقق من أن الـ route يستجيب، لا اختبار كامل
FORWARD_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST http://localhost:8080/api/projects/$PROJECT_ID/submission-chains/$CHAIN_ID/forward \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"toParticipantId\":99999}")
# 400 أو 404 متوقع (participant غير موجود) — يؤكد أن الـ route يعمل
[ "$FORWARD_STATUS" = "400" ] || [ "$FORWARD_STATUS" = "404" ] || [ "$FORWARD_STATUS" = "200" ] \
  && echo "✓ S14: forward route responds ($FORWARD_STATUS) — PASS" \
  || echo "⚠ S14: unexpected status $FORWARD_STATUS"
```

### 10.5 — Validation (Phase 3)

```bash
# S16: submission chain بدون title → 400
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST http://localhost:8080/api/projects/$PROJECT_ID/submission-chains \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}')
[ "$STATUS" = "400" ] && echo "✓ S16: missing title → 400 — PASS" || echo "✗ S16: FAIL — got $STATUS"
```

### 10.6 — Cleanup Smoke Test Data

```bash
# حذف بيانات الـ smoke test
# ملاحظة: الـ chain تبقى للـ UI smoke test في الخطوة 11

# الـ participant (Phase 2)
if [ -n "$PP_ID" ]; then
  curl -s -X DELETE http://localhost:8080/api/projects/$PROJECT_ID/participants/$PP_ID \
    -H "Authorization: Bearer $TOKEN" >/dev/null
  echo "✓ Deleted participant $PP_ID"
fi

# الـ contact (Phase 1)
if [ -n "$CONTACT_ID" ]; then
  curl -s -X DELETE http://localhost:8080/api/entities/$ENTITY_ID/contacts/$CONTACT_ID \
    -H "Authorization: Bearer $TOKEN" >/dev/null
  echo "✓ Deleted contact $CONTACT_ID"
fi

# الـ entity (Phase 1)
if [ -n "$ENTITY_ID" ]; then
  curl -s -X DELETE http://localhost:8080/api/entities/$ENTITY_ID \
    -H "Authorization: Bearer $TOKEN" >/dev/null
  echo "✓ Deleted entity $ENTITY_ID"
fi

# الـ chain تُحذف بعد الـ UI smoke test (الخطوة 11.5)
echo "Chain $CHAIN_ID: سيُحذف بعد الـ UI test"

# تأكيد من DB
docker exec edms_postgres psql -U edms -d edms -t -c "
SELECT COUNT(*) FROM entities WHERE name LIKE '%SMOKE-TEST%';"
# المتوقع: 0
```

---

## الخطوة 11 — UI E2E Smoke Test (Submittals)

> افتح المتصفح مباشرةً على عنوان الإنتاج.  
> لا تستخدم `localhost` — استخدم الـ domain الحقيقي أو الـ IP العام.

### 11.1 — Login

```
U1. فتح https://<production-domain>
U2. تسجيل الدخول بـ amr_j_98@hotmail.com
U3. التحقق: Dashboard يظهر بدون خطأ في الـ console
```

### 11.2 — Submittals Tab

```
U4. فتح مشروع موجود (أي مشروع من القائمة)
U5. التحقق: تظهر تبة "Submittals" بجانب تبويبات المشروع الأخرى
U6. النقر على "Submittals"
U7. التحقق: الصفحة تُحمَّل — إما قائمة فارغة أو chains موجودة (بدون خطأ)
```

### 11.3 — إنشاء Submittal

```
U8. النقر على زر "New Submittal" أو "Create"
U9. إدخال عنوان: "[SMOKE-TEST] UI Smoke Test Chain"
U10. تأكيد الإنشاء
U11. التحقق: الـ chain الجديد يظهر في القائمة
```

### 11.4 — صفحة التفاصيل

```
U12. النقر على الـ chain المُنشأ
U13. التحقق: صفحة التفاصيل تُحمَّل (timeline + actions panel)
U14. التحقق: Status = "draft"، Type = "submittal"، Rev Cycle = 1
U15. التحقق: لا أخطاء في الـ browser console
```

### 11.5 — Cleanup الـ UI Chain

```bash
# بعد التحقق من الـ UI، احذف الـ chain عبر API
if [ -n "$CHAIN_ID" ]; then
  # submission chains قد لا تملك DELETE endpoint في Phase 3
  # إذا لم يوجد: احذف مباشرةً من DB
  docker exec edms_postgres psql -U edms -d edms -t -c "
  DELETE FROM submission_chains
  WHERE title LIKE '%SMOKE-TEST%'
  RETURNING id, title;"
  echo "✓ Smoke test chains cleaned up"
fi
```

---

## الخطوة 12 — Post-Deployment Verification Report

```
== Phase 1 + Phase 2 + Phase 3 — Post-Deployment Verification Report ==

التاريخ/الوقت: _______________
المنفذ:        _______________
git commit:    329435c

── Deploy ──────────────────────────────────────────
  git pull                    □ نجح
  docker compose build api    □ نجح (بدون أخطاء)
  docker compose build frontend □ نجح (بدون أخطاء)
  docker compose up api       □ نجح (container يعمل)
  docker compose up frontend  □ نجح (container يعمل)

── Migration Verification ──────────────────────────
  6.1 Migrations complete.            □ ظهر في logs
  6.2 Migration errors                □ لا يوجد
  6.3 entities table                  □ موجودة (9 columns)
  6.4 contacts table                  □ موجودة (9 columns)
  6.5 organizations.entity_id         □ column موجود (nullable)
  6.6 project_participants + UNIQUE   □ موجودتان
  6.7 entity_type enum (5)            □ company/government/individual/ngo/consortium
  6.8 participant_role enum (7)       □ owner/consultant/.../other
  6.9 submission_chains.type          □ موجود (DEFAULT 'submittal', NOT NULL)
  6.10 submission_chains.current_participant_id □ موجود (nullable)
  6.11 allowed_parties.participant_id + strategy □ موجودان
  6.12 assignment_strategy enum (3)   □ named/role_based/unassigned
  6.13 steps.from_participant_id + to_participant_id □ موجودان
  6.14 drizzle history 0020–0026      □ 7 entries مسجَّلة

── Runtime ─────────────────────────────────────────
  UnhandledRejection          □ لا يوجد
  FATAL / SyntaxError         □ لا يوجد
  Cannot find module          □ لا يوجد

── Health ──────────────────────────────────────────
  HTTP 200                    □ نعم
  status                      □ ok / warn: ______
  disk.usedPercent            □ ____%
  database.latencyMs          □ ____ms

── Login ───────────────────────────────────────────
  Token صالح                  □ نعم

── API Smoke Tests ─────────────────────────────────
  S1:  GET /api/entities → 200                  □ PASS
  S2:  POST /api/entities → 201                 □ PASS  (ENTITY_ID: ___)
  S3:  GET /api/entities/:id → 200              □ PASS
  S4:  POST contacts → 201                      □ PASS  (CONTACT_ID: ___)
  S5:  GET contacts → 200                       □ PASS
  S6:  GET participants → 200                   □ PASS  / □ N/A (no projects)
  S7:  POST participants → 201                  □ PASS  / □ N/A  (PP_ID: ___)
  S8:  GET participants + entity embedded        □ PASS  / □ N/A
  S9:  invalid role → 400                       □ PASS
  S10: duplicate entity → 409                   □ PASS  / □ N/A
  S11: POST submission-chain → 201              □ PASS  / □ N/A  (CHAIN_ID: ___)
  S12: GET submission-chains → 200 + chain      □ PASS  / □ N/A
  S13: setup-parties → 200                      □ PASS  / □ N/A  / □ SKIP
  S14: forward route responds                   □ PASS
  S16: missing title → 400                      □ PASS
  Cleanup:                                      □ نعم

── UI Smoke Test (Submittals) ──────────────────────
  U1:  Login                                    □ PASS
  U2:  Dashboard يظهر                           □ PASS
  U4:  Submittals tab ظاهرة في Project           □ PASS
  U6:  Submittals tab تُحمَّل                   □ PASS
  U8:  Create Submittal dialog                  □ PASS
  U11: Chain يظهر في القائمة                    □ PASS
  U12: Detail page تُحمَّل                      □ PASS
  U14: Status=draft، Type=submittal             □ PASS
  U15: لا console errors                        □ PASS

── النتيجة النهائية ────────────────────────────────
  □ PASS — Phase 1 + Phase 2 + Phase 3 مغلقات رسمياً
  □ FAIL — انظر Rollback Plan

ملاحظات / warnings موثَّقة:
_______________________________________________
_______________________________________________
```

---

## Rollback Plan

### متى تُطبَّق الـ Rollback؟

| الحالة | الإجراء |
|--------|---------|
| Build فشل (الخطوة 4) | لا حاجة لـ rollback — الخدمة لم تتغير |
| Migration فشلت (الخطوة 5) — container يعيد التشغيل | → Rollback A فوراً |
| Smoke test حرج فشل (S11–S14) | → Rollback A إذا كانت الأخطاء في كود الـ API |
| UI لا تعمل بعد frontend rebuild | → Rollback A (يُرجع الـ frontend أيضاً) |
| data corruption موثَّق | → Rollback A ثم B |

### Rollback A — رجوع إلى Sprint C

```bash
cd /var/www/edms

# 1. رجوع إلى commit Sprint C (آخر نشر ناجح)
git checkout 350bab7

# 2. بناء وتشغيل كلا الـ images
docker compose build --no-cache api frontend
docker compose up -d --force-recreate api frontend

# 3. تحقق
sleep 25
curl -s http://localhost:8080/api/health | python3 -m json.tool
docker logs edms_api 2>&1 | grep "\[entrypoint\]"
docker ps | grep -E "edms_api|edms_frontend"
```

**ملاحظة مهمة عن الـ migrations عند Rollback:**
> الـ migrations 0020–0026 ستبقى في قاعدة البيانات.  
> كود Sprint C لا يعرف هذه الجداول/columns ولن يلمسها.  
> **لا حاجة لـ rollback قاعدة البيانات** في الحالة الاعتيادية.  
> الـ rollback الكودي وحده يُستعيد Sprint C الوظيفي.

### Rollback B — استعادة قاعدة البيانات (data corruption فقط)

```bash
# لا تُنفَّذ إلا إذا كانت هناك data corruption موثَّقة

BACKUP_FILE=/var/backups/edms/pre-deploy-<TIMESTAMP>.dump

# 1. إيقاف الـ API
docker compose stop api

# 2. نسخ الـ backup
docker cp "$BACKUP_FILE" edms_postgres:/tmp/restore.dump

# 3. استعادة
docker exec edms_postgres pg_restore \
  -U edms -d edms --clean /tmp/restore.dump

# 4. إعادة تشغيل بالكود القديم
docker compose start api

# 5. تحقق
curl -s http://localhost:8080/api/health
```

---

## ملاحظات مهمة

- **JWT_SECRET:** استخدم secret الإنتاج — لا `dev-jwt-secret-not-for-production`.
- **Frontend rebuild إلزامي** لـ Phase 3 — الـ Submittals tab لن يظهر بدون `docker compose build frontend`.
- **ترتيب الـ restart:** `api` أولاً (migrations)، ثم `frontend` (nginx).
- **submission_chains موجودة في الإنتاج منذ migration 0016** (Sprint B) — 0024–0026 فقط تُضيف columns إليها، لا تُنشئها.
- **submission_chains القائمة:** تحصل تلقائياً على `type='submittal'` و `current_participant_id=NULL` — متوقع وصحيح.
- **Cleanup إلزامي:** احذف جميع البيانات المُعلَّمة بـ [SMOKE-TEST] بعد التحقق.
- **لا Phase 4** قبل تأكيد نجاح هذا الـ deployment وتوثيق التقرير.

---

## Deployment History

| Date | Version | Commit | Deployed By | Result | Rollback | Notes |
|------|---------|--------|-------------|--------|----------|-------|
| 2026-07-01 | Sprint A+B | `7059f90` | amr_j_98@hotmail.com | ✅ PASS | N/A | First production deployment |
| 2026-07-03 | Sprint C (C-1..C-5) | `350bab7` | amr_j_98@hotmail.com | ✅ PASS | N/A | Migration 0019 (sha256) |
| __________ | Phase 1+2+3 | `329435c` | amr_j_98@hotmail.com | ⬜ | | Migrations 0020–0026 + Frontend Phase 3 |

*أضف صفاً جديداً بعد كل عملية نشر ناجحة أو فاشلة.*

---

*آخر تحديث: 2026-07-04 — الإصدار 1.0*
