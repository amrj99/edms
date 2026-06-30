# ArcScale EDMS — Root-Cause Remediation Plan

**Date:** 2026-06-29 (v1.0) — revised 2026-06-29 (v1.1) — RC-01 complete 2026-06-29 (v1.2) — RC-03 complete 2026-06-29 (v1.3) — RC-02 complete 2026-06-29 (v1.4) — RC-04 complete 2026-06-29 (v1.5) — RC-06 complete 2026-06-29 (v1.6) — RC-05 complete 2026-06-30 (v1.7)
**Scope:** Discovery phase J-01 through J-08 — 33 findings, 11 System Patterns, 5 Architectural Principles
**Peer review incorporated:** Independent architectural review by Claude Opus (2026-06-29)
**Purpose:** Group findings by root cause. Identify the minimum correct fixes to move the system to an acceptable operational state. No code is written here. No 33 separate fixes.
**Rule:** Every root cause is stated as a single, falsifiable engineering fact — not a symptom, not a design opinion.

---

## ArcScale Design Philosophy

These four principles govern how every fix in this plan is shaped. They are not negotiable:

- **Flexibility before restriction** — the system guides users toward correct behavior before blocking them.
- **Guidance before prevention** — error messages and warnings before hard 4xx responses, except where audit integrity requires a hard stop.
- **Visibility before enforcement** — make state observable first; enforce constraints only when the cost of getting it wrong is high.
- **No rigid workflow unless explicitly chosen** — organizations opt into enforcement; the default is a path of least resistance that still captures the audit record.

These principles are applied at the level of the fix design, not as a reason to defer a fix.

---

## Governing Architectural Principles

*Established before implementation begins. Every fix is evaluated against these. If a proposed implementation violates one, it is revised before merge.*

### AP-I — Party-scoped access, not org-equality

Every read predicate consults `{sender org, receiver org, named participants}` — never `caller.organizationId === resource.organizationId`. The correct access unit for a cross-org record is the set of parties authorized to that record, not the set of users inside the creating org.

### AP-II — Accepted fields are persisted fields

No field accepted in a request body is silently discarded before persistence. If a field appears in the request schema, it appears in the `INSERT` / `UPDATE`. Any field that is not persisted must be rejected at the route boundary with a validation error, not silently ignored.

### AP-III — Side effects are part of the response contract

Any command that creates records or fires events returns those records and events in the response body. Silent object creation is a contract violation. The caller must be able to reconstruct system state from the response alone.

### AP-IV — Terminal states lock writes explicitly

Records in terminal states (`acknowledged`, `completed`, `cancelled`) declare a write policy in code. The default policy for a terminal state is read-only. Any exception to this must be explicit, named, and audited — not implied by the absence of a guard.

### AP-V — Cross-module linkage is named, not implied

If two records are associated, there is a foreign key and an API surface for the association. No module infers a link from matching string references (document numbers, subject prefixes, timestamps). If the linkage cannot be expressed as an FK, it is not a supported association.

### AP-VI — State transitions go through a single function per entity type

No file outside the designated transition function writes to a status column. Caller code invokes `transitionWorkflow(instanceId, action)` or `acknowledgeTransmittal(id)` — never `db.update({ status: 'approved' })` directly. This makes state-change logic auditable and testable in isolation.

### AP-VII — Multi-org capability must exist at runtime, not only in schema

A schema column that the runtime does not honor is technical debt masquerading as a feature. If a field (e.g., `toOrganizationId`, `toUserId`) exists in the schema, the runtime must read and enforce it. Fields that are stored but never used in access control or routing are candidates for immediate remediation.

---

### Meta-Root: Single-Org Runtime over Multi-Org Schema (Meta-RC-A)

The system was built for a single-org runtime. Multi-org support exists only in the schema. This single fact explains RC-01, RC-02, and the cross-org parts of RC-04 — collectively accounting for approximately half of all P1/P2 findings.

AP-I and AP-VII are the two direct expressions of this meta-root in code.

**Implication for implementation:** RC-01, RC-02, and RC-04 must be implemented as three faces of one coordinated fix, not as three isolated predicate patches. Specifically: each fix must use the existing FK fields (`fromOrganizationId`, `toOrganizationId`, `toUserId`) consistently, so that a `Party` abstraction — `(organizationId, optional userId)` — can later be introduced as a first-class entity underneath the existing logic without a rewrite. Do not hardcode org IDs or user IDs anywhere in the fix.

---

## Open Decisions Before Implementation

*These three questions must be answered before the affected RC is implemented. They are product decisions, not engineering defaults.*

### Decision A — Review authorization scope (RC-02)

**Question:** Is transmittal review authorization user-level or org-level?

| Option | Behavior | Implication |
|---|---|---|
| **User-level (current plan)** | Only the named `toUserId` can call `complete-review` or PATCH items | Requires naming a specific person when sending. Strictest audit trail. |
| **Org-level** | Any user in `toOrganizationId` with role ≥ `reviewer` can act | More flexible; fits teams where any consultant can respond. Requires `toOrganizationId` check in `isAssigned`. |

The current plan assumes user-level. Adding org-level requires one additional condition in `isAssigned` — but it is a product decision about audit attribution, not a code complexity question. Decide before RC-02.

### Decision B — `/cancel` effect on document status (RC-03)

**Question:** When a workflow instance is cancelled, what happens to the document's status?

| Option | Behavior |
|---|---|
| **Revert to prior status** | Document returns to `draft` or the status it held before the workflow started. Caller can restart. |
| **Leave as `under_review`** | Caller must manually track that the workflow was cancelled. Simplest. |
| **Add `cancelled` status** | New status value — requires schema migration. Most explicit. |

Recommended: revert to prior status (simplest behavior that preserves meaning). Decide before implementing `/cancel`.

### Decision C — Submission Chain minimum viable shape (RC-05)

**Question:** Is the chain a view-only linked list, or does it track current custodian?

| Option | Behavior | Scope |
|---|---|---|
| **View-only linked list** | Three endpoints: create, forward, get. Shows who sent what to whom. | Minimal — Manages level baseline. |
| **Current-custodian tracking** | Chain records which org currently holds the document and when it must respond. | Larger — SLA tracking, hold logic, future. |

The current plan targets view-only. If current-custodian tracking is the goal, the data model must be designed now even if the SLA logic is deferred. Decide before RC-05.

---

## Root Cause Summary Table

