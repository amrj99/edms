# ArcScale EDMS — QA Regression Plan
> **وثيقة رسمية.** يُنفَّذ هذا البلان بعد كل مجموعة تطوير (Sprint) للتأكد من عدم وجود regression.  
> آخر تحديث: 2026-06-26  
> **مستوى الاختبار:** Real browser + real API (ليس unit tests فقط).

---

## كيفية استخدام هذا البلان

1. **قبل كل Sprint:** راجع أقسام ذات صلة بالتغييرات المخطط لها.
2. **بعد كل Sprint:** نفّذ الـ Smoke Test Suite (الأقسام المحدّدة بـ ⚡) كحدّ أدنى.
3. **Regression كاملة:** نفّذ كل الأقسام قبل كل إصدار كبير.
4. **عند ظهور Bug:** ابحث عن Test Case مناسب وأضف Edge Case جديداً.

### مستويات الاختبار
- **⚡ Smoke** — يُنفَّذ بعد كل deploy
- **🔄 Regression** — يُنفَّذ بعد كل Sprint
- **🔬 Full** — يُنفَّذ قبل Major Release

---

## أقسام الخطة

| # | القسم | مستوى الاختبار |
|---|-------|---------------|
| 1 | Onboarding & Registration | 🔄 |
| 2 | Organizations & Admin | 🔄 |
| 3 | Users & Roles | ⚡ 🔄 |
| 4 | Projects | ⚡ 🔄 |
| 5 | Document Types & Metadata | 🔄 |
| 6 | Documents | ⚡ 🔄 🔬 |
| 7 | Revisions | 🔄 |
| 8 | Workflow Engine | ⚡ 🔄 🔬 |
| 9 | Correspondence | 🔄 |
| 10 | Transmittals | 🔄 |
| 11 | Meetings & Calendar | 🔬 |
| 12 | Tasks | 🔄 |
| 13 | Search | ⚡ 🔄 |
| 14 | Dashboard | ⚡ |
| 15 | Notifications | 🔄 |
| 16 | Permissions & Access Control | 🔬 |
| 17 | Multi-Tenant Isolation | 🔬 |
| 18 | Plans & Subscription Gates | 🔄 |
| 19 | System Administration | 🔄 |
| 20 | Audit Logs | 🔬 |

---

## مصطلحات

| المصطلح | المعنى |
|---------|--------|
| **Owner** | مستخدم بدور `system_owner` |
| **Admin** | مستخدم بدور `admin` |
| **PM** | مستخدم بدور `project_manager` |
| **DC** | مستخدم بدور `document_controller` |
| **Reviewer** | مستخدم بدور `reviewer` |
| **Viewer** | مستخدم بدور `viewer` |
| **Org-A** | المنظمة الأساسية |
| **Org-B** | منظمة مختلفة (لاختبار العزل) |
| **✅ Pass** | النتيجة متوقعة وصحيحة |
| **❌ Fail** | خطأ يجب إصلاحه |
| **⚠️ Known** | مشكلة معروفة موثّقة |

---

## 1. Onboarding & Registration

### السياق
أول نقطة تماس للعميل مع النظام. يجب أن تكون سلسة وآمنة.

### 1.1 Registration (إنشاء حساب جديد)
**الأدوار:** مستخدم جديد (لا يوجد حساب)

| TC | السيناريو | النتيجة المتوقعة | الحالة |
|----|-----------|-----------------|--------|
| 1.1.1 | تسجيل بإيميل صالح وكلمة مرور قوية | حساب يُنشأ، رسالة تأكيد | ✅ |
| 1.1.2 | تسجيل بإيميل مكرر | رسالة خطأ "Email already exists" | ✅ |
| 1.1.3 | تسجيل بكلمة مرور أقل من 8 أحرف | رسالة خطأ validation | ✅ |
| 1.1.4 | تسجيل بإيميل غير صالح | رسالة خطأ format | ✅ |
| 1.1.5 | محاولة تسجيل بعد تعطيل `registrationEnabled` | 403 Forbidden | ✅ |

**Edge Cases:**
- تسجيل بـ emoji في الإيميل
- إيميل بـ uppercase (يجب lowercase normalization)
- كلمة مرور تحتوي فقط على مسافات

**معايير النجاح:** المستخدم يصل للـ Dashboard خلال 30 ثانية من التسجيل.

---

### 1.2 Terms of Use (أول دخول)
**الأدوار:** أي مستخدم جديد

