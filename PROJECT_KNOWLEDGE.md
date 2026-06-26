# ArcScale EDMS — Project Knowledge Base
> **عقل المشروع.** هذا الملف هو المرجع الأعلى لأي مطور أو نموذج ذكاء اصطناعي يعمل على ArcScale.  
> **Living Document** — يُحدَّث مع كل قرار معماري مهم.  
> **عند التعارض:** الكود هو السلطة النهائية. هذا الملف يشرح *لماذا*، الكود يقول *ماذا*.  
> آخر تحديث: 2026-06-26 | commit: `5d056f3`

---

## 1. Vision & Philosophy

### ما هو ArcScale؟
ArcScale EDMS منصة SaaS متعددة المستأجرين (multi-tenant) لإدارة المستندات الهندسية، المراسلات، وسير العمل في مشاريع البناء والبنية التحتية. يخدم شركات هندسية من جهات مختلفة: مالك المشروع، الاستشاري، المقاول الرئيسي، المقاولون من الباطن.

### الفلسفة الأساسية
**"Control before convenience."**  
كل وثيقة لها رقم. كل إجراء له سجل. كل مستخدم له صلاحية محددة. لا شيء يحدث بلا توثيق.

### وضعَا الاستخدام (يتعايشان في نفس النظام)

| الوضع | الوصف | المثال |
|-------|-------|--------|
| **Internal Operations** | شركة تدير عملها الداخلي | إجراءات، سياسات، مراسلات داخلية |
| **Project Collaboration** | شركات متعددة تتعاون على مشروع | مقاول يرفع مستندات، استشاري يراجعها، مالك يعتمدها |

### القيم التصميمية (بالأولوية)
1. **الأمان أولاً** — العزل بين المستأجرين لا يُتنازل عنه
2. **Audit Trail دائم** — كل إجراء يُسجَّل، السجلات لا تُحذف
3. **Fail Closed** — أي غموض في الصلاحية ينتهي بالرفض (403)، ليس القبول
4. **Additive قبل Destructive** — أضف عموداً جديداً قبل أن تمسح عموداً قديماً
5. **Production-Safe** — كل تغيير يُنشر بـ `git pull + docker compose build + up` دون خطوات يدوية

---

## 2. Core Architecture

### Stack الحالي (2026-06)
```
Frontend:  React 18 + Vite 7 + TypeScript + Tailwind CSS + shadcn/ui
Backend:   Express 5 + TypeScript + Drizzle ORM 0.45
Database:  PostgreSQL 16
Storage:   Cloudflare R2 (object storage) + local fallback
Auth:      Custom HS256 JWT + refresh token rotation
Deploy:    Docker Compose + Nginx + Hetzner VPS
CDN:       Cloudflare
Email:     Resend
AI:        OpenRouter (disabled by default, VITE_AI_ENABLED=true to enable)
```

### هيكل الكود
```
edms-project/
├── artifacts/
│   ├── api-server/          ← Express backend
│   │   ├── src/routes/      ← API endpoints
│   │   ├── src/lib/         ← Business logic, auth, storage, AI
│   │   ├── src/middlewares/  ← Auth, rate limiting, org scoping
│   │   └── src/scripts/     ← Seeds, migrations
│   └── edms/                ← React frontend
│       └── src/
│           ├── pages/       ← Page components
│           ├── components/  ← Shared components
│           └── lib/         ← Auth context, utils
├── lib/
│   ├── db/                  ← Drizzle schema + migrations
│   │   ├── src/schema/      ← Table definitions
│   │   └── drizzle/         ← Migration SQL files
│   └── api-client-react/    ← Generated API hooks
└── docs/
    ├── architecture/        ← Security boundaries
    └── legacy-design/       ← Original design docs + evolution
```

### Migration System
- Drizzle ORM migrations — تُطبَّق تلقائياً عند بدء container API
- ملفات SQL في `lib/db/drizzle/` مرقّمة تسلسلياً
- `docker-entrypoint.sh` يشغّل: migrate → seed-document-types → seed-wf-defaults → API
- كل migration محمية بـ `IF NOT EXISTS` / `IF NOT EXISTS` guards

