# ArcScale — تقرير المراجعة الشاملة وخارطة طريق التنفيذ

**تاريخ المراجعة:** 2026-07-01  
**النطاق:** 4 مراجعات مستقلة — الأمان، الأداء، الـ Frontend، الاتساق والتكامل  
**الملخص التنفيذي:** النظام يعمل وجاهز للإنتاج بشكل عام، لكن يحتوي على 3 ثغرات أمنية حرجة تؤثر على عزل الـ multi-tenant يجب إصلاحها قبل أي deployment لعملاء متعددين.

---

## التصنيفات المستخدمة

| الرمز | المعنى |
|-------|--------|
| `BUG` | خطأ سلوكي قد يسبب نتائج خاطئة |
| `SECURITY` | ثغرة أمنية أو خرق في حدود الأمان |
| `PERFORMANCE` | مشكلة ستؤثر على الأداء عند النمو |
| `SCALE` | مشكلة ستمنع التوسع مستقبلاً |
| `ARCH` | قرار معماري خاطئ يولّد coupling أو تعقيداً غير ضروري |
| `DX` | Developer Experience — صعوبة الصيانة والتطوير |
| `UX` | تجربة مستخدم متأثرة |
| `POLICY` | قرار منهجي يحتاج سياسة موحّدة |
| `FUTURE` | تجهيز للطبقات المستقبلية (Intelligence Platform) |

---

## Sprint A — إصلاحات حرجة وفورية (يجب قبل أي deployment متعدد المستأجرين)

### A-1 | SECURITY | CRITICAL

**العنوان:** Missing organizationId في PUT `/correspondence/:id/read`  
**الدليل:** `correspondence.ts:860-869`
```typescript
.where(eq(correspondenceTable.id, id))  // ❌ لا يوجد org check
```
**الأثر الفعلي:** أي مستخدم مسجّل يستطيع تغيير حالة `isRead` لأي correspondence في أي organization بمعرفة الـ ID.  
**الإصلاح:**
```typescript
.where(and(
  eq(correspondenceTable.id, id),
  eq(correspondenceTable.organizationId, caller.organizationId)
))
```
**الجهد:** ساعة واحدة | **الخطر إذا أُهمل:** خرق multi-tenant isolation — فضيحة للعملاء

---

### A-2 | SECURITY | CRITICAL

**العنوان:** Zero authorization في DELETE `/correspondence/:id/attachments/:attId`  
**الدليل:** `correspondence.ts:1080-1084`
```typescript
router.delete("/:id/attachments/:attId", requireAuth, async (req, res) => {
  await db.delete(correspondenceAttachmentsTable)
    .where(eq(correspondenceAttachmentsTable.id, attId));  // ❌ لا يوجد أي check
  res.json({ success: true });
});
```
**الأثر الفعلي:** أي مستخدم مسجّل (بغض النظر عن الـ org أو الـ role) يستطيع حذف أي attachment من أي organization. حذف أدلة — خطر قانوني.  
**الإصلاح:**
```typescript
// 1. جلب الـ attachment مع verify الـ correspondence
const [att] = await db.select({
  corrOrgId: correspondenceTable.organizationId
}).from(correspondenceAttachmentsTable)
  .innerJoin(correspondenceTable, eq(correspondenceAttachmentsTable.correspondenceId, correspondenceTable.id))
  .where(and(
    eq(correspondenceAttachmentsTable.id, attId),
    eq(correspondenceTable.organizationId, caller.organizationId)
  ));
if (!att) { res.status(404).json({ error: "Not found" }); return; }
// 2. ثم الحذف
await db.delete(...).where(eq(correspondenceAttachmentsTable.id, attId));
```
**الجهد:** 2 ساعات | **الخطر إذا أُهمل:** CRITICAL — data destruction across orgs

---

### A-3 | SECURITY | CRITICAL