| TC | السيناريو | النتيجة المتوقعة |
|----|-----------|-----------------|
| 1.2.1 | أول دخول بعد admin reset password | يظهر Terms dialog |
| 1.2.2 | محاولة قبول بدون تمرير للنهاية | checkbox معطّل، زر Accept معطّل |
| 1.2.3 | التمرير للنهاية ثم قبول | checkbox يصبح نشطاً |
| 1.2.4 | قبول → يُعاد للـ Dashboard | لا يظهر Terms مرة ثانية في نفس الجلسة |
| 1.2.5 | تسجيل خروج ودخول مرة ثانية | لا يظهر Terms (قبلت مسبقاً) |

---

### 1.3 mustChangePassword Flow (⚠️ Known Bug — B2)
**الأدوار:** مستخدم أنشأه Admin

| TC | السيناريو | النتيجة المتوقعة الحالية | النتيجة المتوقعة بعد الإصلاح |
|----|-----------|------------------------|-------------------------------|
| 1.3.1 | Admin ينشئ مستخدماً → المستخدم يسجّل دخول | يُوجَّه لـ `/set-password` | يُوجَّه لـ `/set-password` (صحيح) |
| 1.3.2 | Admin يضغط Lock icon ويضبط كلمة مرور → مستخدم يسجل دخول | يُوجَّه لـ `/set-password` ⚠️ Bug | يدخل مباشرة بكلمة المرور الجديدة |
| 1.3.3 | `/set-password` بدون token في URL | "Invalid or missing invitation link" |

---

## 2. Organizations & Admin Panel

### 2.1 إنشاء منظمة
**الأدوار:** Owner (system_owner)

| TC | السيناريو | النتيجة المتوقعة |
|----|-----------|-----------------|
| 2.1.1 | إنشاء org بالحقول الإلزامية فقط | تُنشأ وتظهر في القائمة |
| 2.1.2 | إنشاء org باسم مكرر | رسالة خطأ (إذا فُرض unique) |
| 2.1.3 | تعديل org type من Contractor إلى Consultant | يُحدَّث فوراً |
| 2.1.4 | محاولة حذف org بها مستخدمين | رفض أو تحذير |
| 2.1.5 | Admin (org-B) يحاول رؤية orgs أخرى | يجب أن يرى فقط org-B ⚠️ Known Bug — C1 |

**Edge Cases:**
- اسم org بأحرف عربية + أرقام
- org بدون contact email

---

### 2.2 Plan Assignment
**الأدوار:** Owner

| TC | السيناريو | النتيجة المتوقعة |
|----|-----------|-----------------|
| 2.2.1 | تغيير org من `expired` إلى `professional` | Transmittals تُفعَّل |
| 2.2.2 | Downgrade من `professional` إلى `expired` | Transmittals تُعطَّل |
| 2.2.3 | تعيين plan `expired` لـ org جديدة | Module restrictions تُطبَّق |

---

## 3. Users & Roles ⚡

### 3.1 إنشاء مستخدم
**الأدوار:** Admin, Owner

| TC | السيناريو | النتيجة المتوقعة |
|----|-----------|-----------------|
| 3.1.1 | Admin ينشئ مستخدماً داخل org-A | يُنشأ بـ `mustChangePassword=true` |
| 3.1.2 | Admin يحاول إنشاء مستخدم في org-B | 403 Forbidden |
| 3.1.3 | Owner ينشئ مستخدماً في أي org | يُنشأ |
| 3.1.4 | إنشاء مستخدم بـ role = `system_owner` من Admin | يجب الرفض |

**Edge Cases:**
- إيميل بأحرف uppercase
- مستخدم بدون organization_id

---

### 3.2 إعادة ضبط كلمة المرور (Admin)
**الأدوار:** Admin, Owner

| TC | السيناريو | النتيجة المتوقعة الحالية | النتيجة بعد الإصلاح |
|----|-----------|------------------------|---------------------|
| 3.2.1 | Admin يضبط كلمة مرور جديدة لمستخدم | 200 OK ⚠️ لكن mustChangePassword لا يُمسح | mustChangePassword=false |
| 3.2.2 | Admin يضبط كلمة مرور < 8 أحرف | 400 Bad Request | ✅ |
| 3.2.3 | Admin يضبط كلمة مرور لمستخدم في org مختلفة | 403 | ✅ |

---

### 3.3 Role Hierarchy
**الأدوار:** جميع الأدوار

