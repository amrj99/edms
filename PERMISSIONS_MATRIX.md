# ArcScale EDMS — Permissions Matrix

> **المصدر الوحيد للحقيقة:** `artifacts/api-server/src/lib/permissions.ts`
> هذا المستند مُولَّد من الكود مباشرةً — أي تغيير في الصلاحيات يجب أن يبدأ هناك، وليس هنا.
> آخر تحديث: 2026-05-28

---

## هرمية الأدوار

| الرتبة | الدور | القيمة |
|--------|-------|--------|
| 1 | `system_owner` | 100 |
| 2 | `admin` | 80 |
| 3 | `project_manager` | 60 |
| 4 | `document_controller` | 40 |
| 5 | `reviewer` | 20 |
| 6 | `member` | 10 |
| 7 | `viewer` | 0 |

`requireMinRole("X")` تعني: الدور المطلوب **أو أعلى منه** في الهرمية.

---

## مبادئ التصريح الأساسية

1. **الموافقات assignment-based، ليست role-based** — وجود الدور المناسب لا يكفي؛ يجب أن يكون المستخدم مُعيَّناً لتلك المرحلة تحديداً.
2. **حذف الوثائق مشروط بالحالة** — DC يحذف فقط في `draft/under_review`؛ admin+ يحذف أي حالة مع تسجيل السبب.
3. **رؤية المراسلات mail-model بالافتراضي** — كل مستخدم يرى فقط ما كان مُستقبِلاً أو في نسخة منه.
4. **التفويضات لا ترفع الصلاحية** — لا يمكن تفويض دور أعلى من الدور الفعلي للمفوِّض.
5. **عمليات admin-override توجب audit log** مع `overrideReason` صريح.

---

## صلاحيات الوثائق

`DocumentPermissions` — `src/lib/permissions.ts`

| العملية | viewer | member | reviewer | document_controller | project_manager | admin | system_owner |
|---------|:------:|:------:|:--------:|:-------------------:|:---------------:|:-----:|:------------:|
| عرض الوثيقة | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| رفع / إنشاء | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| تعديل البيانات الوصفية | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| حذف (draft / under_review) | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| حذف (approved / issued / archived / obsolete) | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ ⚠️ | ✅ ⚠️ |
| إرسال للـ workflow | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| الأهلية للمراجعة / الموافقة (+ يجب تعيينه) | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| تجاوز الـ workflow (admin override) | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ ⚠️ | ✅ ⚠️ |

⚠️ يستوجب تسجيل `overrideReason` في audit log.

---

## صلاحيات المراسلات

`CorrespondencePermissions` — `src/lib/permissions.ts`

| العملية | viewer | member | reviewer | document_controller | project_manager | admin | system_owner |
|---------|:------:|:------:|:--------:|:-------------------:|:---------------:|:-----:|:------------:|
| عرض المراسلات المُرسَلة إليه (To/CC) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| عرض كل مراسلات المشروع (opt-in) | ❌ | ❌ | ❌ | ✅* | ✅* | ✅ | ✅ |
| إنشاء مراسلة جديدة | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| الرد على مراسلة | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| إغلاق / أرشفة الخيط | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| الحذف النهائي | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |

\* يتطلب تفعيل `viewAll=true` صراحةً في الطلب. admin و system_owner يرون كل شيء تلقائياً.

---

## صلاحيات الإرساليات (Transmittals)

`TransmittalPermissions` — `src/lib/permissions.ts`

| العملية | viewer | member | reviewer | document_controller | project_manager | admin | system_owner |
|---------|:------:|:------:|:--------:|:-------------------:|:---------------:|:-----:|:------------:|
| عرض الإرسالية | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| إنشاء / تعديل مسودة | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| إرسال الإرسالية | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| إقرار الاستلام | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| إضافة كود مراجعة (+ يجب تعيينه) | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| إتمام دورة المراجعة (+ يجب تعيينه) | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| الحذف النهائي | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |

---

## صلاحيات سير العمل (Workflows)

`WorkflowPermissions` — `src/lib/permissions.ts`

| العملية | viewer | member | reviewer | document_controller | project_manager | admin | system_owner |
|---------|:------:|:------:|:--------:|:-------------------:|:---------------:|:-----:|:------------:|
| إعداد قوالب الـ workflow | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| تشغيل workflow على وثيقة | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| التقدم في مرحلة (+ يجب تعيينه) | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| تجاوز مرحلة (admin override) | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ ⚠️ | ✅ ⚠️ |

---

## صلاحيات المهام

