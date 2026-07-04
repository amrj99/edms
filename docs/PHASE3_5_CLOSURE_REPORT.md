# Phase 3.5 Closure Report — FINDING-2 Investigation & Configuration Correction

**التاريخ:** 2026-07-04  
**المرحلة:** Phase 3.5 — تحقيق في آلية إعادة تعيين الـ modules (FINDING-2)  
**نوع العمل:** تصحيح configuration، لا code fix  
**المنفّذ:** amr_j_98@hotmail.com  

---

## الهدف

تحديد السبب الجذري لـ FINDING-2 المُوثَّق في تقرير Phase 3:  
> "registers auto-reset mechanism يعيد تعيين `org_config.modules.registers` إلى `false` تلقائياً خلال دقائق"

وإعادة تقييم FINDING-1 كقرار معماري بدلاً من Bug.

---

## تحقيق FINDING-2 — السبب الجذري

### الآلية المكتشفة

يحتوي النظام على ثلاث طبقات لفرض الـ modules بناءً على خطة الاشتراك:

| الطبقة | الملف | وقت التنفيذ | الوظيفة |
|--------|-------|-------------|---------|
| 1 | `app.ts → resetModulesToPlan()` | عند كل startup للـ API | يُعيّن modules لكل org لتطابق defaults الخطة |
| 2 | `module-sync-scheduler.ts → startModuleSyncScheduler()` | بعد 2 دقيقة من الـ startup، ثم كل 30 دقيقة | يُزامن modules دورياً |
| 3 | `module-sync-service.ts → syncOrgModules()` | مستدعى من الطبقتين 1 و2 | يحسب effective modules ويُحدّثها إذا اختلفت |

### منطق الحساب (`syncOrgModules`)

```
1. حل plan_id:
   subscriptions (active) → subscription_tier → 'expired' (default)

2. computeEffectiveModules(orgId, planId):
   getDefaultModulesForPlan(planId) + org_feature_overrides النشطة

3. إذا org_config.modules ≠ effective modules → UPDATE
```

### حالة NMDC (org_id=1) قبل الإصلاح

| العنصر | القيمة | الأثر |
|--------|--------|-------|
| `subscriptions` | لا يوجد صف | الحل يسقط إلى `subscription_tier` |
| `organizations.subscription_tier` | `'expired'` (منذ 2026-05-08) | خطة `expired` |
| `getDefaultModulesForPlan('expired')` | `{registers: false, deliverables: false, chat: false, ...}` | registers=false |
| `org_feature_overrides` | لا يوجد | لا override |
| **النتيجة** | كل sync → `registers: false` | **الظاهرة المكتشفة** |

### الحكم: ليس Bug

هذا سلوك **SaaS enforcement صحيح ومتعمَّد**. النظام يفرض modules بناءً على الخطة الفعلية للـ org. NMDC لم يكن على خطة تتيح `registers`، فرفع النظام التفعيل اليدوي في كل دورة sync — وهو السلوك المطلوب لحماية الـ feature access.

---

## تحقيق FINDING-1 — إعادة تصنيف

**الادعاء الأصلي:** system_owner يحصل على 400 عند إنشاء submission chains (Bug).

**التحليل:**
- `POST /submission-chains` يشترط `req.user.organizationId` لتعبئة `originatingOrgId`/`currentOrgId`.
- system_owner له `organizationId = null` بتصميم متعمَّد — هو actor على مستوى المنصة، لا ينتمي لـ tenant واحد.
- ADR-0002 (Break-glass) يُتيح لـ system_owner الإجراء على chains موجودة، لكن إنشاء chain يستلزم ملكية org.

**الحكم:** قيد صلاحيات معماري متعمَّد، وليس Bug.  
**التصنيف الجديد:** Architectural Decision Review — system_owner create constraint.  
**القرار:** لا نغيّر السلوك الحالي. إذا احتيج لـ system_owner create مستقبلاً، يُفتح ADR مستقل.

---

## الإصلاح المنفَّذ (Option A)

**الخيار المختار:** تحديث `subscription_tier` إلى `'professional'`  
**الخيار المرفوض:** `org_feature_overrides` (B) — لأنه يُخفي حالة الخطة الحقيقية.

**المبرر:** NMDC (org 1) هي بيئة تشغيل/اختبار للمنصة، وليست عميلاً فعلياً على خطة `expired`. تصحيح الـ tier هو التمثيل الصحيح للواقع.

### خطوات التنفيذ

```sql
-- Snapshot قبل التغيير
-- organizations: subscription_tier = 'expired'
-- org_config.modules: {"registers": false, "dashboard": true, ...all others false}

-- الإصلاح
UPDATE organizations SET subscription_tier = 'professional' WHERE id = 1;
-- UPDATE 1

-- تطبيق professional modules يدوياً (ما سيفعله الـ sync تلقائياً)
UPDATE org_config
SET modules = '{"dashboard":true,"deliverables":true,"registers":true,
               "notifications":true,"chat":true,"correspondence":true,
               "meetings":true,"workflow_engine":true}'::jsonb,
    updated_at = NOW()
WHERE organization_id = 1;
-- UPDATE 1
```

---

## التحقق من الثبات

تم restart الـ API container للتحقق من أن `resetModulesToPlan()` لن تعيد `registers` إلى `false`:

```bash
docker restart edms_api && sleep 15 && docker logs --tail=20 edms_api
```

**نتيجة الـ logs (الأهم):**
```json
{
  "total": 14,
  "updated": 0,
  "skipped": 14,
  "msg": "[reset-modules] complete — 0 org(s) reset, 14 already correct"
}
```

**التفسير:** `resetModulesToPlan()` عالجت كل الـ orgs بما فيها org 1 (NMDC)، وقررت **skip** لأن modules تطابق بالفعل defaults خطة `professional` (كلها = true). لم تُعَد أي org إلى defaults مختلفة.

### حالة NMDC بعد الإصلاح

| العنصر | القيمة |
|--------|--------|
| `subscription_tier` | `'professional'` ✅ |
| `getDefaultModulesForPlan('professional')` | جميع الـ modules = true |
| `org_config.modules.registers` | `true` ✅ |
| سلوك كل sync دوري | "already match → skip" ✅ |
| **الاستقرار** | دائم — لن يُعاد التعيين إلى false |

---

## ملخص الحالة النهائية

| العنصر | قبل Phase 3.5 | بعد Phase 3.5 |
|--------|--------------|---------------|
| NMDC `subscription_tier` | `'expired'` ❌ | `'professional'` ✅ |
| `registers` module | `false` (يُعاد كل 30 دقيقة) ❌ | `true` (ثابتة) ✅ |
| FINDING-2 | Open — High severity | ✅ Resolved — configuration correction |
| FINDING-1 | Open — Medium (مُصنَّف bug) | ✅ Reclassified — Architectural Decision |
| FINDING-3 | Open — Low | مؤجَّل لـ Phase 4 |

---

## القرار المقترح

**Phase 3.5 مكتملة ✅ — الطريق مفتوح للبدء في Phase 4.**

تم توثيق وتصحيح FINDING-2 كـ configuration correction (لا code change). NMDC الآن على خطة `professional` مع `registers=true` ثابتة، ويُمكن اختبار Submittals في الإنتاج بشكل طبيعي دون تدخل يدوي. FINDING-3 (TypeError k.filter) مؤجَّل لـ Phase 4 بوصفه front-end bug منخفض الأولوية لا يؤثر على المستخدمين في الحالة الطبيعية.