| TC | السيناريو | النتيجة المتوقعة |
|----|-----------|-----------------|
| 3.3.1 | Viewer يحاول رفع مستند | 403 |
| 3.3.2 | Reviewer يحاول حذف مستند | 403 |
| 3.3.3 | DC يحاول إنشاء مشروع | 403 |
| 3.3.4 | PM يحاول الوصول للـ Admin panel | 403 |
| 3.3.5 | Admin يحاول الوصول لمنظمة أخرى | ✅ حالياً يستطيع ⚠️ Known Bug — C1 |

---

## 4. Projects ⚡

### 4.1 إنشاء مشروع
**الأدوار:** PM, Admin, Owner

| TC | السيناريو | النتيجة المتوقعة |
|----|-----------|-----------------|
| 4.1.1 | PM ينشئ مشروعاً بالحقول الإلزامية | يُنشأ ويظهر في Projects list |
| 4.1.2 | DC يحاول إنشاء مشروع | 403 Forbidden |
| 4.1.3 | مشروع بكود مكرر في نفس الـ org | رسالة خطأ "Code already exists" |
| 4.1.4 | مشروع بكود مكرر في org مختلفة | يُسمح (codes are org-scoped) |

---

### 4.2 Project Members
**الأدوار:** PM, Admin

| TC | السيناريو | النتيجة المتوقعة |
|----|-----------|-----------------|
| 4.2.1 | PM يضيف مستخدماً من نفس الـ org | يُضاف ويرى المشروع |
| 4.2.2 | PM يضيف مستخدماً من org أخرى | يُضاف (API يقبل) لكن المستخدم لا يرى المشروع ⚠️ Known Design Decision |
| 4.2.3 | Viewer يحاول إضافة عضو | 403 |
| 4.2.4 | إضافة نفس المستخدم مرتين | 409 Conflict أو idempotent |

---

### 4.3 Project Access Control
**الأدوار:** جميع الأدوار

| TC | السيناريو | النتيجة المتوقعة |
|----|-----------|-----------------|
| 4.3.1 | مستخدم من org-A يحاول الوصول لمشروع org-B | 403 أو "Project not found" |
| 4.3.2 | مستخدم من org-A يصل لمشروع org-A لكنه غير member | حسب الـ policy (org match = allowed) |
| 4.3.3 | مستخدم يحاول الوصول لمشروع محذوف | 404 |

---

## 5. Document Types & Metadata

### 5.1 Document Types
**الأدوار:** Admin, Owner

| TC | السيناريو | النتيجة المتوقعة |
|----|-----------|-----------------|
| 5.1.1 | Admin ينشئ Document Type بـ code + name | يُنشأ ويظهر في قائمة الأنواع |
| 5.1.2 | Document Type بكود مكرر في نفس الـ org | 409 Conflict |
| 5.1.3 | تعطيل Document Type (`isActive=false`) | لا يظهر في upload dropdown لكن مستندات قديمة بهذا النوع تبقى |
| 5.1.4 | Document Type بـ org-A لا يظهر لـ org-B | ✅ |

---

### 5.2 Metadata Fields
**الأدوار:** Admin, Owner

| TC | السيناريو | النتيجة المتوقعة |
|----|-----------|-----------------|
| 5.2.1 | إنشاء حقل Global (بدون documentTypeId) | يظهر لجميع المستندات بغض النظر عن النوع |
| 5.2.2 | إنشاء حقل مرتبط بـ Document Type محدد | يظهر فقط عند اختيار ذلك النوع في Upload |
| 5.2.3 | جعل حقل Required | رفع مستند بدون ملء الحقل → 400 |
| 5.2.4 | تعطيل حقل (`isActive=false`) | لا يظهر في Upload form لكن القيم القديمة تُعرض |
| 5.2.5 | **Grandfathering:** مستند قديم بدون documentTypeId يُحرَّر | لا تُطبَّق قواعد الميتاداتا الجديدة على الحقول القديمة |

**Edge Cases:**
- حقل Required بقيمة فارغة (`""`)
- حقل نوع `number` يستقبل نصاً

---

## 6. Documents ⚡ 🔬

### 6.1 Upload Document (Single)
**الأدوار:** DC, PM, Admin

