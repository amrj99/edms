# ArcScale — نموذج المجال (Domain Model)
## وثيقة الهوية والدليل v1.0

**التاريخ:** 2026-07-03 | **الحالة:** معتمد — جاهز للمراجعة قبل التنفيذ
**النطاق:** طبقة الهوية والدليل — Entity، Organization، Contact، Directory
**العلاقة بـ ACA:** هذه الوثيقة تُعرِّف "من هم الأطراف" — ACA تُعرِّف "كيف يتعاونون"

---

> **القرارات الواردة هنا محسومة معمارياً بتاريخ 2026-07-03.**
> لا يُبدأ بأي تنفيذ قبل مراجعة هذه الوثيقة والموافقة عليها.

---

## الفهرس

1. لماذا نحتاج هذه الطبقة؟
2. المفاهيم الأساسية
3. العلاقات وقواعد الربط
4. نموذج البيانات (Schema المقترح)
5. دليل المؤسسات (Directory)
6. ProjectParticipant — الجسر بين الهوية والتعاون
7. القرارات المحسومة
8. المؤجَّل والمحجوز للمستقبل

---

## I. لماذا نحتاج هذه الطبقة؟

### المشكلة الحالية

البنية الراهنة تساوي بين شيئين مختلفين:

```
Organization = الكيان القانوني (الشركة كما هي في الواقع)
Organization = حساب الـ Tenant على المنصة
```

هذا يعني ضمنياً:
- كل شركة = حساب واحد بالضبط (1:1)
- هوية الشركة مقيَّدة بحدود الـ Tenant
- لا مكان لتمثيل شركة خارجية دون أن تُنشئ حساباً

### الحالة التي كشفت المشكلة

```
AECOM لديها:
  - AECOM UAE  → Organization على ArcScale (Tenant)
  - AECOM KSA  → Organization مستقلة ثانية (Tenant)

كلاهما نفس الشركة القانونية، لكن النموذج الحالي
يعاملهما ككيانين لا علاقة بينهما.
```

والأهم: عندما يُدرج مستخدم شركة خارجية (مثل مقاول أو استشاري) في مشروعه — هذه الشركة ليس لها بالضرورة حساب على ArcScale، لكن يجب أن يكون لها هوية.

### الحل

```
Entity     = الهوية الواقعية للجهة (من هم؟)
Organization = حساب التشغيل على المنصة (كيف يتعاملون معنا؟)
```

فصل كامل بين الهوية وحساب التشغيل.

---

## II. المفاهيم الأساسية

### Entity (الجهة / الكيان)

الهوية الواقعية لأي جهة تظهر في ArcScale — سواء كانت صاحب حساب أم لا.

```
Entity = شركة إنشاء، مكتب استشاري، جهة حكومية، مقاول،
         مورِّد، فرد — أي جهة تؤدي دوراً في سياق العمل.

مثال:
  AECOM          → Entity واحدة
  بلدية دبي      → Entity
  مكتب الأستاذ خالد → Entity
```

**خصائص Entity:**

| الحقل | النوع | الملاحظة |
|-------|-------|---------|
| `id` | UUID PK | معرف ثابت |
| `name` | TEXT NOT NULL | الاسم الرسمي |
| `type` | ENUM | `company`, `government`, `individual`, `ngo` |
| `country` | TEXT | رمز الدولة (ISO 3166-1 alpha-2) |
| `registrationNumber` | TEXT NULL | رقم السجل التجاري (اختياري) |
| `parentEntityId` | UUID NULL FK → entities | هرمية اختيارية |
| `createdAt` | TIMESTAMP | |
| `updatedAt` | TIMESTAMP | |

**قاعدة أساسية:** Entity لا تحمل أي FK نحو Organization. الربط يسير بالاتجاه المعاكس.

---

### Organization (حساب الـ Tenant)

حساب التشغيل على ArcScale — الوحدة التي تملك البيانات، وتضم المستخدمين، وتتحمل الاشتراك.

```
Organization = Tenant على المنصة.
               تُدار بياناتها باستقلالية تامة.
               قد ترتبط بـ Entity حقيقية أو لا.
```

**التغيير الجوهري عن النموذج السابق:**

