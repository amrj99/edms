# Architecture Debt Register — ArcScale EDMS

**آخر تحديث:** 2026-06-30 (ADR-01 RESOLVED)
**الحالة الإجمالية:** Phase 1 (RC-01 → RC-06) مكتملة ✅ | ADR-01 مُعالج ✅ | المشروع في مرحلة Feature Development

**الغرض من هذا السجل:** توثيق الديون المعمارية وقرارات الـ FUTURE/POLICY المؤجلة، مستقلةً عن سجل الـ Root Causes. كل بند هنا لا يمثل خللاً وظيفياً بل قراراً واعياً بالتأجيل أو مخاطرة مقبولة تم توثيقها.

---

## دليل الحالات

| الحالة | المعنى |
|--------|--------|
| `INVESTIGATE` | يحتاج تحقيقاً أعمق قبل أي قرار |
| `WATCH` | مراقبة — لا حاجة للتدخل حتى تتكرر النمطية |
| `FUTURE` | قرار تقني مؤجل لمرحلة قادمة محددة |
| `POLICY` | يحتاج قراراً من Product/Business قبل التنفيذ |
| `ACCEPTED_RISK` | مخاطرة معروفة، مقبولة بوعي مع شرط إعادة التقييم |
| `DECISION_PENDING` | في انتظار قرار Product/Policy صريح |
| `RESOLVED` | تم الحل — موثق للتاريخ |

---

## ADR-01 — Runtime / Build Divergence على Windows ✅

| الحقل | القيمة |
|-------|--------|
| **الحالة** | `RESOLVED` — ضمن المعمارية الحالية |
| **الأولوية** | ~~عالية~~ — مُعالج |
| **اكتُشف في** | Phase Closure Verification — 2026-06-30 |
| **حُلّ في** | ADR-01 Implementation Session — 2026-06-30 |
| **يؤثر على** | دورة تطوير الـ API — محلول بـ Docker dev mode |
| **ملاحظة** | مجال مفتوح لإعادة التقييم إن تغيرت بيئة التطوير |

### الملاحظة الأصلية (Observed)

`pnpm dev` script القديم في `artifacts/api-server/package.json`:
```
"dev": "export NODE_ENV=development && pnpm run build && node --enable-source-maps ./start.mjs"
```

- `export` هو أمر Unix/bash — يفشل على Windows PowerShell و cmd
- الـ Dockerfile Stage 5 (`api`) ينسخ `dist/` فقط — لا source files في الـ container
- `docker-compose.yml`: لا source bind mount
- `docker-compose.override.yml`: `NODE_ENV: development` فقط — لا hot-reload

### Root Cause الكامل (3 طبقات)

| الطبقة | الوصف | الحل |
|--------|-------|------|
| Layer 1 | `export` syntax على Windows | `dev.mjs` wrapper بـ Node.js خالص |
| Layer 2 | pnpm transitive deps لا تُحلّ محلياً عبر esbuild على Windows | Docker dev mode (pnpm يعمل صحيح داخل Docker) |
| Layer 3 | `postgres` hostname لا يُحلّ خارج Docker | Docker dev mode (الـ network داخلي) |

**Layer 1 و 2 و 3 محلولة بالكامل عبر Docker dev mode.**  
**Layer 1 محلولة أيضاً للـ Local Native Dev (بعد `pnpm install` صحيح).**

### الـ Workaround السابق (Phase 1) — مُعتزَل

~~Dist patching مباشرة داخل الـ container عبر `docker cp` + node scripts.~~  
**هذا الأسلوب لم يعد ضرورياً.**

### Fix المطبّق

**الملفات الجديدة/المعدّلة:**

1. **`artifacts/api-server/dev.mjs`** — wrapper cross-platform جديد:
   - `process.env.NODE_ENV ??= 'development'` بدلاً من `export`
   - `execFileSync(node, ['build.mjs'])` لتشغيل البناء synchronously
   - `await import('./start.mjs')` لتشغيل الـ server
   - يعمل على Windows / Linux / Mac و داخل Docker

2. **`artifacts/api-server/package.json`** — script مُحدَّث:
   ```json
   "dev": "node --enable-source-maps dev.mjs"
   ```

