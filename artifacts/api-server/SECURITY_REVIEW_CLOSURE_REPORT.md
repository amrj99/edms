# تقرير إغلاق المراجعة الأمنية — ArcScale EDMS (api-server)

تاريخ الإغلاق: 2026-06-12
نطاق المراجعة: `artifacts/api-server` — طبقة الصلاحيات (Authorization) والوصول للتخزين (Storage Access).

---

## ما تم إصلاحه

### C1 — Workflow Engine: تجاوز صلاحيات advance/reject

**المشكلة الأصلية**
`POST /api/workflow-engine/instances/:id/advance` و `.../reject` كانا يتطلبان فقط `requireAuth`. أي مستخدم مصادَق ضمن المؤسسة (بدون أي تحقق من تعيين المرحلة) كان يستطيع تقديم/رفض أي `wf_instance`، حتى لو لم يكن:
- هو `responsibleUserId` للمرحلة الحالية، أو
- يحمل `responsibleRole` (أو أعلى) للمرحلة الحالية.

**الحل المطبق**
إضافة فحص صلاحية مبني على التعيين (assignment-based) قبل تنفيذ `advance`/`reject`:
- إن كان المستخدم هو `responsibleUserId` للمرحلة → مسموح.
- وإلا إن كان دوره الفعّال `>= responsibleRole` للمرحلة → مسموح.
- وإلا إن كان `admin`/`system_owner` → مسموح كـ **admin override**، مع تسجيل `workflow_admin_override_advance` / `workflow_admin_override_reject` في `audit_logs`.
- وإلا → `403`.
- كما تم التحقق من أن `responsibleRole` يجب أن يكون قيمة `AppRole` صالحة عند إنشاء/تعديل مراحل القالب (`POST /templates/:id/stages`, `PUT .../stages/:stageId`) → `400` لقيمة غير صالحة.

**الملفات المعدلة**
- مسار workflow-engine (route handlers لـ `advance` و `reject` و stage create/update) — تمت إضافة فحص `checkWorkflowStagePermission` وتسجيل audit log للـ override.

**الاختبارات المضافة**
`src/test/workflow-engine-authorization.test.ts` — 13 اختباراً:
- رفض المستخدم غير المعيّن وغير الحامل للدور المطلوب (advance/reject).
- سماح `responsibleUserId` بالتقدّم/الرفض.
- سماح مستخدم يحمل `responsibleRole` المطلوب أو أعلى.
- رفض دور أدنى من `responsibleRole`.
- رفض الجميع إلا admin/system_owner على مرحلة غير معيّنة (terminal).
- admin override على مرحلة غير معيّنة له + تسجيل audit log.
- admin يتصرف وهو المعيّن فعلياً → بدون تسجيل override.
- admin override على reject + تسجيل audit log.
- التحقق من `responsibleRole` (400 لقيمة غير صالحة، 201 لقيمة صالحة، 400 عند التحديث بقيمة غير صالحة).

**نتيجة الاختبارات**
13/13 ✓ (ضمن مجموع 158/158 في الحزمة الكاملة).

---

### H1 — `GET /api/admin/backup` بلا حماية system_owner

**المشكلة الأصلية**
المسار كان محمياً بـ `requireAuth` فقط — **أي مستخدم مصادَق (بما فيه viewer)** كان يستطيع تصدير نسخة احتياطية كاملة من بيانات مؤسسته (مستخدمين، مشاريع، وثائق، مراسلات، transmittals، مهام)، رغم أن `POST /api/admin/restore` محمي بـ `requireSysOwner`. عدم تناسق واضح يمثل تسريب بيانات حساس.

**الحل المطبق**
تغيير سطر واحد فقط:
```ts
router.get("/backup", requireSysOwner, async (req, res): Promise<void> => { ... });
```
بنفس فلسفة الحماية المطبقة على `restore`. لم يُلمس منطق/تنسيق النسخة الاحتياطية.

**الملفات المعدلة**
- `src/routes/admin.ts` (سطر واحد — `requireSysOwner` كان مستورداً مسبقاً).
- `src/test/authorization.test.ts`.

**الاختبارات المضافة**
- إضافة `GET /api/admin/backup` إلى مصفوفة `sysOwnerEndpoints` (تغطية تلقائية: 401 بدون توكن، 403 لـ admin/PM/reviewer، نجاح لـ system_owner).
- اختبار صريح: "admin cannot export the backup" → 403.
- مجموعة `describe("H1: GET /api/admin/backup — system_owner only")` (4 اختبارات): viewer/member/admin → 403، system_owner → 200 مع `tables` معرّفة.