```
السابق:  Organization تحتوي على orgType أو صفات الهوية مباشرة
الجديد:  Organization = حساب تشغيلي صرف
          هويتها الحقيقية موجودة في Entity المرتبطة (اختياري)
```

**الحقل الجديد:**

```sql
ALTER TABLE organizations ADD COLUMN entity_id UUID REFERENCES entities(id) ON DELETE SET NULL;
```

`entityId` على Organization (ليس العكس) — هذا يسمح بـ 1:N:

```
Entity "AECOM"
  ├── Organization "AECOM UAE"  (entityId → AECOM)
  └── Organization "AECOM KSA"  (entityId → AECOM)
```

**قاعدة:** `entityId` nullable — Organization يمكن أن تعمل دون ارتباط بـ Entity.

---

### Contact (ممثل الجهة)

شخص يُمثِّل Entity في سياق العمل — قد يكون مستخدماً على ArcScale أو لا.

```
Contact = موظف، مدير مشروع، مهندس — في شركة معيَّنة.
          يُعرَّف دائماً بالنسبة لـ Entity.
          قد يُربط لاحقاً بـ User (إذا سجَّل حساباً).
```

**خصائص Contact:**

| الحقل | النوع | الملاحظة |
|-------|-------|---------|
| `id` | UUID PK | |
| `entityId` | UUID FK → entities NOT NULL | الجهة التي يمثِّلها |
| `name` | TEXT NOT NULL | |
| `email` | TEXT NULL | |
| `phone` | TEXT NULL | |
| `jobTitle` | TEXT NULL | |
| `userId` | UUID NULL FK → users | ربط بحساب ArcScale (مستقبلي) |
| `createdAt` | TIMESTAMP | |

---

### Organization Type (نوع المؤسسة)

وصفٌ دائم لطبيعة نشاط المؤسسة — مستقل تماماً عن دورها في أي مشروع.

```
Organization Type = "شركة إنشاء", "مكتب استشاري", "مورّد", "جهة حكومية"...

هذا يصف ما هي المؤسسة في جوهرها —
ليس ما تفعله في مشروع بعينه.
```

**الفرق الجوهري:**

```
Organization Type (ثابت):
  "AECOM هي مكتب استشاري هندسي"
  → لا يتغير بتغيير المشاريع

Party Role / ProjectParticipant (سياقي):
  "AECOM تعمل كـ Designer في مشروع X"
  "AECOM تعمل كـ Owner Rep في مشروع Y"
  → يتغير بكل مشروع
```

**Org Type يبقى حيث هو** (في Organization أو Entity). لا حاجة لربطه بـ ProjectParticipant.

---

## III. العلاقات وقواعد الربط

### خريطة العلاقات

```
Entity (الهوية الحقيقية)
  │
  ├── 1:N → Organization (حسابات Tenant)
  │            entityId FK على Organization
  │
  ├── 1:N → Contact (ممثلو الجهة)
  │            entityId FK على Contact
  │
  └── 0:1 → Entity (هرمية — parentEntityId)
               Entity الأم
```

```
Contact
  └── 0:1 → User
               userId FK على Contact (nullable)
               يُفعَّل عندما يُنشئ Contact حساباً
```

```
Entity + Project → ProjectParticipant (دور في مشروع)
  entityId FK على ProjectParticipant
  projectId FK على ProjectParticipant
  role ENUM
```

### قواعد الربط

| القاعدة | التفاصيل |
|---------|---------|
| FK الاتجاه | `entityId` على Organization — لا `organizationId` على Entity |
| الـ 1:N | هيكلياً مسموح: Entity واحدة → Organizations متعددة |
| السلوك الحالي | كل Organization تعمل باستقلالية تامة — لا منطق مشترك بين Orgs لنفس Entity |
| الـ nullable | `entityId` على Organization مسموح أن يكون NULL |
| الهرمية | `parentEntityId` على Entity مسموح أن يكون NULL — لا منطق هرمي حالياً |

---

## IV. نموذج البيانات (Schema الفعلي)

> **أنواع المفاتيح:** النظام يستخدم `serial` (integer) في كل الجداول — لا UUID.
> القرار مُثبَّت بعد مراجعة schema الفعلي بتاريخ 2026-07-03.