3. **`docker-compose.dev.yml`** — ملف dev جديد عند root المشروع:
   - يستخدم `api-builder` stage (يملك devDeps + source)
   - يربط `./artifacts/api-server/src:/app/artifacts/api-server/src:ro`
   - يُشغّل `node dev.mjs` عند بدء الـ container
   - يُكشف postgres على `localhost:5432` لـ Local Native Dev

### التحقق (Verified — 2026-06-30)

| الاختبار | النتيجة |
|---------|---------|
| Docker build (`api-builder` target) | ✅ نجح — `dev.mjs` موجود في الـ image |
| `dev.mjs` يبني من المصدر المربوط | ✅ `dist/` أُعيد بناؤه بنجاح |
| API يستجيب على port 8090 | ✅ `status: ok`, `database: connected`, `environment: development` |
| Iteration loop — تعديل `health.ts` + `docker restart` | ✅ `devMode: true` ظهر بلا patching |
| إعادة الـ containers الأصلية سليمة | ✅ `edms_api` لا يزال healthy |

### سير العمل الجديد (Docker Dev Mode)

```bash
# بناء الـ dev image (مرة واحدة أو عند تغيير lib/ أو Dockerfile)
docker-compose -f docker-compose.yml -f docker-compose.dev.yml build api

# تشغيل في dev mode
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d api

# بعد تعديل src/ → إعادة build + start بأمر واحد
docker-compose -f docker-compose.yml -f docker-compose.dev.yml restart api
```

### حدود التصميم الحالي — Manual Restart

دورة التطوير الحالية تعتمد على:
```
تعديل src/ → docker restart api → التغيير مرئي
```

هذا مناسب للمرحلة الحالية وتم التحقق منه. الـ Restart اليدوي ليس التصميم النهائي بالضرورة.

**مستقبل مُرجَأ (لا قرار الآن):** إذا أصبح الـ Restart اليدوي عقبة حقيقية في دورة التطوير، يمكن تقييم:
- esbuild watch mode داخل الـ container
- nodemon/tsx watch للـ TypeScript source

لا يُنفَّذ الآن لأن الفائدة لم تُثبت بعد. يُعاد تقييمه عند ظهور حاجة حقيقية.

### ملاحظة — Local Native Dev (خارج Docker)

يعمل `pnpm dev` محلياً بعد شرطين:
1. `pnpm install` صحيح على مستوى workspace (حتى تُحلّ transitive deps)
2. postgres متاح على `localhost:5432` (عبر `docker-compose.dev.yml up postgres`)

اختبار `pnpm run build` المحلي كشف أن التثبيت الحالي ناقص. هذا لا يؤثر على Docker dev mode الذي يملك pnpm store كامل.

---

## ADR-02 — Notification Creation Pattern Duplication

| الحقل | القيمة |
|-------|--------|
| **الحالة** | `WATCH` |
| **الأولوية** | منخفضة |
| **اكتُشف في** | RC-04 implementation — 2026-06-30 |
| **يؤثر على** | `transmittals.ts`, `tasks.ts`, وأي route مستقبلية تستخدم notifications |

### الملاحظة

منطق إنشاء الـ notifications يتكرر عبر modules مختلفة بنفس الشكل:
```typescript
// نمط يتكرر في transmittals.ts وsupported tasks
await db.insert(notificationsTable).values({
  type: "...",
  entityId: ...,
  entityType: "...",
  userId: ...,
  organizationId: ...
});
```

### القرار

في RC-04: لا حاجة لـ Generic Layer حتى الآن. النمط مقبول في موضعين.  
**إذا تكرر في 3+ modules بنفس الشكل** → إعادة تقييم وإنشاء `createNotification()` helper.

### شرط إعادة التقييم

عند إضافة notification في module ثالث → مراجعة هذا البند وتحديث الحالة.

---

## ADR-03 — State Transition Centralization (AP-VI)

| الحقل | القيمة |
|-------|--------|
| **الحالة** | `FUTURE` |
| **الأولوية** | متوسطة |
| **اكتُشف في** | RC-02/03 analysis — Phase 1 |
| **يؤثر على** | `transmittals.ts` — حالات: `draft → sent → acknowledged` |

### الملاحظة

تحولات الحالة في الـ transmittals تُكتب inline داخل route handlers. لا يوجد state machine مركزي.  
حالياً: 3 حالات فقط (`draft`, `sent`, `acknowledged`) — Complexity منخفضة.