**نتيجة الاختبارات**
`authorization.test.ts`: 92/92 ✓ — الحزمة الكاملة (وقتها): 155/155 ✓.

---

### H2 — `GET /api/storage/objects/*path` بلا فحص ملكية/Organization

**المشكلة الأصلية**
هذا المسار (أحد ثلاثة backends لتخزين الملفات، فعّال عند تشغيل التخزين السحابي) كان يتحقق فقط من المصادقة (`requireAuthOrViewToken`) دون أي فحص لملكية الملف أو انتمائه للمؤسسة — على عكس `/onpremise`, `/s3-object`, `/r2-object` التي تستخدم `assertOrgAccess`. الآلية المرشّحة أصلاً للإصلاح (`canAccessObjectEntity()`/ACL) تبيّن أنها **كود ميت فعلياً**: لا يوجد أي مسار يكتب `aclPolicy` metadata عند الرفع، فهي ترجع `false` لكل ملف حقيقي.

**الحل المطبق**
دالة مساعدة جديدة `findOrgIdForObjectServeUrl(serveUrl)` في `storage.ts` تبحث عن `serveUrl` (`/api/storage/objects/<wildcardPath>`) في حقل `fileUrl` للكيانات التالية:
- `documentsTable`, `documentRevisionsTable`, `documentFilesTable`
- `correspondenceAttachmentsTable` (join مع `correspondenceTable`)
- `meetingAttachmentsTable`
- `chatMessagesTable` (join مع `chatGroupsTable`)
- `migrationItemsTable`

في معالج `GET /objects/*path`: إن وُجد سجل يشير للملف → استدعاء `assertOrgAccess(req, res, ownerOrgId, {...})` (نفس الدالة المستخدمة في `/onpremise`/`/s3-object`/`/r2-object`) قبل أي تحميل من GCS. إن لم يُوجد سجل (ملف غير مرتبط بعد) → لا قيد إضافي (تجنّباً لكسر تدفقات الرفع).

**الملفات المعدلة**
- `src/routes/storage.ts` (دالة مساعدة جديدة + استدعاء داخل `/objects/*path` فقط — لم تُلمس `/onpremise`, `/s3-object`, `/r2-object`, `/public-objects`, `/uploads/*`, `/view-token`).
- `src/test/storage-objects-authorization.test.ts` (ملف جديد).

**الاختبارات المضافة**
3 اختبارات:
1. مستخدم من نفس المؤسسة لا يُحجب بفحص الملكية (`!== 401 && !== 403`).
2. مستخدم من مؤسسة مختلفة → `403` ("file belongs to a different organization") قبل أي محاولة جلب من التخزين.
3. طلب بلا مصادقة → `401`.

**نتيجة الاختبارات**
3/3 ✓ — الحزمة الكاملة: **158/158 ✓**.

---

### H3 — `POST /:id/complete-review` بلا فحص تعيين

**المشكلة الأصلية**
المسار كان يتطلب فقط `requireAuth` + رتبة أساسية (`document_controller+`) — أي مستخدم بهذه الرتبة يستطيع إنهاء مراجعة **أي** transmittal، حتى لو لم يكن `toUserId` (المستلم المعيّن) أو `createdById` (المُرسل). هذا مخالف للنمط المطبّق على `PATCH /:id/items/:itemId` عبر `checkAssignmentBasedPermission`.

**الحل المطبق**
إضافة الفحص نفسه المستخدم في `PATCH /:id/items/:itemId`:
```ts
const isAssigned = transmittal.toUserId === actor.id || transmittal.createdById === actor.id;
const basis = checkAssignmentBasedPermission(effectiveRole, isAssigned, "reviewer");
if (!basis) { return 403 }
if (basis === "admin_override") { createAuditLog({ action: "admin_override_complete_review", ... }) }
```
`admin`/`system_owner` يمكنهم تجاوز التعيين (admin override) مع تسجيل دائم في audit log — متّسق مع السلوك في `PATCH /:id/items/:itemId`.

**الملفات المعدلة**
- `src/routes/transmittals.ts` (إدراج فحص التعيين بعد جلب الـ transmittal، قبل معالجة الرد).
- `src/test/transmittal-complete-review-authorization.test.ts` (ملف جديد).