**العنوان:** Missing organizationId في DELETE `/correspondence/:id/share`  
**الدليل:** `correspondence.ts:1171-1177`
```typescript
.where(eq(correspondenceTable.id, id))  // ❌ لا يوجد org check
```
**الأثر الفعلي:** أي مستخدم يستطيع إلغاء shared links لأي correspondence في أي org — DoS عبر org boundaries.  
**الإصلاح:** نفس نمط A-1 — إضافة `eq(correspondenceTable.organizationId, caller.organizationId)`.  
**الجهد:** 30 دقيقة | **الخطر إذا أُهمل:** CRITICAL

---

### A-4 | SECURITY | HIGH

**العنوان:** Missing org boundary في POST `/documents/:id/submit-review`  
**الدليل:** `documents.ts:1061-1079`  
**الأثر الفعلي:** يُنشئ tasks لمستخدمين في أي org بدون التحقق من أن الوثيقة تنتمي للـ org الحالي.  
**الجهد:** ساعة | **الخطر:** HIGH — cross-org task creation

---

## Sprint B — مشاكل الأداء الحرجة (يجب قبل أول عميل إنتاجي بحجم كبير)

### B-1 | PERFORMANCE | CRITICAL

**العنوان:** In-memory pagination في documents list  
**الدليل:** `documents.ts:169-223`
```typescript
// ❌ كل الوثائق تُحمّل في الـ memory أولاً
const all = await db.select().from(documentsTable).where(orgFilter);
const filtered = all.filter(d => matchesFilter(d, query));  // JavaScript filtering
const page = filtered.slice((pg - 1) * lim, pg * lim);      // JavaScript pagination
```
**الأثر الفعلي:** مع 10,000 وثيقة → timeout وانهيار الذاكرة. هذا سيحدث مع أول عميل جدي.  
**الإصلاح:** نقل كل filtering وsorting وpagination إلى SQL (`WHERE`, `ORDER BY`, `LIMIT`, `OFFSET`).  
**الجهد:** يوم كامل | **الخطر:** CRITICAL — النظام لن يعمل مع حجم حقيقي

---

### B-2 | PERFORMANCE | CRITICAL

**العنوان:** Unlimited folder queries بدون LIMIT  
**الدليل:** `documents.ts:67, 129, 153`  
**الأثر الفعلي:** org لديها 10,000 folder → كل request يجلب الكل. Memory spike وبطء.  
**الإصلاح:** إضافة pagination على folder lists وبناء lazy tree بدلاً من تحميل كل الشجرة.  
**الجهد:** نصف يوم

---

### B-3 | PERFORMANCE | CRITICAL

**العنوان:** N+1 Query في `enrichCorrespondence()`  
**الدليل:** `correspondence.ts:35-100`
```typescript
// لكل correspondence يتم تنفيذ 4 queries منفصلة:
const recipients = await db.select()...where(eq(...correspondenceId, id));  // query 1
const cc = await db.select()...where(eq(...correspondenceId, id));          // query 2
const attachments = await db.select()...where(eq(...correspondenceId, id)); // query 3
const fromUsers = await db.select()...where(eq(...fromUserId, fromId));     // query 4
```
**الأثر الفعلي:** inbox بـ 50 رسالة = 200 query. مع 200 رسالة = 800 query.  
**الإصلاح:** JOIN أو batch query واحد بدلاً من 4.  
**الجهد:** يوم | **الأثر بعد الإصلاح:** تحسن 10x في response time

---

### B-4 | PERFORMANCE | HIGH

**العنوان:** Sequential notification scheduler  
**الدليل:** `scheduler.ts:31-79`
```typescript
for (const job of pending) {  // ❌ sequential
  await handleJob(job);       // كل job ينتظر السابق
}
```
**الأثر الفعلي:** 50 notification بمعدل 200ms لكل منها = 10 ثوانٍ. مع نمو حجم المستخدمين → تراكم queue.  
**الإصلاح:** `await Promise.allSettled(pending.map(handleJob))` مع concurrency limit.  
**الجهد:** ساعتان

---

### B-5 | SCALE | HIGH

**العنوان:** 15+ missing database indexes  
**الدليل:** schema files متعددة