### القرار

State machine مركزي غير مبرر حالياً. إذا وصلت الحالات إلى 5+ أو بدأ التحقق من التحولات يتكرر، يصبح مبرراً.

### شرط إعادة التقييم

إضافة حالة جديدة لـ transmittals، أو إضافة نوع entity جديد بـ state machine مماثل.

---

## ADR-04 — submissionChainAllowedPartiesTable

| الحقل | القيمة |
|-------|--------|
| **الحالة** | `FUTURE` / `POLICY` |
| **الأولوية** | متوسطة (Security-adjacent) |
| **اكتُشف في** | RC-05 Decision C — 2026-06-30 |
| **يؤثر على** | `submission_chain_allowed_parties` — الجدول موجود في schema، غير مستخدم |

### الملاحظة

الجدول `submissionChainAllowedPartiesTable` معرّف في الـ schema لكن لم يُستخدم. RC-05 اعتمد على `currentOrgId` و `originatingOrgId` فقط للتحكم في الوصول.

### القرار المؤجل

هل يجب تقييد access للـ submission chains على parties محددة فقط (خلاف الـ originator والـ custodian الحاليين)؟  
هذا قرار **Product/Policy** — من يحق له رؤية Chain لم يُرسل إليه بعد؟

### الخطوة التالية

يُعرض على Product Owner في بداية المرحلة التالية.

---

## ADR-05 — toOrgId Validation في Submission Chains

| الحقل | القيمة |
|-------|--------|
| **الحالة** | `FUTURE` |
| **الأولوية** | منخفضة |
| **اكتُشف في** | RC-05 code review — 2026-06-30 |
| **يؤثر على** | `POST /:id/forward` endpoint |

### الملاحظة

عند Forward، يُقبل `toOrgId` أي قيمة صحيحة دون التحقق من أن الـ Organization موجودة في DB أو أنها مشاركة في المشروع.

### التقدير

خطر منخفض في الوقت الحالي — البيانات التجريبية محدودة والمستخدمون داخليون.  
عند الوصول إلى Multi-Org production environment، يجب إضافة:
```sql
SELECT id FROM organizations WHERE id = $toOrgId
-- أو --
SELECT org_id FROM project_org_memberships WHERE project_id = $projectId AND org_id = $toOrgId
```

### شرط إعادة التقييم

قبل onboarding أول client حقيقي متعدد المنظمات.

---

## ADR-06 — Row-Level Security (RLS)

| الحقل | القيمة |
|-------|--------|
| **الحالة** | `ACCEPTED_RISK` |
| **الأولوية** | عالية (قبل Prod) |
| **اكتُشف في** | MULTI_TENANT_BOUNDARIES.md — Phase 1 |
| **يؤثر على** | جميع الجداول — Multi-tenancy enforced في application layer |

### الملاحظة

لا يوجد PostgreSQL Row-Level Security (RLS). العزل بين المنظمات يعتمد على:
- `organizationId` filter في كل query
- Middleware `requireAuth` + `requireRole`
- Organization-scoped access checks في كل route

### المخاطرة المقبولة

Bug في أي route يمكن أن يُسرّب بيانات من organization أخرى. لا يوجد safety net على مستوى DB.

### شرط إعادة التقييم

**لازم قبل أول client حقيقي.** RLS لا يعني إعادة كتابة كل شيء — يمكن إضافته كطبقة إضافية فوق application logic الحالي.

---

## ADR-07 — Decision D: rejected Write-Lock

| الحقل | القيمة |
|-------|--------|
| **الحالة** | `DECISION_PENDING` |
| **الأولوية** | متوسطة |
| **اكتُشف في** | RC-06 analysis — 2026-06-30 |
| **يؤثر على** | `PUT /transmittals/:id` — write-lock logic |

### الملاحظة

RC-06 طبّق write-lock على الحالات: `sent`, `acknowledged`, `void`.  
السؤال المؤجل: هل يجب lock على حالة `rejected` أيضاً؟

### الحالة الحالية للكود

```typescript
// في transmittals.ts — الحالات المقفلة حالياً:
if (["sent", "acknowledged", "void"].includes(existing.status)) {
  return res.status(409).json({ error: "Transmittal cannot be edited in its current status" });
}
// rejected غير موجودة في هذه القائمة → يمكن تعديلها
```