**الاختبارات المضافة**
4 اختبارات:
1. رفض مستخدم ليس المستلم ولا المُرسل (403، حالة الـ transmittal لا تتغير).
2. المستلم المعيّن (`toUserId`) بدور `reviewer` → 200 + `reviewOutcome === "A"`.
3. admin override على transmittal غير معيّن له → 200 + تسجيل `admin_override_complete_review`.
4. admin هو المستلم المعيّن أيضاً → 200 + يُسجَّل كـ override (سلوك متّسق مع `PATCH /:id/items/:itemId`).

**نتيجة الاختبارات**
4/4 ✓ — الحزمة الكاملة (وقتها): 145/145 ✓.

---

## ما تم استبعاده

- **مراجعة معمارية شاملة** — مستبعدة بطلب صريح من المستخدم خلال جلسات H1/H2.
- **Custom Records** — لم تتم مراجعتها أو لمسها، بطلب صريح.
- **H4** — لم يُعرَّف نطاقه ولم يُنفَّذ، بطلب صريح ("التركيز فقط على إغلاق H2").
- **إعادة بناء/تفعيل نظام ACL** (`objectAcl.ts` / `canAccessObjectEntity` / `trySetObjectEntityAclPolicy`) — تبيّن أنه كود ميت، لكن إصلاحه يتطلب تعديلاً معمارياً (كتابة ACL metadata عند كل رفع) وهو مستبعد من نطاق H2.
- **تعديل مسارات storage الأخرى** (`/onpremise`, `/s3-object`, `/r2-object`, `/public-objects`, `/uploads/*`, `/view-token`) — لم تُعدَّل لأنها ليست جزءاً من المشاكل المحددة (H1–H3, C1) وكانت تستخدم `assertOrgAccess` مسبقاً.

---

## ما بقي مفتوحاً (إن وجد)

1. **H4** — لم يُعرَّف نطاقه بعد؛ يحتاج جلسة مستقلة لتحديد المشكلة والحل.
2. **Custom Records** — لم تُراجع أمنياً ضمن هذه الدورة.
3. **نظام ACL في `objectAcl.ts`** — كود ميت بالكامل (لا يُكتب ولا يُقرأ فعلياً عبر مسارات الإنتاج). يحتاج قراراً: تفعيله بالكامل أو حذفه.
4. **نافذة الملفات غير المرتبطة في H2** — الملفات المرفوعة حديثاً (`/api/storage/objects/uploads/...`) قبل ربطها بسجل DB لا تخضع لفحص الملكية الإضافي (تبقى محمية بالمصادقة فقط). خطر منخفض (مفاتيح UUID غير قابلة للتخمين) لكنه يستحق المتابعة.
5. **اتساق صيغة `fileUrl`** — فحص الملكية في H2 يعتمد على تطابق حرفي لـ `serveUrl`؛ أي بيانات قديمة بصيغة مختلفة (روابط كاملة مثلاً) لن تُكتشف وتبقى في حالة "غير مرتبط".
6. **بيئة الاختبار لا تدعم محاكاة GCS فعلية** — اختبار "نفس المؤسسة" في H2 يتحقق فقط من تجاوز فحص الصلاحية (`!== 403`)، وليس من نجاح الإرجاع الكامل للملف (200)، لأن `PRIVATE_OBJECT_DIR` غير متاح في بيئة CI الحالية.

---

## أهم الملاحظات المعمارية التي ظهرت أثناء المراجعة

1. **تكرار منطق "assignment-based authorization" بدون توحيد**: توجد ثلاث آليات متشابهة لكنها منفصلة:
   - `checkAssignmentBasedPermission` (transmittals — H3، وأيضاً `PATCH /:id/items/:itemId`).
   - `checkWorkflowStagePermission` (workflow-engine — C1).
   كل واحدة لها ترتيب فحص مختلف قليلاً لـ admin-override (الأولى تتحقق من admin أولاً بشكل غير مشروط، الثانية تتحقق من التعيين أولاً). هذا عدم تناسق طفيف لكنه قد يُربك أي مطوّر مستقبلي يحاول تعميم النمط.

2. **`assertOrgAccess` نمط جيد لكن غير مُطبَّق مركزياً**: كان موجوداً ومستخدماً في 3 من 4 مسارات serving الملفات، والمسار الرابع (`/objects/*path`) كان الثغرة (H2). هذا يشير إلى عدم وجود "نقطة فرض" مركزية واحدة لفحص ownership عبر طبقة storage — كل مسار يطبّق الفحص بشكل مستقل.