---

## 3. Domain Model

### الكيانات الأساسية وعلاقاتها
```
Organization (tenant boundary)
  ├── Users (role: system_owner | admin | project_manager | document_controller | reviewer | viewer)
  ├── OrgConfig (plan flags, storage limits, AI settings)
  ├── DocumentTypes (code, name, isActive) ← جديد في 8c0015d
  ├── MetadataFields (name, type, documentTypeId, isActive) ← جديد في 8c0015d
  └── Projects
        ├── ProjectMembers (userId + project-level role override)
        ├── Documents
        │     ├── DocumentRevisions (history)
        │     ├── DocumentFiles (attachments)
        │     └── WorkflowInstances → WorkflowTemplateStages
        ├── Transmittals (plan-gated: Professional+)
        │     └── TransmittalItems (per-document review codes)
        ├── Correspondence
        │     └── CorrespondenceThreads
        ├── Tasks
        ├── Meetings
        ├── Packages
        └── Folders (hierarchical)

System-wide:
  ├── WfTemplates (per org, per documentType)
  ├── WfTemplateStages (sequential, role-based)
  ├── WfInstances (running workflows)
  ├── WfInstanceTransitions (audit trail)
  ├── Notifications
  ├── AuditLogs (append-only, immutable)
  ├── Delegations
  └── Rules (auto-assignment rules engine)
```

### Document Status Lifecycle
```
draft
  └→ under_review
        ├→ approved
        │     └→ issued
        │           └→ superseded
        ├→ approved_with_comments
        ├→ rejected → (back to draft)
        ├→ for_revision → (back to draft)
        └→ void

At any terminal state → archived | obsolete
```

---

## 4. Security Principles

### المبادئ غير القابلة للتفاوض

**1. Organization = Security Boundary (المبدأ الأهم)**
```
Organization boundary = Security boundary.
Project boundary      = Workspace boundary ONLY.
```
لا تثق بـ `project_id` وحده لعزل البيانات. كل query يجب أن تتضمن `WHERE organization_id = ?`.

**2. Fail Closed Always**
- `requireModule`: missing config → 403, DB error → 503. لا يفشل بصمت.
- الشك في الصلاحية → رفض. أبداً قبول.

**3. Chain of Trust**
```
JWT (organization_id claim)
  → API middleware extracts + validates
    → Service layer passes to DB call
      → RLS policy enforces at PostgreSQL level
```
كسر أي حلقة = ثغرة في العزل.

**4. Forbidden Patterns**
```typescript
// ❌ FORBIDDEN — project_id فقط
db.select().from(documents).where(eq(documents.projectId, projectId));

// ✅ REQUIRED — دائماً مع organization_id من JWT
db.select()
  .from(documents)
  .where(and(
    eq(documents.organizationId, req.user.organizationId),
    eq(documents.projectId, projectId)
  ));
```

**5. Authentication**
- HS256 JWT + bcrypt cost 12
- Refresh token rotation: revoke old + issue new on every use
- Token stored as SHA-256 hash in DB; plaintext travels once over wire
- Progressive login lockout: 7 attempts / 15-minute window → escalating lockouts per IP

**6. File Upload Safety**
- Blocklist MIME rejection + magic-byte content sniffing (first 512 bytes)
- Blocks HTML/SVG/JS regardless of declared MIME type
- Max 100MB per file (configurable)

**7. Audit Logs**
- Append-only (`0009_audit_immutable.sql`)
- Fire-and-forget (never breaks main request)
- Covers: login, logout, refresh, password reset, terms acceptance, org override, document CRUD, workflow transitions

---

## 5. Multi-Tenant Rules

### القاعدة الأساسية
```
كل مستأجر = Organization واحدة.
كل Organization = بياناتها معزولة تماماً عن غيرها.
```