| TC | السيناريو | النتيجة المتوقعة |
|----|-----------|-----------------|
| 6.1.1 | DC يفتح "Upload Document" → يرى 3 sections | ✅ File Upload / Document Identity / Classification |
| 6.1.2 | إدخال Document Number موجود مسبقاً | يظهر ⚠️ amber warning مع خيار "Open Document" أو "Upload Revision" |
| 6.1.3 | إدخال Document Number جديد | يظهر ✅ أخضر "No document found — new document will be created" |
| 6.1.4 | محاولة Save بدون ملف | زر Save معطّل |
| 6.1.5 | Upload مستند كامل (ملف + بيانات) | يظهر في Document list |
| 6.1.6 | Upload بـ Document Type له Metadata Fields | تظهر حقول الميتاداتا في Section 3 |
| 6.1.7 | Viewer يحاول الضغط على "Upload Document" | لا يظهر الزر (أو 403) |

**Edge Cases:**
- ملف بحجم يتجاوز الـ 100MB
- ملف بنوع غير مدعوم (HTML, EXE)
- عنوان يحتوي أحرف خاصة (/، <، >)

---

### 6.2 Bulk Upload
**الأدوار:** DC, PM

| TC | السيناريو | النتيجة المتوقعة |
|----|-----------|-----------------|
| 6.2.1 | سحب ملفين متعددين | Dialog يعرض كل ملف مع form منفصل |
| 6.2.2 | رفع ملف + بيانات لكل ملف → Save All | جميع المستندات تُنشأ |
| 6.2.3 | Document Number مكرر في أحد الملفات | warning على ذلك الملف فقط، باقي الملفات تُرفع |
| 6.2.4 | إلغاء ملف واحد من السرب | يُحذف من القائمة فقط |

---

### 6.3 Document List & Filtering
**الأدوار:** جميع الأدوار

| TC | السيناريو | النتيجة المتوقعة |
|----|-----------|-----------------|
| 6.3.1 | فلترة بـ Discipline | يظهر فقط مستندات تلك الـ Discipline |
| 6.3.2 | فلترة بـ Document Type | ✅ |
| 6.3.3 | بحث بـ Document Number | نتيجة فورية |
| 6.3.4 | تحديد مستند واحد | يظهر شريط Bulk Actions بخيار Create Transmittal + Assign Status |
| 6.3.5 | تحديد مستندات متعددة | نفس الشريط مع العدد |

---

### 6.4 Document Detail
**الأدوار:** جميع الأدوار

| TC | السيناريو | النتيجة المتوقعة |
|----|-----------|-----------------|
| 6.4.1 | فتح مستند → Preview panel | يظهر metadata + ATTACHMENTS |
| 6.4.2 | فتح مستند → Full Page | صفحة كاملة مع tabs: Overview / Revisions / Activity / AI Analysis |
| 6.4.3 | AI Analysis tab بدون AI enabled | يظهر رسالة "AI features coming soon" أو مشابه |
| 6.4.4 | Revision History | يظهر كل revisions مع timestamp + uploader |
| 6.4.5 | Activity tab | يظهر audit trail للمستند |

---

### 6.5 Document Edit
**الأدوار:** DC, PM (أو creator)

| TC | السيناريو | النتيجة المتوقعة |
|----|-----------|-----------------|
| 6.5.1 | DC يعدّل Title + Discipline | يُحدَّث فوراً |
| 6.5.2 | DC يحاول تعديل Document Number | الحقل غير متاح للتعديل |
| 6.5.3 | تغيير Document Type إلى نوع بـ metadata fields | تظهر حقول الميتاداتا الجديدة |
| 6.5.4 | Viewer يحاول تعديل مستند | 403 |

---

## 7. Revisions

### 7.1 Upload New Revision
**الأدوار:** DC, PM

| TC | السيناريو | النتيجة المتوقعة |
|----|-----------|-----------------|
| 7.1.1 | Upload Revision جديدة | تُحدَّث الـ Revision letter/number + يُضاف إلى History |
| 7.1.2 | Upload Revision بدون ملف جديد | تُسجَّل بـ `fileCarriedForward=true` |
| 7.1.3 | Revision تغيّر الـ Status | يُسجَّل في Audit Log |
| 7.1.4 | عرض Revision History | كل revisions بالترتيب الزمني |

**Edge Cases:**
- Revision تعود لرقم أصغر (Rev B → Rev A)
- Revision بنفس رقم السابق

---

## 8. Workflow Engine ⚡ 🔬

### 8.1 Workflow Templates
**الأدوار:** Admin, PM