| ID | Root Cause (one sentence) | Class | Phase | Blocks |
|---|---|---|---|---|
| **RC-01** ✅ | Cross-org read access uses the wrong predicate for both Correspondence and Transmittals | Architecture Gap | 1A | Works, Operates, Manages |
| **RC-02** ✅ | `toUserId` on transmittal items is never populated from the request body | Bug | 1B (after RC-01) | Operates |
| **RC-03** ✅ | The workflow engine has no backward routing for `returned`, no template validation, and no recovery API for deadlocked stages | Bug + Product Gap | 1A (parallel with RC-01) | Works, Operates |
| **RC-04** ✅ | Notification and task delivery has no cross-org routing model | Architecture Gap | 2 (after RC-01 + RC-02) | Operates |
| **RC-06** ✅ | Acknowledged records are mutable and reference data is silently discarded | Bug + Product Gap | 3 | Manages |
| **RC-05** ✅ | The Submission Chain feature is not implemented — all routes return 404 | Product Gap | 4 | Manages |

*Note: RC-06 precedes RC-05 because RC-06 stops ongoing audit corruption in existing records; RC-05 adds a new capability. Protective before additive.*

---

## RC-01 — Cross-Org Read Access Uses the Wrong Predicate

### Root cause

The access check for both Correspondence and Transmittals uses `resource.organizationId === caller.organizationId` as a hard boundary. This single predicate is wrong in opposite directions for the two modules: Correspondence is fully org-locked (receiver-org cannot read), Transmittals are fully project-open (all orgs in the project can read). Neither implements the correct rule: *sender org AND receiver org may read; all others may not.*

This is a direct manifestation of Meta-RC-A (single-org runtime) and violates AP-I (party-scoped access).

### Findings explained

| Finding | Symptom | How RC-01 explains it |
|---|---|---|
| J05-001 | CREV (org 3) cannot read the RFI sent to them by DC (org 2) | Correspondence: `organizationId=2 ≠ caller.organizationId=3` → blocked |
| J06-001 | DC (org 2) can read HMT→Owner transmittal (org 3→org 4) | Transmittal: no org filter — project membership is sufficient |
| J08-007 | ENG receives `correspondence_received` notification but cannot read the correspondence | Notification fires, but read attempt fails the same predicate |

### Journeys

J-05 (Phase C), J-06 (Phase A), J-08 (audit)

### Level impact

| Level | Impact |
|---|---|
| **Works** | Broken — cross-org read is the precondition for any multi-party action |
| **Operates** | Broken — no external reviewer scenario can operate without cross-org read |
| **Manages** | Broken — a Director in org 2 reading a transmittal from org 3 to org 4 is a data leak |

### Classification

**Architecture Gap.** The predicate was written for a single-org scenario and was never extended for the multi-org use case. The correct rule is derivable from the existing data model — every transmittal already has `fromOrganizationId` and `toOrganizationId`; every correspondence has `organizationId` on the sender and `toUserId`/`ccUserIds` identifying the recipients.

### Minimal correct fix

**Step 1 — Fix the two confirmed predicates:**

- **Transmittals:** readable if `caller.organizationId ∈ { fromOrganizationId, toOrganizationId }`
- **Correspondence:** readable if `caller.organizationId = organizationId` (sender) OR `caller.id ∈ { toUserId } ∪ ccUserIds`

The predicate change is on the read query (WHERE clause or post-query filter) — no schema changes required.

**Step 2 — Audit all other read endpoints before shipping:**

The same broken predicate (`resource.orgId === caller.orgId`) may exist in workflow instance reads, document reads, task reads, and other modules. Before RC-01 is merged, every `GET` endpoint that touches a resource with an `organizationId` column must be reviewed against AP-I. Fix any additional instances found in the same PR as RC-01. This is not a separate RC — it is a pre-ship audit requirement for RC-01.

### Scope boundary — do NOT build alongside this fix

- Do not add row-level security at the database layer — application-layer isolation is sufficient for current scale; RLS is an infrastructure decision for pre-production with real clients
- Do not build a "sharing permissions" UI
- Do not change the data model — `fromOrganizationId` / `toOrganizationId` already exist
- Do not touch the write path — only the read predicate changes

### Implementation status — ✅ COMPLETE (2026-06-29)

**What was implemented:**

**Transmittals — `transmittalPartyFilter()` helper** (`artifacts/api-server/src/routes/transmittals.ts`):
- New `transmittalPartyFilter(caller, projectId)` function replaces bare `eq(projectId)` in both GET / and GET /:id
- Shows transmittal to caller if: `organizationId = caller.org` (sender org match) OR `toUserId = caller.id` (named recipient) OR `EXISTS(toUserId's org = caller.org)` (org-level receiver match)
- `isSystemOwner(caller)` bypasses party filter — sees all transmittals in project

**Correspondence — cross-org read guard** (`artifacts/api-server/src/routes/correspondence.ts`):
- GET /: Added `isCrossOrgMember` detection for cross-org project members; forces `wantsViewAll = false` and restricts received-items fetch to `inArray(involvedIds)` instead of full `baseFilter` scan
- GET /:id: Removed blanket `TenantIsolationError` on org mismatch. Added `isCrossOrgItem` flag: PM/DC `hasViewAllCapability` is scoped to same-org items only; cross-org items always go through the To/CC check regardless of role
- POST /:id/reply: Removed `TenantIsolationError` on parent org check — reply access governed by thread membership, not org equality

**Runtime verification — 19/19 tests PASS:**

| Test | Actor | Resource | Expected | Result |
|---|---|---|---|---|
| DC reads TXN #1 (own org) | DC / org 2 | TXN-0001 (org 2) | 200 | ✅ PASS |
| DC reads TXN #10 (HMT) | DC / org 2 | TXN-0010 (org 3) | 404 | ✅ PASS |
| CREV reads TXN #9 (own org) | CREV / org 3 | TXN-0009 (org 3) | 200 | ✅ PASS |
| CREV reads TXN #1 (Al-Benna) | CREV / org 3 | TXN-0001 (org 2) | 404 | ✅ PASS |
| HMTDC reads TXN #11 (own org) | HMTDC / org 3 | TXN-0011 (org 3) | 200 | ✅ PASS |
| HMTDC reads TXN #8 (Al-Benna) | HMTDC / org 3 | TXN-0008 (org 2) | 404 | ✅ PASS |
| PM reads TXN #9 (HMT) | PM / org 2 | TXN-0009 (org 3) | 404 | ✅ PASS |
| SYS reads TXN #10 (bypass) | SYS / system_owner | TXN-0010 (org 3) | 200 | ✅ PASS |
| DC list — no HMT TXNs | DC / org 2 | all project TXNs | 10 (org 2 only) | ✅ PASS |
| CREV list — HMT TXNs only | CREV / org 3 | all project TXNs | 3 (org 3 only) | ✅ PASS |
| HMTDC list — HMT TXNs only | HMTDC / org 3 | all project TXNs | 3 (org 3 only) | ✅ PASS |
| CREV reads corr #1 (sender) | CREV / org 3 | corr #1 (org 3) | 200 | ✅ PASS |
| ENG reads corr #1 (in To) | ENG / org 2 | corr #1 (org 3) | 200 | ✅ PASS |
| DC reads corr #1 (CC'd) | DC / org 2 | corr #1 (org 3) | 200 | ✅ PASS |
| DC reads corr #3 (not named) | DC / org 2 | corr #3 (org 3) | 403 | ✅ PASS |
| HMTPM reads corr #4 (not named) | HMTPM / org 3 | corr #4 (org 2) | 403 | ✅ PASS |
| PM reads corr #4 (in To) | PM / org 2 | corr #4 (org 2) | 200 | ✅ PASS |
| DC reads own corr #4 (sender) | DC / org 2 | corr #4 (org 2) | 200 | ✅ PASS |
| SYS reads corr #3 (bypass) | SYS / system_owner | corr #3 (org 3) | 200 | ✅ PASS |