### تطبيق العزل (Layers)
| الطبقة | المسؤولية |
|--------|-----------|
| RLS Policies | PostgreSQL row-level security — يُهيَّأ عند بدء API |
| API Middleware | `requireOrg + requireOrgScope + assertOrgMatch` |
| Service Layer | تمرير `organizationId` لكل DB call |
| Frontend | UX فقط — لا تعتمد عليه للأمان |

### Cross-Org Access
- **محظور افتراضياً.** الاستثناء الوحيد: `system_owner` عبر `?orgOverride=<orgId>` — وهو مسجَّل في audit logs.
- الجهات الخارجية تصل عبر Transmittals + share links فقط (لا login مشترك).

### ثغرات معروفة (مُعلقة)
1. **`isSysAdmin()` bug** — `admin` مُعامَل مثل `system_owner` → يرى كل المنظمات. Design intent: admin يرى منظمته فقط.
2. **Audit logs no org filter** — أي مستخدم مُصادق يمكنه قراءة كل السجلات.
3. **Tasks with `projectId = null`** — لا org scope.

---

## 6. Workflow Philosophy

### مبادئ التصميم
1. **Template-based** — القوالب معادة الاستخدام، org-scoped، مرتبطة بنوع المستند.
2. **Backend computes `canAct`** — لا تحسب الفرونت-إند من يستطيع التصرف. `enrichInstance()` في الـ backend يحسب `canAct` لكل مستخدم لكل instance.
3. **Notifications by role** — `notifyStageReached` يحل المستلمين حسب `responsibleRole`: مستخدم محدد → مستخدمون بدور النظام → fallback للـ admins/PMs.
4. **Immutable transition history** — كل انتقال يُسجَّل في `wf_instance_transitions`.

### هيكل Workflow
```
WfTemplate (per org, per documentType)
  └── WfTemplateStages (ordered, responsible_role OR responsible_user_id)
        └── WfInstance (per document)
              └── WfInstanceTransitions (audit trail)
```

### `canAct` Logic
```typescript
// في backend: enrichInstance()
if (stage.responsibleUserId === userId) → "assigned_user"
if (isAtLeast(role, stage.responsibleRole)) → "assigned_role"
if (isAtLeast(role, "admin")) → "admin_override"
else → null (403)
```

---

## 7. Document Management Principles

1. **Document number is immutable after creation** — يُعيَّن مرة واحدة ولا يتغير.
2. **Every document belongs to a project** — لا مستندات في الهواء.
3. **Revisions are historical** — كل revision له سجل في `document_revisions`.
4. **Metadata is type-driven** — حقول الميتاداتا مرتبطة بـ `document_type_id`. تُحقَّق عند الرفع والتعديل.
5. **Grandfathering** — مستندات بدون `document_type_id` لا تخضع لقواعد الميتاداتا الجديدة (backward compatibility).
6. **Upload requires file** — مستند بدون ملف غير صالح في EDMS.
7. **Bulk actions via selection** — تحديد عدة مستندات يفعّل: Create Transmittal + Bulk Assign Status.

---

## 8. Permission Model

### الأدوار (تصاعدياً)
```
viewer (0) → reviewer (20) → document_controller (40) → project_manager (60) → admin (80) → system_owner (100)
```

### من يفعل ماذا

| الإجراء | الحد الأدنى المطلوب |
|---------|-------------------|
| Create Project | `project_manager` |
| Upload Document | `document_controller` |
| Edit Document | `document_controller` OR document creator |
| Change Document Status | `document_controller` |
| Review/Approve in Workflow | `reviewer` (or assigned role) |
| Create Workflow Template | `admin` |
| Manage Users | `admin` |
| View All Orgs | `system_owner` only (design intent) |
| Override Org Context | `system_owner` only |

### Project-Level Overrides
يمكن override الدور على مستوى المشروع عبر `ProjectMembers.role`. `resolveEffectiveRole()` في الـ backend يحسب الدور الفعلي مع مراعاة delegations وproject overrides.