3. **اعتماد التخزين السحابي على `PRIVATE_OBJECT_DIR` (Replit-only)**: `isCloudStorageAvailable()` يحدد سلوك النظام بالكامل (هل cloud أم onpremise) بناءً على متغير بيئة خاص بـ Replit، وهو غير مضبوط في بيئات self-hosted/VPS. هذا يجعل مسار `/objects/*path` "نشطاً بصمت" بحسب البيئة دون توثيق واضح لذلك.

4. **نموذج multi-tenancy متماسك بشكل عام**: معظم الجداول الجوهرية (`documents`, `correspondence`, `meetings`, `chat`, `transmittals`, `migrations`, ...) تحمل `organizationId` بشكل صريح، وهذا ما جعل إصلاح H2 ممكناً بدون تعديل معماري — البنية كانت تدعم الفحص، لكنه لم يكن مُطبَّقاً على هذا المسار بعينه.

5. **`requireModule()` يفشل بشكل "fail-closed" إن لم يوجد سجل `org_config`** — سلوك أمني جيد (مكتشف خلال إعداد اختبارات H3/C1)، لكنه قد يُفاجئ مؤسسات جديدة لم تُهيّأ بعد إن لم يكن هناك تدفق إنشاء `org_config` تلقائي مضمون.

---

## أهم الديون التقنية المكتشفة

1. **نظام ACL غير مكتمل وميت** (`objectAcl.ts`): `ObjectAccessGroupType` enum فارغ، `canAccessObjectEntity()` بلا أي نقطة استدعاء، ولا يوجد أي كود يكتب `aclPolicy` metadata عند الرفع.
2. **عدم تناسق في ترتيب فحص admin-override** بين `checkAssignmentBasedPermission` و `checkWorkflowStagePermission` (مذكور أعلاه).
3. **اعتماد بيئي (Replit-only) على `PRIVATE_OBJECT_DIR`** لتحديد وضع التخزين الافتراضي، بدون مسار توثيقي واضح لبيئات self-hosted.
4. **عدم وجود migration/سكربت لتطبيع `fileUrl`** عبر الكيانات المختلفة — قد تتعايش صيغ مختلفة (نسبية/مطلقة) لنفس نوع التخزين.
5. **تغطية اختبارات H2 جزئية بسبب بيئة CI**: لا توجد محاكاة GCS، فالمسار الناجح (200 + بث الملف) غير مُختبر فعلياً، فقط بوابة التفويض.

---

## أعلى 10 توصيات للمستقبل

1. **توحيد منطق assignment-based authorization** في دالة/وحدة مشتركة واحدة (`lib/authorization.ts`) تُستخدم من قبل transmittals وworkflow-engine، مع توثيق صريح لترتيب فحص admin-override.
2. **اتخاذ قرار حاسم بشأن نظام ACL**: إما حذف `objectAcl.ts`/`canAccessObjectEntity`/`trySetObjectEntityAclPolicy` بالكامل (كود ميت)، أو تفعيله بالكامل (كتابة policy عند كل رفع + تعريف `ObjectAccessGroupType`).
3. **توسيع فحص الملكية في H2 ليشمل أي جداول مستقبلية جديدة تحمل `fileUrl`** — إضافة ملاحظة/checklist في عملية إضافة جدول جديد يحتوي مرفقات.
4. **معالجة الملفات غير المرتبطة (orphaned uploads)**: إما عملية تنظيف دورية، أو ربط فوري إلزامي عند الرفع، لتقليص نافذة H2 المفتوحة المذكورة أعلاه.
5. **توثيق سياسة fail-open / fail-closed بشكل مركزي** (متى يُسمح بالوصول حين لا توجد بيانات كافية للفحص، ومتى يُرفض).
6. **إضافة محاكاة GCS (fake-gcs-server أو mock) لبيئة الاختبار** لتغطية المسار الناجح الكامل لـ `/objects/*path` (200 + بث الملف)، لا فقط بوابة التفويض.
7. **معالجة H4 و Custom Records في جلسات منفصلة ومركّزة**، باستخدام نفس منهجية H1–H3 (تحديد النطاق، التحقق، الإصلاح، الاختبار).
8. **مراجعة شاملة لكل admin-override actions** (transmittals, workflow-engine, ...) للتأكد من أن كل تجاوز صلاحية يُسجَّل في `audit_logs` بشكل متّسق وقابل للتدقيق.
9. **توضيح/تبسيط الاعتماد على `PRIVATE_OBJECT_DIR`**: توثيق صريح في README/`.env.example` لتفعيل/تعطيل التخزين السحابي في بيئات self-hosted، أو إزالة الاعتماد على افتراضات Replit.
10. **تطبيع صيغة `fileUrl`** عبر جميع الجداول (migration واحدة) لضمان موثوقية مطابقة `findOrgIdForObjectServeUrl` المستقبلية.

