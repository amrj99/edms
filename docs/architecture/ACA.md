# ArcScale Collaboration Architecture (ACA)
## الإصدار 3.0 — Approved Architecture Baseline

**التاريخ:** 2026-07-03 | **الحالة:** معتمد رسمياً — مجمَّد للمرجعية
**الطبيعة:** وثيقة معمارية طويلة المدى — لا كود، لا تعديلات حالية
**الأفق الزمني:** عشر سنوات | **تاريخ التجميد:** 2026-07-01

---

> **هذه الوثيقة هي المرجع الأعلى لأي قرار يتعلق بالتعاون بين المؤسسات في ArcScale.**
> أي قرار تقني يتعارض مع مبادئها يحتاج مراجعة هذه الوثيقة أولاً — لا العكس.
> لا تُعاد مراجعتها إلا بوجود سبب تقني جوهري.

---

## سجل التغييرات

| الإصدار | التاريخ | التغيير |
|---|---|---|
| v1.0 | 2026-07-01 | الإصدار التأسيسي — Party Model، APF، Grant Lifecycle |
| v2.0 | 2026-07-01 | توسيع: Workspace، Federation، Grant State Machine، Policy Algorithm، Migration Strategy |
| v2.1 | 2026-07-01 | تعديلات ما قبل الاعتماد: A1–A6 (تناقضات أمنية ومعمارية)، إضافة Implementation Considerations، Future Roadmap |
| v3.0 | 2026-07-03 | **تحديث جوهري — طبقة الهوية:** فصل Entity (الهوية الواقعية) عن Organization (حساب الـ Tenant)؛ تعريف ProjectParticipant كـ Entity في دور مشروع؛ إحالة إلى DOMAIN_MODEL.md لتفاصيل طبقة الهوية |

---

## الفهرس

1. الرؤية والفلسفة
2. المفاهيم الأساسية
3. الأعمدة الثلاثة للإطار
4. نموذج الملكية
5. نموذج الأطراف (Party Model)
6. Workspace — طبقة السياق التنظيمي
7. إطار سياسات الوصول (APF)
8. خوارزمية حسم التعارض
9. دورة حياة Collaboration Grant
10. التسليم الرسمي — Transmittals
11. أحداث التعاون
12. إدارة دورة الحياة وانتهاء العقود
13. Federation — التعاون بين المنصات المستقلة
14. تطبيق الإطار على الكيانات
15. القواعد غير القابلة للتفاوض
16. مسار الانتقال التدريجي والـ Pilot
17. القرارات المحسومة وما تبقى مفتوحاً
18. **Implementation Considerations** *(جديد v2.1)*
19. **Future Roadmap** *(جديد v2.1)*

---

## I. الرؤية والفلسفة

### ما الذي نبنيه؟

ArcScale بنية تحتية للمعلومات في المشاريع — تستطيع خدمة:

- شركة من عشرة موظفين تُدير مستنداتها الداخلية
- مشروع بنية تحتية ضخم يجمع خمسين شركة
- استشاري يعمل مع عشرة عملاء في آنٍ واحد
- جهة حكومية تُراجع وثائق مقدّمة من مقاولين متعددين
- أي نموذج تعاون لم نتخيله بعد

**الشرط:** نموذج واحد من الكود، لا نسخ مختلفة لحالات استخدام مختلفة.

### الفلسفة الأساسية

**الملكية ثابتة. الوصول متغيّر. التسليم الرسمي دائماً.**

ثلاث جمل تُلخِّص كل قرار في هذه الوثيقة. أي تصميم يتعارض مع إحداها يحتاج مراجعة فلسفية قبل أي مراجعة تقنية.

---

## II. المفاهيم الأساسية

> **ملاحظة v3.0:** هذا القسم يصف المفاهيم على مستوى التعاون. للتفاصيل الكاملة حول طبقة الهوية
> (Entity، Organization، Contact، Directory) راجع [`DOMAIN_MODEL.md`](DOMAIN_MODEL.md).

---

### Entity (الجهة / الكيان)

*(مُضاف في v3.0 — انظر DOMAIN_MODEL.md للتفاصيل الكاملة)*

الهوية الواقعية لأي جهة — شركة، مكتب، جهة حكومية، مقاول. مستقلة عن وجودها على المنصة.

```
AECOM  → Entity واحدة (الهوية القانونية الفعلية)
         قد تمتلك حسابَي Tenant: AECOM UAE + AECOM KSA (Organizations)
```

Entity لا تحمل FK نحو Organization — الربط يسير من Organization نحو Entity.

---

### Organization (حساب الـ Tenant)

*(محدَّث في v3.0)*

حساب التشغيل على ArcScale — الوحدة التي تملك البيانات، تضم المستخدمين، وتتحمل الاشتراك. مستقلة تماماً عن غيرها.

```
Organization ≠ الكيان القانوني بالضرورة
Organization = Tenant تشغيلي على المنصة
               قد يرتبط بـ Entity حقيقية عبر entityId (nullable)
               أو يعمل مستقلاً دون ربط بـ Entity
```

**حدودها:** حدود الملكية والمسؤولية. لا تُتجاوز بقرار تقني.

---

### Project (المشروع)

سياق عمل محدد زمنياً وجغرافياً. تملكه مؤسسة واحدة. يضم أطرافاً من جهات متعددة. ينتهي بأرشفة رسمية.

**القاعدة:** المشروع لا يملك بيانات — المؤسسات تملك بياناتها داخل سياق المشروع.

---

### Party / ProjectParticipant (الطرف)

*(محدَّث في v3.0 — الاسم في قاعدة البيانات: `project_participants`)*

**المفهوم الذي يُمكِّن التعاون بين المؤسسات — جوهر الامتداد المستقبلي.**

Party (في سياق ACA) = **Entity** تؤدي دوراً محدداً في مشروع محدد.