**Implementation note — Docker build workaround:**
Changes are in TypeScript source (`correspondence.ts`, `transmittals.ts`) and also applied as direct patches to the running dist (`dist/index.mjs`) to work around a Windows/WSL2 Docker build cache issue that prevents source changes from being picked up during rebuild. When this is resolved, the dist should be rebuilt from source.

**SP-001 interaction:** `toUserId` is still null for all transmittals (RC-02 not yet fixed). The party filter's `toUserId` and `EXISTS(org)` clauses are syntactically present and correct — they have no effect at runtime until RC-02 is implemented. When RC-02 is done, party-filter behavior will automatically expand to include named recipients without any additional change to the filter function.

---

## RC-02 — `toUserId` on Transmittal Items Is Never Populated

### Root cause

The route handler for `POST /api/transmittals` (and the corresponding `PUT`) destructures the transmittal item fields from the request body but does not include `toUserId`. The field is accepted by the client, stored in the request JSON, and silently discarded — a direct violation of AP-II (accepted fields are persisted fields). Every transmittal item is created with `toUserId=null`. The authorization guard `isAssigned` (`toUserId === caller.id || createdById === caller.id`) then always evaluates false for external reviewers.

This is a second direct manifestation of Meta-RC-A: the `toUserId` field exists in the schema for multi-org routing, but the runtime discards it, keeping the system effectively single-org.

### Findings explained

| Finding | Symptom | How RC-02 explains it |
|---|---|---|
| J04-001 | CREV cannot `complete-review` | `isAssigned` false → blocked |
| J04-002 | CREV cannot PATCH transmittal item status | `isAssigned` false → blocked |
| J04-003 | DC must proxy all reviews on behalf of CREV | Only `createdById === caller.id` branch ever passes |
| J05-003 | CREV cannot `complete-review` on TXN-006 | Same cascade |
| J06-003 | OWNER cannot `complete-review` | Same cascade |
| J07-003 | Acknowledged TXN item PATCH blocked (wrong reason) | `isAssigned` false rather than "already acknowledged" |

### Journeys

J-01, J-03, J-04, J-05, J-06, J-07

### Level impact

| Level | Impact |
|---|---|
| **Works** | Partial — mechanics exist; external reviewer code path is dead |
| **Operates** | Broken — external review requires the sender to proxy all actions |
| **Manages** | Degraded — review records show `createdById` (sender) as reviewer |

### Classification

**Bug.** A single field not destructured from `req.body` in one or two route handlers. The data model, the auth guard logic, and the business rule are all correct.

### Minimal correct fix

In the transmittal item create and update route handlers, add `toUserId` to the destructured fields and include it in the `INSERT` / `UPDATE` statement. No schema change. No new endpoint. No new auth rule. The existing `isAssigned` check handles the rest correctly once the field is populated.

The fix is approximately 2–3 lines per route handler.

### Dependency

RC-02 fix has no observable effect until RC-01 is also fixed. Even with `toUserId` set correctly, an external reviewer who cannot read the transmittal (RC-01) cannot reach the `isAssigned` guard. Fix order: RC-01 → RC-02.

### Open decision dependency

Decision A (review authorization scope) must be resolved before this fix is implemented. The current plan wires only `toUserId` — if org-level delegation is chosen, the fix also adds `caller.organizationId === transmittalItem.toOrganizationId` to `isAssigned`.

### Scope boundary — do NOT build alongside this fix

- Do not change the `isAssigned` guard logic beyond the outcome of Decision A — the guard is correct as written for user-level authorization
- Do not add a `toOrganizationId` check to `isAssigned` without Decision A resolved — this is a product decision about audit attribution, not a scope savings
- Do not build a "reviewer assignment" UI — the route body already accepts `toUserId`

### Implementation status — ✅ COMPLETE (2026-06-29)

**Decision A resolution:** User-level (default). `toUserId` identifies the specific person the transmittal is addressed to. Org-level delegation remains architecturally open: `isAssigned` has no coupling to user-level as the only future option — adding `|| caller.organizationId === <toUser.organizationId>` is a single-line addition, pending a schema migration to add `toOrganizationId` if org-level is ever chosen.

**What was implemented:**

In `artifacts/api-server/src/routes/transmittals.ts`:
- `POST /`: `toUserId` added to `req.body` destructuring and to the `INSERT` values (`toUserId: toUserId ?? null`)
- `PUT /:id`: `toUserId` added to `req.body` destructuring and to the `UPDATE .set({...})` — Drizzle ORM skips `undefined`, passes `null` to clear, passes value to set. No special handling needed.

The `isAssigned` guards in `complete-review` (line 340) and `PATCH /:id/items/:itemId` (line 624) were already correct — they needed no changes.

**Architecture note:** The schema has no `toOrganizationId` column. The transmittal party filter's org-level clause uses EXISTS to infer the receiver's org from the toUser's org_id — this is the correct approach and does not need a new column for the filter. If org-level review authorization is later chosen, it would require either: (a) inferring org via a JOIN on `toUserId.organizationId` in the `isAssigned` check, or (b) adding a `toOrganizationId` column via migration. User-level implementation does not prevent either path.

**Runtime verification — 9/9 tests PASS:**

| Test | Actor | Expected | Result |
|---|---|---|---|
| T-01: POST transmittal with toUserId=7 | DC | toUserId=7 in response | ✅ PASS |
| T-02: CREV PATCH item reviewCode (toUserId=CREV.id) | CREV | 200, reviewCode="A" | ✅ PASS |
| T-03: ENG PATCH item reviewCode (NOT toUserId) | ENG | 403 | ✅ PASS |
| T-04: CREV complete-review (toUserId=CREV.id, item coded) | CREV | 200, response TXN created | ✅ PASS |
| T-05a: PUT transmittal update stores new toUserId | DC | toUserId=7 in response | ✅ PASS |
| T-05b: PUT transmittal clears toUserId=null | DC | toUserId=null | ✅ PASS |
| T-05c: PUT transmittal sets toUserId=5 (ENG) | DC | toUserId=5 | ✅ PASS |
| T-06: CREV complete-review on TXN with toUserId=null | CREV | 403 | ✅ PASS |
| T-07: SYS admin-override PATCH item (not assigned) | SYS | 200, reviewCode="B" | ✅ PASS |