### Delegation
مستخدم يفوّض صلاحيته لآخر لفترة محددة (`delegations` table).

---

## 9. SaaS & Subscription Philosophy

### نموذج الاشتراك
```
Expired (free) → Starter → Basic → Professional → Enterprise → Custom
```

**مهم:** `"free"` في الكود = حالة ما بعد انتهاء التجربة، **ليس** خطة مجانية دائمة.

### تطبيق الـ Plan Gates
- `requireModule` middleware: يتحقق من `org_config.modules[moduleName]`
- Fail closed: missing config → 403
- مثال: Transmittals = Professional+ فقط

### الميزات المقيّدة بالخطة

| الميزة | الحد الأدنى |
|--------|------------|
| Transmittals | Professional |
| AI Features | Professional (+ VITE_AI_ENABLED) |
| Migration Wizard | Professional |
| Storage > 2GB | Starter+ |

### التجربة المجانية
- 14 يوم
- حد 3 مستخدمين، 2GB storage
- بعد الانتهاء → `"free"` tier (data preserved, features restricted)

---

## 10. Design Decisions (ADR-Style)

### ADR-001: Organization = Security Boundary (لا يُعدَّل)
**القرار:** استخدام `organization_id` كمفتاح العزل الأمني الوحيد.  
**السبب:** Project_id وحده لا يكفي لعزل المستأجرين. في multi-tenant SaaS، كسر هذا القرار = data breach.  
**الأثر:** Cross-org project access غير ممكن بدون إعادة تصميم طبقة الأمان بالكامل.

### ADR-002: Express 5 بدلاً من NestJS
**القرار:** Express 5 + TypeScript مباشرة.  
**السبب:** سرعة التطوير في مرحلة MVP. NestJS يضيف abstraction overhead غير ضروري في هذه المرحلة.  
**متى نُعيد النظر:** عند نمو الفريق إلى أكثر من 3 مطورين أو الحاجة لـ microservices.

### ADR-003: PostgreSQL Full-Text بدلاً من Elasticsearch
**القرار:** `tsvector`/`tsquery` في PostgreSQL.  
**السبب:** Elasticsearch يتطلب بنية تحتية منفصلة. PostgreSQL كافٍ لـ EDMS queries.  
**متى نُعيد النظر:** عند الحاجة لـ fuzzy search عبر ملايين المستندات.

### ADR-004: Transmittals Plan-Gated
**القرار:** Transmittals متاحة فقط لـ Professional+.  
**السبب:** Transmittals تتطلب external links، notifications، file bundling — موارد مرتفعة التكلفة.  
**التوثيق:** `docs/free-plan-clarification.md`

### ADR-005: AI خلف Feature Flag
**القرار:** `VITE_AI_ENABLED=true` لتفعيل AI. المكونات موجودة كـ stubs.  
**السبب:** AI أُزيل للنسخة المؤسسية (company edition). الإطار محفوظ لإعادة التفعيل.  
**الملف:** `artifacts/edms/src/components/ai/AIProcedurePanel.tsx`

### ADR-006: mustChangePassword لا يُمسح بـ admin reset (Bug قائم)
**الوضع الحالي (Bug):** `POST /api/users/:id/reset-password` يضبط `passwordHash` لكن لا يمسح `mustChangePassword`.  
**الأثر:** المستخدم محاصر في `/set-password` بعد reset.  
**الإصلاح المطلوب:** إضافة `mustChangePassword: false` في `db.update()` في `users.ts` line 453-454.

### ADR-007: Upload Document = Rich Form + AI Flag
**القرار:** Dialog منفصل عن Bulk Upload، يحتوي 3 sections، AI خلف flag.  
**السبب:** "Upload with AI" كان مرتبطاً بـ AI فحُذف معه. استُعيد كـ "Upload Document" بدون AI افتراضياً.  
**commit:** `5d056f3`