```
AECOM (Entity) ثابتة
AECOM كـ "Designer" في مشروع X = ProjectParticipant A
AECOM كـ "Owner Rep" في مشروع Y = ProjectParticipant B
نفس الجهة، دورين مختلفان، سياقان مختلفان، صلاحيتان مختلفتان
```

> **التصحيح عن v2.1:** الدور يرتبط بـ Entity (الهوية الحقيقية)، لا بـ Organization (حساب الـ Tenant).
> هذا يسمح لـ AECOM UAE وAECOM KSA — كحسابين مختلفين — بتمثيل نفس الجهة في المشروع.

الطرف يحمل: دوره في المشروع، حدود صلاحيته، مدة عضويته، نقطة اتصاله.

---

### Resource (الأصل)

أي كيان قابل للحماية والوصول: مستندات، مراسلات، اجتماعات، مخرجات عمل، حزم تعاقدية، وأي كيان سيُضاف مستقبلاً.

**القاعدة:** كل Resource يملكه مؤسسة. الوصول إليه سياسة منفصلة تماماً عن الملكية.

---

### الملكية ≠ الوصول

```
الملكية:   من أنشأ الأصل ومن تتحمل مؤسسته المسؤولية عنه
           → لا تتغير أبداً
           → تبقى حتى بعد انتهاء المشروع والعقد والوصول

الوصول:    من يستطيع رؤيته والتفاعل معه
           → يُحدَّد بالسياسات والمنح
           → يُمنح ويُسحب ويُعدَّل
           → منفصل تماماً عن الملكية
```

---

### Collaboration Event (حدث التعاون)

أي فعل يعبر حدود المؤسسة عمداً: Transmittal، مراسلة، دعوة طرف، منح وصول، طلب مراجعة. كل حدث يُسجَّل ولا يُحذف.

---

## III. الأعمدة الثلاثة

```
┌──────────────────────────────────────────────────────────────────┐
│                      ArcScale Platform                            │
├────────────────┬───────────────────────┬─────────────────────────┤
│   OWNERSHIP    │       CONTEXT         │     ACCESS POLICY        │
│   الملكية      │      السياق           │    سياسة الوصول          │
│                │                       │                          │
│  Organization  │  Workspace → Project  │  Policy Hierarchy        │
│  owns forever  │  Party plays Role     │  + Grant System          │
│  IMMUTABLE     │  CONFIGURABLE         │  DYNAMIC                 │
└────────────────┴───────────────────────┴─────────────────────────┘
```

---

## IV. نموذج الملكية

كل Resource يُنشأ يحمل ثلاث طوابع ثابتة:

```
createdBy:        المستخدم الذي أنشأه
ownerOrg:         المؤسسة المالكة (لا تتغير أبداً)
createdInContext: المشروع / الـ Workspace الذي أُنشئ فيه
```

الطابع الثالث سياقي — يحدد أين ظهر الأصل، لكن لا يُؤثر على الملكية.

### الملكية والحقوق التعاقدية

```
Technical Ownership (ArcScale يتتبعه):
  ownerOrg → ثابت، موثَّق، لا يتغير

Contractual Rights (خارج ArcScale):
  عقد البناء قد يُعطي المالك حق استخدام مخططات المصمم بعد انتهاء العلاقة
  ArcScale لا يُفسِّر العقود — لكن يوفر الـ Audit Trail الداعم للإثبات القانوني
```

---

## V. نموذج الأطراف (Party Model)

### هرمية الأدوار

```
Project Party Roles Taxonomy
├── Project Owner            — يملك المشروع، القرار النهائي
├── Owner Representative     — يمثّل المالك (قد يكون org مختلفة)
├── Program Manager          — يُدير برنامجاً من مشاريع
├── Designer                 — معماري، هندسي، متخصص
├── Construction Manager     — يُدير التنفيذ نيابة عن المالك
├── Main Contractor          — يُنفذ الأعمال الرئيسية
├── Subcontractor            — يُنفذ نطاقاً فرعياً
├── Supplier / Vendor        — يُزوّد مواد أو خدمات
├── Quantity Surveyor        — يُقدِّر التكاليف ويُراجع المستخلصات
├── Regulatory Authority     — جهة حكومية مانحة أو رقابية
├── Third-party Inspector    — فحص مستقل
├── Lender / Financier       — ممول يراقب التقدم
└── Observer                 — رؤية فقط، لا تفاعل
```

### صلاحيات الدور الافتراضية

لكل دور Profile افتراضي يُحدِّد ما يستطيع فعله في غياب أي سياسة أكثر تحديداً:

```
Project Owner:
  Documents: ADMIN (كل شيء)
  Correspondence: ADMIN
  Meetings: ADMIN

Designer:
  Documents: SUBMIT (رفع مراجعات) + READ + COMMENT
  Correspondence: READ + COMMENT (المرسل إليه فقط)
  Meetings: READ + COMMENT

Main Contractor:
  Documents: READ + COMMENT (ما صدر بـ Transmittal إليه)
  Correspondence: READ (mail-model)
  Submittals: SUBMIT

Observer:
  Documents: READ فقط
  Correspondence: لا وصول
  Meetings: READ فقط
```

الـ Profile الافتراضي = الحد الأعلى (Ceiling) لما يستطيع هذا الدور الوصول إليه. السياسات الأكثر تحديداً تُضيِّق، لا توسِّع.

---

## VI. Workspace — طبقة السياق التنظيمي

### لماذا نحتاج Workspace؟

البنية الحالية:
```
Organization → Projects → Resources
```

هذا يعمل بشكل ممتاز لإدارة المشاريع. لكن ماذا عن:

- **إدارة العقود:** مؤسسة تُدير عقودها القانونية بدون ارتباط بمشروع بعينه
- **إدارة الجودة:** نظام جودة (ISO) يشمل المؤسسة كلها
- **الموارد البشرية:** وثائق HR لا تنتمي لمشروع
- **مستودع المعرفة:** مواصفات قياسية، نماذج مرجعية

الحل: **Workspace** — سياق تنظيمي يسبق المشروع في الهرمية.

### تعريف Workspace