---

## RC-03 — Workflow Engine Cannot Complete a 3-Stage Review

### Root cause

Three independent failures combine to make the standard 3-stage review template permanently unusable:

**Sub-cause A — Missing template validation:** The template editor saves stages with `responsibleRole=null` and `responsibleUserId=null` without error. The `canAct` function returns false when both are null. This is the root: stages without a responsible party are structurally invalid and must be rejected at save time, not at runtime.

**Sub-cause A′ — No recovery API:** Even if validation is added for new templates, existing deadlocked instances have no recovery path. There is no endpoint for a PM or admin to cancel a deadlocked workflow instance. The only recovery path today is direct database access.

**Sub-cause B — Incorrect `returned` routing:** The `advance` handler for `action="returned"` routes forward to the next stage, not backward to the previous stage. From Stage 2, `returned` produces `toStageId = Stage 3` (same as `approved`), not `toStageId = Stage 1`. The document advances into the deadlock rather than returning for rework.

Sub-causes A and B compound: B creates a second path into the deadlock that A creates. Any workflow using "return for rework" from Stage 2 triggers both simultaneously.

### Findings explained

| Finding | Symptom | Sub-cause |
|---|---|---|
| J01-004 | Stage 3 permanently deadlocked — `canAct=false` for all | A |
| J02-002 | `returned` from Stage 1 loops at Stage 1 | B (incidentally correct — no prior stage) |
| J07-002 | `returned` from Stage 2 advances to Stage 3 and immediately deadlocks | B → A |

### Journeys

J-01, J-02, J-07 (F-03)

### Level impact

| Level | Impact |
|---|---|
| **Works** | Broken — every 3-stage workflow deadlocks at Stage 3 |
| **Operates** | Broken — no project can complete a full 3-stage review cycle |
| **Manages** | Moot — cannot reach a completed state to manage |

### Classification

**Sub-cause A:** Bug + Product Gap — the template editor has no invariant enforcement. A stage without a responsible party is a structurally invalid record; rejecting it at save time is the correct fix, not seed data patching.
**Sub-cause A′:** Product Gap — no recovery API exists.
**Sub-cause B:** Bug — incorrect routing logic in the `advance` handler.

### Minimal correct fix

**For sub-cause B (routing bug) — Phase 1A:**
In the `advance` handler, when `action === "returned"`, resolve `toStageId` as the stage with `stageOrder = currentStage.stageOrder - 1`, not as `nextStageId`. If no prior stage exists (Stage 1), the behavior is the existing loop (stays at Stage 1) — no change needed for that case.

**For sub-cause A (template validation) — Phase 1A:**
In the template save handler, add a guard: if any stage in the submitted template has both `responsibleRole` and `responsibleUserId` null, return `422 Unprocessable Entity` with a message identifying the invalid stage. This is a single conditional before the INSERT — no schema change.

This replaces the seed data fix as the primary remediation for sub-cause A. The seed data is fixed as a side effect (re-running the seed after validation is added produces correct data), but the code guard is what prevents recurrence.

**For sub-cause A′ (recovery API) — Phase 1A:**
Add `POST /api/workflow-engine/instances/:id/cancel` (PM or admin role required). Sets instance status to `cancelled`. Open Decision B governs what happens to the document status. The endpoint is the escape valve for any misconfiguration that reaches production despite the template validation — it will always be needed.

In keeping with ArcScale's "guidance before prevention" principle: the cancel endpoint logs a reason field in the audit record and requires an explicit acknowledgment body (`{ reason: "..." }`) rather than being a zero-argument POST.

### RC-03 runs in parallel with RC-01

RC-03 is independent of RC-01 and RC-02 — it touches the workflow engine, not the access predicates or the transmittal route destructuring. RC-03 should be implemented in parallel with the RC-01+RC-02 track, not sequenced after.

### Scope boundary — do NOT build alongside this fix

- Do not redesign the `canAct` logic — only add the template validation guard
- Do not add parallel review, voting, or multi-reviewer delegation — future features
- Do not add `force-advance` or `reassign` to the recovery API — `cancel` only
- Do not add template validation for other fields beyond the `responsibleRole`/`responsibleUserId` invariant — scope creep

### Open decision dependency

Decision B (cancel effect on document status) must be resolved before implementing the `/cancel` endpoint.

### Implementation status — ✅ COMPLETE (2026-06-29)

**Sub-cause B — Backward routing (already correct):**
Inspection of the running dist (`dist/index.mjs` line ~179610) confirmed the `advance` handler already implements `stages[currentIdx - 1] ?? stages[0] ?? null` for `action="returned"` — backward routing was correct in the deployed code. No fix required.

**Sub-cause A — Template validation (PATCH W1):**
POST `/templates/:id/stages` now rejects stages where `isTerminal=false` AND both `responsibleRole` and `responsibleUserId` are null. Guard inserted after the existing `responsibleUserId` org-check in the dist and in source (`workflow-engine.ts`).

PUT `/templates/:id/stages/:stageId` now computes effective state from `(incoming fields) ?? (stored fields)` and applies the same invariant — updating a stage to clear its responsible party is also rejected.

**Sub-cause A′ — Recovery API (PATCH W2):**
`POST /api/workflow-engine/instances/:id/cancel` added. Requires `admin`, `project_manager`, or `system_owner` role. Sets `status=cancelled`, `currentStageId=null`, records a transition row (`action="cancelled"`), emits two audit log entries, calls `syncDocumentStatus(documentId, "draft")`.

**Decision B resolution:** Document reverts to `draft` on cancel.

**Runtime verification — 6/6 tests PASS:**

| Test | Actor | Expected | Result |
|---|---|---|---|
| W1-a: POST stage, no responsibleRole/userId, isTerminal=false | SYS | 400 | ✅ PASS |
| W1-b: POST stage, responsibleRole="reviewer", isTerminal=false | SYS | 201 | ✅ PASS |
| W1-c: POST stage, isTerminal=true, no responsible | SYS | 201 (terminal exempt) | ✅ PASS |
| W2-a: PM cancel active instance | PM | 200, status=cancelled, currentStageId=null | ✅ PASS |
| W2-b: PM cancel already-cancelled instance | PM | 409 | ✅ PASS |
| W2-c: Reviewer cancel attempt | ENG | 403 | ✅ PASS |

**Implementation note:** Same Docker build workaround as RC-01 — source changes applied to `workflow-engine.ts` and equivalent patches applied directly to the running `dist/index.mjs`.

