# Phase 6 — Cross-Org Transmittal Access: Design Review

**التاريخ:** 2026-07-05
**الحالة:** معتمدة v2 — Phase 6A مُنجزة (commit `c46d1c7`), Phase 6B مُنجزة
**المرجع:** Phase 5 Party Model Minimum (commit `a49de00`) · Phase 5.1 (commit `a7a6ec2`)

---

## 1. تعريف المشكلة بدقة

بعد Phase 5، يوجد الهيكل التالي:
- المشاريع إما `org_only` أو `parties`
- المنظمات الحليفة (parties) لها دور `observer` أو `contributor`
- الـ contributor يستطيع **إنشاء** transmittal **ورفع** documents

**المشكلة:** دورة حياة الـ transmittal عبر المنظمات مكسورة من جانب المستلِم.

الحالة العملية التي لا تعمل حالياً:
```
Org A (مالك المشروع) ←→ Org B (طرف حليف / Contributor)

Org A ينشئ transmittal "for_review"، يرفق وثائق، يرسل إلى مستخدم في Org B.

المستلِم في Org B يحاول:
  ✓ رؤية الـ transmittal في القائمة   — يعمل (transmittalPartyFilter يغطيه)
  ✗ تفصيل/تحميل الوثائق المرفقة      — مكسور (orgScopedWhere يحجبه)
  ✗ تعيين review code لكل بند         — جزئي (يعمل فقط إن كان هو toUserId)
  ✗ إكمال المراجعة (complete-review)   — جزئي (نفس الشرط)
  ⚠ تأكيد الاستلام (acknowledge)       — مفتوح لأي مستخدم مصادق (ثغرة أمنية)
```

---

## 2. لماذا لا يحله التصميم الحالي

### 2-A. `orgScopedWhere` يمنع قراءة وثائق Org A

عندما يحاول مستخدم Org B فتح وثيقة منفردة:
```typescript
.where(orgScopedWhere(caller, documentsTable.id, id, documentsTable.organizationId))
```
`orgScopedWhere` يضيف `AND organizationId = caller.organizationId`. وثائق Org A تحمل `organizationId = A`، فيكون الناتج 404 لكل مستخدمي Org B — حتى لو كانوا في transmittal صادر إليهم.

### 2-B. `acknowledge` بلا authorization

```typescript
// transmittals.ts (قبل Phase 6A)
const [transmittal] = await db.update(transmittalsTable)
  .set({ status: "acknowledged", acknowledgedAt: new Date() })
  .where(eq(transmittalsTable.id, id))  // لا يوجد أي تحقق من الهوية
```
أي مستخدم مصادق يعرف الـ `id` يستطيع تأكيد أي transmittal.
**هذه ثغرة أمنية مُعالَجة في Phase 6A.**

### 2-C. `set review code` و`complete-review` مقيدان بـ `toUserId` فقط

```typescript
const isAssigned = transmittal.toUserId === caller.id || transmittal.createdById === caller.id;
```
إذا أرسلت Org A إلى `toUserId = 42` (موظف في Org B)، فكل مستخدمي Org B الآخرين (حتى مديريهم) لا يستطيعون تعيين review codes أو إكمال المراجعة.

### 2-D. لا يوجد حقل `toOrganizationId`

الـ transmittal يصل لمستخدم محدد لا لمنظمة. إذا كان `toUserId = null`، لا يرى أي مستخدم في Org B الحليفة هذا الـ transmittal.

---

## 3. Routes وServices المتأثرة

| Route | الحالة الحالية | التغيير المطلوب |
|---|---|---|
| `GET /projects/:id/transmittals` | transmittalPartyFilter — يعمل | لا تغيير |
| `GET /projects/:id/transmittals/:id` | transmittalPartyFilter — يعمل | لا تغيير |
| `POST /projects/:id/transmittals` | Party contributor مدعوم ✓ | لا تغيير |
| `PUT /projects/:id/transmittals/:id` | intra-org فقط — صحيح | لا تغيير |
| `POST .../send` | orgScopedWhere — intra-org فقط — صحيح | لا تغيير |
| `POST .../acknowledge` | **ثغرة: أي مستخدم** | **Phase 6A** — canAccessProject + org check |
| `POST .../complete-review` | toUserId فقط | Phase 6C |
| `PATCH .../items/:itemId` | toUserId فقط | Phase 6C |
| `GET /projects/:id/documents/:id` | **orgScopedWhere يحجب** | Phase 6D |
| `GET .../files/:fileId` | **orgScopedWhere يحجب** | Phase 6D |