```
Workspace = وحدة تنظيمية ذات نطاق محدد داخل المؤسسة
            تُدير Resources ذات صلة
            قد تحتوي على Projects أو لا
            لها سياسة وصول مستقلة
```

### هرمية مقترحة

```
Organization
├── Workspace: "أعمال هندسية المباني"
│     ├── Project: "برج السلام"
│     ├── Project: "مجمع الواحة"
│     └── Resources مشتركة (مواصفات، نماذج قياسية)
│
├── Workspace: "إدارة العقود"
│     └── Resources: عقود، ملاحق، أوامر تغيير
│
├── Workspace: "إدارة الجودة"
│     └── Resources: إجراءات ISO، سجلات التدقيق
│
└── Workspace: "الموارد البشرية"
      └── Resources: سياسات، عقود توظيف (مقيدة جداً)
```

### خصائص الـ Workspace

**الديمومة:** Workspace يُنشأ مرة ويبقى. لا تاريخ انتهاء افتراضي.

**العزل:** لكل Workspace سياسة وصول مستقلة.

**التوريث:** Projects داخل Workspace ترث سياساته الافتراضية، مع إمكانية التخصيص.

**قابلية التعاون:** بعض الـ Workspaces قابل للمشاركة بين مؤسسات. بعضها مغلق (HR).

### قرار معماري: Virtual Project Pattern *(v2.1 — A3)*

**Workspace-level Resources (غير مرتبطة بمشروع محدد) تُنفَّذ عبر Virtual Project Pattern:**

كل Workspace يحمل "General Project" افتراضياً بـ ID نظامي مُولَّد تلقائياً. Resources لا تنتمي لمشروع حقيقي تُسجَّل تحت هذا الـ Virtual Project.

**الأثر:** `project_id` يبقى `NOT NULL` في كل الجداول الحالية. لا تغيير في الـ Schema. لا migration breaking. الـ invariant الأساسي محفوظ.

### العلاقة مع البنية الحالية

كل Project حالي يُعتبر في Workspace افتراضي اسمه "General" — لا يظهر للمستخدم إلا إذا أنشأ workspaces مخصصة. **لا شيء يتغير في البنية الحالية.**

---

## VII. إطار سياسات الوصول (APF)

### قاعدة تحديد نظام الصلاحيات *(v2.1 — A2)*

**قاعدة أساسية:** نظامان للصلاحيات يتعايشان ولا يختلطان:

```
للـ Resources المملوكة لـ Org المستخدم (داخل org-scope):
  → يُطبَّق Role-Based system (ROLE_RANK: admin / PM / DC / reviewer...)
  → orgScopedWhere يُطبَّق بالكامل
  → لا تغيير عن النظام الحالي

للـ Resources المملوكة لـ Org أخرى في Collaborative Context:
  → يُطبَّق ACA Access Level system (READ / REVIEW / APPROVE...)
  → Authorization Path منفصل (ليس OR على orgScopedWhere)
  → مبني على Party Membership + Policy Hierarchy
```

لا يختلط النظامان على نفس الـ Resource في نفس الوقت.

### هرمية السياسات الكاملة

```
Level 0: Platform Defaults           — ما لا يتغير أبداً (ArcScale يُحدده)
Level 1: Organization Policy         — سياسة المؤسسة لمواردها الخاصة
Level 2: Workspace Policy            — سياسة الـ Workspace
Level 3: Project Collaboration Policy— ما يُشارَك مع الأطراف وبأي أدوار
Level 4: Entity Type Policy          — سياسة لكل نوع (Documents / Meetings / etc.)
Level 5: Folder / Collection Policy  — على مستوى مجلد أو مجموعة
Level 6: Entity-level Grant          — منح وصول لأصل بعينه
```

### Access Levels الكاملة

```
NONE           — لا وصول، حتى معرفة وجود الأصل ممنوعة
DISCOVER       — يعلم بوجود الأصل لكن لا يرى محتواه
READ           — يرى المعلومات الوصفية والمحتوى
DOWNLOAD       — يستطيع تنزيل الملف
COMMENT        — يضيف تعليقات وملاحظات
REVIEW         — مراجعة رسمية (تُنشئ Review Record موثَّقاً)
APPROVE        — موافقة رسمية (تُنشئ Approval Record)
SUBMIT         — رفع نسخة/مراجعة جديدة
MANAGE_SHARES  — إدارة مشاركة هذا الأصل مع الآخرين (في حدود سياسة أعلى)
ADMIN          — كل ما سبق + نقل + حذف
```

---

## VIII. خوارزمية حسم التعارض

### المبدأ الجوهري

> **Explicit DENY always wins. Specific context overrides general context — within ceiling.**

### التعريفات

- **Ceiling:** الحد الأعلى لما يستطيع طرف الوصول إليه، مُحدَّد في Level 1 + Level 3
- **Floor:** الحد الأدنى المضمون، مُحدَّد في Entity Grant (Level 6)
- **Restriction:** أي سياسة تُضيِّق الوصول دون حذفه
- **Hard Block:** رفض مطلق لا يمكن تجاوزه (DENY_ABSOLUTE)

### الخوارزمية الرسمية