| الجدول | الـ column | سبب الـ index |
|--------|-----------|--------------|
| `documents` | `folderId` | FK lookup — كل تصفح folder |
| `documents` | `createdById` | تصفية بالمنشئ |
| `notifications` | `createdAt` | ترتيب زمني |
| `notifications` | `(userId, createdAt)` | composite — inbox queries |
| `correspondence_recipients` | `correspondenceId` | FK join |
| `correspondence_cc` | `correspondenceId` | FK join |
| `correspondence_attachments` | `correspondenceId` | FK join |
| `ai_cache` | `expiresAt` | cleanup queries — full scan حالياً |
| `ai_analysis` | `(entityType, entityId)` | lookups |

**الإصلاح:** migration إضافة indexes.  
**الجهد:** نصف يوم | **الأثر:** تحسن 5-50x على queries المتأثرة

---

### B-6 | PERFORMANCE | HIGH

**العنوان:** ILIKE على columns بدون index في search  
**الدليل:** `search-service.ts:267-276`
```typescript
ilike(documentsTable.title, pat)        // full table scan
ilike(documentsTable.description, pat)  // full table scan
```
**الإصلاح قصير المدى:** index `GIN` على `title` + تعطيل البحث في `description` أو تحديد minimum length.  
**الإصلاح طويل المدى:** PostgreSQL Full-Text Search مع `tsvector`.  
**الجهد:** ساعات | **FUTURE:** يمتد إلى Intelligence search layer

---

### B-7 | SCALE | HIGH

**العنوان:** Hardcoded limits في audit log export  
**الدليل:** `audit-logs.ts:215, 271`
```typescript
.limit(10000)  // CSV export
.limit(5000)   // dashboard
```
**الأثر الفعلي:** org لديها 50,000 event → CSV export معطوب أو يسبب timeout.  
**الإصلاح:** streaming export بدلاً من one-shot query. Dashboard يستخدم date range محدود.  
**الجهد:** يوم

---

## Sprint C — الصيانة المعمارية (خلال الشهر القادم)

### C-1 | ARCH | HIGH

**العنوان:** `orgNotificationSettingsTable` موجودة لكن مهملة — SLA مُرمّزة مباشرة  
**الدليل:** `correspondence.ts:469`, `organizations.ts:22-24`
```typescript
const unreadHours = org?.corrUnreadReminderHours ?? 48;  // يقرأ من deprecated columns
// بينما orgNotificationSettingsTable موجودة في correspondence.ts:77-87 ولا أحد يستخدمها
```
**الأثر:** أي تخصيص SLA للعميل مستحيل فعلياً. الجدول الجديد لا قيمة له.  
**الإصلاح:** نقل correspondence notifications لتقرأ من `orgNotificationSettingsTable`.  
**الجهد:** يوم

---

### C-2 | ARCH | HIGH

**العنوان:** Notification type مismatch — DB enum يحتوي 21 نوع بينما الـ code يعرف 40+  
**الدليل:** `notifications.ts:8-30` (DB) vs `lib/notifications/index.ts:23-70` (code)  
**الأثر:** notification events تُنشأ في الـ code لكن لا تُحفظ في DB. مستقبلاً → analytics وnotification center لن يروا أنواعاً كاملة.  
**الإصلاح:** مزامنة الـ enum — إضافة الأنواع الناقصة إلى DB migration.  
**الجهد:** نصف يوم

---

### C-3 | BUG | HIGH

**العنوان:** Zero audit logging في tasks routes  
**الدليل:** `tasks.ts` — بحث كامل لا يوجد `createAuditLog` call  
**الأثر:** لا تاريخ لمن أنشأ task أو غيّر status أو عيّن مستخدماً. يخالف EDMS audit requirements.  
**الإصلاح:** إضافة `createAuditLog()` عند: create, status change, assignment change, delete.  
**الجهد:** نصف يوم

---

### C-4 | ARCH | MEDIUM