**Services:**
- `lib/can-access-project.ts` — لا تغيير
- `lib/party-ceiling.ts` — تعديل في Phase 6B: إضافة actions جديدة
- `lib/party-access.ts` — إضافة `canReceiveTransmittal()` في Phase 6B (انظر §البنية أدناه)
- `lib/org-scope.ts` — **لا يُلمس أبداً**

---

## 4. بنية `canReceiveTransmittal()`

> **قاعدة التصميم:** `canReceiveTransmittal()` تجيب على سؤال واحد فقط:
> **"هل هذه المنظمة هي الجهة المستلمة لهذا الـ Transmittal؟"**
> لا تمنح صلاحية، ولا تقرر هل الفعل مسموح — ذلك يبقى في الـ Route مع `PARTY_CEILING_V1`.

```typescript
// lib/party-access.ts — يُضاف في Phase 6B
export async function canReceiveTransmittal(
  callerOrgId: number,
  transmittalId: number,
  projectId: number,
): Promise<boolean> {
  // Conditions checked together (NOT separately):
  // 1. transmittal belongs to this project (projectId match)
  // 2. transmittal status is active (not revoked/cancelled)
  // 3. toUserId belongs to callerOrgId
  // Single DB query — no partial authorization
  const [row] = await db
    .select({ id: transmittalsTable.id })
    .from(transmittalsTable)
    .innerJoin(usersTable, eq(usersTable.id, transmittalsTable.toUserId))
    .where(and(
      eq(transmittalsTable.id, transmittalId),
      eq(transmittalsTable.projectId, projectId),
      notInArray(transmittalsTable.status, ["cancelled", "void"]),
      eq(usersTable.organizationId, callerOrgId),
    ))
    .limit(1);
  return !!row;
}
```

القرار الفعلي (هل يُسمح بالفعل؟) يبقى في الـ Route:
```typescript
const isRecipient = await canReceiveTransmittal(caller.organizationId, id, projectId);
if (!isRecipient) return res.status(403).json({ error: "Forbidden" });
if (!isWithinPartyCeiling(partyRole, "acknowledge_transmittal")) return res.status(403)...;
// proceed
```

---

## 5. نموذج الـ Authorization — قبل وبعد

### قبل Phase 6

```
الفعل                     | intra-org | party contributor | party observer
-------------------------|-----------|-------------------|---------------
قراءة قائمة transmittals  | ✓         | ✓ (إن كان toUserId)| ✓ (نفس الشرط)
تفصيل transmittal         | ✓         | ✓ (إن كان toUserId)| ✓ (نفس الشرط)
قراءة وثيقة مرفقة         | ✓         | ✗ (orgScopedWhere) | ✗
تعيين review code         | ✓         | ✓ (إن كان toUserId)| ✗
إكمال مراجعة              | ✓ (admin+) | ✓ (إن كان toUserId)| ✗
تأكيد الاستلام            | ✓ (أي مستخدم!) | ✓ (ثغرة) | ✓ (ثغرة)
إنشاء transmittal          | ✓         | ✓                 | ✗
```

### بعد Phase 6 (كامل)

```
الفعل                     | intra-org | party contributor | party observer
-------------------------|-----------|-------------------|---------------
قراءة قائمة transmittals  | ✓         | ✓                 | ✓
تفصيل transmittal         | ✓         | ✓                 | ✓
قراءة وثيقة مرفقة في TRS  | ✓         | ✓ (TRS نشط مرسَل لـ org) | ✓ (read-only)
تعيين review code         | ✓         | ✓ (contributor من org المستلِم) | ✗
إكمال مراجعة              | ✓ (admin+) | ✓ (contributor من org المستلِم) | ✗
تأكيد الاستلام            | ✓ (sender/recipient org) | ✓ (recipient org) | ✓ (recipient org)
إنشاء transmittal          | ✓         | ✓                 | ✗
```

**تعريف "org المستلِم":** مستخدم من Org B يُعتبر "مستلِماً" إذا كان `transmittal.toUserId` ينتمي إلى Org B.

---

## 6. هل يوجد أي تأثير على `orgScopedWhere`؟

**لا. صفر.**