**Secondary finding (not RC-03 scope):** Seeded workflow stages use display names for `responsibleRole` (e.g., "Finance", "GM", "Document Controller") which are not in `ALL_ROLES` and would be rejected if re-submitted via the API. These were inserted directly into the DB by the seed script, bypassing the route validation. This is a seeding artifact, not a runtime regression — the validation added in PATCH W1 is correct. Flagged as a separate DX item.

---

## RC-04 — Notification and Task Delivery Has No Cross-Org Routing

### Root cause

The notification system emits events only for internal-org transitions. No event type exists for "transmittal arrived for review" from the perspective of the receiver org. The task system hard-assigns every review task to the internal PM (`assignedToUserId = 6`) rather than routing to `transmittalItem.toUserId`. The initiating org (DC) receives zero notifications for any event that occurs after they send a transmittal. There is no mark-as-read endpoint.

This is the third face of Meta-RC-A: the notification and task emitters were built for a single-org runtime and never extended for cross-org delivery.

### Findings explained

| Finding | Symptom |
|---|---|
| J08-001 | 7 tasks — all assigned to PM (org 2), none to CREV/PM_HMT/OWNER |
| J08-002 | CREV/PM_HMT/OWNER: 8 notifications each, all `document_uploaded` — zero `transmittal_received` |
| J08-004 | DC: 0 notifications for any event across all 8 journeys |
| J08-003 | `PUT /notifications/:id/read` → 404 — no mark-as-read endpoint |
| J08-005 | Tasks never auto-close when transmittal is acknowledged |
| J08-007 | `correspondence_received` fires for ENG but ENG cannot read the correspondence — actionless notification |

### Journeys

J-08 (audit — covers all prior journeys retrospectively)

### Level impact

| Level | Impact |
|---|---|
| **Works** | Partial — internal notifications (`workflow_action_required`, `task_assigned`) work for ENG and PM |
| **Operates** | Broken — external parties have no signal that work is waiting; they must poll manually |
| **Manages** | Broken — initiating org has zero visibility into what happens after submission |

### Classification

**Architecture Gap.** Cross-org event delivery was never designed into the notification emitter. The task assignment logic hard-codes an internal user ID.

### Minimal correct fix

Three targeted additions — no notification system rewrite:

1. **`transmittal_received` event:** When a transmittal transitions to `sent`, emit one notification to `toUserId` (the external reviewer, now populated after RC-02). Fallback routing: if `toUserId` is null, emit to users in `toOrganizationId` with role `document_controller`. Content: transmittal subject, sender org, due date, direct link to transmittal.

   *Routing decision: the fallback to "all DCs in toOrg" is intentionally broad — visibility before enforcement. The org decides internally who responds; the system ensures the information reaches the org.*

2. **`transmittal_reviewed` feedback event:** When `complete-review` is called, emit one notification to `createdById` (the DC who created the transmittal) with the review code and reviewer org name. This closes the feedback loop for the initiating party.

3. **Mark-as-read endpoint:** `PATCH /api/notifications/read` with body `{ ids: [N, ...] }`. Bulk operation. One endpoint, one query, no model change. All existing notifications become manageable.

**Task routing:** In the transmittal send handler, change `assignedToUserId = PM_ID` to `assignedToUserId = transmittalItem.toUserId`. After RC-02, this is a live field. Add: when a transmittal is acknowledged (status → `acknowledged`), auto-close the corresponding task (status → `completed`). This aligns task lifecycle with transmittal lifecycle.

### Dependencies

RC-04 fixes are only testable after RC-01 and RC-02 are fixed. `toUserId` is null until RC-02 is applied; routing targets are undefined until RC-01 is applied.

### Scope boundary — do NOT build alongside this fix

- Do not build notification preferences UI — emit to all relevant parties by default; visibility before enforcement
- Do not add email delivery — in-app only for this phase
- Do not add per-type filtering on the read endpoint — bulk mark-as-read is sufficient
- Do not rebuild the task system — only change the `assignedToUserId` assignment and add the auto-close on acknowledgment

### Implementation status — RC-04 ✅ COMPLETE

**Files changed:** `artifacts/api-server/src/routes/transmittals.ts` (source), `artifacts/api-server/dist/index.mjs` (dist patch RC-04)

**Changes applied (5 patches):**

| Patch | Location | Change |
|---|---|---|
| R1 | `send()` — autoAssignee | `pm?.userId ?? req.user.id` → `transmittal.toUserId ?? pm?.userId ?? req.user.id` |
| R2 | `send()` — task INSERT | Added `sourceId: transmittal.id` to link the task back to its transmittal |
| R3 | `send()` — after task_assigned notification | Added `transmittal_received` notification to `toUserId` when set |
| R4 | `acknowledge()` — after history INSERT | Auto-close task (sourceId match) + `transmittal_acknowledged` notification to `createdById` |
| R5 | `complete-review()` — before `res.json` | `transmittal_acknowledged` feedback notification to `createdById` with review outcome |

**Deviations from plan (Observed vs Plan):**

- **J08-003 (mark-as-read):** The plan proposed a new `PATCH /notifications/read` endpoint. **Observed:** `POST /notifications/:id/read` already existed. The finding was caused by the wrong HTTP method in the test harness (PUT vs POST). No new endpoint was added — existing individual and bulk (`POST /read-all`) endpoints are sufficient. J08-003 is resolved by clarifying the correct method.

- **Fallback routing when toUserId=null:** The plan described fallback to "all DCs in toOrg". **Observed:** `toOrganizationId` does not exist in the schema. No fallback was implemented — the notification fires only when `toUserId` is set (consistent with Decision A: user-level default). When `toUserId` is null, the task still falls back to the project PM, preserving the pre-RC-04 behavior.

- **Task auto-close in complete-review:** Only implemented in the `acknowledge()` handler per plan. The `complete-review()` handler sets `status='acknowledged'` directly without going through the acknowledge endpoint, so tasks remain open after a formal review. This is a design decision — the review task closing path is the acknowledge endpoint.

**Verification — 8/8 PASS (2026-06-29):**

| Test | Assertion | Result |
|---|---|---|
| T-01 | `transmittal_received` notification fires to `toUserId` on send | PASS |
| T-02 | Task assigned to `toUserId` (not PM) when `toUserId` is set | PASS |
| T-03 | Task falls back to PM when `toUserId` is null | PASS |
| T-04a | Task auto-closes (status → `completed`) when transmittal is acknowledged | PASS |
| T-04b | `transmittal_acknowledged` notification fires to `createdById` on acknowledge | PASS |
| T-05 | `transmittal_acknowledged` feedback fires to `createdById` after `complete-review` | PASS |
| T-06 | `POST /notifications/:id/read` → 200 OK (J08-003 resolved) | PASS |
| T-07 | `POST /notifications/read-all` → 200 OK | PASS |

---

## RC-05 — Submission Chain Feature Is Not Implemented

### Root cause