### القرار المطلوب

هل `rejected` transmittal يُعتبر "نهائياً" (write-lock) أم يُسمح بتعديله وإعادة إرساله؟  
هذا قرار **Product** — يعتمد على workflow المطلوب للـ rejection scenario.

### الخطوة التالية

يُعرض على Product Owner. اتخاذ القرار يستغرق 15 دقيقة تنفيذاً بعد الموافقة.

---

## ADR-08 — Seed Data: responsibleRole Values

| الحقل | القيمة |
|-------|--------|
| **الحالة** | `FUTURE` (DX) |
| **الأولوية** | منخفضة |
| **اكتُشف في** | Phase Closure Verification — 2026-06-30 |
| **يؤثر على** | `workflow_stages` seed data — بيئة التطوير فقط |
| **Chip** | `task_f53a69fe` (background chip — DX fix) |

### الملاحظة

قيم `responsibleRole` في seed data لـ workflow stages لا تتطابق مع roles المستخدمين التجريبيين.  
هذا يؤثر على تجربة التطوير فقط — لا أثر على الـ production logic.

### القرار

تم تسجيله كـ background chip (`task_f53a69fe`). يُطبق في بداية أي جلسة تطوير تحتاج workflow testing دقيق.

---

## ADR-09 — Cross-Org `assignedToId` في Manual Tasks

| الحقل | القيمة |
|-------|--------|
| **الحالة** | `FUTURE` — يُعالَج ضمن Party Model |
| **الأولوية** | منخفضة (لا وصول فعلي للبيانات) |
| **اكتُشف في** | Day-1 Hardening — Tasks Security Review — 2026-07-04 |
| **يؤثر على** | `POST /tasks` و `PUT /tasks/:id` — تعيين tasks يدوياً |

### الملاحظة

`assignedToId` في إنشاء Task وتعديلها (POST / و PUT /:id) لا يُتحقَّق من أنه ينتمي لنفس منظمة المُنشئ. إذا عرف مستخدم ID مستخدم من منظمة أخرى، يمكنه:
1. إنشاء task وإرسال notification + email لذلك المستخدم
2. Task تحمل `organizationId` للمنظمة المُنشئة — المستخدم الأجنبي لا يراها

### التمييز عن A-4

| | A-4 (مُغلَق) | ADR-09 (مؤجَّل) |
|---|---|---|
| **الـ Endpoint** | `POST /:id/submit-review` | `POST /tasks`, `PUT /tasks/:id` |
| **هل Task مرئية للمستخدم الأجنبي؟** | كانت نعم (قبل الإصلاح) | لا — task مقيَّدة بمنظمة المُنشئ |
| **الأثر الفعلي** | وصول للبيانات ← ثغرة | notification فقط ← تسرب معلومات منخفض |

### لماذا لم يُصلَح في Day-1

- لا وصول فعلي للبيانات (task لا تظهر للمستخدم الأجنبي)
- التأثير محدود بعنوان الـ task في notification فقط
- Party Model سيُعيد تعريف "من يحق له أن يكون assignee" بشكل بنيوي — الإصلاح هنا سيصبح ضرورياً وطبيعياً

### الخطوة التالية

عند بناء Party Model: `assignedToId` يُستبدل بـ party-based assignment. التحقق من المنظمة يصبح جزءاً من Party authorization path.

---

## سجل التحديثات

| التاريخ | الإصدار | التغيير |
|---------|---------|---------|
| 2026-06-30 | v1.0 | إنشاء السجل — 8 بنود من Phase 1 |
| 2026-06-30 | v1.1 | ADR-01: INVESTIGATE → RESOLVED — `dev.mjs` + `docker-compose.dev.yml` مُطبَّقان ومُختبَران |
| 2026-07-04 | v1.2 | ADR-09: تسجيل Known Design Gap — cross-org assignedToId في manual tasks (Day-1 Hardening review) |

---

## الإجراءات المطلوبة من Product

| البند | الإجراء المطلوب | المسؤول |
|-------|----------------|---------|
| ADR-04 | تحديد policy الوصول للـ Submission Chains | Product Owner |
| ADR-07 | قرار write-lock على `rejected` transmittals | Product Owner |

---

*هذا السجل يُحدَّث في نهاية كل Phase أو عند اكتشاف دين معماري جديد.*
