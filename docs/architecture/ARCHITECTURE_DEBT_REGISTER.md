# Architecture Debt Register — ArcScale EDMS

**آخر تحديث:** 2026-07-10 (ADR-12 + ADR-13 مُسجَّلان — Phase 8B-1)
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

## ADR-10 — download = read في Party Model Minimum

| الحقل | القيمة |
|-------|--------|
| **الحالة** | `FUTURE` |
| **الأولوية** | منخفضة |
| **اكتُشف في** | Phase 5 Design Review — 2026-07-05 |
| **يؤثر على** | `GET /api/projects/:id/documents/:id/download` — وصول party members للملفات |

### الملاحظة

في Party Model Minimum (Phase 5)، `download` يُعامَل كامتداد لـ `read`. أي party member يستطيع قراءة وثيقة يستطيع تنزيلها — لا فصل بين رؤية قائمة الوثائق وتنزيل المحتوى.

هذا القرار مقصود للحد الأدنى: القيمة الفعلية من وصول observer هي قراءة المحتوى، لا مجرد رؤية الاسم.

### السيناريو المؤجَّل

في المشاريع ذات البروتوكولات الصارمة (ISO 19650)، الوثيقة لا "تُوزَّع" رسمياً إلا بعد transmittal رسمي. التنزيل قبل الـ transmittal يتجاوز هذا الإجراء.

**النموذج المستقبلي:** observer يرى metadata الوثيقة لكن يُنزِّل فقط ما وُزِّع إليه عبر transmittal رسمي من Org A (`download_requires_transmittal` ceiling).

### الخطوة التالية

يُقيَّم ضمن APF عند بناء fine-grained ceiling controls.

---

## ADR-11 — Migration Tracking Drift

| الحقل | القيمة |
|-------|--------|
| **الحالة** | `FUTURE` |
| **الأولوية** | متوسطة (Operational Risk) |
| **اكتُشف في** | Phase 5 Production Deploy — 2026-07-05 |
| **يؤثر على** | `docker-entrypoint.sh` → `migrate.ts` — كل عملية نشر |

### الملاحظة

أثناء نشر Phase 5، اكتُشف أن migrations 0020-0027 كانت مطبَّقة يدويًا على production DB في جلسات سابقة، لكن سجل Drizzle tracking (`drizzle.__drizzle_migrations`) لم يُحدَّث. عند محاولة تشغيل الكود الجديد:

- Drizzle رأى 19 tracked migrations من أصل 29 في الـ journal
- حاول تطبيق 10 migrations "فائتة"، فيها `CREATE TYPE entity_type` — فشل لأن النوع موجود فعلًا

**الأثر:** API دخل في restart loop خلال نافذة downtime قصيرة. الحل يدوي (INSERT 7 tracking records).

### جذر المشكلة

`ensureBaseline()` في [`migrate.ts`](../../artifacts/api-server/src/migrate.ts) تعالج الحالة التي يكون فيها `drizzle` schema غائبًا كليًا (DB قديمة بدون tracking). لكنها لا تعالج:

> **"drizzle schema موجود، لكن بعض migrations في الـ journal لا توجد في الـ tracking وهي مطبَّقة فعلًا في الـ schema"**

هذا التقصير يمكن أن يتكرر في أي deployment تم فيه تطبيق migration خارج الآلية الرسمية.

### `repairStaleBaseline()` — الحماية الحالية ونقاط ضعفها

الدالة الموجودة حاليًا تتحقق فقط من `CREATE INDEX` migrations عبر `pg_indexes`. لا تتحقق من:
- Enum types (`pg_type`)
- Tables (`information_schema.tables`)
- Columns (`information_schema.columns`)
- Constraints

### الحل المقترح (لا تنفيذ الآن)

**Migration Health Audit** — يضاف لـ `migrate.ts` كدالة `auditMigrationDrift()`:

```
للقراءة فقط — يُشغَّل قبل migrate() وبعد repairStaleBaseline()

لكل journal entry:
  1. احسب hash من الملف
  2. تحقق هل هو في tracking table
  3. إذا غائب: فحص DB الفعلي (pg_type, information_schema, pg_indexes)
  4. إذا Schema موجود: أضف tracking record + سجّل تحذير
  5. إذا Schema غائب: اتركه لـ migrate() يشغّله طبيعيًا

المخرج: تحذير واضح في logs عند وجود drift
```

### قيود قبل التنفيذ

- الفحص يحتاج أن يعرف "signature" كل migration (ماذا تنشئ بالضبط) — هذا يعني إما parsing SQL أو metadata خارجية
- الأبسط: تسجيل الـ drift كـ warning وإجراء يدوي للتحقق (وليس auto-fix)
- الأفضل طويل المدى: منع تطبيق أي migration خارج الآلية الرسمية من الأساس (process rule)

### الخطوة التالية

يُعالَج ضمن Phase 5.1 (Operational Hardening) أو كـ standalone task قبل أول multi-environment deployment.

---

## ADR-12 — Legal Localization Blocker: Arabic Terms Review

| الحقل | القيمة |
|-------|--------|
| **الحالة** | `POLICY` |
| **الأولوية** | عالية (قبل أي إطلاق تجاري بالعربية / قبل ادعاء أن الشروط ثنائية اللغة) |
| **اكتُشف في** | Phase 8B-1 — Authentication Journey Vertical Slice — 2026-07-10 |
| **يؤثر على** | `components/legal/TermsGate.tsx`, `components/legal/LegalModals.tsx`, `lib/i18n/dictionaries/legal.ts` |

### الملاحظة

في Phase 8B-1 تُرجمت **واجهة** المكوّنات القانونية بالكامل (العناوين، الأزرار، تعليمات التمرير، checkbox الموافقة، الـ toasts). لكن **نص الاتفاقية القانوني نفسه** (Terms of Use + Privacy Policy body — الأقسام المرقّمة) بقي في صياغته الإنجليزية المعتمدة ولم يُترجَم آلياً.

عند `lang=ar` يظهر إشعار `legal.notice.arabicPending` (بانر amber) فوق النص الإنجليزي يُعلم المستخدم العربي بأن النسخة العربية قيد المراجعة القانونية المتخصصة، وأن الموافقة تعني الموافقة على النص الإنجليزي المعروض.

### السبب (لماذا لم يُترجَم آلياً)

الترجمة الآلية لنص قانوني ملزِم تحمل **مسؤولية قانونية** — الصياغة القانونية العربية يجب أن تُعتمد من مختص، لا أن تُولَّد آلياً.

### الأثر على الـ Hardcoded Guard

الـ 34 نتيجة `latin` المتبقية في الملفين (`LegalModals.tsx`=25, `TermsGate.tsx`=9 في `i18n-baseline.json`) هي **النص القانوني الإنجليزي المقصود** — وليست ديناً يُغلَق بترجمة الفاحص. لا يجوز خفضها بترجمة آلية.

### القرار

`POLICY` — لا تُترجم الاتفاقية آلياً. الانتظار لمراجعة قانونية عربية معتمدة. **لا يُدَّعى أن محتوى الشروط مكتمل ثنائي اللغة قبل اعتماد الصياغة العربية قانونياً.**

### الخطوة التالية (الإجراء المطلوب)

مراجعة قانونية عربية معتمدة → إضافة النسخة العربية المعتمدة إلى `legal.ts` → إزالة إشعار `arabicPending` → تحديث هذا البند إلى `RESOLVED`.

---

## ADR-13 — Language Toggle Logic Duplication