| TC | السيناريو | النتيجة المتوقعة |
|----|-----------|-----------------|
| 8.1.1 | Admin ينشئ Workflow Template | يُنشأ ويظهر في قائمة Templates |
| 8.1.2 | Template مرتبط بـ Document Type | يُطبَّق تلقائياً على مستندات ذلك النوع |
| 8.1.3 | DC يحاول إنشاء Template | 403 |
| 8.1.4 | Template بدون stages | warning أو رفض |
| 8.1.5 | مستند بدون template مُعيَّن → Workflow panel | "No workflow template configured for [type]" |

---

### 8.2 Starting a Workflow
**الأدوار:** DC, PM

| TC | السيناريو | النتيجة المتوقعة |
|----|-----------|-----------------|
| 8.2.1 | DC يبدأ Workflow على مستند | يُنشأ WfInstance، تُرسَل إشعار للـ stage الأول |
| 8.2.2 | Workflow يبدأ على مستند بـ status != draft | يجب السماح أو رفض حسب القاعدة |
| 8.2.3 | محاولة بدء workflow ثانٍ على نفس المستند | 409 Conflict |

---

### 8.3 Multi-User Workflow (السيناريو الكامل)
**الأدوار:** DC → Reviewer → Admin

| TC | الخطوة | من يفعل | النتيجة المتوقعة |
|----|--------|---------|-----------------|
| 8.3.1 | DC يرفع Shop Drawing + يبدأ Workflow | DC | Instance في مرحلة "Technical Review" |
| 8.3.2 | Reviewer يرى "My Actions" badge | Reviewer | amber banner + count في Workflow page |
| 8.3.3 | Reviewer يفتح Instance → رابط المستند ظاهر | Reviewer | ينقر الرابط → يفتح المستند |
| 8.3.4 | Reviewer يضغط Advance → انتقل للمرحلة التالية | Reviewer | Stage 2 |
| 8.3.5 | Admin يرى Instance في My Actions | Admin | canAct = true |
| 8.3.6 | Admin يُكمل مرحلة Approved | Admin | Instance status = Completed |
| 8.3.7 | DC يرى المستند أصبح Approved | DC | Document status تغيّر |

---

### 8.4 canAct Verification
**الأدوار:** جميع الأدوار

| TC | السيناريو | النتيجة المتوقعة |
|----|-----------|-----------------|
| 8.4.1 | Reviewer لديه stage مُسنَّد له | canAct = true |
| 8.4.2 | Viewer يرى نفس الـ Instance | canAct = false → لا يظهر زر Advance |
| 8.4.3 | DC (غير مُسنَّد) يرى Instance | canAct = false إلا إذا هو Creator |

---

## 9. Correspondence

### 9.1 إنشاء مراسلة
**الأدوار:** جميع الأدوار (عدا Viewer في بعض الحالات)

| TC | السيناريو | النتيجة المتوقعة |
|----|-----------|-----------------|
| 9.1.1 | إنشاء RFI داخل مشروع | تُنشأ مع Reference Number تلقائي |
| 9.1.2 | إضافة To + CC + Body + Due Date | كل الحقول تُحفظ |
| 9.1.3 | إرسال → تظهر في Outgoing | ✅ |
| 9.1.4 | المستلم يرى المراسلة في Incoming | ✅ |
| 9.1.5 | Reply على مراسلة | Thread يتكوّن |
| 9.1.6 | إرسال بدون Subject | 400 Bad Request |

**Edge Cases:**
- مراسلة بدون مستلمين
- Due Date في الماضي
- Body بـ HTML tags (XSS check)

---

### 9.2 SLA Tracking
| TC | السيناريو | النتيجة المتوقعة |
|----|-----------|-----------------|
| 9.2.1 | مراسلة تجاوز Due Date | تظهر في "Overdue" smart view |
| 9.2.2 | مراسلة قريبة من Due Date | تظهر في "Due Soon" |
| 9.2.3 | مراسلة لم تُقرأ خلال unread_reminder_hours | reminder notification |

---

## 10. Transmittals

### 10.1 Plan Gate Check
**الأدوار:** جميع الأدوار

| TC | السيناريو | النتيجة المتوقعة |
|----|-----------|-----------------|
| 10.1.1 | Org على `expired` plan → فتح Transmittals tab | "Transmittals not available on your plan" |
| 10.1.2 | Org على `professional` plan → فتح Transmittals tab | القائمة تظهر |

---

