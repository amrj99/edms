# F2 — Legacy On-Prem Storage-Path Data Repair

**النوع:** حزمة إصلاح بيانات إنتاجية (Production Data Repair) — يدوية التشغيل، خلف بوابة موافقة مستقلة في كل مرحلة. **ليست** جزءًا من CI/CD ولا تُشغَّل تلقائيًا عند النشر.

الحزمة تحت إدارة الإصدارات لأغراض: تاريخ المراجعة، الـDiff، ربط النسخة المُنفَّذة بـcommit معلوم، الاحتفاظ الدائم بالـmigration والـrollback، والقدرة على تدقيق ما شُغّل لاحقًا.

---

## العقد (Canonical Contract) — مُثبَت من الكود/التاريخ + الجرد الحيّ
- **OLD (أثر تاريخي يُرحَّل):** `^/app/uploads/1/document/[^/]+$` — `file_url` مسار فيزيائي مطلق ذو 3 مقاطع بلا مقطع مشروع.
- **NEW (العقد الرسمي الحالي، لا يُمَسّ):** `^/api/storage/onpremise/1/1/document/[^/]+$` — صيغة رابط الخدمة التي يقرؤها serve route.
- **التحويل:** استبدال البادئة فقط `/app/uploads/1/document/` → `/api/storage/onpremise/1/1/document/` (اسم الملف يبقى).

## السبب الجذري (Root Cause) — بالأدلة
1. **لماذا خُزِّن القديم كمسار fs؟** أقدم معالج مستندات كان يأخذ `fileUrl` من جسم الطلب، والعميل يخزّن ما تُعيده `requestUpload` القديمة: `filePath`/`objectPath` = `buildOnPremPath` (مسار فيزيائي مطلق `{basePath}/{org}/{type}/{file}`). مع `basePath=/app/uploads` وعلّة truthiness في `buildOnPremPath` (إسقاط مقطع المشروع) → `/app/uploads/1/document/<f>`.
2. **عقد رسمي أم Bug؟** Bug تاريخي، لا عقد مُعتمَد. لاحقًا وُحِّد النظام على العقد الرسمي = صيغة رابط الخدمة (الكود الحالي يخزّن `stored.serveUrl`). إصلاح الكود لمنع التكرار تمّ ودُمج منفصلًا: **F2b** (`buildOnPremPath`/`buildR2Key` على `projectId ?? 0`, merge `207f5ce`). هذه الحزمة تعالج **البيانات التاريخية** فقط.
3. **شكل ثالث؟** داخل النطاق (org=1/project=1) شكلان فقط: OLD و NEW. أشكال أخرى (`s3://`, `/mnt/nas/`, `seed/`, `/1/15/`, `/0/0/uploads/`) تخصّ مؤسسات/بيئات/مشاريع أخرى — خارج النطاق. العقد **fail-closed**: أي صفّ داخل النطاق بمسار `/app/uploads/%` لا يطابق OLD بالضبط → توقف (شكل مجهول)، دون توسيع الاكتشاف.

## النطاق (Scope)
- **7 سجلات** (بالعقد OLD): `document_files` (2) + `document_revisions` (4) + `correspondence_attachments` (1).
- **4 ملفات فيزيائية فريدة** (بعض السجلات تتشارك نفس الملف — مثل مراجعتين لنفس الملف).
- الكيانات الأمّ كلها ضمن **`organization_id = 1`** و**`project_id = 1`**.
- الاكتشاف بالعلاقات (project=1/org=1) والعقد OLD **حارس صريح** (لا regex عام).

## الوجهة القانونية
- فيزيائي: `/app/uploads/1/1/document/<filename>`
- الرابط: `/api/storage/onpremise/1/1/document/<filename>`
- ملاحظة: مصدر النسخ هو مسار العقد القديم نفسه `/app/uploads/1/document/<f>` (`SRC_DIR` الافتراضي)؛ قسم PHYSICAL READINESS في الـdry-run يؤكّد وجود البايتات فعليًا.

## التسلسل (Sequence) — كل خطوة خلف موافقة مستقلة
| # | ملف | الفعل | يمسّ بيانات؟ |
|---|---|---|---|
| — | `00_inventory.sql` | جرد حيّ (علاقة+حارس) + توليد mapping | قراءة |
| 1 | `00_dry_run.sh` | جرد + preflight + توليد mapping/preimage + تقرير | قراءة/التقاط (لا طفرة على الـVPS) |
| 2 | `02_copy.sh` | نسخ 4 ملفات `/app/uploads/1/document/` → `/app/uploads/1/1/document/` (**Copy لا Move**) + بوّابة sha للهدف الموجود | ملفات (نسخ) |
| 3 | `03_verify.sh` | size + sha256 + `cmp` + قابلية القراءة بمستخدم التطبيق | قراءة |
| 4 | `04_migrate.sql` | UPDATE 7 صفوف، معاملة واحدة، fail-closed، per-table + الإجمالي | DB |
| 5 | `06_download_and_perms_test.sh` | تنزيل بجلسة مخوّلة حقيقية + عزل cross-org (403/404) | قراءة |
| R | `05_rollback.sql` | استرجاع `file_url` من pre-image، مستقل، fail-closed | DB (عند الحاجة) |