`TaskPermissions` — `src/lib/permissions.ts`

| العملية | viewer | member | reviewer | document_controller | project_manager | admin | system_owner |
|---------|:------:|:------:|:--------:|:-------------------:|:---------------:|:-----:|:------------:|
| عرض مهامه الشخصية / المُعيَّنة له | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| إنشاء مهمة شخصية | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| إنشاء مهمة مُعيَّنة (project/workflow) | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| تعيين مهمة لمستخدم آخر | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| إغلاق مهمة مُعيَّنة له | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| حذف مهمة مُعيَّنة | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |

---

## صلاحيات الإدارة

`ManagementPermissions` — `src/lib/permissions.ts`

| العملية | viewer | member | reviewer | document_controller | project_manager | admin | system_owner |
|---------|:------:|:------:|:--------:|:-------------------:|:---------------:|:-----:|:------------:|
| دعوة مستخدمين للمؤسسة | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| تعيين أدوار على مستوى المؤسسة | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| إضافة أعضاء للمشروع | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| تعيين أدوار على مستوى المشروع | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| منح تفويض (delegation) | ❌ | ❌ | ❌ | ❌ | ✅* | ✅ | ✅ |
| عرض سجل الـ Audit | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |

\* الـ PM يفوِّض بحد أقصى دوره الفعلي (anti-escalation guard). لا يمكن تفويض دور أعلى من الدور الحالي للمفوِّض.

---

## عمليات النظام (system_owner حصراً)

هذه العمليات تستخدم `requireSysOwner` في الـ middleware — `admin` لا يملكها:

| العملية | الملف |
|---------|-------|
| عرض معلومات النظام (`GET /admin/system-info`) | `routes/admin.ts` |
| إعدادات التخزين لأي مؤسسة (`PUT /admin/storage-config/:orgId`) | `routes/admin.ts` |
| التحقق من ملف النسخ الاحتياطية (`POST /admin/restore/validate`) | `routes/admin.ts` |
| استعادة النسخ الاحتياطية (`POST /admin/restore`) | `routes/admin.ts` |
| تغيير خطة AI لمؤسسة (`PUT /admin/ai-tier/:orgId`) | `routes/admin.ts` |
| تعديل حدود AI لمؤسسة (`PUT /admin/ai-limits/:orgId`) | `routes/admin.ts` |
| عرض جميع خطط المؤسسات (`GET /admin/org-plans`) | `routes/admin.ts` |
| تغيير خطة اشتراك المؤسسة (`POST /admin/organizations/:orgId/change-plan`) | `routes/admin.ts` |
| إعدادات النظام العامة (`PUT /config/system-settings`) | `routes/config.ts` |

---

## عمليات admin+ (admin أو system_owner)

تستخدم `requireMinRole("admin")`:

| العملية | الملف |
|---------|-------|
| إنشاء مستخدم يدوياً (`POST /users`) | `routes/users.ts` |
| إنشاء قسم / تعديله / حذفه | `routes/departments.ts` |
| إعدادات AI Governance | `routes/config.ts` |
| إعدادات المؤسسة | `routes/config.ts` |
| إعدادات AI Classification | `routes/admin.ts` |
| اختبار SMTP | `routes/admin.ts` |
| Seed بيانات اختبار | `routes/admin.ts` |
| إعادة فهرسة البحث | `routes/admin.ts` |
| عرض Shadow Log | `routes/admin.ts` |

---

## عمليات project_manager+

تستخدم `requireMinRole("project_manager")`:

| العملية | الملف |
|---------|-------|
| إنشاء / تعديل / حذف قواعد الـ rules | `routes/rules.ts` |
| منح التفويضات (`POST /delegations`) | `routes/delegations.ts` |
| عرض / تعديل / حذف project role overrides | `routes/project-role-overrides.ts` |

---

## ملاحظة المطور

```
// ❌ لا تفعل هذا أبداً في route handler:
if (user.role === "admin" || user.role === "system_owner") { ... }

// ✅ في الـ middleware chain:
router.post("/", requireAuth, requireMinRole("admin"), handler)

// ✅ داخل الـ handler عند الحاجة لمنطق شرطي:
if (hasMinRole(req.user, "admin")) { ... }

// ✅ لصلاحيات domain (وثائق، مراسلات، مهام):
if (DocumentPermissions.canDelete(role, docStatus)) { ... }
if (CorrespondencePermissions.canClose(role)) { ... }
```

---

*يُحدَّث هذا المستند يدوياً عند كل تغيير في `permissions.ts` أو إضافة endpoint جديد.*