```
FUNCTION resolveAccess(Principal P, Resource R, RequestedLevel A):

  ─── المرحلة 1: Hard Stops ───────────────────────────────────────
  IF Platform.isDenyAbsolute(P, R):
      RETURN DENY  [لا يمكن تجاوزه بأي شيء]

  IF Organization(R.ownerOrg).isDenyAbsolute(P.org, R):
      RETURN DENY  [قرار المؤسسة المالكة — مطلق]

  ─── المرحلة 2: تحديد الـ Ceiling ───────────────────────────────
  ceiling = ProjectCollaborationPolicy(P.partyRole, R.entityType).maxLevel
  IF ceiling = NONE:
      RETURN DENY  [الطرف لا يُسمح له بهذا النوع في هذا المشروع]

  ─── المرحلة 3: تطبيق القيود التراكمية ──────────────────────────
  effective = ceiling

  IF WorkspacePolicy(R.workspace, P.partyRole).maxLevel < effective:
      effective = WorkspacePolicy(...).maxLevel

  IF EntityTypePolicy(R.type, P.partyRole).maxLevel < effective:
      effective = EntityTypePolicy(...).maxLevel

  IF FolderPolicy(R.folder, P.partyRole).maxLevel < effective:
      effective = FolderPolicy(...).maxLevel

  ─── المرحلة 4: Entity Grant ─────────────────────────────────────
  grant = EntityGrant.find(P.org, R)
  IF grant EXISTS AND grant.state = ACTIVE:          ← [v2.1: A5]
      IF grant.level > ceiling:
          LOG SecurityWarning("Grant exceeds ceiling — applying ceiling")
          grant.level = ceiling
      effective = MAX(effective, grant.level)

  ─── المرحلة 5: القرار النهائي ───────────────────────────────────
  IF A <= effective:
      RETURN ALLOW
  ELSE:
      RETURN DENY
```

**ملاحظة مهمة:** المرحلة 4 تتحقق من `grant.state = ACTIVE` صراحةً. Grant في حالة PENDING أو SUSPENDED أو REVOKED أو EXPIRED لا يُطبَّق في القرار حتى لو كان موجوداً في قاعدة البيانات.

### أمثلة توضيحية

**مثال 1 — القيد المطلق:**
```
Level 1: المؤسسة تُعلن "وثائق العقود المالية: DENY_ABSOLUTE للخارج"
Level 6: مدير مشروع يُنشئ Grant لـ AECOM على وثيقة عقد مالي
النتيجة: DENY — Level 1 مطلق، لا Grant يُجاوزه
```

**مثال 2 — Grant يتجاوز قيد Folder:**
```
Level 3: "Designers لديهم READ على Documents"  → Ceiling = READ
Level 5: "Folder X: لا وصول للخارج"           → effective = NONE
Level 6: Grant لـ AECOM على Document D (ACTIVE state): REVIEW

حساب:
  ceiling = READ
  effective = NONE (من Level 5)
  grant ACTIVE، لكن REVIEW > ceiling (READ) → يُقلَّص لـ READ
  → effective = MAX(NONE, READ) = READ
النتيجة: ALLOW READ
```

**مثال 3 — Grant في حالة SUSPENDED:**
```
Level 3: Ceiling = READ
Level 6: Grant لـ AECOM (SUSPENDED state): READ

حساب:
  grant.state = SUSPENDED → لا يُطبَّق
  effective = يبقى كما هو بعد Level 3-5
النتيجة: حسب القيود فقط، دون Grant
```

### جدول الأولوية المرجعي

| السيناريو | النتيجة | السبب |
|---|---|---|
| Level 0/1 DENY_ABSOLUTE | DENY | لا يمكن تجاوزه |
| لا Party Membership | DENY | لا سياق تعاون |
| Ceiling = NONE (Level 3) | DENY | الدور لا يُسمح له بهذا النوع |
| Grant غير ACTIVE | لا أثر | PENDING/SUSPENDED/REVOKED تُتجاهل |
| Grant ACTIVE داخل الـ Ceiling | ALLOW (grant.level) | Grant رافع مشروع |
| Grant ACTIVE فوق الـ Ceiling | ALLOW (ceiling) | Ceiling يتحكم دائماً |

---

## IX. دورة حياة Collaboration Grant

### حالات الـ Grant

```
                    ┌──────────┐
                    │ PENDING  │ ← Grant مُنشأ، بانتظار قبول الطرف
                    └──────────┘
                    /          \
              [قبول]          [رفض/إلغاء قبل القبول]
                 ↓                     ↓
          ┌──────────┐          ┌──────────┐
          │ ACCEPTED │          │ REVOKED  │
          └──────────┘          └──────────┘
               ↓ [يبدأ تاريخ البدء]
          ┌──────────┐
          │  ACTIVE  │ ← الـ Grant فعّال، الوصول مُتاح
          └──────────┘
         /            \              \
  [تعليق]         [إلغاء]        [انتهاء تاريخ]
      ↓                ↓                ↓
┌───────────┐   ┌──────────┐   ┌──────────┐
│ SUSPENDED │   │ REVOKED  │   │ EXPIRED  │
└───────────┘   └──────────┘   └──────────┘
      |
  [استئناف]
      ↓
  ACTIVE

[أرشفة المشروع يُحوِّل كل الحالات إلى:]
          ┌──────────┐
          │ ARCHIVED │ ← سجل تاريخي، لا وصول نشط
          └──────────┘
```

**فقط ACTIVE يُطبَّق في Policy Resolution Algorithm.**
باقي الحالات موجودة للـ Audit Trail والإدارة، لكن لا أثر لها في قرارات الوصول.

### تعريف كل حالة

**PENDING:** Grant مُنشأ، الطرف المستفيد لم يقبل بعد. الوصول لا يُفعَّل.

**ACCEPTED:** الطرف قبِل. ينتقل تلقائياً لـ ACTIVE عند تاريخ البدء.

**ACTIVE:** الوصول مُتاح فعلياً. الـ Policy Resolution Algorithm يستخدم هذا الـ Grant.

**SUSPENDED:** توقف مؤقت. الوصول محجوب. قابل للاستئناف. يُسجَّل السبب.

**REVOKED:** إلغاء دائم. لا يمكن استئنافه. يحتاج Grant جديداً.

**EXPIRED:** انتهت مدة الـ Grant تلقائياً. يشبه REVOKED في الأثر.

**ARCHIVED:** حالة نهائية عند أرشفة المشروع.

### خصائص الـ Grant