```sql
-- نوع Enum للجهات (PostgreSQL type)
CREATE TYPE entity_type AS ENUM ('company', 'government', 'individual', 'ngo', 'consortium');

-- جدول الجهات (Entity / Directory)
-- org_id = الـ Tenant الذي أنشأ هذا الـ Entity في دليله المحلي (Local Directory)
CREATE TABLE entities (
  id                  SERIAL PRIMARY KEY,
  organization_id     INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  type                entity_type NOT NULL,
  country             TEXT,                          -- ISO 3166-1 alpha-2
  registration_number TEXT,                          -- رقم السجل التجاري
  parent_entity_id    INTEGER REFERENCES entities(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_entities_org_id ON entities(organization_id);
CREATE INDEX idx_entities_name   ON entities(name);

-- جدول جهات الاتصال
CREATE TABLE contacts (
  id          SERIAL PRIMARY KEY,
  entity_id   INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  email       TEXT,
  phone       TEXT,
  job_title   TEXT,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,  -- ربط مستقبلي
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_contacts_entity_id ON contacts(entity_id);
CREATE INDEX idx_contacts_user_id   ON contacts(user_id);

-- الحقل الجديد على organizations (nullable — لا يكسر أي شيء حالي)
ALTER TABLE organizations
  ADD COLUMN entity_id INTEGER REFERENCES entities(id) ON DELETE SET NULL;
CREATE INDEX idx_organizations_entity_id ON organizations(entity_id);
```

> **ملاحظة Phase 1:** جدول `project_participants` (Entity + Project + Role) يُبنى في Phase 2
> عند بدء تنفيذ Collaboration Layer. لا migrations له الآن.

---

## IV-A. Legacy Compatibility Note

**جدول `external_contacts` — Legacy/Operational**

يوجد في النظام جدول `external_contacts` قائم منذ ما قبل Domain Model:

```
external_contacts:
  id              serial PK
  organization_id integer FK → organizations
  name            text NOT NULL
  email           text NOT NULL
  company         text          ← نص حر، لا FK لـ Entity
  job_title       text
  phone           text
```

**قاعدة Phase 1:**
- `external_contacts` لا يُلمس — لا تعديل، لا إضافة entityId، لا هجرة بيانات
- `contacts` الجديدة هي جزء من Domain Model النظيف (entity_id FK)
- الجدولان يتعايشان بالتوازي حتى يُقرَّر مسار الهجرة في مرحلة لاحقة
- **لا خلط بينهما** في الكود أو الـ API أو الـ UI

---

## V. دليل المؤسسات (Directory)

### النطاق الحالي: Local Directory

```
كل Organization تُدير قائمتها الخاصة من Entities.
العزل كامل — لا Entities مشتركة بين Tenants في المرحلة الأولى.

مثال:
  [Org A Tenant]         [Org B Tenant]
  ├── Entity: AECOM      ├── Entity: AECOM    ← نفس الشركة
  ├── Entity: Bechtel    ├── Entity: WSP      ← لكن كل Tenant
  └── Entity: Local Co.  └── Entity: Arup     ← يُدير نسخته المستقلة
```

**لماذا Local Directory الآن؟**
- أبسط: لا تعقيدات Cross-tenant data sharing
- أسرع: لا federation في المرحلة الأولى
- أكثر أماناً: كل Tenant يتحكم في بياناته
- قابل للتطور: Global Directory يُبنى فوقه لاحقاً

### الأفق المستقبلي: Global Directory (محجوز)

```
Entity "AECOM" تُنشأ مرة واحدة على مستوى المنصة،
يستطيع كل Tenant الإشارة إليها.

هذا يحل مشكلة:
  - تكرار البيانات (كل Tenant يُنشئ AECOM من جديد)
  - اتساق المعلومات (اسم + بلد + نوع موحَّد)
  - Discovery (Tenant جديد يجد AECOM جاهزة)

لا تنفيذ الآن — المسار موثَّق لا أكثر.
```

### Federation (مؤجَّل بعيد)

```
Entity لديها Profile مُوثَّق في منصة خارجية (نظام ERP، SAML، OpenID Connect).
ArcScale تُنشئ Trust حول هذا Profile.

يُعالَج في مرحلة Enterprise — بعد وجود عملاء enterprise فعليين.
```

---