### 10.2 إنشاء Transmittal (Professional+)
**الأدوار:** DC, PM

| TC | السيناريو | النتيجة المتوقعة |
|----|-----------|-----------------|
| 10.2.1 | إنشاء Outgoing Transmittal مع مستندات محددة | يُنشأ مع Reference Number تلقائي |
| 10.2.2 | تحديد مستندات من Document list → Create Transmittal | المستندات تُضاف تلقائياً |
| 10.2.3 | إضافة ABCD review code لكل مستند | يُحفظ |
| 10.2.4 | Complete Review من غير المُسنَّد | 403 |
| 10.2.5 | Complete Review من المُسنَّد أو Admin | 200 OK |

---

## 11. Meetings & Calendar

### 11.1 إنشاء اجتماع
**الأدوار:** PM, Admin

| TC | السيناريو | النتيجة المتوقعة |
|----|-----------|-----------------|
| 11.1.1 | إنشاء اجتماع بتاريخ + مدعوون | يُنشأ ويظهر في Calendar |
| 11.1.2 | إضافة Meeting Minutes | تُحفظ |
| 11.1.3 | عرض اجتماع | agenda + attendees + minutes |
| 11.1.4 | اجتماع بدون عنوان | 400 |

---

## 12. Tasks

### 12.1 إنشاء مهمة
**الأدوار:** جميع الأدوار

| TC | السيناريو | النتيجة المتوقعة |
|----|-----------|-----------------|
| 12.1.1 | إنشاء مهمة من "My Tasks" | تُنشأ |
| 12.1.2 | إنشاء مهمة من Project Tasks tab | ⚠️ لا يوجد زر إنشاء في Project Tasks tab حالياً |
| 12.1.3 | تعيين مهمة لمستخدم آخر | يظهر في My Tasks للمستخدم الآخر |
| 12.1.4 | تغيير status من pending → in_progress → completed | يُحدَّث |
| 12.1.5 | مهمة بـ Due Date منتهية | تظهر في Overdue Items في Dashboard |

---

## 13. Search ⚡

### 13.1 Global Search
**الأدوار:** جميع الأدوار

| TC | السيناريو | النتيجة المتوقعة |
|----|-----------|-----------------|
| 13.1.1 | بحث بـ Document Number الكامل | يجد المستند فوراً |
| 13.1.2 | بحث بجزء من العنوان | نتائج partial match |
| 13.1.3 | بحث بـ discipline | يجد مستندات بتلك الـ discipline |
| 13.1.4 | بحث في منظمة أخرى | لا نتائج (org isolation) |
| 13.1.5 | بحث بنتائج صفرية | "No results found" |
| 13.1.6 | الضغط على نتيجة | ينتقل للمستند مباشرة |

**Edge Cases:**
- بحث بـ SQL injection characters
- بحث بـ emoji
- بحث بـ 1 حرف فقط

---

## 14. Dashboard ⚡

### 14.1 KPI Cards
**الأدوار:** جميع الأدوار

| TC | السيناريو | النتيجة المتوقعة |
|----|-----------|-----------------|
| 14.1.1 | Dashboard يُحمَّل | 4 KPI cards: Total Docs / Pending Approvals / Open Tasks / Active Projects |
| 14.1.2 | Documents by Status donut chart | يعكس حالة المستندات الفعلية |
| 14.1.3 | Project Portfolio | نسب Active / On Hold / Completed / Cancelled |
| 14.1.4 | Overdue Items | يعكس المهام والمراسلات المتأخرة |
| 14.1.5 | Viewer dashboard | نفس الـ KPIs لكنها صفر إذا لم يكن member في أي مشروع |

---

## 15. Notifications

### 15.1 In-App Notifications
**الأدوار:** جميع الأدوار

| TC | السيناريو | النتيجة المتوقعة |
|----|-----------|-----------------|
| 15.1.1 | Workflow stage جديد → المُسنَّد يرى notification | bell icon يتحدث بعداد |
| 15.1.2 | مراسلة جديدة → المستلم يرى notification | ✅ |
| 15.1.3 | Document approved → Uploader يرى notification | ✅ |
| 15.1.4 | الضغط على notification | ينتقل للعنصر المرتبط |
| 15.1.5 | Mark all as read | العداد يعود لصفر |

### 15.2 Email Notifications
| TC | السيناريو | النتيجة المتوقعة |
|----|-----------|-----------------|
| 15.2.1 | RESEND_API_KEY مضبوط → Workflow stage | إيميل يُرسَل |
| 15.2.2 | RESEND_API_KEY غير مضبوط | يُسجَّل في logs فقط، النظام يستمر |