**العنوان:** `audit_logs.action` free text بدلاً من typed enum  
**الدليل:** `audit-logs.ts:12` — `action: text("action").notNull()`  
**الأثر:** كل developer يكتب action name مختلف. بالفعل وُجد `"approval_submitted"` مقابل `"submit_approval"` في الـ codebase. Intelligence layer لاحقاً لن تستطيع معالجة events بشكل موثوق.  
**الإصلاح:** تحويل إلى enum مع migration. النمط: `verb_noun` موحّد.  
**الجهد:** يوم (schema + migration + بحث واستبدال)

---

### C-5 | SECURITY | MEDIUM

**العنوان:** JWT secret مستخدم في legacy password hashing  
**الدليل:** `auth.ts:64`
```typescript
const legacyHash = crypto.createHash("sha256").update(password + JWT_SECRET).digest("hex");
```
**الأثر:** تسرّب `JWT_SECRET` = crack جميع legacy passwords. SHA256 بدون salt ضعيف.  
**الإصلاح:** migration لـ bcrypt وإجبار users على reset password. JWT secret تُعاد بشكل مستقل.  
**الجهد:** يوم

---

### C-6 | SECURITY | MEDIUM

**العنوان:** Potential path traversal في storage routes  
**الدليل:** `storage.ts:359-381` — `filename` من URL params  
**الأثر:** filename يحتوي `../` قد يكتب خارج storage directory.  
**الإصلاح:** validate أن filename بعد `path.basename()` يساوي نفسه (لا path separators).  
**الجهد:** ساعة

---

### C-7 | POLICY | MEDIUM

**العنوان:** API response shapes غير موحّدة (5 أنماط مختلفة)  
**الدليل:** `departments.ts:44` (array مباشر)، `documents.ts:73` (بدون total)، `notifications.ts:160` (`unreadCount` بدلاً من `total`)  
**الأثر:** كل frontend developer يكتب handling مختلف. محرّك أخطاء وقت runtime.  
**الإصلاح:** تعريف `ListResponse<T>` موحّدة: `{ items: T[], total: number, page?: number }`.  
**الجهد:** يوم

---

### C-8 | DX | HIGH

**العنوان:** Double global fetch monkey-patching  
**الدليل:** `auth.tsx:25-39` + `org-context.tsx:32-46`
```typescript
// patch 1: يضيف Authorization header
window.fetch = async (...) => { ... }

// patch 2: يضيف orgOverride param
window.fetch = (input, init) => { ... }
```
**الأثر:** أي library تستخدم fetch ستتأثر. Debugging أصعب (أي patch سبب المشكلة؟). إضافة Sentry أو library ثالثة ستسبب conflicts غير متوقعة.  
**الإصلاح:** تحويل إلى axios instance مركزية مع interceptors، أو React Query interceptor.  
**الجهد:** يوم

---

### C-9 | DX | HIGH

**العنوان:** Pages monolithique — 4,851 سطر في ملف واحد  
**الدليل:**  
- `project-detail.tsx` — 4,851 سطر، 97 useState/useEffect  
- `admin.tsx` — 3,864 سطر  
- `reports.tsx` — 2,563 سطر  
**الأثر:** bugfix في tab واحد يخاطر بكسر tabs أخرى. Junior developer يقضي أسابيع يفهم flow الـ state.  
**الإصلاح:** تقسيم كل page إلى feature modules (`ProjectDocumentsTab`, `ProjectWorkflowTab`, etc.) — كل module ملف مستقل.  
**الجهد:** 3-5 أيام لكل page

---

### C-10 | DX | HIGH

**العنوان:** 597 استخدام لـ `any` type — TypeScript بدون أسنان  
**الدليل:** موزعة على كل pages وcomponents  
```typescript
const [moveToFolderDoc, setMoveToFolderDoc] = useState<any>(null);
const [form, setForm] = useState<any>(null);
```
**الأثر:** بعد سنتين لا أحد يعرف shape الـ state. IDE autocomplete لا يعمل. Refactoring خطر.  
**الإصلاح:** تفعيل `"strict": true` في `tsconfig.json` + استبدال تدريجي بـ typed interfaces.  
**الجهد:** أسابيع (يُعمل تدريجياً)

