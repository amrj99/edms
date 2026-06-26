# README for AI Models — ArcScale EDMS
> اقرأ هذا الملف أولاً قبل أي شيء آخر.  
> يستغرق القراءة ~3 دقائق. يوفّر عليك إعادة شرح المشروع من الصفر.

---

## ما هو ArcScale؟

ArcScale EDMS منصة SaaS متعددة المستأجرين لإدارة المستندات الهندسية والمراسلات وسير العمل في مشاريع البناء. تخدم شركات متعددة (مالك، استشاري، مقاول) كل منها بحساب منفصل تماماً.

**Stack:** React + TypeScript / Express 5 / PostgreSQL 16 / Drizzle ORM / Cloudflare R2 / Docker

---

## أهم الوثائق — بهذا الترتيب

| # | الملف | لماذا |
|---|-------|-------|
| 1 | `PROJECT_KNOWLEDGE.md` ← (هذا المشروع، جذر المجلد) | العقل الكامل للمشروع — Vision، Architecture، ADRs، Roadmap |
| 2 | `docs/architecture/MULTI_TENANT_BOUNDARIES.md` | **إلزامي قبل أي endpoint.** Organization = Security Boundary |
| 3 | `docs/legacy-design/DESIGN_EVOLUTION.md` | لماذا اتُخذت القرارات — تاريخ التحولات |
| 4 | `docs/legacy-design/INDEX.md` | فهرس الوثائق القديمة مع تصنيفها |
| 5 | `docs/legacy-design/05-module-behavior.md` | كيف يعمل كل module اليوم |
| 6 | `ArcScale_EDMS_System_Guide.md` | الرؤية الأصلية — لا تزال صالحة فلسفياً |

**عند التعارض بين الوثائق والكود: الكود هو السلطة النهائية.**  
الوثائق تشرح *لماذا*، الكود يقول *ماذا*.

---

## المبادئ التي لا تكسرها

```
1. Organization = Security Boundary.
   لا تستخدم project_id وحده للعزل. دائماً: WHERE org_id = req.user.organizationId

2. Fail Closed.
   شك في الصلاحية → 403. أبداً 200.

3. Audit Log = Append Only.
   لا تُضف DELETE أو UPDATE على audit_logs.

4. لا تُشغّل SET row_security = off في production code.

5. لا تُخزّن passwords أو tokens بـ plaintext في DB.

6. لا تقبل organizationId من req.body بدون JWT validation.

7. كل migration SQL يجب أن تكون idempotent (IF NOT EXISTS).
```

---

## البنية الجوهرية في 30 ثانية

```
Organization (tenant)
  └── Users (roles: system_owner > admin > project_manager > document_controller > reviewer > viewer)
        └── Projects (org-scoped workspace)
              └── Documents → Revisions → Workflow → Transmittals
                  Correspondence → Tasks → Meetings
```

**Cross-org collaboration** = عبر Transmittals + share links فقط (لا shared project access).  
**Workflow** = Templates per org/documentType → Stages (role-based) → Instances → Transitions.  
**Permissions** = Backend computes `canAct` — لا تحسب في Frontend.

---

## الثغرات / الـ Bugs المعروفة (2026-06-26)

| # | المشكلة | الخطورة |
|---|---------|---------|
| B1 | `isSysAdmin()` تجمع `admin` مع `system_owner` → admin يرى كل المنظمات | High |
| B2 | `POST /api/users/:id/reset-password` لا يمسح `mustChangePassword` | High |
| B3 | Audit logs ليس لها org filter | Medium |
| B4 | Tasks with `projectId = null` ليس لها org scope | Medium |

---

## عند بدء مهمة جديدة، اسأل نفسك

- هل هذا التغيير يمس tenant isolation؟ → اقرأ `MULTI_TENANT_BOUNDARIES.md`
- هل هذا endpoint جديد؟ → تحقق من `organization_id` filtering
- هل تُغيّر workflow logic؟ → الـ backend يحسب `canAct`، ليس الفرونت-إند
- هل تُعدِّل schema؟ → أنشئ migration SQL بـ `IF NOT EXISTS` guards
- هل هذا قرار معماري مهم؟ → أضف ADR في `PROJECT_KNOWLEDGE.md` قسم 10

---

*هذا الملف يُمثّل snapshot لتاريخ 2026-06-26. تحقق من `git log` للتغييرات اللاحقة.*