---

## 16. Permissions & Access Control 🔬

### 16.1 Role-Based Access
**الأدوار:** جميع الأدوار

| TC | السيناريو | المستخدم | النتيجة المتوقعة |
|----|-----------|---------|-----------------|
| 16.1.1 | الوصول لـ Admin panel | Viewer | 403 |
| 16.1.2 | الوصول لـ Admin panel | DC | 403 |
| 16.1.3 | الوصول لـ Admin panel | PM | 403 |
| 16.1.4 | الوصول لـ Admin panel | Admin | ✅ |
| 16.1.5 | رؤية جميع المنظمات | Admin | يرى منظمته فقط (Design Intent) ⚠️ Currently sees all |
| 16.1.6 | رؤية جميع المنظمات | Owner | يرى الجميع ✅ |
| 16.1.7 | حذف مستخدم من org أخرى | Admin | 403 |
| 16.1.8 | Reset password لمستخدم من org أخرى | Admin | 403 |

---

### 16.2 Project-Level Override
| TC | السيناريو | النتيجة المتوقعة |
|----|-----------|-----------------|
| 16.2.1 | Viewer مرفوع لـ Reviewer على مستوى المشروع | `resolveEffectiveRole()` يُعيد reviewer |
| 16.2.2 | PM مُخفَّض لـ Viewer على مستوى مشروع محدد | لا يستطيع رفع مستندات في ذلك المشروع |

---

### 16.3 Delegation
| TC | السيناريو | النتيجة المتوقعة |
|----|-----------|-----------------|
| 16.3.1 | A يُفوِّض B → B يستطيع العمل في Workflow stage المُسنَّد لـ A | ✅ |
| 16.3.2 | Delegation تنتهي → B يفقد الصلاحية | ✅ |

---

## 17. Multi-Tenant Isolation 🔬

### 17.1 Data Isolation
**الأدوار:** Users من orgs مختلفة

| TC | السيناريو | النتيجة المتوقعة |
|----|-----------|-----------------|
| 17.1.1 | User من org-B يطلب `/api/projects` | يرى فقط مشاريع org-B |
| 17.1.2 | User من org-B يطلب `/api/documents` | يرى فقط مستندات مشاريع org-B |
| 17.1.3 | User من org-B يطلب `/api/projects/:id` لمشروع org-A | 403 أو 404 |
| 17.1.4 | User من org-B يطلب `/api/projects/13/documents/58` | 403 أو 404 |
| 17.1.5 | User من org-B يطلب `/api/users` | يرى مستخدمي org-B فقط |

**⚠️ هذه أهم اختبارات النظام** — كسر أي منها = data breach.

---

### 17.2 API Parameter Injection
| TC | السيناريو | النتيجة المتوقعة |
|----|-----------|-----------------|
| 17.2.1 | Request بـ `?orgOverride=<orgId>` من غير Owner | يُتجاهل أو 403 |
| 17.2.2 | Request بـ `organizationId` في body من غير Owner | يُتجاهل — JWT org فقط يُعتمد |

---

## 18. Plans & Subscription Gates

### 18.1 Feature Gating
**الأدوار:** جميع الأدوار في orgs بخطط مختلفة

| TC | السيناريو | الخطة | النتيجة المتوقعة |
|----|-----------|-------|-----------------|
| 18.1.1 | فتح Transmittals tab | expired | "Not available on your plan" |
| 18.1.2 | فتح Transmittals tab | professional | القائمة تظهر |
| 18.1.3 | Migration Wizard | expired | محجوب |
| 18.1.4 | Migration Wizard | professional | متاح |
| 18.1.5 | تغيير plan من admin → immediate effect | Module flags تُحدَّث |

---

### 18.2 Storage Quotas
| TC | السيناريو | النتيجة المتوقعة |
|----|-----------|-----------------|
| 18.2.1 | رفع ملف يتجاوز quota الـ org | رسالة "Storage limit exceeded" |
| 18.2.2 | عرض Storage usage في Admin | يعكس الحجم الفعلي |

---

## 19. System Administration

### 19.1 Admin Panel — Users Tab
**الأدوار:** Admin, Owner