`orgScopedWhere` لا يُلمس، لا يُعدَّل، لا يُضاف إليه استثناء. مضمون بالتصميم:
- الوصول للوثائق عبر transmittals يمر بمسار **موازٍ** مستقل
- كل الـ mutations (UPDATE / DELETE) على وثائق الـ intra-org تبقى محمية بـ `orgScopedWhere`
- القاعدة من ADR-011 تبقى: "Cross-org access يمر فقط عبر `lib/party-access.ts`"

---

## 7. الـ Invariants التي يجب ألا تنكسر

| # | Invariant |
|---|---|
| I-1 | مستخدم Org B لا يرى وثائق Org A إلا من خلال transmittal نشط مرسَل لـ org B |
| I-2 | مستخدم Org B لا يُعدِّل أو يحذف وثائق Org A أبداً |
| I-3 | observer لا يُعيِّن review codes ولا يُكمل مراجعة |
| I-4 | المنظمات غير الحليفة لا تصل للمشروع |
| I-5 | acknowledge يتطلب caller من org المرسِل أو org المستلِم — لا طرف ثالث |
| I-6 | `orgScopedWhere` لا يُلمس |
| I-7 | الوثيقة يُعاد فحص ارتباطها بـ transmittal نشط في كل طلب — لا caching |
| I-8 | إزالة party من المشروع يقطع الوصول فوراً (انظر T-6) |

---

## 8. Threat Model

### T-1: Insecure Direct Object Reference على الوثائق

**الهجوم:** Org B تحاول قراءة `documentId` لم يرِد في أي transmittal مرسَل لها.
**الدفاع:** مسار القراءة في Phase 6D يتحقق بـ EXISTS query: transmittal_item + transmittal في نفس المشروع + toUserId في callerOrg + status نشط.

### T-2: Privilege Escalation عبر acknowledge

**الهجوم:** Org C (ليست طرفاً) تؤكد transmittal بين Org A وOrg B.
**الدفاع (Phase 6A):** ثلاثة شروط: (1) canAccessProject → مشارك في المشروع، (2) callerOrg = sender أو recipient org، (3) إن كان المشروع org_only لا يُفتح أي مسار cross-org.

### T-3: Review Code Injection

**الهجوم:** Org B تُعيِّن review codes على transmittal أرسلته هي.
**الدفاع:** set review code يشترط أن يكون caller من **org المستلِم** لا org المرسِل.

### T-4: Cross-org Data Exfiltration عبر قائمة الوثائق

`GET /projects/:id/documents` يُعيد كل وثائق المشروع لجميع الحلفاء — هذا **accepted known exposure**: الـ party اُضيف بموافقة صريحة من مالك المشروع. تقييد قائمة الوثائق للـ parties هو نطاق APF لاحق.

### T-5: Replay على share tokens

Share tokens للـ transmittals لا تتأثر بهذا التصميم.

### T-6: Revoked Party Access — **قرار: القطع الفوري**

**السيناريو:** Org B استلمت transmittal. بعد أسبوع أزالها Admin المشروع من `project_parties` (`removed_at` يُعيَّن).

**القرار المعتمد: الوصول يُقطع فوراً عند الإزالة.**

**المبرر:**
- `canAccessProject()` يتحقق من `isNull(projectPartiesTable.removedAt)` في كل طلب — حالما يُعيَّن `removed_at`، يعود `allowed: false`.
- مسار القراءة الجديد في Phase 6D يستدعي `canAccessProject` أيضاً — نفس الآلية تقطع وصول الوثائق.
- **لا يوجد وصول تاريخي**: لا نسخة مؤقتة (cache)، لا رابط مباشر، لا استثناء.

**تأثير مقصود:** Org B قد تكون في منتصف مراجعة transmittal عند الإزالة — المراجعة تتوقف فوراً. هذا القرار مقصود: صلاحية المشاركة تنتهي بانتهاء عضوية الـ party.

**الاختبار المطلوب في Phase 6A:** test يُثبت أن Org B بعد إزالتها من project_parties لا تستطيع acknowledge أي transmittal — حتى لو كانت `toUserId` منتمية لها.

---

## 9. خطة التنفيذ

### Phase 6A — إصلاح ثغرة `acknowledge` (الآن)

**النطاق:** `transmittals.ts:acknowledge` فقط.