### ADR-008: Drizzle ORM Migrations = Automatic
**القرار:** `docker-entrypoint.sh` يشغّل migrations تلقائياً عند كل container restart.  
**السبب:** Zero-downtime deployments. لا خطوات يدوية مطلوبة.  
**تحذير:** كل migration SQL يجب أن تكون idempotent (`IF NOT EXISTS`).

---

## 11. Lessons Learned

### من مرحلة Replit (2026-03 إلى 2026-04)

1. **الأمان لاحقاً = دين تقني مؤلم.** إضافة `organization_id` لجداول لا تملكه بعد الإنتاج أصعب بكثير من تصميمه من البداية.

2. **`isSysAdmin()` تبسيط خطير.** دمج `admin` مع `system_owner` في دالة واحدة أعطى `admin` صلاحيات لا يستحقها. القاعدة: `admin` = org-scoped فقط.

3. **Open self-signup في B2B = مشكلة.** أي مهندس يمكنه إنشاء حساب ورفع gigabytes. يجب Hybrid Gated.

4. **Replit → VPS = قرار صحيح.** Replit جيد للنماذج الأولية؛ الإنتاج يحتاج بيئة مضبوطة.

### من مرحلة Security Review (2026-05)

5. **Magic-byte file checking ضروري.** Content-type header لا يكفي — المستخدم يمكنه تغييره. فحص أول 512 bytes يمنع رفع HTML/JS/SVG مخفية كـ PDF.

6. **Fail closed = الموقف الصحيح.** كل `requireModule` يفشل بصمت = ثغرة محتملة. 403 عند الشك أفضل من 200 خطأ.

7. **Audit logs append-only من اليوم الأول.** لا تُضف إمكانية حذف السجلات لاحقاً — الضغط التجاري سيطلبها.

### من E2E Testing (2026-06)

8. **Cross-org project access مُربك للمستخدمين.** عند إضافة مستخدم من منظمة أخرى كـ project member ثم عدم قدرته على الرؤية — يجب إما منع الإضافة أو توضيح السبب في الواجهة.

9. **`mustChangePassword` يجب مسحه في admin reset.** المسؤول يضبط كلمة مرور ويظن أن المستخدم يمكنه الدخول — لكنه لا يستطيع. Bug صامت خطير.

10. **Browser autofill يتعارض مع multi-user testing.** المتصفح يتذكر آخر credentials ناجحة. في بيئات التطوير: clear localStorage + use incognito.

---

## 12. Future Roadmap

### قريب (الدورة التالية)

| # | العمل | الأولوية | التعقيد |
|---|-------|----------|---------|
| R1 | إصلاح `mustChangePassword` في `reset-password` endpoint | 🔴 Critical | منخفض |
| R2 | فصل `isSysAdmin()` → `isOrgAdmin()` vs `isSystemOwner()` | 🔴 High | متوسط |
| R3 | Status badges موحّدة لجميع حالات المستند | 🟡 Medium | منخفض |
| R4 | Tooltip للعناوين المقطوعة في document list | 🟡 Medium | منخفض |
| R5 | "Add Task" button في Project Tasks tab | 🟡 Medium | منخفض |
| R6 | Default workflow template لكل org جديدة | 🟡 Medium | متوسط |
| R7 | Audit log org-scoping | 🟡 Medium | متوسط |

### متوسط المدى

| # | العمل | الأولوية | التعقيد |
|---|-------|----------|---------|
| M1 | Hybrid Gated Registration (Trial + Paid tracks) | 🔴 High | عالٍ |
| M2 | Report generator (Excel/PDF export) | 🟡 Medium | عالٍ |
| M3 | Correspondence external file attachments | 🟡 Medium | متوسط |
| M4 | Distribution Matrix (auto-transmittal rules) | 🟡 Medium | عالٍ |
| M5 | AI re-enable via `VITE_AI_ENABLED=true` + AIProcedurePanel implementation | 🔵 Low | عالٍ |

### طويل المدى