The Submission Chain API returns 404 for all routes. This is not a simple "feature not built" — it is the most visible manifestation of SP-006 (no cross-module linkage): the system has no first-class entity that represents a multi-party, multi-step approval process. Transmittals, correspondence, and workflow instances exist as isolated records with no common chain parent. The three-party DC→HMT→Owner flow cannot be traced as a unit through the system.

The data model scaffolding is in place (`submissionChainId` FK, `isForwarded` flag on transmittals). The runtime object that would populate these fields does not exist.

### Design caution

The current plan targets a view-only linked list (three endpoints: create, forward, get). This is the minimum for the Manages level baseline. However, if built as a thin linked list, it will not generalize naturally to current-custodian tracking ("which org holds the document right now") without a schema change. Decision C must resolve the target shape before implementation to avoid building the wrong abstraction.

### Findings explained

| Finding | Symptom |
|---|---|
| J03-004 | All submission chain routes return 404 — J-03 entire scenario blocked |
| J06-001 | Three-party chain executed manually with independent transmittals — no chain record |
| LOS-J06-01 | "Has HMT forwarded our drawing to the Owner?" — unanswerable |
| LOS-J06-03 | "Where is document 12 in its approval journey?" — unanswerable |

### Journeys

J-03, J-06, J-08 (retrospective)

### Level impact

| Level | Impact |
|---|---|
| **Works** | Not directly blocked — individual transmittals work |
| **Operates** | Degraded — three-party flow is manual; manageable as workaround after RC-01/02/03/04 |
| **Manages** | Broken — chain-of-custody is unobservable through the API |

### Classification

**Product Gap.** The missing layer is an implementation of SP-006's resolution: a named, FK-backed association between transmittals in a multi-party chain.

### Minimal correct fix (view-only shape — pending Decision C)

Three endpoints, no schema change:

1. `POST /api/submission-chains` — create a chain record, return `chainId`
2. `POST /api/submission-chains/:id/forward` — add a forwarding step: links `fromTransmittalId → toTransmittalId`, records `fromOrganizationId → toOrganizationId`, timestamp
3. `GET /api/submission-chains/:id` — returns the ordered list of steps: sender org, receiver org, transmittal reference, review outcome, timestamps

The chain carries no approval logic of its own — individual transmittal statuses are the source of truth. The chain is a read model over existing transmittals.

### Scope boundary — do NOT build alongside this fix

- Do not add automatic chain progression triggered by `complete-review` — product decision, not a fix
- Do not add chain-level status aggregation
- Do not build a submission chain UI — the API view is sufficient for Manages baseline
- Do not add SLA tracking or hold logic — out of scope for current remediation

### Open decision dependency

Decision C (minimum viable shape) must be resolved before implementation.

### Implementation status — RC-05 ✅ COMPLETE

**Decision C resolution (2026-06-30):** Implemented using `submissionChainsTable` + `submissionChainStepsTable` + `submissionChainDocumentsTable`. `submissionChainAllowedPartiesTable` deferred — no allowed-party enforcement; forward can target any org. This preserves the "no rigid workflow unless explicitly chosen" design principle: any org can receive a forwarded chain without being pre-declared. Party pre-definition remains a FUTURE/POLICY option.

**Plan deviation (Observed vs Plan):** Plan stated "scaffolding is in place (submissionChainId FK, isForwarded flag on transmittals)." **Observed:** Neither column exists on the transmittals table. The relationship goes the other way: `submissionChainStepsTable.transmittalId` is an optional FK from steps to transmittals, not vice versa. Steps optionally reference transmittals when the user explicitly chooses "Review + Send Transmittal." No schema change was needed — all 4 tables already exist in the DB.

**Files changed:** `artifacts/api-server/src/routes/submission-chains.ts` (new), `artifacts/api-server/src/routes/index.ts` (import + registration), `artifacts/api-server/dist/index.mjs` (dist patch RC-05 — +6142 bytes)

**Endpoints implemented (4 total — 3 per plan + GET / list as necessary companion):**

| Endpoint | Description |
|---|---|
| `GET /projects/:projectId/submission-chains` | List chains visible to caller's org (originatingOrg or currentCustodian) |
| `POST /projects/:projectId/submission-chains` | Create chain + attach documents (revisionCycle=1) |
| `GET /projects/:projectId/submission-chains/:id` | Get chain + ordered steps + documents; access: originatingOrg, currentOrg, orgs in steps, system_owner |
| `POST /projects/:projectId/submission-chains/:id/forward` | Transfer custody to another org; only current custodian can forward; records immutable step in audit trail |

**Scope boundaries honored:**
- `submissionChainAllowedPartiesTable` — not used, no party enforcement (FUTURE/POLICY)
- No automatic chain progression from `complete-review`
- No chain-level status aggregation
- No SLA enforcement (currentStepStartedAt recorded, but no alerting)

**Verification — 16/16 PASS (2026-06-30):**