```
id              — معرّف فريد
resourceId      — الأصل المُمنوح الوصول إليه (أو null للمستوى الأعلى)
resourceType    — نوع الأصل
grantedToParty  — الطرف المستفيد
grantedToOrg    — مؤسسة الطرف المستفيد
accessLevel     — مستوى الوصول المُمنوح
grantedBy       — المستخدم الذي أنشأ الـ Grant
grantedAt       — تاريخ الإنشاء
validFrom       — تاريخ البدء
validUntil      — تاريخ الانتهاء (optional)
expiresOnEvent  — حدث يُسبِّب الانتهاء
state           — PENDING / ACCEPTED / ACTIVE / SUSPENDED / REVOKED / EXPIRED / ARCHIVED
stateChangedAt  — آخر تغيير للحالة
stateChangedBy  — من غيّر الحالة
revocationReason— سبب الإلغاء (إلزامي عند REVOKE)
```

### قواعد الـ Grant

**من يُصدر Grant؟** أي مستخدم لديه `MANAGE_SHARES` على الأصل — ضمن سقف الـ Ceiling المُحدَّد لدوره. لا يستطيع منح ما يفوق Ceiling.

**من يُلغي Grant؟** المانح الأصلي، أو أي مستخدم بصلاحية `ADMIN` في المشروع، أو إدارة النظام.

**هل يُخطَر المستفيد عند الإلغاء؟** نعم — إشعار فوري مع ذكر السبب.

---

## X. التسليم الرسمي — Transmittals

### التمييز الجوهري

```
Collaboration Grant  ≠  Transmittal
      ↓                      ↓
 الوصول المباشر        التسليم الرسمي
 للتعاون اليومي       للمستندات المعتمدة
 قابل للتعديل         سجل قانوني دائم
 غير رسمي             رسمي وموثَّق
```

### متى يبقى Transmittal ضرورياً؟

**دائماً، بصرف النظر عن وجود Collaboration Grants.**

Transmittal ليس آلية "إتاحة وصول" — هو **فعل تسليم رسمي موثَّق** يُثبِت:
- أن مستنداً بمراجعة محددة سُلِّم لطرف محدد في تاريخ محدد
- أن المستلم استلمه ويُقرُّ بذلك
- أن هذا التسليم جزء من الإجراء التعاقدي

**القاعدة:** Collaboration Grant للعمل اليومي. Transmittal للتسليم الرسمي. كلاهما ضروري معاً.

### الوصول إلى Transmittals بعد انتهاء عضوية الطرف *(v2.1 — A6)*

**Transmittals المستلَمة بواسطة طرف تبقى قابلة للوصول Read-Only لـ Org المستلِمة طوال فترة أرشفة المشروع، بصرف النظر عن حالة Party Membership.**

السبب: Transmittals هي إثبات قانوني لما استُلم. فقدان المقاول وصوله لـ Transmittals التي صدرت إليه = فقدان دليله القانوني في النزاعات.

**التفصيل:**
- وصول إنشاء Transmittals جديدة → يتوقف فور انتهاء العضوية
- وصول قراءة Transmittals المستلَمة سابقاً → يبقى لمدة الأرشفة المُحددة
- بعد مدة الأرشفة → يُطبَّق نفس سياسة الأرشفة العامة

---

## XI. أحداث التعاون — التصنيف الكامل

| نوع الحدث | الوصف | الرسمية | قابلية العكس |
|---|---|---|---|
| **Party Invitation** | دعوة جهة (Entity) للانضمام كطرف في مشروع | رسمية تعاقدية | قابل للسحب |
| **Party Acceptance** | قبول الدعوة | رسمية تعاقدية | لا يُمحى (يُلغى) |
| **Transmittal** | تسليم رسمي لمستند | رسمية قانونية | غير قابل للحذف |
| **Correspondence** | مراسلة رسمية | رسمية إجرائية | غير قابل للحذف |
| **Collaboration Grant** | منح وصول مباشر | داخلية إجرائية | قابل للإلغاء |
| **Grant Revocation** | سحب وصول | داخلية أمنية | لا يُمحى |
| **Review Request** | طلب مراجعة من طرف آخر | إجرائية | قابل للإلغاء |
| **Party Exit** | خروج طرف من المشروع | رسمية تعاقدية | غير قابل للحذف |

**القاعدة:** كل حدث تعاون يُسجَّل في Audit Trail. الحذف مستحيل لأي منها.

---

## XII. إدارة دورة الحياة وانتهاء العقود

### خروج طرف من المشروع

```
الموارد التي أنشأها هذا الطرف:
  → تبقى في النظام (الملكية للمؤسسة، ليست للمشروع)
  → الأطراف الأخرى تبقى قادرة على الوصول لما مُنح لهم
  → الطرف الخارج يفقد صلاحية إضافة أو تعديل أي شيء
  → Grants التي أنشأها: تُجمَّد (لا تُلغى تلقائياً، قرار منفصل)

حقوق الوصول للطرف الخارج:
  → كل Grants النشطة تنتقل لـ REVOKED أو EXPIRED حسب السبب
  → وصول إنشاء أي Resource جديد يتوقف فوراً
  → وصول قراءة Transmittals المستلَمة يبقى (انظر Section X)

Audit Trail:
  → لا يُحذف شيء
  → يبقى باسم المؤسسة: "Approved by [Name] from [Org] on [Date]"
```

### انتهاء العقد

```
D-30: تنبيه لمديري المشروع وممثل الطرف المنتهي عقده
D-7:  تنبيه أخير + فرصة ترحيل بيانات
D-0:  انتقال تلقائي لـ Read-Only
D+30: وصول Archived فقط (Transmittals المستلَمة)
D+90: انتهاء الوصول كلياً (حسب إعدادات المؤسسة المالكة)
```

### سحب الوصول طارئاً *(v2.1 — A4)*