| # | العمل |
|---|-------|
| L1 | Cross-org project collaboration (`project_organizations` table) |
| L2 | Inspection Module (ITR/MIR/NCR/SOR) |
| L3 | Revision comparison (diff viewer) |
| L4 | Mobile app (API is mobile-ready) |
| L5 | Email import to project (`project@edms.arcscale.org`) |
| L6 | External party login (currently share-link only) |
| L7 | BIM integration |

---

## 13. Known Constraints

### قيود معمارية (لا تتجاهلها)

1. **VPS واحد (Single-VPS)** — In-memory rate limiting يعمل. عند التوسع لـ multi-node، استبدله بـ Redis-backed rate limiter.

2. **Drizzle migrations = transactional** — `ALTER TYPE ADD VALUE` لا يعمل داخل transaction في PostgreSQL. يجب `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END; $$`.

3. **Cloudflare R2 = eventual consistency** — لا تعتمد على قراءة ملف مباشرة بعد كتابته.

4. **JWT refresh token = single-device** — النظام الحالي لا يدعم multiple active sessions بشكل رسمي.

5. **Email via Resend** — إذا `RESEND_API_KEY` غير مضبوط، الإيميلات تُسجَّل فقط ولا تُرسَل. النظام يستمر بدون خطأ.

6. **AI = VITE_* env var** — يُحقَّق في build time. تغييره في production يتطلب rebuild للـ frontend image.

### قيود الـ Plan System

7. **Plan gates في `modules` JSONB** — لا تُعدِّل module flags يدوياً في DB بدون تشغيل `reset-modules-to-plan`.

8. **`visible_on_free` column في projects** — تتحكم في ظهور المشاريع عند downgrade لـ free tier. لا تحذفها.

---

## 14. Things We Will Never Do (Non-Goals)

هذه ليست قيوداً مؤقتة — هي قرارات تصميمية جوهرية:

1. **لن نستخدم `project_id` وحده للعزل الأمني.** Organization boundary أبدي.

2. **لن نُعطي external users login.** الوصول الخارجي عبر share links فقط — مُقيَّد بـ rate limiting وتاريخ انتهاء.

3. **لن نسمح للمستخدمين بحذف audit logs.** السجلات append-only أبداً.

4. **لن نُشغّل `SET row_security = off` في production application code.** أي bypass لـ RLS يُعامَل كـ critical security bug.

5. **لن نخزّن plaintext passwords أو tokens في DB.** bcrypt للكلمات، SHA-256 للـ tokens.

6. **لن نقبل user-supplied `organizationId` بدون validation من JWT.** `req.user.organizationId` فقط من JWT المُتحقَّق منه.

7. **لن نستخدم `--no-verify` لتجاوز git hooks بدون إذن صريح من المالك.**

8. **لن نُنشئ ميزات تعتمد على حذف بيانات المستأجرين بدون إجراء GDPR صريح.**

---

## 15. Quick Reference — Critical Files

| الملف | الوظيفة |
|-------|---------|
| `lib/db/src/schema/` | تعريفات جداول DB |
| `artifacts/api-server/src/middlewares/` | Auth، org scoping، rate limiting |
| `artifacts/api-server/src/lib/permissions.ts` | دوال الصلاحيات (`isSysAdmin`, `isAtLeast`, etc.) |
| `artifacts/api-server/src/routes/workflow-engine.ts` | منطق الـ workflow كاملاً |
| `artifacts/api-server/src/routes/users.ts` | إدارة المستخدمين + reset-password |
| `artifacts/api-server/src/routes/auth.ts` | Login، refresh، forgot-password، set-password |
| `docs/architecture/MULTI_TENANT_BOUNDARIES.md` | **قراءة إلزامية قبل أي endpoint جديد** |
| `docs/legacy-design/DESIGN_EVOLUTION.md` | تاريخ القرارات وسببها |
| `docker-entrypoint.sh` | ترتيب بدء الـ API + migrations |

---

*آخر تحديث: 2026-06-26 — يجب تحديث هذا الملف مع كل ADR جديد أو قرار معماري مهم.*