**شروط الـ authorization الجديدة:**
1. `canAccessProject(caller.id, caller.organizationId, projectId, sysOwner)` → must be `allowed`
2. callerOrg = `transmittal.organizationId` (org المرسِل)، أو
3. callerOrg = org الـ `transmittal.toUserId` (org المستلِم)
4. إذا كان `mode === 'intra_org'` والمشروع org_only → لا cross-org path ممكن بالتعريف (canAccessProject لا تُعيد mode=party لمشاريع org_only)

**نقطة توقف:** typecheck + tests قبل أي deploy.

---

### Phase 6B — `canReceiveTransmittal()` + PARTY_CEILING_V1 توسيع

بلا migration. انظر §4 أعلاه.

---

### Phase 6C — توسيع workflow الاستلام

Routes: acknowledge ✓ (Phase 6A) + `complete-review` + `PATCH items/:itemId`.

---

### Phase 6D — Document Read Access عبر Transmittal

إضافة `canReadDocumentViaTransmittal()`. الفحص يتضمن: transmittal_item موجود + transmittal في نفس المشروع + transmittal نشط (ليس cancelled/void) + toUserId في callerOrg.

---

### Phase 6E (اختيارية) — `toOrganizationId` Field

Migration جديد. تحتاج موافقة منفصلة.

---

## 10. المخاطر وخطة الـ Rollback

| الخطر | التخفيف |
|---|---|
| تسريب وثائق عبر Phase 6D | E2E يثبت عدم وصول Org C وOrg B بعد الإزالة |
| كسر intra-org workflow | test suite الحالي (586 test) يكتشفه |
| تعارض مع `resolveEffectiveRole` | Phase 6C مستقلة — تُختبر قبل Phase 6D |
| regression في orgScopedWhere | لا يُلمس — invariant مكتوب + code review gate |

**Rollback:** كل مرحلة مستقلة، بلا migration (حتى 6E). `git revert` + deploy كافٍ لأي مرحلة.

---

## 11. Phase 6B — تعديلات التصميم v2

**القرارات المعتمدة في مراجعة 2026-07-05:**

### تغيير الاسم: `canReceiveTransmittal()` → `recipientOrganizationId()`

الاسم الأصلي أوحى بمنح صلاحية. `recipientOrganizationId()` utility صافية:
```typescript
recipientOrganizationId(toUserId, toUserOrganizationId) → number | null
```
لا database calls. القرار في الـ Route بعدها:
```typescript
const recipientOrgId = recipientOrganizationId(trs.toUserId, toUserOrgId);
const isRecipient = recipientOrgId === caller.organizationId;
```

### تغيير Observer Ceiling: إضافة `read_transmittal`

```
observer:    ["read_transmittal"]          ← v2 (v1 كان: [])
contributor: ["read_transmittal",
              "upload_document",
              "create_transmittal",
              "acknowledge_transmittal"]
```

**السبب:** observer يملك `read_document`. الـ transmittal هو غلاف إرسال الوثيقة — رؤيته ضرورية لفهم لماذا وصل الملف. عدم السماح كان تناقضاً مع الفلسفة.

### Invariant I-9: توحيد predicate الـ List والـ Detail

> `GET /transmittals/:id` يجب أن يستخدم نفس `transmittalPartyFilter` الخاصة بـ `GET /transmittals`.
> لا يجوز أن يكون للوصول المفرد منطق مستقل. `GET /:id` قبل Phase 6B لم يستدعِ `canAccessProject()`
> — تم تثبيت هذا في Phase 6B وإضافة gate صريح.

### Filter الـ List — project_id صريح

```sql
project_id = :projectId          ← صريح، ليس ضمنياً
AND (
  organization_id = :callerOrgId
  OR to_user_id = :callerId
  OR EXISTS (SELECT 1 FROM users WHERE id = to_user_id AND organization_id = :callerOrgId)
)
```

### Gate Model المحدَّث لـ acknowledge:

```
Gate 1: canAccessProject()                → allowed + mode + partyRole
Gate 2: (party mode) isWithinPartyCeiling("acknowledge_transmittal")
Gate 3: system_owner → bypass
        party        → recipientOrganizationId() === callerOrgId (recipient only)
        intra-org    → senderOrg OR recipientOrg (Phase 6A behavior preserved)
```

### P13 — Information Hiding على مستوى الـ transmittal

Transmittal من مشروع مختلف يُعيد `404` (ليس `403`) — المستخدم لا يعلم بوجوده.
`transmittalPartyFilter` يتضمن `project_id = :projectId` صراحةً.