---

## هل ترى أي سبب حقيقي لإعادة بناء ArcScale من الصفر؟

**لا.**

**ما الذي يجب الحفاظ عليه كما هو:**

1. **نظام الأدوار والصلاحيات (`permissions.ts` — `AppRole`, `rankOf`, `isAtLeast`)**: مركزي، متماسك، ومُختبر جيداً (158 اختباراً في `authorization.test.ts` وحده يغطي معظم endpoints الحساسة).
2. **نموذج multi-tenancy عبر `organizationId`**: منتشر بشكل صحيح في الجداول الجوهرية، وهو ما جعل إصلاح H2 (وهو أعمق المشاكل المكتشفة) ممكناً بإضافة دالة واحدة دون أي تعديل في المخطط (schema) أو البنية.
3. **نمط `assertOrgAccess` ونظام audit logging**: موجود ويُستخدم بشكل صحيح في معظم المسارات؛ المشكلة لم تكن في غياب الأدوات بل في عدم تطبيقها على مسار واحد متبقٍ.
4. **بنية الاختبارات (vitest + Postgres test DB عبر Docker)**: مكّنت من التحقق السريع والموثوق لكل إصلاح (C1, H1, H2, H3) دون تأثير جانبي على 158 اختباراً قائماً.

كل المشاكل المكتشفة (C1, H1, H2, H3) كانت **محلية ومحدودة النطاق** — إصلاحات سطر واحد إلى عشرات الأسطر في ملف واحد، دون الحاجة لأي تعديل معماري أو في المخطط. هذا مؤشر قوي على أن المشاكل كانت "ثغرات تطبيق نمط موجود بشكل غير متّسق" وليست "عيوب تصميم جوهرية". إعادة البناء من الصفر ستُعيد تقديم هذه الفئة من المخاطر (نسيان تطبيق فحص على مسار جديد) دون أي فائدة معمارية تُذكر.

---

## التقييم النهائي

| المحور | التقييم | الملاحظات |
|---|---|---|
| **الأمن** | جيد (بعد الإغلاق) | كانت هناك 4 ثغرات حقيقية (C1, H1, H2, H3) — جميعها من فئة "نمط حماية موجود لكن غير مُطبَّق على نقطة معينة"، وليست عيوباً نظامية. تم إغلاقها جميعاً مع تغطية اختبارية (158/158). الثغرة الوحيدة المتبقية ذات الأثر المنخفض هي نافذة الملفات غير المرتبطة في H2. |
| **المعمارية** | جيدة مع تحسينات ممكنة | فصل واضح بين الطبقات (routes/lib/db)، نمط multi-tenant متماسك، أدوات أمنية مركزية (`assertOrgAccess`, `createAuditLog`, `permissions.ts`) — لكن مع تكرار طفيف غير متّسق في منطق assignment-based authorization (C1 vs H3) ونظام ACL ميت. |
| **القابلية للتوسع** | جيدة | `organizationId` منتشر بشكل صحيح، ودعم 3 أوضاع تخزين (cloud/onpremise/S3-R2) يدل على مرونة معمارية حقيقية. |
| **القابلية للصيانة** | متوسطة إلى جيدة | الكود مقروء ومنظم، التغطية الاختبارية قوية في طبقة الصلاحيات — لكن وجود كود ميت (ACL) وتكرار منطق غير موحّد يزيد العبء المعرفي على المطورين الجدد. |
| **جاهزية التطوير المستقبلي** | جيدة | بعد إغلاق C1/H1/H2/H3، الأساس الأمني والمعماري سليم بما يكفي للانتقال للمرحلة التالية (H4, Custom Records, إلخ) دون عوائق بنيوية. |

---

**الحالة العامة**: المراجعة الحالية **مغلقة** (C1, H1, H2, H3 = ✓ مع 158/158 اختباراً ناجحاً). البنود المفتوحة (H4, Custom Records, ديون ACL) موثّقة أعلاه وجاهزة كنقاط انطلاق للمرحلة التالية.