| TC | السيناريو | النتيجة المتوقعة |
|----|-----------|-----------------|
| 19.1.1 | عرض قائمة المستخدمين | يظهر 22 مستخدم مع email + role + org |
| 19.1.2 | بحث في المستخدمين | يفلتر فورياً |
| 19.1.3 | Lock icon → Reset Password | Dialog يفتح |
| 19.1.4 | تغيير role مستخدم | يُحدَّث فوراً |
| 19.1.5 | تعطيل مستخدم (isActive=false) | لا يستطيع تسجيل الدخول |

### 19.2 Admin Panel — Document Types Tab
| TC | السيناريو | النتيجة المتوقعة |
|----|-----------|-----------------|
| 19.2.1 | عرض قائمة Document Types | يظهر types الـ org الحالية |
| 19.2.2 | إنشاء type جديد | يُنشأ ويظهر في Upload dropdown |
| 19.2.3 | الضغط على type | ينتقل لـ Document Type Detail page |

### 19.3 Admin Panel — Workflows Tab
| TC | السيناريو | النتيجة المتوقعة |
|----|-----------|-----------------|
| 19.3.1 | عرض Workflow Templates | قائمة بـ templates الـ org |
| 19.3.2 | إنشاء Template جديد | Modal يفتح |
| 19.3.3 | تعيين documentTypeId لـ Template | يُطبَّق تلقائياً |

---

## 20. Audit Logs 🔬

### 20.1 سجل العمليات
**الأدوار:** Admin, Owner

| TC | السيناريو | النتيجة المتوقعة |
|----|-----------|-----------------|
| 20.1.1 | Login → Audit log | `action=login, entityType=auth` |
| 20.1.2 | Upload Document → Audit log | `action=create, entityType=document` |
| 20.1.3 | Status change → Audit log | `action=status_change, details={fromStatus, toStatus}` |
| 20.1.4 | Password reset → Audit log | `action=reset_password` |
| 20.1.5 | Admin override org → Audit log | `action=admin_override` |
| 20.1.6 | محاولة حذف audit log entry | يجب الرفض (append-only) |
| 20.1.7 | User من org-B يطلب audit logs | ⚠️ يرى جميع السجلات حالياً (Known Bug — C5) |

---

## Smoke Test Suite ⚡
> يُنفَّذ بعد كل deploy. يجب أن يكمل خلال < 15 دقيقة.

```
1. Login بحساب admin → يدخل Dashboard ✅
2. فتح أي مشروع → Documents tab يظهر ✅
3. الضغط على "Upload Document" → Dialog يفتح بـ 3 sections ✅
4. البحث عن مستند موجود → يظهر في نتائج ✅
5. الوصول لـ /admin → يفتح System Administration ✅
6. الضغط على زر Logout → يُوجَّه لـ Login ✅
7. Login بـ Viewer account → Dashboard يُحمَّل ✅
8. Viewer يحاول فتح /admin → 403 ✅
9. Global search من Viewer → يرى فقط مستندات org-A ✅
10. API health check: GET /api/health → {"status":"ok"} ✅
```

---

## تسجيل نتائج الاختبار

لكل دورة اختبار، سجّل في جدول بسيط:

```
Sprint: ___
Date: ___
Commit: ___
Tester: ___

| Module | Tests Run | Pass | Fail | Skipped | Notes |
|--------|-----------|------|------|---------|-------|
| Documents | 15 | 14 | 1 | 0 | TC 6.1.6 — metadata fields not shown |
...

Known Issues Found:
New Issues Found:
```

---

## الـ Test Data الأساسي (يُعاد إنشاؤه لكل Regression)

```
Organizations:
  - Horizons Infrastructure LLC (Client) — org_id: 10
  - Vision Engineering Consultants (Consultant) — org_id: 11
  - Al-Benna Construction Co. (Contractor) — org_id: 12

Users (كلمة المرور: ArcTest2026! لكل منهم):
  - khalid.alrashid@sim.test → project_manager → HIL
  - nadia.farouk@sim.test → reviewer → VEC
  - tariq.mansour@sim.test → document_controller → ABC
  - sara.ibrahim@sim.test → project_manager → ABC
  - ameen.saleh@sim.test → reviewer → ABC
  - fatima.qasim@sim.test → admin → VEC

Project: Horizons Tower — Al-Benna Package (HMT-ABC) → org: 12
Documents: 7 مستندات بأنواع ودisciplines مختلفة
```

---

*هذه الخطة وثيقة حية — أضف Test Cases جديدة مع كل Bug تكتشفه.*