---

## Sprint D — تجهيز للمستقبل (Intelligence Platform Foundation)

### D-1 | FUTURE | HIGH

**العنوان:** `audit_logs.action` يجب أن يصبح Event Taxonomy  
**الدليل:** ADR-001 + النتائج الحالية  
**الهدف:** تحويل الـ audit log من "سجل تدقيق" إلى "مصدر أحداث" يمكن للـ Intelligence layer قراءته.  
**المطلوب:**
1. enum موحّد لجميع actions (C-4)
2. إضافة `entityType` و `entityId` كـ typed fields (حالياً في `details` JSON)
3. schema للـ `beforeState`/`afterState` — typed بدلاً من raw JSONB

---

### D-2 | FUTURE | HIGH

**العنوان:** `ai_analysis` بدون retention policy → تراكم للأبد  
**الدليل:** `ai.ts:66-86` — append-only مع `isLatest` flag  
**الهدف:** نحتاج retention policy وcleanup job قبل أن تصبح AI analysis layer active.  
**المطلوب:** policy بحذف analyses القديمة (غير isLatest) بعد X days.

---

### D-3 | FUTURE | MEDIUM

**العنوان:** `notifications` enum لا يغطي أحداث الـ workflow الكاملة  
**الدليل:** 19 نوع في DB مقابل 40+ في code (C-2)  
**الهدف:** عند بناء intelligence notifications، يجب أن كل event قابل للحفظ والاسترجاع.  
**المطلوب:** مزامنة كاملة + إضافة notification preference per-org لكل type.

---

### D-4 | FUTURE | MEDIUM

**العنوان:** conversations/messages tables — dead code أو مستقبل غير مقرّر  
**الدليل:** `conversations.ts`, `messages.ts` — defined but zero usage (confirmed via grep)  
**القرار المطلوب:** إما حذف (clean) أو وضع خطة محددة للاستخدام في Intelligence messaging layer.

---

## الخلاصة التنفيذية

### توزيع المشكلات

| الفئة | CRITICAL | HIGH | MEDIUM | LOW |
|-------|---------|------|--------|-----|
| SECURITY | 3 | 1 | 2 | 0 |
| PERFORMANCE | 3 | 2 | 0 | 0 |
| SCALE | 0 | 2 | 0 | 0 |
| ARCH | 0 | 2 | 1 | 0 |
| DX | 0 | 3 | 2 | 0 |
| BUG | 0 | 1 | 0 | 0 |
| POLICY | 0 | 0 | 1 | 0 |
| FUTURE | 0 | 2 | 2 | 0 |

### خارطة الطريق

```
الآن ←————————————————————————————————→ 3 أشهر

Sprint A (يومان):         إصلاح 4 ثغرات أمنية [A-1 حتى A-4]
  │
Sprint B (1-2 أسبوع):    إصلاح 6 مشاكل أداء حرجة [B-1 حتى B-7]
  │
Sprint C (3-4 أسابيع):   8 إصلاحات معمارية ومنهجية [C-1 حتى C-10]
  │
Sprint D (مستمر):         4 تجهيزات للـ Intelligence Platform
```

### القرار المقترح

النظام جاهز وظيفياً لكنه **غير جاهز للـ multi-tenant deployment** قبل Sprint A. الثغرات الثلاث الحرجة (A-1, A-2, A-3) بسيطة في الإصلاح (يومان كافيان) لكن أثرها قانوني وتشغيلي خطير.

**التوصية:** قبل onboarding أي عميل ثانٍ، يجب إغلاق Sprint A كاملاً والتحقق منه بـ integration tests تختبر cross-org access.

بعد Sprint A: Sprint B هو الأهم للـ reliability — الـ in-memory pagination (B-1) ستسبب أول حادثة إنتاجية فعلية مع أول عميل لديه حجم وثائق حقيقي.

Sprint C وD يمكن تقسيمهما على مدار ربع سنة — لا يحتاجان urgency لكنهما يحددان قابلية الصيانة على المدى البعيد.