| الحقل | القيمة |
|-------|--------|
| **الحالة** | `FUTURE` (DX / Refactor) |
| **الأولوية** | منخفضة |
| **اكتُشف في** | Phase 8B-1 — 2026-07-10 |
| **يؤثر على** | `components/layout/AppLayout.tsx` (`LanguageToggle` غير مُصدَّر، ~سطر 643), `components/auth/AuthLanguageToggle.tsx` |
| **Chip** | `task_ae214f34` (background chip — refactor) |

### الملاحظة

منطق قلب اللغة (`useI18n().setLang(lang==='en'?'ar':'en')` + رسم العلَم/التسمية) مكرَّر في موضعين. الـ `LanguageToggle` الرئيسي **دالة محلية غير مُصدَّرة داخل `AppLayout.tsx`** فلا يمكن استيرادها؛ ولأن صفحات المصادقة تُعرَض **خارج** `AppLayout`، أُنشئ `AuthLanguageToggle` الذي أعاد تنفيذ نفس المنطق الجوهري.

الفروق تنسيقية فقط (الأساسي: `ghost` inline بنصوص hardcoded؛ الجديد: `outline` + fixed `end-4` + تسميات عبر `t()`).

### القرار

استخراج مكوّن/هوك مشترك (مثل `useLanguageToggle()` أو `LanguageToggle` مشترك مع variants) يستهلكه الطرفان. **لم يُنفَّذ في 8B-1 عمداً** لأن الإصلاح يستلزم تعديل `AppLayout.tsx` خارج سياج الملفات التسعة للشريحة المرجعية.

### شرط إعادة التقييم

عند لمس `AppLayout` header في مرحلة لاحقة، أو ظهور مبدّل لغة ثالث، أو ضمن أي جولة تنظيف i18n لاحقة.

---

## سجل التحديثات

| التاريخ | الإصدار | التغيير |
|---------|---------|---------|
| 2026-06-30 | v1.0 | إنشاء السجل — 8 بنود من Phase 1 |
| 2026-06-30 | v1.1 | ADR-01: INVESTIGATE → RESOLVED — `dev.mjs` + `docker-compose.dev.yml` مُطبَّقان ومُختبَران |
| 2026-07-04 | v1.2 | ADR-09: تسجيل Known Design Gap — cross-org assignedToId في manual tasks (Day-1 Hardening review) |
| 2026-07-05 | v1.3 | ADR-10: تسجيل Known Simplification — download = read في Party Model Minimum (Phase 5 Design Review) |
| 2026-07-05 | v1.4 | ADR-11: تسجيل Migration Tracking Drift — اكتُشف أثناء Phase 5 Production Deploy |
| 2026-07-10 | v1.5 | ADR-12: تسجيل Legal Localization Blocker (Arabic Terms Review) + ADR-13: Language Toggle Logic Duplication — اكتُشفا في Phase 8B-1 |

---

## D1 — Party Ceiling default-deny for unknown party actions

| الحقل | القيمة |
|-------|--------|
| **الحالة** | `DECISION_PENDING` — **Security/Product Decision Required (NOT Accepted)** |
| **اكتُشف في** | B2.4-FIX / Architecture Closure Review — 2026-07-13 |
| **يؤثر على** | `PARTY_CEILING_V1` — كل أفعال الطرف عبر الراوترات |

**الملاحظة:** `PARTY_CEILING_V1` يسمح افتراضياً بالأفعال غير المدرجة (default-allow) — غير آمن للأفعال التدميرية. عُولج per-router بـ `denyPartyDestructive` (fail-closed) لكن الافتراض الأساسي ما زال متساهلاً.

**الاتجاه المبدئي (غير معتمد):** Unknown Party Actions → deny by default.

**مطلوب قبل التنفيذ:** (1) جرد كل Party Actions الفعلية؛ (2) تسجيل القدرات الشرعية صراحةً؛ (3) اختبارات تمنع كسر السلوك الحالي؛ (4) PR Security/Product مستقل. **لا تنفيذ استباقي.** (بلا رقم ADR جديد.)

---