```
Emergency Revocation (مثل: موظف يترك الشركة، اختراق أمني):

  T+0:  Grant state → REVOKED (فوري في قاعدة البيانات)
  T+0:  Policy Resolution Algorithm يرفض أي طلب جديد
  T+0:  إشعار لمدير المشروع ومالك المؤسسة
  T+0:  Audit Log: "Access revoked by [User] — Reason: [...]"

  ملاحظة مهمة حول الـ JWT:
  الـ JWT الحالية stateless — لا يمكن إلغاؤها قبل انتهائها الطبيعي.
  الإلغاء الفوري على مستوى Grant يمنع أي طلب جديد يمر عبر Policy Resolution،
  لكن JWT سارية قد تُتيح وصولاً لنقاط نهاية لا تمر بخوارزمية الـ Grant.
  الحل الكامل يتطلب: token blacklist (Redis) أو short-lived tokens (15 دقيقة)
  مع refresh token rotation — هذا متطلب infrastructure لمستقبل يُقرَّر عند الحاجة.

  T+∞:  سجل أن الوصول كان موجوداً يبقى دائماً
```

---

## XIII. Federation — التعاون بين المنصات المستقلة

### تعريف المشكلة

في النموذج الحالي، كل المؤسسات على نفس منصة ArcScale. Federation تُعالج:
- مؤسسة لها ArcScale خاصة (Self-hosted)
- منصتان مستقلتان تريدان التعاون

### مستويات Federation

**المستوى 0 — لا Federation (الحالي):**
كل المؤسسات على نفس الـ platform. لا تعاون خارجي. المستخدمون ينشئون حسابات داخل المنصة للمؤسسة التي دعتهم.

**المستوى 1 — Platform Identity Federation (المستقبل القريب):**
نفس الـ platform، لكن المؤسسة تستخدم Identity Provider خاصة (SAML/OIDC). مستخدمو AECOM يُسجِّلون دخولهم بحساب AECOM الخاص.

**المستوى 2 — Cross-Platform Federation (المستقبل البعيد):**
منصتان ArcScale مستقلتان تتبادلان الثقة.

### ما يظل ثابتاً في Federation

- الملكية لا تنتقل بين منصات
- Access Policy Resolution يجري على منصة مالك المورد
- Transmittals الرسمية بين منصات تحمل Digital Signature
- Audit Trail على كل منصة مستقل ومحمي

### جدول التنفيذ

| المستوى | الشرط | الأفق الزمني |
|---|---|---|
| Level 0 (الحالي) | — | الآن |
| Level 1 (SSO/SAML) | وجود enterprise clients | 2-3 سنوات |
| Level 2 (Cross-platform) | نضج السوق + قانونية | 5-7 سنوات |

**الموقف الحالي:** لا نبني Level 2 الآن. القرارات الحالية يجب أن لا تمنع بناءه لاحقاً.

---

## XIV. تطبيق الإطار على الكيانات

| Resource | نموذج Org-only | في Collaboration | الآلية الرسمية | ملاحظة |
|---|---|---|---|---|
| **Documents** | orgScopedWhere | Party Grant (Level 3+6) | Transmittal | الجوهر — أعلى أولوية |
| **Folders** | org-scoped | يرث من Project Policy | — | لا Transmittal مباشر |
| **Correspondence** | Mail-model | Mail-model موسَّع | Formal Letter | لا viewAll للخارج |
| **Meetings** | org-scoped | Invite-based لكل Party | Meeting Minutes | قابل للتنفيذ فوراً |
| **Transmittals** | Cross-org by design | — | هو نفسه الآلية | لا يحتاج تغييراً |
| **RFIs** | org-scoped | Requester + Responder | RFI Response | طرفان محددان |
| **Submittals** | org-scoped | Multi-party Workflow | Submittal Register | يعبر 3+ أطراف |
| **Workflows** | org-scoped | Multi-party Approvers | Completion Record | Approver قد يكون خارجياً |

---

## XV. القواعد غير القابلة للتفاوض

هذه القواعد تُعبِّر عن الفلسفة الأساسية. أي قرار يتعارض معها يحتاج مراجعة هذه الوثيقة.

```
القاعدة 1   الملكية لا تنتقل:
            المؤسسة التي أنشأت Resource تملكه إلى الأبد.

القاعدة 2   الوصول ≠ الملكية:
            إتاحة الوصول لطرف خارجي لا تُغيِّر من يملك المورد.

القاعدة 3   Transmittals للتسليم الرسمي دائماً:
            حتى مع وجود Collaboration Access، التسليم الرسمي يمر بـ Transmittal.

القاعدة 4   الـ Audit Trail لا يُحذف:
            كل حدث تعاون يُسجَّل ويبقى — حتى بعد انتهاء المشروع والعقد.

القاعدة 5   Default is Closed:
            أي Resource جديد private بالكامل حتى يُتاح صراحةً.

القاعدة 6   الهرمية Restricts لا Expands:
            Level أدنى يُضيِّق الوصول. لا يُوسِّعه فوق الـ Ceiling.
            استثناء: Entity Grant ACTIVE يُوسِّع فوق Folder restriction، لكن لا فوق الـ Ceiling.

القاعدة 7   الدور في المشروع منفصل عن الدور في المؤسسة:
            User قد يكون admin في مؤسسته وviewer في مشروع خارجي.

القاعدة 8   الانسحاب لا يُحذف التاريخ:
            خروج طرف لا يمحو أثره في Audit Trail أو اعتماداته أو مساهماته.

القاعدة 9   Grant لا يتجاوز الـ Ceiling:
            لا يمكن منح Grant بمستوى وصول يفوق ما يُتيحه Project Collaboration Policy.

القاعدة 10  Federation لا تكسر الـ Ownership:
            التعاون بين منصات مستقلة لا ينقل ملكية أي مورد.

القاعدة 11  نظامَا الصلاحيات لا يختلطان:
            Role-Based للموارد الداخلية. ACA Access Levels للموارد Cross-org.
            لا يُطبَّقان معاً على نفس Resource في نفس الوقت.

القاعدة 12  orgScopedWhere invariant محفوظ:
            Collaborative Access لا يُضيف OR على orgScopedWhere.
            يُنفَّذ كـ Authorization Path منفصل تماماً.
```

---

## XVI. مسار الانتقال التدريجي والـ Pilot

### الخريطة الكاملة: الحالي والمستقبل

