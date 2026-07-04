# Phase 3 Closure Report — Submission Chains (Submittals)

**التاريخ:** 2026-07-04  
**المرحلة:** Phase 3 — Submission Chains (Submittal Lifecycle)  
**يشمل أيضاً:** Phase 1 (Entity Directory) + Phase 2 (Project Participants)  
**Build المنشور:** `e497784`  
**المنشور بواسطة:** amr_j_98@hotmail.com  

---

## ملخص التنفيذ

تم نشر Phases 1+2+3 دفعةً واحدة في الإنتاج بتاريخ 2026-07-04، وشمل النشر:
- 7 migrations (0020–0026) طُبِّقت بنجاح
- `docker compose build --no-cache api frontend` + restart بالترتيب الصحيح
- اجتياز كامل لـ UI E2E Smoke Tests U1–U15

---

## نتائج UI E2E Smoke Tests

اختُبرت الواجهة بالكامل عبر حساب `archscale-admin@archscale.com` (org: NMDC / organization_id=1).

| Test | الوصف | النتيجة |
|------|-------|---------|
| U1 | Login — archscale-admin@archscale.com | ✅ PASS |
| U2 | Dashboard loads — no console errors | ✅ PASS |
| U3 | Projects list loads | ✅ PASS |
| U4 | Open project T001 | ✅ PASS |
| U5 | Submittals tab visible في navigation | ✅ PASS |
| U6 | Submittals tab clickable | ✅ PASS |
| U7 | Tab loads — empty state "No submittals yet" | ✅ PASS |
| U8 | "+ New Submittal" dialog يفتح (Step 1 of 2) | ✅ PASS |
| U9 | إدخال العنوان → Step 2 → إضافة 2 مشاركَين | ✅ PASS |
| U10 | "Create Submittal" → API 201 → navigate to detail | ✅ PASS |
| U11 | SC-T001-0001 يظهر في القائمة (SUBMITTAL / Active / Rev 1) | ✅ PASS |
| U12 | صفحة التفاصيل تحمّل — Party Sequence + Activity Timeline | ✅ PASS |
| U13 | Status=ACTIVE · Type=Submittal · Rev Cycle=1 | ✅ PASS |
| U14 | Status + Type يظهران صحيحَين في الـ header | ✅ PASS |
| U15 | لا JavaScript errors في الجلسة الحالية | ✅ PASS |

**النتيجة الإجمالية: 15/15 ✅**

---

## بيانات الاختبار وحالة Cleanup

استُخدمت بيانات اختبار مؤقتة لتمكين الاختبار:

| العنصر | القيمة | الحالة |
|--------|--------|--------|
| Entity | [UI-TEST] Contractor Co (id=2) | 🗑 محذوف |
| Entity | [UI-TEST] Consultant Co (id=3) | 🗑 محذوف |
| Project Participant | id=2 (main_contractor) | 🗑 محذوف بالـ cascade |
| Project Participant | id=3 (consultant) | 🗑 محذوف بالـ cascade |
| Submission Chain | SC-T001-0001 (id=2) | 🗑 محذوف |
| org_config.modules.registers | org 1 (NMDC) | ✅ مُعاد إلى `false` |

لا يوجد أي أثر لبيانات الاختبار في الإنتاج.

---

## Findings (غير blocking)

### FINDING-1 — system_owner لا يستطيع إنشاء submission chains
- **السبب:** `POST /submission-chains` يشترط `req.user.organizationId` لتعبئة `originatingOrgId`. المستخدم system_owner له `organizationId = null`.
- **التأثير:** حساب `amr_j_98@hotmail.com` (system_owner) لا يستطيع إنشاء Submittals من الـ UI.
- **الحل:** إضافة Break-glass fallback في الـ route يستخدم `projectOrgId` بدلاً من `req.user.organizationId` عندما يكون الدور `system_owner`.
- **الحالة:** Post-deployment fix — يحتاج repo change → build → deploy.
- **الـ Severity:** Medium (لأن org-level admins يعملون بشكل طبيعي).

### FINDING-2 — registers auto-reset mechanism
- **السبب:** يوجد background process يعيد تعيين `org_config.modules.registers` إلى `false` تلقائياً خلال دقائق.
- **التأثير:** تفعيل Submittals يتطلب تدخلاً يدوياً متكرراً.
- **الحالة:** Post-deployment investigation (task_0b79721a).
- **الـ Severity:** High — يحتاج تحليل وإصلاح في الـ codebase.

### FINDING-3 — TypeError: k.filter is not a function
- **السبب:** عند انتهاء الـ token أثناء render الـ dialog، يُخزَّن الـ 401 response body (object) كـ `participants` data بدلاً من array.
- **التأثير:** الـ dialog يُغلق بصمت عند انتهاء الجلسة.
- **الحالة:** Front-end bug — يحتاج `if (!res.ok) throw new Error(...)` في queryFn.
- **الـ Severity:** Low (يظهر فقط عند انتهاء الجلسة).

---

## الحالة النهائية للإنتاج

| المكوّن | الحالة |
|---------|--------|
| Migrations 0020–0026 | ✅ مطبَّقة |
| API — Entity Directory | ✅ يعمل |
| API — Project Participants | ✅ يعمل |
| API — Submission Chains | ✅ يعمل |
| Frontend — SubmittalsTab | ✅ يعمل |
| Frontend — CreateSubmittalDialog | ✅ يعمل |
| Frontend — Submittal Detail Page | ✅ يعمل |
| Build footer | `bu11d e497784` |
| آخر migration مطبَّق | `0026_submission_chain_steps_participant` |

---

## القرار المقترح

**Phase 3 مكتملة ✅ — يُنصح بالمضي إلى Phase 4.**

يتمثّل الشرط الوحيد قبل البدء في Phase 4 في معالجة FINDING-2 (registers auto-reset) لأنه يؤثر على قابلية استخدام ميزة Submittals في الإنتاج. يمكن أن يُعالَج كأول مهمة في Phase 4 أو كـ hotfix مستقل قبل البدء. FINDING-1 وFINDING-3 يمكن تأجيلهما لـ Phase 4 دون تأثير على المستخدمين الفعليين (org-level admins).