> `01_preflight.sh` مشترك: يستدعيه `00_dry_run.sh` (لا نسخة مستقلة من قواعد الـpreflight).

### وضع التشخيص في الـDry Run
`00_dry_run.sh` يستدعي preflight بـ`DRY_RUN=1`: الفحوص **الفيزيائية** (وجود المصدر/قراءته، تعارض الوجهة، قابلية الإنشاء، وجود `SRC_DIR`) تُسجَّل ولا تُوقِف التشغيل، فيكتمل التشخيص حتى لو كان المسار الفيزيائي نفسه هو المشكلة. النتيجة تُلخَّص في قسم **PHYSICAL READINESS** (`sources_present`, `dst absent/identical/conflict`, `dst_not_creatable`, `physical_issues`, `READINESS=READY|NOT READY`). سلامة الـinventory (العلاقات، الإجمالي=7، الفريدة=4) تبقى **مانعة**. في الوضع الصارم (بلا `DRY_RUN=1`) تعود الفحوص الفيزيائية مانعة. الأمان لا يتأثر: `02_copy.sh` يفحص المصدر بصرامة مستقلًّا قبل أي نسخ.

## شروط التوقف (Stop Conditions / fail-closed)
- الجرد: أي سجل بالحارس التاريخي لكن كيانه الأمّ ليس project=1/org=1 (أو NULL) → **توقف**. الإجمالي ≠ 7 → توقف. الملفات الفريدة ≠ 4 → توقف.
- النسخ: هدف موجود بحجم/sha مختلف → **توقف** (لا استبدال). `cp` فشل → توقف.
- التحقق: أي فرق في size/sha256/`cmp` أو عدم قابلية قراءة → **توقف**؛ لا يُلمس DB قبل نجاح 4/4.
- الترحيل: أي `ROW_COUNT ≠ 1`، أو عدم تطابق per-table (df/dr/ca)، أو إجمالي ≠ 7، أو جدول خارج القائمة البيضاء → `RAISE` → **ROLLBACK** كامل (معاملة واحدة).

## التراجع (Rollback)
`05_rollback.sql` مستقل: يُعيد `file_url` إلى القيمة القديمة (من `mapping.mig.tsv`)، بفحوص per-table + الإجمالي. المصادر لم تُنقل (Copy لا Move) → لا استرجاع فيزيائي مطلوب؛ النسخ في `/1/1/` تبقى (غير ضارّة).

## بوابات الموافقة (Approval Gates)
تشغيل يدوي فقط، بموافقة مستقلة صريحة قبل كل خطوة. لا دمج ولا تنفيذ من CI/CD. بعد اعتماد الحزمة ودمجها، تُسحب الحزمة على الـVPS من **commit محدد** (لا نقل ملفات يدوي)، ثم يبدأ `00_dry_run.sh` وحده.

## الحدود / خارج النطاق (Limits / Out of Scope)
- **Cleanup مؤجّل ومنفصل:** حذف النسخ الأربع القديمة في `/1/0/document/` بعد نافذة احتفاظ + نسخة احتياطية + نجاح التنزيل (تفاصيله في `07_cleanup_deferred_PLAN.md`). **لا حذف لأي مصدر ضمن هذه الحزمة.**
- تنظيف بيانات UAT (project 15 / doc 65 / file 7 / correspondence-F10 / أي بيانات UAT) **ليس** جزءًا من F2 — Batch مستقل بقراره الخاص.
- قرار مزوّد التخزين طويل الأمد (R5) منفصل تمامًا.

## سرية المخرجات (Output Sensitivity)
المخرجات الحيّة (`mapping.gen.tsv`, `mapping.mig.tsv`, `preimage.tsv`, `dry_run_report.txt`, `*.log`) **لا تُرفع إلى Git** (انظر `.gitignore`). لا تحتوي tokens بحسب التصميم، لكنها تحوي معلومات تشغيلية داخلية (أسماء حاويات/قاعدة بيانات، معرّفات سجلات، أسماء ملفات، مسارات، روابط مستندات) — تُشارَك للمراجعة الخاصة فقط ولا تُنشر علنًا.

## المتغيّرات المطلوبة عند التشغيل (تُضبط من المشغّل)
`APP_CONTAINER`, `DB_CONTAINER` (إلزاميان)؛ `PGDB=edms`, `PGUSER=edms`, `SRC_DIR=/app/uploads/1/document`, `DST_DIR=/app/uploads/1/1/document` (افتراضيات قابلة للتجاوز). اختبار التنزيل يتطلب `BASE_URL`, `AUTH_TOKEN`, `OTHER_TOKEN` (جلسات حقيقية يوفّرها المشغّل).