```
الحالة الراهنة — ما يعمل اليوم (Sprint A + B):
  ✅ Organization Ownership                   — الأساس، محفوظ
  ✅ RBAC داخل المؤسسة                       — يعمل، لا تغيير
  ✅ orgScopedWhere                           — محفوظ لكل المشاريع الداخلية
  ✅ project_members (قادر على cross-org)     — بذرة Party Model
  ✅ Transmittals cross-org                   — يعمل، لا تغيير
  ✅ Correspondence mail-model cross-org      — يعمل، لا تغيير
  ✅ Audit logging                            — يعمل، يُوسَّع لاحقاً
  ❌ Party Model (project_parties table)      — غير موجود
  ❌ Access Policy Framework                  — غير موجود
  ❌ Collaboration Grants                     — غير موجود
  ❌ Workspace Layer                          — غير موجود
  ❌ Federation                               — غير موجود (مستقبل بعيد)
```

### مبدأ التوافق الرجعي

**كل ما يُضاف يعمل على المشاريع الجديدة. كل ما يعمل اليوم يستمر بدون تغيير.**

```
مشروع حالي (org_only):
  collaborationMode = 'org_only' (default — القيمة الفعلية في DB والكود)
  → يعمل بنفس منطق Sprint A تماماً
  → orgScopedWhere يعمل كما هو بلا لمس

مشروع جديد مع تعاون (opt-in):
  collaborationMode = 'parties'
  → يُفعَّل Party Model
  → Authorization Path المنفصل للـ cross-org access
  → orgScopedWhere يبقى سليماً للـ org_only queries
```

### المراحل التدريجية

```
المرحلة الحالية — Production (Sprint A + B، مكتملة)

المرحلة 1 — Party Model Pilot:
  - project_parties table
  - collaborationMode per project
  - Collaborative Authorization Path (منفصل عن orgScopedWhere)

المرحلة 2 — Access Policy Framework:
  - collaboration_policies table
  - Policy Resolution Algorithm
  - Entity Type defaults per Party Role

المرحلة 3 — Collaboration Grants:
  - collaboration_grants table مع Grant Lifecycle كامل
  - Grant creation + management UI

المرحلة 4 — Workspace:
  - workspaces table + Virtual Project Pattern
  - Workspace Policy level في APF

المرحلة 5 — Federation (مستقبل بعيد):
  - SSO/SAML integration عند وجود enterprise clients
```

### الـ Pilot — أول حالة استخدام حقيقية

**السيناريو:** مؤسسة (المالك) تُتيح لاستشاري (Designer) رؤية مستندات التصميم في مشروع محدد.

**ما يُبنى في الـ Pilot:**
1. `project_participants` table (entity + project + role + dateRange) — *(انظر DOMAIN_MODEL.md Section IV للـ Schema الكامل)*
2. `collaborationMode` على المشروع (`'org_only'` / `'parties'`)
3. **Authorization Path منفصل** — لا OR على `orgScopedWhere`:
   - استعلام مستقل يتحقق من: هل المستخدم ينتمي لـ Entity مشاركة؟ هل المشروع `'parties'` mode؟ هل الـ Resource ضمن الـ Ceiling الافتراضي للدور؟
   - يُرجع فقط الـ Resources المُتاحة صراحةً — لا cross-org leak
4. Transmittals تسير كالمعتاد (لا تغيير)

**ما لا يتغير في الـ Pilot:**
- كل `orgScopedWhere` في الكود الحالي — لا لمس
- كل مشاريع `org_only` — لا أثر
- منطق permissions الداخلي — لا تغيير

**معايير نجاح الـ Pilot:**
- Entity B (ممثَّلة عبر Organization Tenant الخاص بها) ترى مستندات Entity A في المشروع المحدد فقط
- Entity B لا ترى أي شيء خارج هذا المشروع
- Organization A الـ `org_only` projects: orgScopedWhere يعمل بلا تأثير
- Audit Trail يُسجِّل كل وصول cross-entity بوضوح

---

## XVII. القرارات المحسومة وما تبقى مفتوحاً

### محسوم بهذه الوثيقة

| القرار | الموقف |
|---|---|
| Organization Ownership هو الأساس | ✅ لا تغيير |
| Transmittals للتسليم الرسمي دائماً | ✅ محفوظة |
| Collaborative Access = Authorization Path منفصل | ✅ محدد |
| Party Model هو آلية التعاون | ✅ محدد |
| APF هو إطار السياسات | ✅ محدد |
| Grant Lifecycle بـ 7 حالات | ✅ محدد |
| فقط ACTIVE Grants تُطبَّق في Policy Resolution | ✅ محدد |
| Role-Based للداخلي / ACA Access Levels للـ cross-org | ✅ محدد |
| Workspace يستخدم Virtual Project Pattern | ✅ محدد |
| Transmittals المستلَمة تبقى Read-Only بعد انتهاء العضوية | ✅ محدد |
| Grant Revocation الفوري Soft فقط (JWT limitation موثَّق) | ✅ محدد |
| Federation بدون كسر Ownership | ✅ محجوز |

### محسوم في v3.0 — طبقة الهوية (2026-07-03)

*(راجع `DOMAIN_MODEL.md` للتفاصيل الكاملة)*

| القرار | الموقف |
|---|---|
| Entity منفصلة عن Organization | ✅ Entity = الهوية، Organization = Tenant |
| FK الاتجاه: `entityId` على Organization | ✅ الـ Many side يحمل الـ FK — يتيح 1:N |
| الـ 1:N هيكلي فقط | ✅ مسموح في الـ Schema — لا سلوك مشترك الآن |
| `entityId` nullable على Organization | ✅ Organization تعمل دون Entity مرتبطة |
| `parentEntityId` محجوز بلا منطق | ✅ الحقل في Schema — لا hierarchy logic الآن |
| Party = Entity + Role في Project | ✅ ليس Organization + Role |
| Local Directory الآن | ✅ Global/Federation موثَّق ومؤجَّل |
| Contact يرتبط بـ Entity + `userId` nullable | ✅ الربط بـ User مؤجَّل |
| Organization Type منفصل عن Project Role | ✅ وصف ثابت ≠ دور سياقي |