## VI. ProjectParticipant — الجسر بين الهوية والتعاون

### التعريف

```
ProjectParticipant = Entity تؤدي دوراً محدداً في مشروع محدد.
```

هذا ما كان يُسمَّى "Party" في ACA v2.1 — إلا أن ACA كانت تقصد Organization في الدور، لا Entity. التصحيح الآن:

```
السابق:  Party = Organization + Role في Project
الجديد:  ProjectParticipant = Entity + Role في Project
```

**لماذا Entity وليس Organization؟**

```
AECOM UAE (Organization) و AECOM KSA (Organization)
كلاهما يمثِّلان AECOM (Entity) في مشروع إقليمي.

إذا ربطنا الدور بـ Organization:
  → AECOM UAE = Party A
  → AECOM KSA = Party B  ← مشكلة: نفس الجهة، دورَان مختلفان؟

إذا ربطنا الدور بـ Entity:
  → AECOM (Entity) = ProjectParticipant بدور "Designer"
  → AECOM UAE و KSA كلاهما يندرجان تحت هذه المشاركة
```

### العلاقة مع ACA

ACA (وثيقة التعاون) تتحدث عن:
- Party Roles (Designer, Owner Rep, Observer...)
- Party Permissions (ما يستطيع الوصول إليه)
- Party Membership (مدة المشاركة)

**كل هذا يُطبَّق الآن على ProjectParticipant (Entity-based) بدلاً من Organization-based Party.**

للانتقال من ACA إلى هذا النموذج:

```
ACA "Party"              →  Domain Model "ProjectParticipant"
ACA "Organization"       →  Domain Model "Entity" (في سياق الهوية)
ArcScale "Organization"  →  Domain Model "Organization" (Tenant account)
```

---

## VII. القرارات المحسومة

هذه القرارات اتُّخذت في 2026-07-03 وهي جزء من Architecture Freeze للـ Domain Model:

| # | القرار | التفاصيل |
|---|--------|---------|
| DM-01 | الفصل الكامل بين Entity وOrganization | Entity = الهوية، Organization = Tenant — مفهومان منفصلان |
| DM-02 | FK الاتجاه: entityId على Organization | لا organizationId على Entity — الـ Many side يحمل الـ FK |
| DM-03 | الـ 1:N هيكلي، لا سلوكي | Entity واحدة قد ترتبط بـ Organizations متعددة — لكن كل Org تعمل باستقلالية |
| DM-04 | entityId nullable | Organization لا تحتاج Entity مرتبطة لتعمل |
| DM-05 | parentEntityId محجوز، لا منطق | الحقل موجود في Schema — لا hierarchy logic الآن |
| DM-06 | Local Directory فقط الآن | كل Tenant يُدير Entities الخاصة به — لا global sharing |
| DM-07 | Contact يرتبط بـ Entity، لا Organization | Contact.entityId NOT NULL — Contact.userId NULL (للمستقبل) |
| DM-08 | Organization Type منفصل عن Project Role | OrgType = "من هم" (ثابت) — ProjectParticipant Role = "ماذا يفعلون" (سياقي) |
| DM-09 | ProjectParticipant = Entity + Role في Project | ليس Organization + Role — العلاقة على مستوى الهوية |

---

## VIII. المؤجَّل والمحجوز للمستقبل

| الموضوع | القرار | السبب |
|---------|--------|-------|
| Global Directory | محجوز — لا تنفيذ | تعقيد Cross-tenant لا حاجة له الآن |
| Federation / SSO | محجوز — لا تنفيذ | يتطلب Enterprise clients فعليين |
| Entity Hierarchy Logic | محجوز — parentEntityId موجود فقط | لا use case حقيقي الآن |
| Contact → User Auto-link | محجوز — userId في Schema | الربط يحدث عند تسجيل الحساب (مستقبلاً) |
| Multi-org Behavior لنفس Entity | محجوز — هيكل متاح | السلوك المشترك يُحدَّد عند وجود حاجة فعلية |
| Entity Verification / KYC | خارج النطاق | ليس في أفق ArcScale الحالي |

---

## سجل التغييرات

| الإصدار | التاريخ | التغيير |
|---------|---------|---------|
| v1.0 | 2026-07-03 | الإصدار الأول — Entity/Organization/Contact/Directory |