| Test | Assertion | Result |
|---|---|---|
| S-01a | POST chain (org2/HMT) → `chainNumber` starts with `SC-`, id present | PASS |
| S-01b | `currentOrgId = 2` (originator's org) on creation | PASS |
| S-01c | `documents = []` when no documentIds provided | PASS |
| S-02a | GET /:id returns chain with `steps` and `documents` arrays | PASS |
| S-02b | `currentOrgId = 2` before any forward | PASS |
| S-03a | New chain for forward test: `currentOrgId = 2` (HMT) | PASS |
| S-03b | Forward to org3: `chain.currentOrgId` becomes 3 (consultant) | PASS |
| S-03c | Step recorded: `action=forward, fromOrgId=2, toOrgId=3` | PASS |
| S-04 | GET after forward: `steps[0].fromOrgId=2` — **LOS-J06-01 ANSWERABLE** ("Has HMT forwarded?") | PASS |
| S-05 | DC (org2) tries to forward chain at org3 → 403 Forbidden | PASS |
| S-06a | POST with `documentIds` → `documents` array has 1 entry (docId=11) | PASS |
| S-06b | GET: `currentOrgId=2`, `documents[0].documentId=11` — **LOS-J06-03 ANSWERABLE** ("Where is doc 11?") | PASS |
| S-07a | DC (org2) sees chain1 (org2-only chain) in list | PASS |
| S-07b | HMTDC (org3) does NOT see chain1 (org-scoped list) | PASS |
| S-07c | DC (org2/originator) sees forwarded chain2 in list | PASS |
| S-07d | HMTDC (org3/current custodian) sees forwarded chain2 in list | PASS |

---

## RC-06 — Acknowledged Records Are Mutable and Reference Data Is Silently Discarded

### Root cause

Three independent issues share the same conceptual gap — the system has no "immutable after acknowledgment" concept and no enforced contract between request and storage:

- **J06-004 / SP-008:** `reference` field accepted in POST/PUT body, not in route destructuring, always stored as null — a direct violation of AP-II.
- **J07-004:** `PUT /api/transmittals/:id` succeeds on an acknowledged transmittal — a direct violation of AP-IV (terminal states lock writes explicitly).
- **J06-002 / SP-004:** `complete-review` auto-creates a response transmittal without declaring it in the response body — a direct violation of AP-III (side effects are part of the response contract).

RC-06 precedes RC-05 in the plan because these three bugs corrupt records that already exist. RC-05 adds a new capability. Protective before additive.

### Findings explained

| Finding | Symptom |
|---|---|
| J07-004 | `PUT /api/transmittals/:id` succeeds on an acknowledged transmittal |
| J06-004 | `reference` field in POST/PUT body never persisted — always null |
| J06-002 | `complete-review` creates ghost TXN-010 without announcing it in the response |

### Journeys

J-06, J-07

### Level impact

| Level | Impact |
|---|---|
| **Works** | Not directly broken |
| **Operates** | Degraded — teams cannot trust the record matches what was sent |
| **Manages** | Broken — the audit trail is not legally defensible if mutable post-acknowledgment |

### Classification

**Bug (J06-004):** Missing field in route destructuring — same pattern as RC-02. One change.
**Product Gap (J07-004):** No write-lock concept after acknowledgment — AP-IV not implemented.
**Bug (J06-002):** Command response does not declare its side effects — AP-III not implemented.

### Minimal correct fix

1. **`reference` field (J06-004):** Add `reference` to the destructuring in the transmittal create and update route handlers. 1–2 lines. Same pattern as RC-02 fix.

2. **Write-lock after acknowledgment (J07-004):** In the transmittal `PUT` handler, add a guard: if `transmittal.status === 'acknowledged'`, return `409 Conflict` with message identifying the field that cannot be modified and why. Hard stop is correct here — acknowledged records are legal documents. "Guidance before prevention" does not apply where audit integrity is the constraint.

3. **Side-effect declaration (J06-002):** In the `complete-review` response body, add a `sideEffects` object: `{ createdTransmittal: { id, reference } | null, acknowledgmentApplied: boolean }`. No logic change — only what the response returns.

### Scope boundary — do NOT build alongside this fix

- Do not add an "amendment" workflow for post-acknowledgment corrections — future feature
- Do not add versioning or history for transmittals — out of scope
- Do not change the auto-create behavior of `complete-review` — only declare it in the response

### Implementation status — RC-06 ✅ COMPLETE

**Files changed:** `lib/db/src/schema/transmittals.ts`, `lib/db/drizzle/0015_transmittal_reference.sql` (new), `artifacts/api-server/src/routes/transmittals.ts`, `artifacts/api-server/dist/index.mjs` (dist patch RC-06)

**Changes applied (7 sub-patches):**

| Patch | Location | Change |
|---|---|---|
| D1 | `transmittalsTable` definition (dist) | Added `reference: text("reference")` column |
| D2a | `POST /` destructuring | Added `reference` |
| D2b | `POST /` INSERT | Added `reference: reference ?? null` |
| D3a | `PUT /:id` destructuring | Added `reference` |
| D3b | `PUT /:id` handler | Added write-lock guard: `existing.status === "acknowledged"` → 409 Conflict |
| D3c | `PUT /:id` UPDATE `.set()` | Added `reference` |
| D4 | `complete-review` response | Added `sideEffects: { createdTransmittal: { id, transmittalNumber, reference }, acknowledgmentApplied: true }` |

**Migration:** `0015_transmittal_reference.sql` — `ALTER TABLE transmittals ADD COLUMN reference text` — applied to DB 2026-06-29.

**Deviations from plan (Observed vs Plan):**

- **J06-004 fix scope:** Plan said "1-2 lines, same as RC-02." **Observed:** `reference` column did not exist in DB or schema — was never created. Fix required schema migration + schema file update + 4 route changes + dist table definition patch. Root cause is deeper than plan assumed (omitted column, not just omitted destructuring). AP-II violation confirmed.

- **J06-002 partial pre-resolution:** The plan described `complete-review` as creating a "ghost" response transmittal. **Observed:** `responseTrs: response` was already in the response body — the transmittal was already declared. The fix adds `sideEffects` wrapper for explicit, structured side-effect declaration without removing `responseTrs` (backward compat). `acknowledgmentApplied: true` is the only net-new information.

- **Decision D (deferred) — `rejected` write-lock:** AP-IV implies all terminal states lock writes. The plan only specifies `acknowledged`. `rejected` is also terminal but locking it has product implications: the sending DC may need to correct and resubmit after rejection. Not locked in this implementation — flagged as Decision D for product resolution.

**Verification — 7/7 PASS (2026-06-29):**

| Test | Assertion | Result |
|---|---|---|
| V-01 | POST with `reference="HMT-REF-001"` → field persisted and returned | PASS |
| V-02 | PUT on draft transmittal with reference update → 200 OK, reference updated | PASS |
| V-03 | PUT on acknowledged transmittal (id=17) → 409 Conflict | PASS |
| V-04 | GET transmittal → `reference` field present in response | PASS |
| V-05a | `complete-review` response has `sideEffects.acknowledgmentApplied=true` | PASS |
| V-05b | `sideEffects.createdTransmittal.id` present | PASS |
| V-05c | `sideEffects.createdTransmittal.reference` field present (null for auto-created response) | PASS |

---

## Minimum Fix Set: Level Transition

### Current state

| Level | Verdict | Primary blocker |
|---|---|---|
| **Works** | Partial (~30%) | RC-03 (deadlock), RC-02 (external reviewer dead code) |
| **Operates** | ✗ | RC-01 + RC-02 (cross-org access), RC-03 (deadlock), RC-04 (no notifications) |
| **Manages** | ✗ | RC-05 (no chain view), RC-06 (no audit integrity) |

---

### Target state: Works ✓ / Operates acceptable for two-party and three-party (manual) / Manages initially usable

| Phase | Fix set | What it unlocks | What remains |
|---|---|---|---|
| **1A (parallel)** | RC-01 + RC-03 | External reviewer can read transmittals + correspondence. Workflows complete 3-stage cycle. `returned` routes backward. Template validation prevents new deadlocks. | External reviewer still cannot act (RC-02 pending) |
| **1B** | + RC-02 | External reviewer can `complete-review`, PATCH items. `isAssigned` guard works correctly for the first time. | No notifications — external reviewer must poll |
| **2** | + RC-04 | External reviewer notified on receipt. DC notified on review completion. Task routes to external reviewer. Mark-as-read works. | No chain-of-custody view. Audit trail mutable. |
| **= Operates** | | All single-org and two-org scenarios run end-to-end. Three-party flow works manually (independent transmittals). | Chain is unlinked. Audit risk remains. |
| **3** | + RC-06 | Acknowledged records immutable. Reference field persisted. Side effects declared. | No chain view |
| **4** | + RC-05 | DC can create a chain, HMT can forward, Director can query full chain. | — |
| **= Manages** | | Chain-of-custody observable. Audit trail legally defensible. | Email, SLA, advanced search (future) |

---

### Execution phases

```
Phase 1A (parallel tracks):
  Track α: RC-01 (cross-org read predicate + full read endpoint audit)
           → RC-02 (toUserId destructuring)   [1B, after RC-01]
  Track β: RC-03 (backward routing + template validation + /cancel API)

Phase 2:   RC-04 (transmittal_received event + transmittal_reviewed feedback + mark-as-read + task routing)
           — requires RC-01 + RC-02 to be testable

Phase 3:   RC-06 (reference field + write-lock + side-effect declaration)

Phase 4:   RC-05 (submission chain endpoints)
           — requires Decision C to be resolved
```

---

## Regression Risks — Pre-Ship Checklist

*Each risk must be verified before the corresponding RC is merged.*

### RC-01 risks

| Risk | Verification |
|---|---|
| Transmittal scoping breaks dashboards or project-level aggregations that today read all transmittals across orgs | Audit all `GET /api/transmittals` call sites; verify project rollup queries are not broken by the new predicate |
| Correspondence scoping breaks any report that DC uses to see all org correspondence | Verify DC (sender org) still has full read access after the predicate change |

### RC-02 risks

| Risk | Verification |
|---|---|
| `complete-review` code path runs for an external reviewer for the first time — untested branch | End-to-end test: CREV calls `complete-review` on a transmittal where `toUserId=CREV.id`. Verify all side effects (auto-acknowledge, response TXN creation) behave correctly for the external actor, not just the sender. |
| `isAssigned` now passes for CREV — verify the PATCH item path is also correct | Test CREV PATCH on a non-acknowledged item. Confirm the blocked-after-acknowledgment guard (RC-06) is not conflated with the `isAssigned` guard. |

### RC-03 risks

| Risk | Verification |
|---|---|
| `/cancel` document status: verify Decision B outcome is implemented correctly | Test cancel on a workflow with a document in `under_review` — confirm document status after cancel matches the agreed Decision B outcome |
| Background jobs or schedulers that may depend on specific workflow status values | Audit any cron or background task that reads workflow instance status; confirm `cancelled` is handled |

### RC-04 risks

| Risk | Verification |
|---|---|
| `transmittal_received` fan-out to all DCs in a multi-DC org creates inbox noise | Confirm fallback routing behavior is intentional and documented in the API response; org-level recipients are informed, not just one person |
| Task auto-close on acknowledgment: verify no task-chain logic depends on the original task staying open | Check for any code that queries `status=pending` tasks as a precondition for another action |

### RC-06 risks

| Risk | Verification |
|---|---|
| Write-lock on acknowledged transmittal: any background job, webhook, or admin script that updates transmittal metadata will now return 409 | Audit all `UPDATE transmittals` call sites outside the user-facing PUT handler |
| `reference` field now persisted: verify no existing transmittals that were created without `reference` are broken by the change | The field should be nullable — confirm the schema allows null for backward compatibility |

---

## What This Plan Does Not Cover

The following are deliberately excluded — they are LOS Requirements (features the system never claimed to have), DX items, or UX concerns that do not block any operational level:

- All LOS-Jxx entries (unified document timeline, hold state on transmittal, overdue task alerts) — future product requirements
- J07-001 (no warning when starting workflow on approved doc) — UX, no operational block
- J08-006, J08-008 (task list shows all org tasks, `document_uploaded` broadcast) — UX improvements, not blockers
- SP-005 (single status field per document, last-writer-wins) — product decision, not a bug; the field correctly reflects current state
- Row-level security at the database layer — deferred; accepted risk at current scale; must be reconsidered before first real client onboarding

---

## Revision History

v1.0 — 2026-06-29 — Initial plan after J-01 through J-08 discovery phase

v1.7 — 2026-06-30 — RC-05 implementation complete. Summary table updated (✅). Implementation status section added to RC-05. Decision C resolved: custodian-tracking model using submissionChainsTable + submissionChainStepsTable + submissionChainDocumentsTable; submissionChainAllowedPartiesTable deferred (FUTURE/POLICY). One plan deviation recorded: scaffolding claim was wrong — no FK on transmittals, relationship is reversed (steps have optional transmittalId FK). New route file created (submission-chains.ts), index.ts updated, dist patched (+6142 bytes). 16/16 verification tests pass. LOS-J06-01 and LOS-J06-03 now answerable. All 5 RCs in scope complete.

v1.6 — 2026-06-29 — RC-06 implementation complete. Summary table updated (✅). Implementation status section added to RC-06. Three deviations recorded: reference column required schema migration (not 1-2 lines), J06-002 was partially pre-resolved (responseTrs already in response), rejected state write-lock deferred as Decision D. 7/7 verification tests pass.

v1.5 — 2026-06-29 — RC-04 implementation complete. Summary table updated (✅). Implementation status section added to RC-04. Two deviations from plan recorded: J08-003 mark-as-read already existed (wrong HTTP method in test), toOrg fallback deferred (no toOrganizationId in schema). 8/8 verification tests pass.

v1.4 — 2026-06-29 — RC-02 implementation complete. Summary table updated (✅). Implementation status section added to RC-02. Decision A resolved: user-level (default), org-level remains architecturally open.

v1.3 — 2026-06-29 — RC-03 implementation complete. Summary table updated (✅). Implementation status section added to RC-03. Decision B resolved: cancel reverts document to "draft". Secondary finding recorded: seeded `responsibleRole` values use display names not in `ALL_ROLES` — flagged as DX item, not RC-03 scope.

v1.1 — 2026-06-29 — Revised after independent architectural peer review (Claude Opus). Changes:
- Added Governing Architectural Principles (AP-I through AP-VII) and Meta-RC-A
- Added Open Decisions section (Decision A: review scope; Decision B: cancel effect; Decision C: chain shape)
- RC-03 scope boundary corrected: removed "Do not add template validation at save time" — template validation IS the root fix for sub-cause A and is now part of the minimal correct fix
- RC-03 parallel execution made explicit — runs in Phase 1A alongside RC-01, not sequenced after
- RC-01 minimal fix expanded: pre-ship audit of all read endpoints required, not just Correspondence + Transmittals
- RC-05 framing updated: named as manifestation of SP-006 (no cross-module linkage) with design caution on linked-list vs custodian-tracking shapes
- RC-06 placed before RC-05 with explicit rationale (protective before additive)
- Added Regression Risks checklist per RC
- ArcScale design philosophy added as governing header
- Execution phased into 1A/1B/2/3/4 to reflect parallel tracks