---

### ما يبقى للقرار عند التنفيذ

**أ) Grantor Authority على مستندات Party آخر:**
مشروع Org A + مستند يملكه Org B (Designer) → Org A تريد مشاركته مع Org C.
الإجابة من القواعد: Org A لا تملك الـ Grant authority — Org B يجب أن تُصدره أو تُفوِّض MANAGE_SHARES لـ Org A صراحةً.
*يُوثَّق عند تنفيذ Grant System.*

**ب) Party Invitation: قبول صريح أم تلقائي؟**
الأثر على Audit Trail وتجربة المستخدم.

**ج) مدة PENDING Grants:**
المقترح: 30 يوم ثم EXPIRED تلقائياً.

**د) Workspace General — هل يظهر للمستخدم؟**
المقترح: مخفي حتى يُنشئ المستخدم Workspace مخصصاً.

---

## XVIII. Implementation Considerations

هذه الاعتبارات لا تُغيِّر الـ Framework — لكنها يجب أن تُقرأ قبل تنفيذ كل مرحلة.

---

**IC-1: Ceiling مشترك لكل أعضاء الـ Party (Known Limitation)**

كل مستخدمي Org B في Project X يحملون نفس الـ Ceiling (من Party Role). لا تمييز فردي داخل نفس الـ Party بدون Entity Grants.

*عند التنفيذ:* توثيق هذا كـ Known Limitation. التمييز الفردي يُحقَّق حصراً عبر Entity Grants (Level 6)، لا عبر تعديل Party Role.

---

**IC-2: لا Hard Folder Lock (extension point مستقبلي)**

الفولدر Restriction (Level 5) قابل للتجاوز بـ Entity Grant ACTIVE. لا توجد آلية حالياً تمنع Grant من تجاوز Folder restriction بشكل مطلق.

*عند تنفيذ Folder Policy:* توثيق هذا كـ gap. إضافة "Folder Hard Lock" (يعمل كـ Level 1 على مستوى الفولدر) تُضاف كـ extension في مرحلة لاحقة عند وجود حاجة فعلية.

---

**IC-3: Grant Authority في التثليث**

إذا أنشأ Org B مستنداً في مشروع Org A، وأراد Org A مشاركته مع Org C:
- Org A لا تملك Grant Authority على مستند Org B (القاعدة 1 + 9)
- Org B يجب أن يُصدر الـ Grant أو يُفوِّض MANAGE_SHARES لـ Org A صراحةً

*عند تنفيذ Grant System:* هذا الـ flow يجب أن يكون معتمداً في الـ UI — "طلب تفويض Grant" من المالك الحقيقي.

---

**IC-4: مراجعة `objectAcl.ts` قبل تنفيذ Level 6 Grants**

يوجد في الكود `lib/objectAcl.ts`. يجب مراجعته قبل بناء Entity Grant system للتحقق من:
- هل يُوجد نظام ACL موجود بالفعل؟
- هل يُشابه Level 6 أم يختلف؟
- هل يُمدَّد أم يُستبدل؟

*Prerequisite لمرحلة Collaboration Grants.*

---

**IC-5: Policy Evaluation يجب أن يُصمَّم مع Caching**

الخوارزمية في Section VIII تُقيِّم 7 مستويات. Per-request evaluation لكل Resource في قائمة = 7× عدد الـ Resources في DB queries.

*عند تنفيذ APF:* الـ Policies تُخزَّن في cache per-project-load أو per-Party-session. لا per-resource-evaluation بدون cache. هذا شرط تصميمي لا اختياري.

---

**IC-6: MANAGE_SHARES غير قابل للتفويض**

Grant يحمل `MANAGE_SHARES` لا يُطبَّق على الـ Grantee تلقائياً. MANAGE_SHARES لا تنتقل بالـ Grants.

*عند تنفيذ Grant System:* هذا يمنع delegation chain اللانهائية. إعطاء MANAGE_SHARES لطرف = قرار صريح من مالك المورد، لا يُورَّث تلقائياً.

---

## XIX. Future Roadmap

هذه المواضيع صحيحة ومهمة لكن لا تؤثر على المراحل القريبة.

| الموضوع | متى يُعالَج | الشرط |
|---|---|---|
| مستخدم ينتقل من Org B إلى Org C — ماذا يحدث بـ Grants الصادرة له | عند بناء Grant Lifecycle management | الـ Grant مرتبط بـ org لا بـ user — الانتقال لا يُؤثر |
| Regulatory Authority بوصول خفيف (لا Org Onboarding) | عند وجود طلب فعلي من عميل | Lightweight Observer access pattern |
| Cross-Project Shared Standards documents | عند بناء Workspace أو Programs متعددة المشاريع | يحتاج Cross-Project resource reference |
| "Explain Access" — أداة تشخيص سبب رفض الوصول | عند بناء APF الكامل (المرحلة 2) | 7 مستويات تحتاج debugging UI |
| Short-lived tokens + refresh rotation (T+0 revocation) | عند وجود enterprise requirement | Infrastructure decision — Redis or token store |
| Hard Folder Lock (Level 1 at folder level) | عند وجود طلب فعلي | Extension لـ APF Layer 5 |

---

*الوثيقة مجمَّدة كـ Approved Architecture Baseline — 2026-07-01*
*لا تُعاد مراجعتها إلا بوجود سبب تقني جوهري مُحدَّد.*
*المرحلة التالية: Sprint C — Production Safety.*

---

*تحديث 2026-07-05: توحيد أسماء `collaborationMode` — القيم الرسمية في DB والكود هي `'org_only'` و`'parties'`. تم استبدال الأسماء السابقة `INTERNAL`/`COLLABORATIVE` في هذه الوثيقة. لا تغيير في المنطق.*