## D2 — Correspondence Dual Mount (Org-scoped vs Project-scoped)

| الحقل | القيمة |
|-------|--------|
| **الحالة** | `INVESTIGATE` — **Architecture/Product Evidence Required (NOT Accepted)** |
| **اكتُشف في** | B2.5-FIX / Architecture Closure Review — 2026-07-13 |
| **يؤثر على** | `routes/correspondence.ts` mount المزدوج (`/projects/:projectId/correspondence` + `/correspondence`) |

**الملاحظة:** الـ dual mount هو جذر تباعُد correspondence عن نمط الـ project-gate (اضطُر لاستخدام `orgScopedWhere`). هل المراسلة org-scoped فعلاً أم project-scoped حصراً؟

**مطلوب قبل القرار:** جرد بيانات + استخدام فعلي للمسار `/correspondence` (بلا projectId). **لا تغيير الآن.** (بلا رقم ADR جديد.)

---

## Observation — workflow-engine resolveEffectiveRole usage

| الحقل | القيمة |
|-------|--------|
| **الحالة** | `WATCH` |
| **Category** | Security / Authorization Review |
| **Severity** | غير محسومة حتى اختبارات RED |
| **Blocking** | لا — لا يمنع الـ Refactor الحالي ولا أي عمل |
| **اكتُشف في** | Architecture Closure Review (check 2) — 2026-07-13 |

**الملاحظة:** استخدامات `resolveEffectiveRole` في `routes/workflow-engine.ts` تحتاج مراجعة مستقلة لإثبات أن **جميع Entry Points تقيّد المؤسسة قبل حل الدور**. مساراته (approve/reject) تُجري lookup مُقيّداً بالـ org قبل resolveEffectiveRole (يبدو محمياً)، لكن لا بوابة راوتر وموضع مبكر لم يُتحقق منه.

**Action:** Batch أمني مستقل لاحقاً بمنهجية RED؛ **بلا إصلاح استباقي**، ولا يُلمس في هذا الـ Refactor.

---

## Future Notification Taxonomy Unification

| الحقل | القيمة |
|-------|--------|
| **الحالة** | `DEFERRED` — Non-blocking follow-up (NOT part of C-2 remediation) |
| **Category** | Architecture / Data Model |
| **Blocking** | لا — لا يمنع أي عمل حالي |
| **اكتُشف في** | C-2 Closure (roadmap diagnosis corrected) — 2026-07-15 |
| **المرجع** | ADR-0009 (Notification Dual Vocabularies) |

**الملاحظة:** النظام يستخدم عقدين منفصلين عمداً (ADR-0009): `notification_type` enum (مركز الإشعارات، `notifications.type`) و`NotificationEvent` namespaced (أحداث التسليم/الإعدادات، `text` في `notification_logs.event_key` + `org_notification_settings.event_key`). لا mismatch غير آمن على مسارات الكتابة الحالية (حارس `notification-type-write-contract.test.ts` يثبت أن كل قيمة تُكتب في `notifications.type` ∈ الـenum).

**متى يُعاد التقييم:** فقط عند الحاجة إلى (1) Analytics موحّدة عبر الإشعارات + أحداث التسليم، أو (2) آلية عامة لترقية Delivery `Event` إلى Notification Center `Type`. يندرج مستقبلاً مع D-1/D-3. **لا تغيير الآن، ولا migration.**

---

## الإجراءات المطلوبة من Product

| البند | الإجراء المطلوب | المسؤول |
|-------|----------------|---------|
| ADR-04 | تحديد policy الوصول للـ Submission Chains | Product Owner |
| ADR-07 | قرار write-lock على `rejected` transmittals | Product Owner |
| ADR-12 | ترتيب مراجعة قانونية عربية معتمدة لنص Terms/Privacy | Product Owner / Legal |

---

*هذا السجل يُحدَّث في نهاية كل Phase أو عند اكتشاف دين معماري جديد.*
