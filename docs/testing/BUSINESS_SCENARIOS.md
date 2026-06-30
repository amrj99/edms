# Business Scenario Testing — ArcScale EDMS

> **Purpose:** Validate ArcScale as a real operational system, not as a collection of modules.
> Each scenario is a cross-module work journey as it actually happens on a construction project.
>
> **What this is not:** Unit tests. Module-level smoke tests. Coverage metrics.
>
> **What we are testing:**
> - That the system supports real workflows end-to-end
> - That flexibility is preserved (system guides, does not block)
> - That the user always knows what is happening (or that we identify when they don't)
> - That the system helps users make good decisions without imposing them

---

## Execution Methodology

### The Three Operational Levels

Every step is evaluated at three levels. Passing Level 1 alone does not mean the scenario succeeded.

**Level 1 — Works** *(Did it execute correctly?)*
- Did the operation succeed without errors?
- Was the data saved correctly to the database?
- Did the workflow transition to the correct state?
- Did the system do what it was supposed to do?

**Level 2 — Operates** *(Can a real employee use this daily?)*
- Does the user know immediately what to do next — without training?
- Did they find what they needed in the place they expected?
- Did they have to navigate through multiple pages to complete one action?
- Could they repeat this process confidently one month from now with no help?

**Level 3 — Manages** *(Can leadership make decisions from this?)*
- Can the Project Manager know where work is stalled — in under 10 seconds?
- Can the DC see what is waiting for them vs. what is waiting for others?
- Can the Company Director assess project document health without clicking through multiple screens?

> A scenario that passes Level 1 but fails Level 2 has a **UX** or **LOS-REQ** finding.
> A scenario that passes Levels 1–2 but fails Level 3 has a **LOS-REQ** or **DX** finding.
> Both matter. Neither is acceptable in a production EDMS.

### The Four Questions

At every step of every scenario, evaluate the system from four angles simultaneously:

1. **Technical correctness** — Did the operation succeed? Is the DB state correct?
2. **UX fluency** — Was the interaction natural? Did the user have to hunt for the action?
3. **Information availability** — Is the information the user needs present, in the place they would expect it?
4. **Decision support** — Does the system help the user choose the right path without forcing it?

### The Three Persona Tests

After completing each scenario phase, pause and ask these questions from each human perspective:

**Document Controller** *(works 8 hours/day, manages 50+ documents)*
> "If I opened ArcScale right now, would I immediately know what I need to do today? Or would I have to click through several pages to find what's waiting for me?"

**Project Manager** *(checks status 3-4 times/day, not in the system constantly)*
> "In under 10 seconds, can I tell where the work has stopped and why? Or do I need to open each item individually?"

**Company Director** *(checks once/week, no patience for navigation)*
> "Without moving between pages, can I understand the current health of this project's document flow? Or is that knowledge scattered across 5 different screens?"

If the answer to any of these is "no" — record it. That "no" is the specification for Live Operational State.

### The Fresh Eyes Rule

Execute every journey as if the system is unknown to you.

Do not use your knowledge of the codebase to skip or shortcut steps. If completing a scenario requires a step not written in the script — record it immediately. That unscripted step is data, not an error in the script.

Specifically, record whenever:
- An unscripted action was required to complete a scripted step
- Information needed to proceed was located on a different page
- It was necessary to backtrack more than once to understand the current state
- An assumption about where something would be turned out to be wrong

These are not necessarily bugs. They reveal real friction — the difference between a system that an expert can operate and a system that a new employee can operate on day two.

### The No-Fix Rule

**Nothing is fixed during scenario execution.**

When a bug, gap, or improvement opportunity is discovered:
1. Record it in the Findings Log with ID, description, classification, and impact
2. Explain what the user experiences as a result (not just the technical gap)
3. Continue the scenario to completion

Fixing during execution contaminates the test. The complete picture, after all scenarios run, determines priority — not the order in which findings appear.

### The Decision Freeze Rule

**No new feature or design change is implemented because it seemed like a good idea during a scenario.**

When a new idea or apparent improvement appears during execution, record it — then apply three filters before it can enter any implementation scope:

1. Does it solve a problem that *actually appeared* during the scenario — or is it an improvement that just occurred to us?
2. Would it benefit most users of this module — or is it a special case?
3. Would it have prevented a journey failure or measurably shortened the workflow?

If any answer is "no" — it stays in FUTURE or ARCH and does not enter the current release.

This rule exists because the most dangerous moment in product development is when a working test session generates creative momentum. Good ideas at the wrong time are a form of scope creep.

### Finding Impact Levels

| Level | Meaning |
|---|---|
| **P1 — Blocking** | The user cannot complete the action. The workflow stops. |
| **P2 — Degraded** | The user can complete the action but with workarounds or confusion. |
| **P3 — Invisible** | The system works but the user lacks context to use it confidently. |
| **P4 — Suboptimal** | Everything works, but a better path exists that the system doesn't surface. |

### Two Types of Debt

Not all gaps are the same kind of problem. Distinguish always:

**Technical Debt**
The code, structure, or data model has a problem. The implementation needs to change.
*Examples: fragile API helper, missing index, inconsistent state machine, untested edge case.*

**Product Debt**
The code is correct but the product makes the user's job harder than it needs to be.
No code is broken — the experience is broken.
*Examples: DC needs 4 clicks to find their pending reviews, PM cannot see who is blocking a transmittal, Director has no overview without navigating 5 pages.*

> Product Debt does not appear in code reviews. It only appears when real people use the system to do real work. This is exactly why these scenarios exist.

Record both types in the Findings Log. They have different owners and different fix strategies — Technical Debt is a developer problem, Product Debt is a product design problem.

---

## Actors

All scenarios use the project **HMT-ABC** (Al-Benna Construction Co.).

| Actor | Role | Org |
|---|---|---|
| `dc@contractor.local` | Document Controller | Contractor |
| `engineer@contractor.local` | Engineer / Initiator | Contractor |
| `reviewer@consultant.local` | Document Reviewer | Consultant |
| `pm@consultant.local` | Project Manager | Consultant |
| `approver@owner.local` | Owner Representative | Owner |

Test users **must not exist in production**. Create in dev/staging only.

---

## Finding Classification

Whenever something unexpected is discovered during a scenario, classify it — do not fix it immediately.

| Code | Meaning |
|---|---|
| **BUG** | System behaves incorrectly — wrong data, wrong state, crash, or operation fails |
| **UX** | Correct behavior but the experience is confusing, missing feedback, or requires unnecessary steps |
| **POLICY** | Behavior depends on an org configuration decision; not inherently right or wrong |
| **FUTURE** | Logical evolution, not needed now, no current user pain |
| **LOS-REQ** | Moment where the user needs "what is happening right now" and the system does not surface it clearly |
| **DX** | Decision Experience gap — the system allows multiple valid paths but gives the user no guidance on which is appropriate for their situation |
| **ARCH** | Architectural Observation — a structural pattern, duplication, missing contract, or simplification opportunity that may shape future design decisions |

**DX explained:** DX findings are not bugs and not UX gaps. The feature works correctly. The problem is that the user faces a fork — same revision or new revision? restart workflow or create transmittal? — and the system offers no context to help them decide. ArcScale should guide without blocking. DX findings identify where that guidance is missing.

**ARCH explained:** ARCH findings are not actionable immediately. They are observations about the system's structure — repeated logic across modules, a missing shared contract, an opportunity to unify multiple interfaces, or a simplification that wouldn't change behavior. These are preserved during testing so they don't get lost. They inform future architecture decisions, not the current sprint.

Collect all findings in the Findings Log at the end of this document.
Do not implement anything until all scenarios are complete.

---

## Execution Order

```
J-01  →  J-02  →  J-03
 ↑         ↑         ↑
 │    builds on J-01  builds on J-01/J-02
 │
 └→  J-04  (parallel flexibility branch)
 └→  J-05  (correspondence mid-flight)
 └→  J-06  (three-party chain — needs J-01 complete first)
 └→  J-07  (flexibility matrix — independent)
 └→  J-08  (tasks + notifications audit — runs last, draws on all previous)
```

Execute J-01 first. J-04, J-05, J-07 can run in any order after J-01.
J-06 requires Consultant org to be active, run after J-03.
J-08 is a retrospective — run at the end.

---

## J-01: Standard Full Journey — Upload → Approval → External Submission

**Story:** Contractor uploads a drawing, it goes through internal approval, then gets submitted to the Consultant for review. Everything works as expected.

**Why this first:** This is the happy path. It establishes baseline behavior for every other scenario.

**Actors:** `dc@contractor.local`, `engineer@contractor.local`, `reviewer@consultant.local`

### Steps

**Phase A — Document Upload**

1. `dc` uploads new document: Structural Drawing SD-001, Rev 01, type "drawing", discipline "Structural"
2. `dc` fills metadata fields (document number, revision, discipline)
3. Verify: document appears in project Documents tab with status `draft`

**Phase B — Internal Workflow**

4. `dc` opens "Start Workflow" dialog, selects SD-001
5. Selects template "Drawing Approval Workflow", confirms
6. Verify: `wf_instances` row created with `status = active`
7. `engineer@contractor.local` sees Task in their task list
8. `engineer` opens document, reviews, clicks "Advance"
9. Verify: Task for engineer closes; Task for next stage reviewer opens
10. Stage 2 reviewer advances → Workflow completes
11. Verify: `wf_instances.status = completed`; `documents.status` changes

**Phase C — External Transmittal**

12. `dc` creates new Transmittal, subject "SD-001 Rev 01 for Review"
13. Adds SD-001 to Transmittal items
14. Sets recipient org to "Consultant"
15. `dc` sends Transmittal
16. Verify: `transmittals.status = sent`; `transmittal_items` row linked to SD-001
17. `reviewer@consultant.local` sees Task or notification

**Phase D — Consultant Review**

18. `reviewer` opens Transmittal, sees SD-001 in items list
19. `reviewer` sets Review Code = **A** (Approved) on SD-001
20. `reviewer` submits review
21. Verify: `transmittals.status = acknowledged`; `transmittals.reviewOutcome = A`
22. Verify: SD-001 document status updated by `applyDocumentReviewDecision`
23. `dc` sees notification or can see updated Transmittal status

### DB Checkpoints

| Table | Expected state at end |
|---|---|
| `wf_instances` | 1 row, `status = completed` |
| `wf_instance_transitions` | N rows covering all stage advances |
| `transmittals` | 1 row, `status = acknowledged`, `reviewOutcome = A` |
| `transmittal_items` | 1 row, `reviewCode = A` |
| `documents` | `status` reflects Code A outcome |
| `tasks` | All tasks `status = closed` |

### LOS-REQ Moments to Record

- After step 3: does `dc` know the document is "waiting to be submitted to workflow"?
- After step 6: does the Workflow stage owner know "I have an action pending"?
- After step 16: does `dc` know "the Transmittal is out with the Consultant"?
- After step 20: does `dc` know "the Consultant has reviewed and it's Code A"?

### Expected Findings

- Notification delivery to `reviewer@consultant` (may need email/SMTP configured) → record if missing as **UX** or **BUG**
- Task auto-close on workflow advance → verify works, or **BUG**
- `applyDocumentReviewDecision` result on doc status → verify, or **BUG**
- Whether a Response Transmittal auto-generates → **POLICY** (currently not mandatory)

---

## J-02: Internal Rejection → Correction → Resubmission (Same Revision)

**Story:** The internal reviewer rejects the drawing. The DC corrects it and starts a new workflow on the same revision — no revision bump required.

**Why this tests flexibility:** The system must not force the DC to increment the revision number just because a workflow was rejected. Same document, corrected, new workflow.

**Builds on:** J-01 structure, but with rejection path.

**Actors:** `dc@contractor.local`, `reviewer@contractor.local` (internal)

### Steps

**Phase A — Workflow with Return then Rejection**

1. DC uploads new doc SD-002 Rev 01
2. DC starts internal Workflow
3. Stage 1 reviewer clicks "Return" with comment: "Missing load calculations"
4. Verify: `wf_instances` returns to Stage 1 (or back to initiator — check behavior)
5. Verify: B-1 fix is working — no spurious error toast on Return
6. DC re-reads comment, acknowledges
7. Workflow resumes → Stage 1 again → reviewer clicks "Reject" with comment
8. Verify: `wf_instances.status = rejected`; `documents.status` reverts to `draft`

**Phase B — Correction Without Revision Bump**

9. DC uploads a corrected file to SD-002 Rev 01 (same revision, new file)
10. Question: Does the system allow replacing the file on an existing revision?
11. If yes: document is updated, revision number unchanged → proceed
12. If no: record as **POLICY** (forced revision increment)

**Phase C — New Workflow on Same Revision**

13. DC opens "Start Workflow" dialog, searches for SD-002
14. Verify B-2 fix: SD-002 appears in results with prior history notice "rejected (Drawing Approval Workflow)"
15. DC starts new workflow instance on SD-002 Rev 01
16. Verify: new `wf_instances` row created (different id, same `documentId`)
17. Workflow proceeds to completion
18. Verify: both instances exist in DB — history preserved

### DB Checkpoints

| Table | Expected state at end |
|---|---|
| `wf_instances` | 2 rows for SD-002: first `rejected`, second `completed` |
| `wf_instance_transitions` | Transitions for both instances |
| `documents` | `status = approved` (after second workflow completes) |

### LOS-REQ Moments to Record

- After step 8: where can the DC see "this document was rejected and needs correction"? Is `documents.status = draft` enough context?
- After step 13: B-2 notice helps, but does the DC also know WHICH stage rejected it?
- After step 15: does the DC know they now have an active workflow running again?

### Expected Findings

- Whether file replacement on same revision is supported → **POLICY** or **FUTURE**
- Whether "Return" behavior (goes back to which stage?) is correct → may be **BUG** or **POLICY**
- B-1 and B-2 fixes verified in real usage → **BUG** (should confirm fixed)
- History panel: does it show both instances? → **UX** if not

---

## J-03: External Rejection (Code C) → New Revision → Resubmission

**Story:** Consultant returns Code C (Revise and Resubmit) on a document. DC creates a proper Revision 02, runs workflow on it, then submits again through a Submission Chain.

**Why this tests flexibility:** The system must support starting a Submission Chain after the fact, or adding to one. Revision increment is the DC's choice.

**Builds on:** J-01 (SD-001 is approved and submitted). Use SD-001 as the base.

**Actors:** `dc@contractor.local`, `reviewer@consultant.local`

### Steps

**Phase A — Create a New Scenario: Code C on SD-003**

1. DC uploads SD-003 Rev 01, starts workflow → workflow completes
2. DC creates Transmittal TXN-002, adds SD-003, sends to Consultant
3. `reviewer` sets Code C on SD-003, submits review
4. Verify: SD-003 document status reflects Code C ("for_revision" or equivalent)
5. Verify: `transmittals.reviewOutcome = C`

**Phase B — Create Revision 02**

6. DC goes to SD-003 → creates Revision 02 (new `document_revisions` row)
7. Uploads corrected file for Rev 02
8. Question: Does Rev 02 automatically get status `draft`, independent of Rev 01?
9. DC adds comments/notes to explain the revision

**Phase C — Workflow on Rev 02**

10. DC starts Workflow on SD-003 Rev 02
11. Workflow completes → Rev 02 status = `approved`
12. Verify: Rev 01 status unchanged (system preserves history)

**Phase D — Resubmission via Submission Chain**

13. DC creates a Submission Chain (or adds to existing chain for SD-003)
14. DC creates Transmittal TXN-003, adds SD-003 Rev 02
15. Links TXN-003 to the Submission Chain
16. Verify: `submission_chain_steps` shows TXN-002 (Rev01 attempt) and TXN-003 (Rev02 attempt)
17. Verify: `revisionCycle` value — does it indicate this is the second attempt?
18. DC sends TXN-003 → Consultant reviews → Code A
19. Verify: SD-003 Rev 02 status updated

### DB Checkpoints

| Table | Expected state at end |
|---|---|
| `document_revisions` | 2 rows for SD-003: Rev01 (Code C), Rev02 (approved) |
| `submission_chain_steps` | 2 steps: TXN-002 and TXN-003 |
| `transmittals` | TXN-002 (`reviewOutcome = C`), TXN-003 (`reviewOutcome = A`) |

### LOS-REQ Moments to Record

- After step 5: can the DC see "SD-003 is waiting for revision" clearly? On what screen?
- After step 12: can anyone see that Rev 01 and Rev 02 are different, and that Rev 01 was rejected?
- After step 16: is the Submission Chain history visible to the Consultant so they know "this is a second attempt"?

### Expected Findings

- Whether Submission Chain can be created retroactively → **POLICY** or **BUG**
- Whether `revisionCycle` auto-increments or needs manual input → **POLICY**
- Rev 01 vs Rev 02 visibility in Transmittal: which revision does the Consultant see? → **UX**
- Does the Consultant receive context that this is a resubmission? → **LOS-REQ**

---

## J-04: Transmittal Without Internal Workflow

**Story:** DC submits a drawing directly to the Consultant without running an internal workflow first. This must be allowed — the system guides, does not block.

**Why this tests flexibility:** Some projects do not require internal approval before external submission. The system must support this.

**Actors:** `dc@contractor.local`, `reviewer@consultant.local`

### Steps

1. DC uploads new doc SD-004 Rev 01 (status = `draft`)
2. DC creates Transmittal TXN-004, adds SD-004
3. DC sends TXN-004 — **no workflow has been run**
4. Question: Does the system allow this? Or does it warn? Or does it block?
5. Record result:
   - Allowed without warning → **POLICY** (is this correct behavior for this org?)
   - Allowed with warning "document has no approved workflow" → **UX** (good behavior)
   - Blocked → **BUG** (violates flexibility principle)
6. `reviewer` reviews → Code B
7. Verify: SD-004 status updated; transmittal acknowledged
8. After external review, DC decides to run internal workflow:
9. DC starts internal Workflow on SD-004 Rev 01 post-submission
10. Question: Is there any constraint preventing this? → record result

### LOS-REQ Moments to Record

- After step 3 (if allowed): can `dc` tell that SD-004 was submitted without internal approval?
- From Consultant's perspective: can `reviewer` see that SD-004 has no internal workflow history?

### Expected Findings

- Whether the system blocks or warns on transmittal without workflow → **POLICY** classification
- Whether running workflow after transmittal causes any state conflicts → **BUG** or **POLICY**
- Whether there is a "submission status" independent of workflow status → **LOS-REQ**

---

## J-05: Correspondence Mid-Flight — RFI During Transmittal Review

**Story:** Consultant receives a transmittal for review but has a question before they can complete their review. They raise an RFI (Correspondence) to the Contractor. The Contractor responds. Only then does the review continue.

**Why this matters:** Tests cross-module linkage. Correspondence should interrupt/augment the transmittal flow without breaking it.

**Actors:** All five actors

### Steps

**Phase A — Setup: Transmittal Sent**

1. DC sends TXN-005 with SD-005 to Consultant
2. `reviewer` receives Task to review

**Phase B — RFI Raised**

3. `reviewer` creates new Correspondence, type "RFI"
4. Links Correspondence to SD-005 (the document in question)
5. Sets assignee to `engineer@contractor.local`
6. Sets due date (5 business days)
7. Verify: Task created for engineer
8. Verify: Notification sent to engineer
9. Verify: Is there any linkage visible between TXN-005 and this Correspondence?

**Phase C — Response**

10. `engineer` receives Task, opens Correspondence
11. Engineer writes response, uploads supporting file
12. Engineer marks Correspondence as "resolved" or "closed"
13. Verify: `correspondence.status = closed`
14. Verify: Task for engineer closes

**Phase D — Review Resumes**

15. `reviewer` sees that RFI is resolved
16. `reviewer` completes review of TXN-005 with Code A
17. Verify: SD-005 status updated; TXN-005 acknowledged

### LOS-REQ Moments to Record

- After step 9: can anyone (DC, PM) see that "TXN-005 is on hold because an RFI is open"?
- After step 12: does `reviewer` get notified that the RFI was answered?
- After step 17: is there a unified view showing "SD-005 had an RFI, it was answered, then it was approved"?

### Expected Findings

- Whether Correspondence can be linked to both a document and a transmittal → **UX** or **BUG**
- Whether Task for engineer auto-closes when Correspondence closes → **BUG** if not
- Whether `reviewer` gets a notification when RFI is resolved → **UX** if not
- The "hold" concept (transmittal waiting on RFI) → **LOS-REQ** (no current tracking)

---

## J-06: Three-Party Submission Chain — Contractor → Consultant → Owner

**Story:** Full multi-org round trip. Contractor submits to Consultant, Consultant forwards to Owner for final approval, Owner responds, response propagates back.

**Why this is important:** This is the real-world scenario for major project deliverables. Tests `submission_chains`, multi-org transmittals, and response chaining.

**Actors:** All five actors

### Steps

**Phase A — Contractor → Consultant**

1. DC creates SD-006 Rev 01, runs internal workflow → approved
2. DC creates Submission Chain for SD-006
3. DC creates TXN-006, adds SD-006, sends to Consultant
4. `submission_chain_steps`: Step 1 recorded

**Phase B — Consultant → Owner (Forward)**

5. `pm@consultant.local` receives TXN-006
6. PM decides to forward to Owner for final approval
7. PM creates TXN-007, adds SD-006 (same doc), recipient = Owner org
8. Links TXN-007 to same Submission Chain
9. PM sends TXN-007
10. `submission_chain_steps`: Step 2 recorded
11. Verify: `currentOrgId` in chain reflects Owner now holds the document

**Phase C — Owner Review**

12. `approver@owner.local` receives TXN-007
13. Owner reviews → Code A
14. Response Transmittal auto-generated (or Owner creates manually)
15. Response sent back to Consultant

**Phase D — Consultant Response to Contractor**

16. `pm@consultant.local` receives Owner's Code A
17. PM creates response Transmittal TXN-008 back to Contractor
18. Sends with Code A outcome forwarded
19. `dc` receives notification
20. DC reviews TXN-008 response — SD-006 Code A confirmed

### DB Checkpoints

| Table | Expected state at end |
|---|---|
| `submission_chains` | 1 chain for SD-006 |
| `submission_chain_steps` | 4 steps: TXN-006, TXN-007, response from Owner, TXN-008 |
| `transmittals` | TXN-006, TXN-007, TXN-008 all `acknowledged` |

### LOS-REQ Moments to Record

- After step 9: can `dc` see that "SD-006 is currently with the Owner"?
- After step 13: can `pm@consultant` see that "Owner has approved — I need to notify Contractor"?
- At any point: is there a view showing the full chain history (who held it when, with what outcome)?
- After step 20: can `dc` see the complete journey: Contractor → Consultant → Owner → Consultant → Contractor?

### Expected Findings

- Whether `currentOrgId` exists and is maintained in `submission_chains` → **BUG** if not
- Whether response transmittal is auto-generated or must be manual → **POLICY**
- Whether the chain is visible as a timeline/trail anywhere in the UI → **LOS-REQ**
- Whether the Contractor can see that their doc went to the Owner (visibility across orgs) → **POLICY**

---

## J-07: Flexibility Matrix — Eight Boundary Cases

**Story:** Eight targeted tests of the flexibility principle. Each is short and focused. They do not need to follow J-01 sequence. Run them independently.

**For each case:** run the action and record whether the system allows / warns / blocks, then classify.

### F-01: Workflow on already-approved document

- Take a doc with `status = approved`
- Attempt to start a new Workflow on it
- **Expected:** Allowed (no block). History notice shows previous workflow.
- **Record:** B-2 notice fires? System warns? Blocks?

### F-02: Transmittal with document in active workflow

- Take a doc with an active `wf_instance` (status = active)
- Attempt to add it to a Transmittal and send
- **Expected:** Allowed with possible warning (doc is still in review)
- **Record:** Blocked = **BUG** (violates flexibility). Warning only = **POLICY**.

### F-03: Return in Workflow — multiple times

- Start Workflow, advance to Stage 2, Return to Stage 1, advance again, Return again
- Verify system handles multiple returns on the same instance
- **Record:** Any error, wrong stage, or data corruption = **BUG**

### F-04: Reject mid-chain (Workflow inside active Submission Chain)

- SD-006 is in an active Submission Chain
- Internal reviewer rejects the document's workflow
- **Record:** Does the rejection affect the Submission Chain? Should it? → **POLICY**

### F-05: Transmittal with mixed document statuses

- Create Transmittal with 3 docs: one `draft`, one `approved`, one `rejected`
- **Expected:** All three can be added (no filter by status)
- **Record:** If any status prevents adding → **POLICY** or **BUG**

### F-06: Reopen acknowledged Transmittal

- TXN acknowledged, review complete
- Attempt to add a new item or change a review code
- **Expected:** Blocked (acknowledged is terminal)
- **Record:** If allowed → **BUG**. If blocked with no explanation → **UX**.

### F-07: Correspondence without document link

- Create Correspondence with no linked document — just free-standing
- **Expected:** Allowed (Correspondence is its own module)
- **Record:** System forces document link? → **POLICY** or **BUG**

### F-08: Submission Chain — add step after chain is "complete"

- A chain where the final response was received
- Attempt to add a new Transmittal to the same chain (e.g., amendment)
- **Expected:** Allowed (no terminal lock — flexibility)
- **Record:** Blocked? → **POLICY** (may be correct). Allowed silently? → **UX** (no indicator of amendment).

---

## J-08: Tasks and Notifications Retrospective Audit

**Story:** After running J-01 through J-07, audit the complete Tasks and Notifications state. This is not a new scenario — it is a review of what the previous scenarios generated.

**Run last.**

### Tasks Audit

For each actor, open their task list and verify:

| Actor | Expected open tasks at end | Expected closed tasks |
|---|---|---|
| `dc` | 0 (all workflows complete) | All prior workflow + transmittal tasks |
| `engineer` | 0 | Prior workflow stage tasks + RFI response task |
| `reviewer@consultant` | 0 | All review tasks |
| `pm@consultant` | 0 | Forward/chain tasks |
| `approver@owner` | 0 | Owner review task |

**Questions:**
1. Do tasks from completed workflows appear in a closed/historical view?
2. Can a user see tasks across all projects they're in?
3. Are task descriptions meaningful ("Review SD-003 Rev 01 — Stage 2") or generic ("You have a task")?
4. Is there a due date on any task? Who sets it?

### Notifications Audit

Review notification log for each actor:

| Event | Expected notification |
|---|---|
| Workflow stage opens for you | `workflow_action_required` |
| Your workflow stage is done | `workflow_stage_complete` |
| Workflow completed | DC and initiator: `workflow_completed` |
| Workflow rejected | DC and initiator: `workflow_rejected` |
| Transmittal sent to your org | `transmittal_for_review` |
| Transmittal review complete | DC: `transmittal_reviewed` |
| Correspondence assigned | Assignee: `correspondence_assigned` |
| RFI response received | Raiser: notification? |

**Questions:**
1. Which of these notifications actually exist in the system?
2. Are they delivered in-app, by email, or both?
3. Can a user mark notifications as read?
4. Do notifications contain a direct link to the relevant entity?
5. Is there a notification for overdue tasks?

### LOS-REQ Moments from This Audit

- Is there a "My Work" page that shows: my open tasks + my pending reviews + my awaiting responses — all in one place?
- Can a DC see: "These 3 documents have no active workflow and no transmittal — they are sitting idle"?
- Can a PM see: "These 2 transmittals have been with the Consultant for 7 days with no action"?

---

## Post-Journey Report Template

After completing each journey (J-01 through J-08), produce a report using this fixed structure.
The report is the deliverable — not the steps themselves.

---

### Journey J-XX: [Name] — Report

**Execution date:** YYYY-MM-DD
**Levels reached:** Works ✓/✗ | Operates ✓/✗ | Manages ✓/✗

**Operational Cost:**
| Metric | Count | Notes |
|---|---|---|
| Clicks to complete | — | Total clicks from start to final confirmation |
| Pages visited | — | Distinct pages navigated during the journey |
| Context switches | — | Times the user had to leave the current task to find information elsewhere |
| User decisions required | — | Forks where the system offered no guidance on the right choice |
| Read/interpret moments | — | Times the user had to pause and read labels, states, or tooltips before proceeding |

*A high click count is not inherently bad. A high context-switch count usually is. Record with notes — numbers without context are misleading.*

---

#### 1. What Worked
*Operations that succeeded at all three levels — technically correct, usable daily, and informative for decision-making.*

#### 2. What Failed
*Operations that did not complete, produced wrong data, or left the system in an incorrect state. BUG findings.*

#### 3. What Confused the User
*Operations that technically worked but left the DC or Reviewer uncertain about what happened or what to do next. UX and DX findings.*

#### 4. What Confused the Manager
*Moments where a PM or Director could not quickly understand project status, who holds what, or what is overdue. LOS-REQ findings at Level 3.*

#### 5. What This Revealed About Live Operational State
*The specific "I cannot answer this question" moments encountered. Becomes direct input to the LOS Requirements Log.*

#### 6. What This Revealed About System Flexibility
*Did the system allow every valid path? Were there unexpected blocks or warnings? Were POLICY decisions hiding as BUGs or vice versa?*

#### 7. What This Revealed About Architecture
*Structural observations: repeated patterns, missing contracts, module coupling, simplification opportunities. ARCH findings.*

---

#### 9. The New User Test

*Answer this before writing the report. It measures product maturity more honestly than any technical metric.*

> "If we handed this exact scenario to a user who had never seen ArcScale before, would they complete it successfully — without any explanation from us?"

**If yes:** Note which parts were self-evident and why.

**If no:** Identify every point where the system required human explanation to proceed:
- What did the user not know how to find?
- What label, button, or concept was ambiguous?
- What did the system not tell them that they needed to know?

These points are not UX findings in the conventional sense. They are gaps between the system's internal logic and the mental model a new employee brings on day one. A mature product closes that gap. Record them under this section — they feed directly into onboarding design and LOS requirements.

---

#### 8. Would We Design This the Same Way?

*The long-term investment question. Answer honestly after experiencing the journey as a real user.*

> "If we were starting ArcScale from zero today, knowing what this scenario revealed, would we design this part the same way?"

**If yes:** State which design decisions were confirmed correct and why. These become protected architectural principles.

**If no:** Record:
- What would we design differently?
- Why — what did the scenario reveal that the original design didn't account for?
- Is this a local improvement (affects only this module) or systemic (affects the whole architecture)?
- Does it warrant redesign now, or is it deferred until after first customers?

*Do not start redesigning. Record only. The answer to this question across all journeys becomes the input to the architectural roadmap.*

---

*This structure is fixed across all journeys to enable comparison and trend analysis across the full test run.*
*Sections 1–8 are written in order. Section 9 (New User Test) is answered before writing Sections 1–8 — it sets the lens.*

---

## Observed vs. Hypothesis

Every finding must be marked as one of these two types:

**Observed** — Something that actually happened during execution. A button that did not respond. A state that was wrong in the DB. A page the user could not find. A step that was not in the script but had to be taken. These are facts.

**Hypothesis** — An inference, a belief, or a prediction that was not directly tested in this journey. "We believe this will also affect transmittals from other orgs." "This is probably caused by the org context reset." "This would likely confuse a new user even more in a multi-project setup." These are not facts yet.

> **The roadmap is built on Observed findings. Hypotheses are preserved for future validation — they are not discarded, but they are never treated as proven until a scenario confirms them.**

Both types are recorded in the Findings Log with a type flag. Do not mix them in conclusions.

---

## Journey J-01: Standard Full Journey — Report

**Execution date:** 2026-06-28
**Status: CLOSED — 2026-06-28** *(findings reclassified and agreed: J01-003 → ARCH/P2, J01-005 → POLICY/P3)*
**Levels reached:** Works ✓ (partial) | Operates ✗ | Manages ✗

**Operational Cost (API-based execution — UI clicks not measurable, but decision points and friction counted):**
| Metric | Count | Notes |
|---|---|---|
| User decisions required | 3 | (1) Which workflow template to use — 2 DRAWING templates, no guidance. (2) Which user to set as responsible for Stage 3 (seed design gap, but reflects real template config UX). (3) How to address transmittal to HMT — no user picker, only free text. |
| Context switches | 2 | (1) DC must go to workflow module after upload — separate action, not prompted. (2) DC must check transmittal status separately after sending — no confirmation in the send response. |
| Read/interpret moments | 4 | Transmittal purpose codes (for_review, for_information, etc. — no tooltips). Workflow template selection (no descriptions). Stage state after advance (need second API call for enriched data). canAct=false error interpretation (no explanation). |
| Blockers encountered | 2 | Stage 3 deadlock (ARCH / template design risk — J01-003). Rate limit lockout after token expiry retry loop (ENV). |

---

#### 9. New User Test (answered first — sets the lens)

**Would a user who has never seen ArcScale complete J-01 without any explanation from us?**

**No.**

Points where the system required explanation or prior knowledge:

1. **Workflow template selection**: Two "Drawing Approval" templates exist. A new user would not know which applies. No description, no recommendation, no "last used" indicator.

2. **Workflow attachment step**: After uploading a document, nothing in the system prompts the DC to attach a workflow. The upload completes, status is "draft." The DC must know to separately navigate to Workflow Engine → Start a Workflow. This step is not discoverable from the document detail page.

3. **Stage 3 deadlock (no responsible user)**: If this template were encountered without prior knowledge, the DC would see the workflow progress to Stage 3, then find that the Advance button returns 403 Forbidden. There is no system message explaining why. A new user would assume it is a bug, not a configuration issue.

4. **Transmittal creation after workflow**: Nothing in the system guides the DC from "workflow approved" → "create transmittal." These are separate flows with no linking action. A new user would not know to go to the Transmittals module after the approval step.

5. **Recipient specification**: The transmittal form accepts free-text for `toExternal` but has no user picker. A new user would not know how to target a specific system user at another org.

**Verdict**: A new user would fail J-01 at steps 2 (which template?), 3 (where do I start a workflow?), and 5 (how do I address a transmittal to a specific org user?). The system assumes prior knowledge of its own module structure.

---

#### 1. What Worked

- **Document upload with auto-numbering**: DC uploaded "Ground Floor Plan" and received auto-number `HMT-ABC-ARC-DRA-001`. Format `{PROJECT}-{DISCIPLINE}-{TYPE}-{SEQ}` is correct. Zero user decisions required for numbering.
- **Workflow engine for Stages 1 and 2**: Engineer (Stage 1) and PM (Stage 2) both received `canAct=true` for their assigned stages. Authorization is correctly enforced — DC cannot advance stages not assigned to them.
- **Transmittal creation with no status restriction**: DC created and sent `TRS-HMT-ABC-0001` with the document in `under_review` state. System correctly allows this flexibility.
- **Transmittal auto-numbering**: `TRS-HMT-ABC-0001` generated correctly from project code.
- **Audit trail**: All transitions (workflow start, Stage 1 advance, Stage 2 advance) recorded with actor name, timestamp, and comment.

#### 2. What Failed

- **Stage 3 terminal deadlock** (J01-003): Workflow reached Stage 3 "Approved for Construction" (`isTerminal=true`) but cannot advance. No `responsibleUserId`, no `responsibleRole`, no `admin` user in project. All users `canAct=false`. Workflow permanently stuck. Document permanently `under_review`. **Reclassified ARCH / P2: this is a template validation/design risk — the system behaves per its rules. Open design question recorded: should a terminal stage require a responsible party configured at template save time?**

#### 3. What Confused the User

- **Two DRAWING templates** (J01-001): No guidance on which to use. The system auto-selects nothing.
- **Workflow start response missing stage info** (J01-002): POST /instances returns `currentStage: null`. DC has no immediate confirmation of who must act next.
- **Stage 3 Forbidden error** (J01-004): Generic 403 with no path forward. "You are not authorized" could mean the stage is misconfigured, OR that the user lacks rights — the system does not distinguish.

#### 4. What Confused the Manager

- **No workflow dashboard**: To see if all workflows are progressing, the PM would need to query each document individually. There is no "all active workflows" view at the project level.
- **No transmittal acknowledgment signal**: After sending, the PM cannot see whether HMT has received and is reviewing the transmittal. The `status=sent` with null `acknowledgedAt` provides no differentiation between "sent but unread" vs. "sent and in review."

#### 5. What This Revealed About Live Operational State

Specific questions that could not be answered from the current system state:

- *"Which documents are waiting for review by HMT, and for how long?"* — not answerable without manual transmittal list inspection.
- *"Is the Ground Floor Plan approved or still under review?"* — `status=under_review` is technically correct but hides the fact that the workflow is deadlocked, not actively being reviewed.
- *"Who is blocking progress on document HMT-ABC-ARC-DRA-001?"* — System shows Stage 3 as current, but Stage 3 has no assigned user. The answer is "nobody, because the template is misconfigured."
- *"Has the consultant acknowledged our transmittal?"* — `acknowledgedAt=null` but no way to distinguish "not yet opened" from "received and reviewing."

#### 6. What This Revealed About System Flexibility

**Positive flexibility**:
- Transmittal can be created and sent at any document status — system does not enforce "must be approved before transmitting." This is correct for the EDMS domain (sometimes you transmit for review before approval).

**Questionable flexibility**:
- No warning or confirmation when transmitting an `under_review` document. A contractor could accidentally send an unapproved drawing as if it were approved. The system's flexibility here could produce contractual and legal problems without any guardrail.

**Missing flexibility**:
- Cannot transmit directly to an internal system user (no `toUserId` in POST /transmittals). Cross-org transmittals must use free-text email. This is not flexibility — it is a missing feature.

#### 7. What This Revealed About Architecture

- **ARCH-001** (J01-003): Terminal stage validation/design risk — `isTerminal=true` does not mean auto-complete. The flag is descriptive (marks the final stage) but not operational (does not trigger completion). The system allows a terminal stage to be saved without a responsible user or role. This creates a deadlock if no admin is present in the project. The system behaves per its own rules; this is a template design/validation gap. Open design question: (1) require responsible party on terminal stages? (2) auto-complete on arrival? (3) fall back to initiator/PM? (4) prevent saving? No fix applied — recorded for future design decision.

- **ARCH-002**: Module sync scheduler vs. seed data — `ModuleSyncScheduler` runs every 30 min and resets `org_config.modules` to plan defaults. Any direct DB manipulation of modules is temporary. This is an intentional design (plan-driven module access), but it creates a fragility for dev/test environments that need to override plan defaults for testing.

- **ARCH-003**: Transmittal recipient model — The schema has `toUserId` (FK to users) but the API only accepts `toExternal` (free text). This is an incomplete implementation — the schema anticipates internal targeting, but the route was not updated to support it. Downstream consequence: no in-system notifications, no acknowledgment tracking, no "who has this document" answer.

#### 8. Would We Design This the Same Way?

**Workflow terminal stage behavior**: The current design allows a terminal stage to exist without a responsible user — this is a template validation/design risk (ARCH, not Bug). The design options are still open: require responsible party, auto-complete on arrival, fall back to initiator/PM, or prevent saving. This is recorded as a design decision to resolve in a future phase — it affects all workflows with terminal stages.

**Transmittal recipient model**: No. The free-text `toExternal` + orphaned `toUserId` pattern means transmittals are disconnected from the system's user model. For a multi-org EDMS, cross-org transmittals should target specific system users (who would get in-system notifications) while still supporting external email for non-system recipients. This is product debt, not technical debt — the schema already anticipated it but the feature was not built.

**Module sync scheduler**: Yes, but with a documented dev override. The scheduler is correct for production (plan-driven access control). The gap is in dev/test tooling — seed scripts need a clear, documented way to set a plan tier that makes the scheduler reinforce (not fight) the test configuration.

---

## Journey J-02: Internal Rejection → Correction → Resubmission — Report

**Execution date:** 2026-06-28
**Status: CLOSED — 2026-06-28**
**Levels reached:** Works ✓ (partial) | Operates ✗ | Manages ✗

**Operational Cost:**
| Metric | Count | Notes |
|---|---|---|
| User decisions required | 2 | (1) Which workflow template to use (same J01-001 ambiguity). (2) How to communicate to reviewer that correction is done — no in-system signal, DC must contact engineer out-of-band. |
| Context switches | 1 | DC must return to workflow module after correction — no "re-submit to reviewer" prompt. |
| Read/interpret moments | 2 | DC must read return comment from transitions list. No "you have a returned item" notification visible in this API. |
| Blockers encountered | 1 | Stage 3 deadlock (consistent with J01-003). |

---

#### 9. New User Test

**Would a user who has never seen ArcScale complete J-02 without any explanation?**

**No.** Beyond J-01's existing gaps, J-02 reveals a new one: after receiving a Return, DC has no in-system signal that a correction is expected. The workflow sits at Stage 1 with no status change, no notification, and no "awaiting correction" state. A new user who received a Return would need external guidance to know: (1) check the transitions list for comments, (2) fix the document offline, (3) inform the reviewer out-of-band that it's ready for re-review.

---

#### 1. What Worked

- **Return (action=returned)**: Engineer returned workflow at Stage 1. Transition correctly recorded with comment. Workflow stayed active at Stage 1. HTTP 200 returned cleanly — no error toast (B-1 appears fixed).
- **Reject (action=rejected)**: Workflow status → `rejected`. Document status → `draft`. Both transitions preserved in history. Correct behavior.
- **New workflow on rejected document**: DC successfully started wf3 (id=3) on the same document (id=12) after rejection. System correctly allows this. New row created with separate id.
- **History preservation**: GET /instances returns both wf2 (rejected) and wf3 (active) for document 12. Both have full transition histories. Full audit trail intact.
- **Stage 1 and Stage 2 advancement on resubmission**: Engineer advanced Stage 1, PM advanced Stage 2. Transitions recorded correctly. Authorization enforced correctly.

#### 2. What Failed / Blocked

- **Stage 3 deadlock** (consistent with J01-003): wf3 reached Stage 3 "Approved for Construction" (isTerminal=true, no responsible user/role). DC `canAct=false`. Same deadlock as J-01. Consistent finding — confirms J01-003 is not specific to one workflow instance.
- **File upload blocked** (ENV-002): `POST /documents/12/files` returned 403 `EMAIL_NOT_VERIFIED`. Phase B (file replacement on same revision) could not be executed. The policy question — "does the system force a revision increment for corrections?" — remains unanswered.

#### 3. What Confused the User

- **Return loops to Stage 1**: "Return" from Stage 1 goes back to Stage 1 (because there is no Stage 0). The transition shows `fromStageName=Checker Review → toStageName=Checker Review`. DC sees no change in workflow state — the workflow sits at Stage 1 indefinitely until the engineer acts again. DC has no acknowledgment mechanism.
- **No "needs correction" document status**: After Return, the document stays `under_review`. DC cannot distinguish "first-time review in progress" from "returned and waiting for correction." Both show the same status.
- **GET /instances?documentId=X filter not applied** (J02-001): When DC queries instances by documentId=12, the response includes wf1 (document 11 from J-01). The filter parameter is ignored. DC would see a confusing mixed list.

#### 4. What Confused the Manager

- **No "correction awaiting" state**: PM cannot see which documents have been returned and are waiting for correction. All of them show `under_review` with an active or rejected workflow — no differentiation.
- **Two active-ish workflows for same document**: The document has wf2 (rejected) and wf3 (active). A PM checking the document register would see one active workflow but may not realize there was a prior rejected one without drilling into history.

#### 5. What This Revealed About Live Operational State

- *"Is this document in first review or re-review after correction?"* — cannot distinguish. Both show `under_review` + active workflow.
- *"Has the DC acknowledged the engineer's return comment?"* — no mechanism. DC may not have seen it.
- *"Which documents have been returned to DC and are awaiting their correction?"* — no status or filter for this state.

#### 6. What This Revealed About System Flexibility

**Positive flexibility**: System allows starting a new workflow on a previously rejected document without requiring a revision increment. This is correct EDMS behavior — same revision, corrected content, new review cycle.

**Missing flexibility**: No "Return to Initiator" stage concept. Return from the first stage loops back to itself. The system's "Return" action is a feedback mechanism only — it does not move the document out of the reviewer's queue into the DC's queue.

#### 7. What This Revealed About Architecture

- **ARCH-004** (J02-001): Instances list endpoint `GET /workflow-engine/instances` does not filter by `?documentId`. The query parameter is accepted but ignored — the endpoint returns all instances for the organization. Any consumer expecting filtered results by documentId would see the full unfiltered list.
- **ARCH-005** (J02-002): Return from first stage loops back to same stage. There is no "initiator holds" concept. The workflow engine has no concept of a document being "in correction" — it is either active at a stage or rejected. This gap produces an invisible correction state.

#### 8. Would We Design This the Same Way?

**Return to first stage behavior**: Partially. The Return action returning to Stage 1 (first stage) from Stage 1 is technically consistent but operationally incorrect. The correct behavior for "Return from first stage" in an EDMS context should route the document to an initiator-visible correction state — either a "Needs Correction" document status, a notification to DC, or an explicit "Correction" stage before the first reviewer stage. This is a design gap, not a local fix — it requires either a new document status or a new stage type.

**Instances list filtering**: No. The `?documentId` parameter should filter results. Returning all organization instances regardless of the filter is a correctness issue.

---

## Journey J-03: External Rejection (Code C) → New Revision → Resubmission — Report

**Execution date:** 2026-06-28
**Status: CLOSED — 2026-06-28**
**Levels reached:** Works ✓ (partial) | Operates ✗ | Manages ✗

**Operational Cost:**
| Metric | Count | Notes |
|---|---|---|
| User decisions required | 3 | (1) Which transmittal format to use — no "external review" template. (2) How to address a transmittal to a specific system user — no user picker, `toUserId` not settable via API. (3) Which workflow template to use for resubmission — same template blocked (409), must use alternative. |
| Context switches | 3 | (1) DC creates transmittal after workflow → separate module, no prompt. (2) DC sets review code after sending — must return to the transmittal item. (3) DC must start a new workflow in a different module after Rev 02 creation. |
| Read/interpret moments | 3 | complete-review auto-creates a response transmittal (not announced in response). Revision 02 keeps status=for_revision (not reset to draft — no guidance on expected status). Multiple active workflow instances for same document — no clear "which one is current?" |
| Blockers encountered | 2 | Terminal deadlock cascade (J03-002: same-template resubmission blocked by active instance 409). Submission chain CRUD API does not exist (J03-004). |

---

#### 9. New User Test

**Would a user who has never seen ArcScale complete J-03 without any explanation?**

**No.**

Beyond J-01/J-02 gaps, J-03 reveals:

1. **Transmittal recipient selection**: The consultant (CREV, user 7) exists in the system as a project member. Yet there is no way to designate them as the named recipient on a transmittal via the API. `toUserId` field is in the DB but has no API surface. A DC cannot target CREV specifically — only free-text email. A new user would assume the system supports user targeting and be confused by the missing field.

2. **Resubmission block**: After Code C, DC creates Rev 02 and tries to resubmit through the same workflow. The system returns 409. There is no guidance — no "you have an active workflow instance; do you want to close it first?" No button to archive or cancel the stuck instance. A new user would assume they broke something.

3. **Submission chain**: No CRUD API exists for submission chains. A DC who wants to track that TRS-HMT-ABC-0002 and TRS-HMT-ABC-0003 are part of the same revision cycle has no system mechanism to do so.

4. **No "for revision" → "draft" auto-transition**: After Rev 02 is created, the document status remains `for_revision`. A new user would expect Rev 02 to start as `draft` (clean slate) and be confused why the status still says "for revision."

**Verdict**: A new user would fail at the transmittal recipient step, the resubmission step, and the submission chain step. The "Code C → resubmit" flow requires workarounds not discoverable from the system UI.

---

#### 1. What Worked

- **Transmittal creation with `subject` field**: `POST /projects/2/transmittals` with `subject` → `TRS-HMT-ABC-0002` created. Status=draft. Auto-numbering correct.
- **Transmittal send**: `POST /:id/send` → status=sent. `sentAt` populated. Correct behavior.
- **Creator can set review code on their own transmittal**: DC as `createdById` satisfies `isAssigned=true`. `PATCH /:id/items/:itemId` with `reviewCode=C` succeeded for DC. Assignment check works correctly — the issue is the missing `toUserId` setter, not the check itself.
- **complete-review rolls up worst code**: `POST /:id/complete-review` correctly identified worst code = C, applied `for_revision` decision to document 13. Document status → `for_revision`. Correct DB state.
- **complete-review auto-creates response transmittal**: System automatically created `TRS-HMT-ABC-0003` as a response to `TRS-HMT-ABC-0002`. Includes rolled-up outcome label and reviewer comment in description. This is useful behavior — not announced in response but present.
- **Revision increment (PUT)**: `PUT /projects/2/documents/13` with `{ revision: "02" }` updated the revision field. No error. Audit trail entry created.
- **New workflow starts on revised document**: With a different template (11), new instance wf5 started for document 13 Rev 02 after the same-template 409. Stage 1 and Stage 2 advanced correctly.

#### 2. What Failed / Blocked

- **CREV cannot set review code** (J03-001): `PATCH /:id/items/:itemId` returns 403 for CREV. `toUserId` is null (not settable via API), so CREV is neither the assigned user nor the creator. The designated external reviewer has no way to be recognized by the system. DC must act as reviewer — misrepresents the actual review chain.
- **Same-template resubmission blocked** (J03-002): `POST /workflow-engine/instances` with `templateId=6` returns 409 "An active workflow instance already exists for this document and template." The terminal stage deadlock (J01-003) keeps the prior instance "active" — permanently — because it can never be completed or closed by regular users. This blocks the natural resubmission path.
- **Stage 3 deadlock** (consistent): wf5 (template 11) reached Stage 3 "Approved for Construction" (isTerminal=true, no responsible user/role). Same deadlock as J-01, J-02, J-03 original instance. Pattern confirmed: **every tested workflow in this environment terminates at Stage 3 with canAct=false for all project users.**
- **Submission chain CRUD API does not exist** (J03-004): All probed endpoints (`/submission-chains`, `/documents/13/submission-chain`, `/documents/13/chains`) return 404. The table is in the DB schema and referenced in the frontend document history route, but no backend routes are registered.

#### 3. What Confused the User

- **Unrecognized `responsibleRole` → silent permission bypass** (J03-003): Template 11 stages have `responsibleRole="Checker"` and `responsibleRole="Senior Engineer"` — neither is a valid `AppRole`. `rankOf("Checker")=-1`, so `isAtLeast(anyRole, "Checker")` returns true for all users. Every authenticated user can advance these stages. A DC acting as "Checker" in a test context may not be confused, but this is an authorization bypass that would confuse a PM trying to enforce access control.
- **Rev 02 inherits `for_revision` status**: After `PUT` with `revision="02"`, document status remains `for_revision` — there is no reset to `draft`. DC would expect a new revision to start clean. Status only changes when a new workflow is started (which resets it to `under_review`). The intermediate state `for_revision` on revision 02 is logically inconsistent.
- **`workflowInstanceId` in document API shows old instance**: After starting wf5, `GET /documents/13` still returns `workflowInstanceId=4` (the deadlocked instance), not wf5. The query has no `ORDER BY createdAt DESC`, so it returns whichever active instance the DB returns first.

#### 4. What Confused the Manager

- **No resubmission cycle counter**: PM cannot tell from the system that document 13 has been through Code C once and is now on its second attempt. All metadata looks the same as a first submission.
- **Two active instances for same document**: Instances 4 and 5 are both active for document 13. The document API shows instance 4. The instances list shows both. A PM viewing the workflow queue sees two entries for the same document with no clear indication that one supersedes the other.
- **No submission chain visibility**: No API to show "this is the second transmittal for this document." Consultant cannot see the history of submissions without reading transmittal descriptions.

#### 5. What This Revealed About Live Operational State

- *"Has CREV received and reviewed the drainage drawing? What was their verdict?"* — The review was done by DC in the system (acting in place of CREV). The system has no record that CREV was the actual reviewer. No audit trail from the consultant's perspective.
- *"Is document 13 Rev 02 ready for resubmission, or still in correction?"* — Status is `for_revision` even after Rev 02 was created. Ambiguous.
- *"This is the second attempt on this document — was the first one Code C or Code D?"* — No Submission Chain API to show the sequence. Must cross-reference transmittals manually.
- *"Which workflow is the current one for this document?"* — Two active instances exist. Document API returns the older one. No "superseded by" link.

#### 6. What This Revealed About System Flexibility

**Positive flexibility**:
- `complete-review` does not enforce who performs the review (the creator can act). Allows DC to stand in for external reviewers when needed.
- New workflow can start with a different template even when same-template is blocked — provides a workaround path.

**Missing flexibility**:
- Cannot designate a system user as the named recipient on a transmittal (`toUserId` not settable via API).
- Cannot cancel or archive a stuck workflow instance. No `PATCH /instances/:id/status` or `DELETE /instances/:id`. Once an instance is stuck at a terminal stage, it cannot be cleared by anyone except admin via direct DB manipulation.
- Cannot link two transmittals into a submission chain via API. The schema anticipates this (table exists) but the feature was not built.

**Questionable flexibility**:
- Template 11's custom roles ("Checker", "Senior Engineer") bypass RBAC because they're not recognized `AppRole` values. This allows any user to advance any stage — flexibility that undermines access control.

#### 7. What This Revealed About Architecture

- **ARCH-006** (J03-001): `toUserId` field in `transmittals` table has no API setter. POST /transmittals does not accept it; PUT /transmittals does not accept it. The assignment check (`transmittal.toUserId === caller.id`) exists and is enforced, but the only way to set it is direct DB write. Schema anticipates cross-org user targeting; API was not completed.
- **ARCH-007** (J03-002): **Terminal stage deadlock cascade.** An active workflow instance at a terminal stage (isTerminal=true) cannot be completed, rejected, or deleted by non-admin users. The instance status stays "active" permanently. This blocks `POST /instances` with the same template (409). The `for_revision` path creates a situation where the document needs a new workflow cycle, but the old cycle is permanently blocking it. This is a second-order consequence of ARCH-001 (J01-003) — the deadlock now prevents the entire resubmission path for the same template.
- **ARCH-008** (J03-003): `responsibleRole` values are stored as free-text strings and cast to `AppRole` at runtime. If the stored value is not a recognized `AppRole` (e.g., "Checker", "Senior Engineer"), `rankOf()` returns -1, and `isAtLeast(anyRole, unknownRole)` returns true for all authenticated users. This is a silent permission bypass — every user becomes authorized for stages with unrecognized roles.
- **ARCH-009** (J03-004): Submission chains schema exists (`submission_chains`, `submission_chain_documents` tables) but has no backend routes. Referenced in the frontend document history href. This is incomplete implementation — not a design risk, a build gap.

#### 8. Would We Design This the Same Way?

**`toUserId` in transmittals**: No. The API should accept `toUserId` in POST and PUT. This is a straightforward missing field. The RBAC check already works correctly — the field just needs to be accepted and saved. Until this is implemented, cross-org targeted review with in-system notification is impossible.

**Workflow instance lifecycle**: No. An active instance must have a way to be cancelled or archived by a PM+. The current model has no instance management — instances are created, advanced, and either complete or reject. A "cancelled" status (triggered by DC or PM) would allow stuck instances to be cleared without admin DB access.

**responsibleRole validation**: No. A template stage should validate that `responsibleRole` is a recognized `AppRole` at save time. Storing free-text roles that are then cast to `AppRole` at runtime is a type safety gap that produces incorrect authorization behavior silently.

**Submission chains**: The schema is correctly designed. The gap is the missing route implementation. The design should be preserved; the implementation should be completed before the first customer who tracks revision cycles.

---

## Findings Log

*Populate during execution. One row per finding. Never fix during execution.*

| ID | Scenario | Step | Type | Description | User Impact | Classification | Impact Level |
|---|---|---|---|---|---|---|---|
| ENV-001 | Pre-J-01 | Env Setup | Observed | Seed script gap — two-layer problem: (1) `seed-business-scenarios.ts` did not set `org_config.modules` for scenario orgs, so they inherited "expired" plan defaults (`workflow_engine: false`). (2) `ModuleSyncScheduler` runs every 30 min and resets org modules to plan defaults, causing any manual fix to be reverted. Root fix: seed script now sets `subscriptionTier="trial"` for all 3 scenario orgs — trial plan has all modules enabled, so the scheduler reinforces instead of reverts. Also sets `org_config.modules` immediately. | **P1 — Blocking** for all workflow/transmittal/correspondence steps in J-01→J-08. Any fresh environment resets needs the updated seed. | ENV-SETUP | P1 / Critical |
| J01-001 | J-01 | Step 2 | Observed | **DX: Two DRAWING workflow templates** exist for org ABC — "Drawing Approval Workflow" (id=11, role-based: Checker/Senior Engineer) and "Drawing Approval Workflow (Scenarios)" (id=6, user-specific). The DC must choose between them with no guidance on when to use each. No template description, no recommended template, no filtering by use case. | DC must guess. Wrong choice silently produces a wrong workflow. Amplified on first use. | DX | P2 / High |
| J01-002 | J-01 | Step 2 | Observed | **UX: POST /instances response returns `currentStage: null`** — the workflow creation response does not include enriched stage details (who needs to act, what the stage is). DC gets no confirmation of who must act next. GET /instances/1 immediately after returns the full enriched view, but requires a second call. | DC submits workflow, sees "active" with no stage info. Must navigate back to see what happens next. | UX | P2 / High |
| J01-003 | J-01 | Step 4b | Observed | **ARCH: Terminal stage validation/design risk — Observed × 3 (J-01, J-02, J-03). Must appear in final report.** The system allows a terminal workflow stage with no responsible user or role. Stage 3 "Approved for Construction" (`isTerminal=true`) has no `responsibleUserId` and no `responsibleRole`. When Stage 2 is advanced, Stage 3 becomes current but all regular project users get `canAct=false`. Only `admin+` can advance via admin_override; no admin exists in the scenario project → workflow stuck permanently. The system behaves per its own rules — this is a template validation/design risk, not a code bug. Open design question (no fix applied): (1) should a terminal stage require a responsible party? (2) should it auto-complete on arrival? (3) fall back to initiator/PM? (4) should the system prevent saving such a template? **Cascade: see J03-002 — the deadlocked instance blocks resubmission with the same template indefinitely.** Pattern confirmed across every tested workflow — this is not an isolated case. | P2 — Document stuck in `under_review` with no path forward for regular project users. All 4 active workflow instances in the test environment are deadlocked at Stage 3. Cascade effect: resubmission blocked (J03-002). Must be resolved before first customer. | ARCH | P2 / High |
| J01-004 | J-01 | Step 4b | Observed | **UX: Stage 3 deadlock is invisible to users.** The `canAct=false` flag is returned but the error gives no signal about WHY — no "this stage has no responsible user configured", no "contact your administrator." The system presents a silent dead end. | Users will click Advance, receive 403, and have no idea what to do. Support cost is high. | UX | P2 / High |
| J01-005 | J-01 | Step 5 | Observed | **POLICY: Transmittal allowed on documents at any status.** The system allows transmittals to be sent for documents still under review — no document status validation blocks transmittal creation. DC sent `TRS-HMT-ABC-0001` with doc `HMT-ABC-ARC-DRA-001` while its workflow was stuck mid-approval. This flexibility is intentional and should remain unless the organization configures a stricter policy. The missing part is guidance/warning, not enforcement. | No blocking issue. Risk: DC may inadvertently send an unapproved document with no system warning that it has not yet been approved. | POLICY | P3 / Low |
| J01-006 | J-01 | Step 5 | Observed | **DX: `toUserId` exists in schema but is not exposed via POST /transmittals API.** The only recipient field is `toExternal` (free text). There is no way to address a transmittal to a specific system user from the same API. Cross-org transmittals cannot link to the receiving org's user — only to an email address string. | No in-system notification to the receiving user. They must discover the transmittal by other means (email, phone, checking the system manually). | DX | P2 / High |
| J01-007 | J-01 | Step 6 | Observed | **LOS-REQ: No confirmation that the receiving party received the transmittal.** After `status=sent`, the DC has no way to know if the consultant has seen it. `acknowledgedAt` is null. No read receipt. The DC cannot distinguish "sent and ignored" from "sent and under review." | DC must follow up manually (call/email). ArcScale provides no operational visibility on transmittal receipt. | LOS-REQ | P2 / High |
| J01-008 | J-01 | Env | Observed | **UX: Rate limiting blocks recovery from expired tokens.** After repeated login attempts (due to expired JWTs during testing), accounts are locked for 15 minutes. In a real scenario, a user whose session expires and retries multiple times is locked out mid-task. | Usability: DC stuck mid-workflow until rate limit clears. No warning that the account is approaching lockout. | UX | P3 / Low (test artifact) |
| ENV-002 | Pre-J-02 | Env Setup | Observed | **File upload blocked by email verification gate.** `POST /projects/:id/documents/:id/files` returns 403 `EMAIL_NOT_VERIFIED` for scenario users. Phase B of J-02 (file replacement on same revision) could not be executed. The policy question "does the system force a revision increment for corrections?" remains unanswered. | P2 — File upload is a core DC operation. Test environment cannot exercise this path. Requires email verification bypass for scenario users or a dev flag. | ENV-SETUP | P2 / High |
| J02-001 | J-02 | Phase C | Observed | **BUG: GET /workflow-engine/instances?documentId=X filter not applied.** The endpoint accepts `documentId` as a query parameter but ignores it — returns all workflow instances for the organization. Querying `?documentId=12` returned wf1 (document 11 from J-01) alongside wf2 and wf3. Any consumer relying on this filter receives incorrect, unfiltered results. | DC/PM cannot reliably retrieve workflow history for a specific document. Any UI feature that filters workflows by document is broken at the API level. | BUG | P2 / High |
| J02-002 | J-02 | Phase A Step 3 | Observed | **UX: "Return" from Stage 1 loops back to Stage 1 — no correction acknowledgment.** The `returned` action from the first workflow stage keeps the workflow at Stage 1 (no prior stage exists). DC receives no notification that a return was sent, has no in-system acknowledgment button, and has no way to signal the engineer that the correction is done. DC must communicate out-of-band. The document stays `under_review` with no "needs correction" status indicator. | DC cannot distinguish "first review" from "returned — correction expected." Requires out-of-band coordination. Engineer cannot tell if DC has seen the comment. | UX | P2 / High |
| J02-003 | J-02 | Phase A | Observed | **B-1 fix confirmed: Return action returns clean HTTP 200.** POST /instances/:id/reject with action=returned returns 200 with enriched workflow data. No spurious error response. If there was previously an error toast on Return, it is no longer produced at the API level. | No impact. Confirmed fix. | UX | ✓ Fixed |
| J02-004 | J-02 | Phase C Step 13 | Observed | **B-2 partial: Prior rejected instance visible in list API but no dedicated "history notice" field.** GET /instances returns both the rejected (wf2) and active (wf3) instances for document 12. The prior rejection history is preserved and accessible. However, there is no dedicated `hasPriorRejection` or `priorWorkflowCount` field in the response — a UI must infer this from the list. | No blocking issue. UI must handle the inference logic. History is preserved. | DX | P2 / Low |
| J02-005 | J-02 | Phase C Step 17 | Observed | **POST /instances response now includes enriched stage data.** Unlike J01-002 (which recorded `currentStage: null`), J-02's POST /instances returns `currentStageName`, `currentStageResponsibleUserId`, `transitions[]`, and `canAct`. This may indicate J01-002 was fixed or the behavior differs by context. Marked for re-verification. | If fixed: DC now gets immediate confirmation of who must act next. | UX | ? Possibly Fixed — verify |
| J03-001 | J-03 | Phase A | Observed | **BUG: `toUserId` field in transmittals table has no API setter — external reviewer cannot be designated as the named in-system recipient.** `POST /transmittals` and `PUT /transmittals` both omit `toUserId` from their accepted fields. `PATCH /:id/items/:itemId` (set review code) and `POST /:id/complete-review` both check `transmittal.toUserId === caller.id` for assignment. Since `toUserId` is always null via API, the consultant (CREV, user 7) receives 403 — even though they are a project member and the intended reviewer. Only the transmittal creator (DC, `createdById`) can act. This is NOT a future enhancement — it is an incomplete implementation. The schema anticipated cross-org user targeting; the API route was not updated to match. Without this: the external review chain is unauditable (DC acts as the reviewer in the system), CREV receives no in-system notifications, and the LOS cannot show "who is reviewing this document" for external parties. | **P2 / High** — The entire external review flow (Code A/B/C/D by the designated consultant) cannot be properly executed. DC must stand in for the consultant, misrepresenting the actual review. The data model is correct — the API gap must be closed before the external review workflow can be considered operational. | BUG | P2 / High |
| J03-002 | J-03 | Phase C | Observed | **BUG: Terminal stage deadlock cascade — resubmission to same workflow template blocked by 409.** Workflow instance 4 (template 6, document 13) is permanently "active" at Stage 3 (isTerminal=true, no responsible user → `canAct=false` for all project users). Since the instance cannot be completed or cancelled by non-admin users, `POST /workflow-engine/instances` with the same `templateId=6` returns 409 "An active workflow instance already exists." The Code C → Rev 02 → Resubmit path is fully blocked for the same template. This is a second-order consequence of ARCH-001 (J01-003). | DC cannot resubmit Rev 02 through the same workflow. Must use a different template — which itself may have different stage assignments and produce incorrect authorization behavior. | BUG | P2 / High |
| J03-003 | J-03 | Phase C | Observed | **BUG / Security: Unrecognized `responsibleRole` values grant workflow advancement permission to ALL authenticated users.** Template 11 stages have `responsibleRole="Checker"` and `responsibleRole="Senior Engineer"` — neither is a recognized `AppRole`. `checkWorkflowStagePermission` calls `isAtLeast(effectiveRole, unknownRole)` which resolves to `rankOf(unknownRole) = -1`. Since all valid roles have rank ≥ 0, the inequality `rankOf(anyValidRole) >= -1` is always true — every authenticated user, including viewers, qualifies as "assigned_role." DC advanced both stages without being the responsible party. This is a silent, complete authorization bypass at the workflow stage level. Any org user who can read a workflow instance can advance it if any stage uses a custom role string. No error, no warning, no audit flag. **No fix applied — No-Fix Rule.** | **P1 / Critical** — This is a security-class authorization bypass. The integrity of access control for all workflow stages depends on `responsibleRole` being a valid `AppRole`. Any template using a custom or misspelled role name silently removes stage-level access control for the entire stage. The bypass is not detectable from the API response — `canAct=true` gives no indication of whether authorization was proper or bypassed. | BUG / Security | P1 / Critical |
| J03-004 | J-03 | Phase D | Observed | **FUTURE: Submission chain CRUD API does not exist — fundamental gap for Contractor → Consultant → Owner flows. Must appear in final report.** All probed paths (`/submission-chains`, `/documents/:id/submission-chain`, `/documents/:id/chains`) return 404. The `submission_chains` and `submission_chain_documents` tables are present in the DB schema. The frontend document history page contains an href that references a `/submission-chains/` route. No backend routes are registered. This is not a minor feature gap — a Submission Chain is the formal record that links multiple revision cycles (TXN-002 Code C → TXN-003 Code A) into a single auditable thread. Without it: the consultant cannot see "this is a second attempt"; the owner cannot see the full submission history in one view; revision cycles are only traceable by manual cross-referencing of transmittals. This is a build gap — the schema design is correct and intentional. Classification FUTURE (not Bug) because no existing route is broken. But it is a pre-production requirement for any construction-phase EDMS use. | **P2 / Medium** — Not blocking current journeys, but the Contractor–Consultant–Owner submission audit trail cannot be completed without this feature. Treat as a non-negotiable pre-production requirement, not an optional enhancement. | FUTURE | P2 / Medium |
| J03-005 | J-03 | Phase A | Observed | **LOS-OBS: `complete-review` auto-creates a response transmittal.** When `POST /:id/complete-review` is called with outcome=C, the system automatically creates a new draft transmittal (`TRS-HMT-ABC-0003`) linked to the original via `responseToTransmittalId`. It includes the rolled-up outcome label and reviewer comment in the description. This is useful behavior — the response transmittal is the formal reply to the original. However, this is not announced in the `complete-review` response — the `responseTrs` object appears but is not documented. DCs must know to look for it. | Positive: formal review response is auto-generated. Gap: response not surfaced in any "pending transmittals" list for the sender. | LOS-OBS | P3 / Low |
| J03-006 | J-03 | Phase B | Observed | **DX: Revision increment (PUT revision="02") carries forward document status — no system guidance on what this means.** After `PUT /documents/13` with `{ revision: "02" }`, the document status remains `for_revision`. There is no auto-transition to `draft` and no system prompt explaining the lifecycle intent. Three design options exist: (1) status auto-resets to `draft` on revision increment — clean slate; (2) status stays, and the workflow start resets it to `under_review` — current behavior; (3) a `resubmitted` status appears after revision increment, before workflow is restarted. The system chose option 2 without surfacing this decision to the user. The intermediate state `for_revision` on Rev 02 is mechanically consistent but requires the user to know that starting a workflow will clear it. Without guidance, DC may be confused about whether Rev 02 is ready, still needing revision, or already in review. **Classification: DX (Decision Experience)** — this is a design decision not communicated to the user, not a missing feature. The right answer depends on the product decision about revision lifecycle semantics. | P3 / Low — No blocking issue. The behavior is internally consistent. The gap is guidance: the DC is not told what to do next, or what status means for a new revision. | DX | P3 / Low |
| J04-001 | J-04 | Step 2 | Observed | **POLICY (confirmed): Transmittal on `draft` document allowed without warning.** J-04 confirms J01-005 extends to `draft` status — system creates and sends `TRS-HMT-ABC-0004` with doc 14 in `draft` state. No check, no warning, no flag on the transmittal that the document has no internal approval. DC sends unapproved content as easily as approved. The flexibility is preserved — this is a pattern confirmation, not a new finding. The warning gap remains. | DC cannot distinguish between "I sent this draft knowingly" and "I forgot to run internal review first." No audit trail of intent. | POLICY | P3 / Low |
| J04-002 | J-04 | Step 8 | Observed | **BUG / UX: Internal workflow start silently overwrites external review status.** After `complete-review` (Code B) set document 14 to `approved_with_comments`, `POST /workflow-engine/instances` called `syncDocumentStatus(documentId, "under_review")` unconditionally. Document status changed from `approved_with_comments` → `under_review` with no warning, no conflict check, no prompt. The Code B result from HMT is no longer visible in the document status field — only in transmittal history. A PM looking at doc 14 sees `under_review` (internal workflow) with no indication that external Code B was already received. | DC cannot tell PM "we already have Code B — this is just internal approval." PM sees `under_review` and may think no external response has been received yet. State is misleading and requires cross-referencing transmittal history to reconstruct the true picture. | BUG / UX | P2 / High |
| J04-003 | J-04 | All steps | Observed | **LOS-REQ: Document status cannot represent simultaneous internal and external review states.** A document with `status=draft` can have an active transmittal sent to a consultant. A document with `status=under_review` (workflow) can have an external Code B already recorded. The single status field forces a linear representation of what is actually a parallel process. No combination of field values in the current schema can express "internally: first-stage review" AND "externally: Code B received." | PM cannot determine whether a document is pending external input, pending internal approval, or both. Any document register view based on status will be incomplete for parallel-track documents. | LOS-REQ | P2 / High |
| J04-004 | J-04 | Step 6 | Observed | **UX: `complete-review` auto-acknowledges original transmittal — not announced, not obvious.** After `POST /:id/complete-review`, the original transmittal status changed to `acknowledged` with `acknowledgedAt` populated. DC does not need to call `/acknowledge` separately. However, this is not surfaced in the `complete-review` response (which only returns `{ reviewOutcome, responseTrs }`). DC has no confirmation that the original transmittal is now closed. Separately, `POST /:id/acknowledge` requires auth (router-level middleware) — the `actor ?? "External"` defensive fallback in the code is dead code. If the intent was unauthenticated external acknowledgment via share link, it was not implemented. | No blocking issue. Gap: DC may call `/acknowledge` thinking it's needed; or may not know that `complete-review` closes the transmittal. Two endpoints, one of which is a silent subset of the other. | UX | P3 / Low |
| J03-007 | J-03 | Phase C | Observed | **UX: Document API returns stale `workflowInstanceId` when multiple active instances exist.** After wf5 was started (template 11, instance 5), `GET /documents/13` still returns `workflowInstanceId=4` (the deadlocked instance). The query (`WHERE documentId=13 AND status="active" LIMIT 1`) has no `ORDER BY` — returns whichever active instance the DB returns first. With two active instances, the "current" workflow displayed is ambiguous. | PM or DC checking document detail sees instance 4 (deadlocked at Stage 3) as the workflow. They would believe no workflow is running, not that a second one was started. | UX | P2 / High |
| J05-001 | J-05 | Phase C | Observed | **BUG / Security: Cross-org correspondence is fully read-blocked — `toUserId` and `ccUserId` confer no cross-org access.** `GET /correspondence/:id` runs `organizationId !== caller.organizationId` unconditionally before any `toUserId`/`ccUserId` check. Engineer (id=5, org 2) — the named `toUserId` of RFI id=1 — receives 403 TENANT_ISOLATION_VIOLATION on read. DC (id=4, org 2) — the `ccUserId` — also receives 403. The entire org 2 is locked out of a correspondence record addressed to them. This is not limited to RFIs: all cross-org correspondence types (notice, submittal, technical_query, inspection) are equally blocked. Any org that creates a correspondence record is the only org that can ever read it. The "to" and "cc" fields are cosmetically stored but functionally inert for cross-org participants. | **P1** — Cross-org correspondence is a fundamental use case for any construction EDMS. An RFI from consultant to contractor that the contractor cannot read defeats the purpose of the feature. This is a security-class finding because named recipients are told they have access (they're in the `toUserId` field) but are denied at the route level — the system gives false confidence in message delivery. | BUG / Security | P1 / Critical |
| J05-002 | J-05 | All phases | Observed | **LOS-REQ: No "on hold" state or RFI linkage on transmittal — review pause is invisible.** During the RFI period (Phase B → Phase D), transmittal 6 shows status=`sent` with no change. No field, flag, or linked object on the transmittal indicates that the review is paused pending an open RFI. DC (org 2) cannot see the RFI exists. PM cannot distinguish "reviewer is slow" from "reviewer raised a question." No timeline event, no status pill, no linked correspondence object in GET /transmittals/6. | PM, DC, and Director all see `sent` transmittal with no indication of an active, unresolved technical question. The blockage is invisible at every level. | LOS-REQ | P2 / High |
| J05-003 | J-05 | Phase D | Observed | **BUG: CREV (designated external reviewer) cannot complete-review on a transmittal addressed to them (J03-001 cascade).** `POST /transmittals/6/complete-review` returns 403 for CREV (id=7). Check: `isAssigned = transmittal.toUserId === caller.id || transmittal.createdById === caller.id`. `toUserId` is null (ARCH-006 — never set via API), `createdById=4 ≠ 7`. CREV is the org 3 reviewer, a project member, and the person the transmittal was sent to — but the API blocks them from completing the review. DC (createdById) completes the review instead. This means: review code, reviewer comments, and the response transmittal are all authored by the transmittal sender — not the reviewer. The audit trail says DC approved their own submission. Second occurrence after J04. | **P2** — Audit integrity of external review is compromised. Sender controls review outcome in the DB. The designated reviewer has no mechanism to formally record their decision. | BUG | P2 / High |
| J05-004 | J-05 | Phase B | Observed | **BUG: `linkedDocumentId` in correspondence POST is silently ignored.** Passing `linkedDocumentId=15` in the POST body to `POST /projects/2/correspondence` returns 200 with `linkedDocumentId=null`. The field is present in the DB schema (`linked_document_id integer nullable`), but `createCorrespondence` destructuring does not include it — the value is discarded before insert. No validation error, no field rejection notice. Callers who pass this field to link a correspondence to a document receive no indication that the linkage was not stored. | Correspondence cannot be formally linked to a document via the API. The `linked_document_id` column is a schema artifact with no API surface. Cross-module linkage (document ↔ correspondence) is impossible via the documented interface. | BUG | P3 / Low |
| J05-005 | J-05 | All phases | Observed | **LOS-REQ: No transmittal ↔ correspondence linkage — cross-module audit history is unrecoverable.** GET /transmittals/6 contains no `correspondenceIds`, no `linkedRfi`, no `onHold` flag. GET /correspondence/1 contains no `transmittalId`, no `transmittalRef`. The `correspondence` table has no `transmittal_id` column at all. The two records exist in total isolation — no API surface connects them. The complete audit trail for "TXN-006 was paused for RFI-001, RFI was answered, then TXN-006 was completed with Code A" is unrecoverable from any single API call or view. | PM and Director cannot reconstruct the review history for a document that had an RFI. The connection between the technical question and the final review decision is invisible. | LOS-REQ | P2 / High |
| J06-001 | J-06 | All phases | Observed | **BUG / Security: All transmittals are project-wide readable — no org-scoping — any org member reads any transmittal.** DC (org 2) successfully read TXN-008 (Consultant org 3 → Owner org 4) and TXN-010 (org 3 auto-draft). OWNER (org 4) successfully read TXN-007 (Contractor org 2 → Consultant org 3). No org-based filter on `GET /transmittals/:id`. Transmittals are filtered only by `projectId` — all project members across all orgs have full read access to all transmittals. This is the inverse of J05-001 (correspondence fully blocked). The two modules apply opposite isolation policies. Correct model: party-scoped — readable by sender org + named receiver org only. On a real construction project, org 2 reading org 3's confidential communication with org 4 (e.g., price adjustments, scope disputes, Owner-direct instructions) is a commercial information boundary violation. | **P1 / Critical** — Information boundary between project parties is absent for transmittals. Any org user in the project can see all transmittal content from all other orgs. This is especially critical because transmittals carry documents, review codes, and reviewer comments that may be confidential between parties. | BUG / Security | P1 / Critical |
| J06-002 | J-06 | Phase C | Observed | **BUG / UX: `complete-review` unconditionally creates a ghost draft response transmittal — no deduplication check.** PM_HMT called `complete-review` on TXN-008. System auto-created TXN-010 (id=10, status=draft, responseToId=9, createdById=8). PM_HMT did not know this was created — they manually created TXN-011 (id=11) as the response. DC now has TXN-010 (ghost draft) and TXN-011 (sent, acknowledged) both as responses to the same transmittal. No dedup check before creating the response. No notification to PM_HMT that a draft was created on their behalf. Third occurrence of the auto-create pattern (J03-005, J04-004, J06-002). | DC cannot tell if TXN-010 is an intentional draft or a system artifact. PM_HMT has an orphan draft they didn't create. The transmittal list now contains a record that can never be sent (its purpose is already fulfilled by TXN-011). | BUG / UX | P2 / High |
| J06-003 | J-06 | Phase C | Observed | **BUG: OWNER cannot complete-review or PATCH item on TXN-008 — J03-001 cascade, 3rd confirmed instance.** OWNER (id=10, org 4) receives 403 on both `PATCH /transmittals/9/items/9` and `POST /transmittals/9/complete-review`. The `isAssigned` check (`toUserId === caller.id || createdById === caller.id`) fails because `toUserId` is null (ARCH-006) and `createdById=8 ≠ 10`. PM_HMT (sender) completes Owner's review instead. Owner's approval is recorded under PM_HMT's identity. The Owner Authority (POA) has no in-system trace of their actual review decision. Pattern: every external review in J-03, J-05, and J-06 has been completed by the sender rather than the receiver. | **P2** — Systemic. The external review mechanism is entirely sender-controlled. The system records the sender's proxy action as the reviewer's decision across all three journeys tested. This is a structural audit integrity failure for external reviews. | BUG | P2 / High |
| J07-001 | J-07 | F-01 | Observed | **LOS-REQ: Starting a new workflow on an already-approved document overwrites approval status with no warning.** `POST /workflow-engine/instances` on doc 15 (status=`approved` from Code A) returns 200, wf7 created, doc status immediately changes to `under_review`. No "this document was previously approved — starting a new workflow will override this status" prompt or notice. History of prior approval is invisible. Same as SP-005 but for workflow-overwrites-transmittal-approval direction. | A PM checking doc 15 sees `under_review` with no indication a Code A was issued via TXN-6. The prior external approval disappears from document status. | LOS-REQ | P3 / Low |
| J07-002 | J-07 | F-03 | Observed | **BUG: `returned` action from a middle stage (Stage 2) advances FORWARD to Stage 3 rather than returning to Stage 1.** wf8 (template 6, doc 18): ENG approved Stage 1 → Stage 2. PM called `action="returned"` from Stage 2. Transition recorded: `fromStageId=20 ("Senior Engineer Review") → toStageId=21 ("Approved for Construction")` with `action="returned"`. Expected: go back to Stage 1 for rework by ENG. Observed: advance to Stage 3 (terminal deadlock). Contrast: `returned` from Stage 1 (J-02) stayed at Stage 1 (no previous stage). For Stage 2, previous stage = Stage 1, but routing went forward. The return routing for middle stages is broken. PM cannot send the document backward for rework — calling "return" produces the same forward movement as calling "approved." | **P1** — The primary correction mechanism in multi-stage workflows does not work. Once a document reaches Stage 2 and the Stage 2 reviewer has a concern, they cannot reverse it. The document advances regardless of the action label. All workflow correction loops are broken for middle stages. | BUG | P1 / High |
| J07-003 | J-07 | F-06 | Observed | **DX: Acknowledged transmittal item PATCH is accidentally blocked by SP-001 (wrong actor), not by status lock — fixing SP-001 would expose audit modification.** `PATCH /transmittals/9/items/9` returns 403 for DC with "designated recipient" error — because DC is not `createdById` of TXN-9 (PM_HMT is). This is NOT because TXN-9 is `acknowledged`. There is no status check that prevents item modification on acknowledged transmittals. If SP-001 is fixed (toUserId set correctly), the intended reviewer would be able to PATCH item review codes on acknowledged transmittals — changing the recorded review outcome after the review is complete. The current protection is incidental, not intentional. | **P2** — This reveals a missing explicit status guard. The security boundary relies on a coincidental authorization failure from a different bug. The two bugs currently cancel each other out, but this is fragile. | DX | P2 / High |
| J07-004 | J-07 | F-06 | Observed | **BUG: PUT on acknowledged transmittal is allowed — metadata can be modified after acknowledgment.** `PUT /transmittals/9` with new `subject` returns 200, status remains `acknowledged`. No status check in the PUT route prevents updates to acknowledged transmittals. The transmittal `subject`, `description`, `purpose`, and other metadata fields can be changed after the review is complete and acknowledged. This corrupts the audit record — what DC or PM sees after acknowledgment may differ from what was reviewed. | **P2** — Acknowledged transmittals should be immutable. Their content at the time of acknowledgment is the formal record. Allowing PUT after acknowledgment means the "approved" record can be silently altered. | BUG | P2 / High |
| J06-004 | J-06 | All phases | Observed | **BUG: Transmittal `reference` field silently discarded — never stored in POST or PUT.** Passed `reference="TRS-HMT-ABC-0007"` in POST body → `GET /transmittals/8` returns `ref=''`. Confirmed for TXN-008 (id=9), TXN-009/011 (id=11). Retrospective check on TXN-006 (J-05) also confirms `ref=''`. PUT with `reference` field also returns `ref=''`. The `reference` field is accepted in the request body without error, is not in the route destructuring, and is never inserted or updated. All transmittals are identifiable only by auto-incremented `id`. The human-readable reference number (e.g., "TRS-HMT-ABC-0007") — which is the primary identifier used in construction document control — cannot be stored via the API. | **P2** — Transmittal reference numbers are the primary document control identifier used by all parties. Contractors, consultants, and owners refer to transmittals by reference number, not by database ID. The inability to store this field means: search by reference is impossible, printed transmittal cover sheets cannot pull the reference, and audit trails reference "transmittal ID 8" rather than "TRS-HMT-ABC-0007." | BUG | P2 / High |

---

## System Patterns

*Extracted when the same root cause appears in more than one Journey, or the same gap appears in more than one Module.*
*These are not individual bugs — they are structural behaviors that individual findings are symptoms of.*
*No fixes or redesign here. Evidence only.*
*Updated as new journeys execute. Final synthesis → Architectural Principles (written after J-08).*

---

### Active Patterns (J-01 → J-06)

---

#### SP-001: External Reviewer Authorization Collapse

**Type:** Cross-Journey Bug Pattern
**Status:** Active — confirmed in J-03, J-05, J-06
**Scope:** `POST /transmittals`, `PUT /transmittals`, `PATCH /transmittals/:id/items/:itemId`, `POST /transmittals/:id/complete-review`

**Root cause (one sentence):** The `toUserId` field in the transmittals table has no API setter — every transmittal is created with `toUserId=null` — so the `isAssigned` authorization check (`toUserId === caller.id || createdById === caller.id`) always fails for the intended external reviewer and always passes for the sender.

**Evidence:**
| Journey | Finding | What happened |
|---|---|---|
| J-03 | J03-001 | CREV (id=7) gets 403 on PATCH item and complete-review for TXN-003/004. DC (createdById) completes instead. |
| J-05 | J05-003 | CREV (id=7) gets 403 on complete-review for TXN-006. DC (createdById) completes Code A. Audit trail inverted. |
| J-06 | J06-003 | OWNER (id=10) gets 403 on both item PATCH and complete-review for TXN-008. PM_HMT (createdById) proxies Owner's Code A. |

**Observed consequence in every case:** The designated external reviewer cannot record their own review decision. The transmittal sender (internal DC or PM_HMT) completes the review on behalf of the reviewer. The system records the sender's identity as the reviewer. The audit trail shows the sender approved their own submission.

**Not yet observed:** Whether an admin bypass exists that could restore correct behavior without fixing the API gap.

---

#### SP-002: Opposite Isolation Policies Across Modules

**Type:** Cross-Module Architectural Inconsistency
**Status:** Active — confirmed J-05 vs J-06
**Scope:** `GET /correspondence/:id` (org-isolated), `GET /transmittals/:id` (project-broadcast)

**Root cause (one sentence):** The two modules that carry inter-party communication apply opposite tenancy policies — correspondence is org-isolated at the read level, transmittals are project-wide-readable with no org filter — neither policy is "party-scoped" (visible to named sender + receiver parties only).

**Evidence:**
| Module | Journey | Finding | Behavior |
|---|---|---|---|
| Correspondence | J-05 | J05-001 | Engineer (org 2, `toUserId` in RFI) gets 403 on `GET /correspondence/1`. DC (org 2, `ccUserId`) gets 403. Entire org 2 cannot read RFI addressed to them. Org isolation overrides named-party access unconditionally. |
| Transmittals | J-06 | J06-001 | DC (org 2) reads TXN-008 (org 3 → org 4). OWNER (org 4) reads TXN-007 (org 2 → org 3). No org filter. All transmittals in project visible to all project members regardless of org. |

**The gap in both cases:** Neither module implements party-scoped access (visible to: sender org + named receiver org). One module over-restricts (prevents named recipients from reading). The other over-shares (broadcasts to all orgs). The correct policy — same in both — is the one neither implements.

**Implication for the model:** The isolation design was decided per-module rather than at a cross-cutting policy level. This produces incoherent behavior: an RFI from the consultant that the contractor can't read, but a transmittal from the contractor that the owner can freely read.

---

#### SP-003: Terminal Stage Deadlock — Systemic, Not Incidental

**Type:** Cross-Journey Bug Pattern (Environment + Design)
**Status:** Active — confirmed in J-01, J-02, J-03, J-04 (and all workflows in environment)
**Scope:** `POST /workflow-engine/instances/:id/advance`, `checkWorkflowStagePermission`

**Root cause (one sentence):** Stage 3 ("Approved for Construction") in all tested workflow templates has `responsibleUserId=null` and `responsibleRole=null` — the permission check returns `canAct=false` for every project user — the stage cannot be advanced by any non-admin actor — and the instance status remains `"active"` permanently because `isTerminal=true` does not auto-complete.

**Evidence:**
| Journey | Workflow Instance | Template | Confirmed at |
|---|---|---|---|
| J-01 | wf1 | Template 6 | Step 4b — Stage 3, canAct=false all users |
| J-02 | wf3 | Template 6 | Phase C — new instance, same deadlock |
| J-03 | wf4, wf5 | Templates 6, 11 | Phase C — both instances deadlocked at Stage 3 |
| J-04 | wf6 | Template 6 | Stage 3 deadlock, 5th occurrence |

**Cascade effects:**
- J03-002: Deadlocked instance remains `status="active"` → `POST /instances` with same template returns 409 → resubmission blocked
- J03-007: Multiple active instances for same document → stale `workflowInstanceId` in document GET
- Every document that enters a workflow cannot complete it through normal user action

**Classification note:** Environment condition (seed data misconfiguration) rather than a code bug in the advance logic itself. However, the design has no recovery path for non-admin users — the absence of a "cancel" or "reassign" action for deadlocked stages is a design gap that makes this condition unrecoverable in production without admin DB access.

**J-07 updates:**
- wf7 (F-01, doc 15, template 6): New workflow started on previously-approved doc → deadlock at Stage 3 confirmed.
- wf8 (F-03, doc 18, template 6): PM called `returned` from Stage 2 → advanced to Stage 3 (broken return routing, SP-009) → immediately deadlocked. SP-009 is now a second path to SP-003. Any "return" from Stage 2 produces a deadlock — not just misconfigured templates.

---

#### SP-004: `complete-review` Side Effects Are Silent and Unstable

**Type:** Cross-Journey API Behavior Pattern
**Status:** Active — confirmed in J-03, J-04, J-06
**Scope:** `POST /transmittals/:id/complete-review`

**Root cause (one sentence):** `complete-review` performs multiple irreversible side effects (acknowledge original, create response transmittal, apply document status) that are not announced in the response body and not guarded against repetition or conflicting state.

**Evidence:**
| Journey | Finding | Side effect observed |
|---|---|---|
| J-03 | J03-005 | Auto-creates draft response transmittal (TRS-HMT-ABC-0003). DC unaware until they discover it in the transmittal list. |
| J-04 | J04-004 | Auto-acknowledges original transmittal (`status=acknowledged`, `acknowledgedAt` set). DC does not know if `/acknowledge` is still needed. `acknowledge` is now a redundant subset. |
| J-06 | J06-002 | Auto-creates TXN-010 (draft response). PM_HMT unaware, creates TXN-011 manually. DC now sees two response records for the same review event. No deduplication check. |

**Pattern:** Each call to `complete-review` unconditionally writes to three different records. The response body returns only `{ reviewOutcome, responseTrs }`. The caller cannot tell what was written where unless they subsequently query the original transmittal and the document.

**Not yet observed:** Whether `complete-review` is idempotent (can be called twice safely) or produces double side effects.

---

#### SP-005: Single Document Status Cannot Represent Parallel Tracks

**Type:** Cross-Journey Architectural Gap
**Status:** Active — confirmed J-04, J-05
**Scope:** `documents.status` field, `syncDocumentStatus()`, `complete-review`

**Root cause (one sentence):** The document `status` field is a single scalar — the last writer wins — and both internal workflow events and external transmittal review events write to it unconditionally, each silently overwriting the other's result.

**Evidence:**
| Journey | Finding | What was overwritten |
|---|---|---|
| J-04 | J04-002, J04-003 | `syncDocumentStatus("under_review")` called on workflow start overwrote `approved_with_comments` (Code B from external review). Code B result invisible in document status. |
| J-05 | J05-002 (LOS) | Document 15 status=`approved` after complete-review Code A — but document had no internal workflow. Status reflects only external review outcome; no combined state possible. |

**Pattern:** Two independent processes (internal workflow, external transmittal review) both own the same field. Neither checks existing status before writing. Neither produces a combined representation ("internally: under_review AND externally: approved_with_comments").

**State combinations that cannot be expressed:**
- "draft internally, pending external review"
- "under_review internally, Code B received externally"
- "approved internally, for_revision externally (Code C)"

---

#### SP-006: Cross-Module Linkage Is Absent at Every Level

**Type:** Cross-Module Architectural Gap
**Status:** Active — confirmed J-03, J-05, J-06
**Scope:** correspondence ↔ transmittals, correspondence ↔ documents, transmittals ↔ submission_chains

**Root cause (one sentence):** The three primary modules (workflow, transmittals, correspondence) have no shared event model, no foreign-key relationships between them at the API level, and no UI-surface that joins records from more than one module.

**Evidence:**
| Gap | Journey | Finding | Detail |
|---|---|---|---|
| Correspondence ↔ Document | J-05 | J05-004 | `linked_document_id` exists in DB schema but not in API destructuring → silently null. No correspondence can be linked to a document via the API. |
| Correspondence ↔ Transmittal | J-05 | J05-005 | No `transmittal_id` column in correspondence table. No `correspondenceId` in transmittal response. Two records for the same review event exist in isolation. |
| Transmittal ↔ Submission Chain | J-03, J-06 | J03-004 | `submission_chains` and `submission_chain_documents` tables exist. All API routes return 404. No transmittal can be associated with a chain. |
| Transmittal ↔ Transmittal (forward) | J-06 | (no finding ID) | No `parentTransmittalId` or `forwardedFromId` field. TXN-007 and TXN-008 carry the same document across the same chain with no API link. |

**Consequence:** Any cross-module business question ("what transmittals are linked to this RFI?", "what correspondence happened during review of this document?", "what is the full forwarding chain for this transmittal?") cannot be answered from the API. It requires manual cross-referencing by document number or date.

---

#### SP-007: Unrecognized Role Strings Silently Grant Universal Authorization

**Type:** Cross-Feature Security Pattern
**Status:** Active — confirmed in J-03 (workflow), and `CorrespondencePermissions` (static analysis)
**Scope:** `isAtLeast()` in `permissions.ts`, workflow stage permission check, `CorrespondencePermissions.canCreate`

**Root cause (one sentence):** `rankOf(unknownRoleString) = -1` — since all valid role ranks are ≥ 0, the inequality `rankOf(caller.role) ≥ rankOf(requiredRole)` is always true when `requiredRole` is not a recognized `AppRole` — authorization silently collapses to "allow all authenticated users."

**Evidence:**
| Location | Journey | Finding | Unrecognized value | Effect |
|---|---|---|---|---|
| `checkWorkflowStagePermission` | J-03 | J03-003 | `responsibleRole="Checker"`, `"Senior Engineer"` | All authenticated users can advance the stage. DC advanced both stages without being the responsible party. |
| `CorrespondencePermissions.canCreate` | (static) | J03-003 note | `"member"` (not in ALL_ROLES) | All authenticated users can create correspondence regardless of role. |

**Pattern:** Any configuration field that accepts a free-text role string (template stage `responsibleRole`, correspondence permission minimum) can introduce a silent authorization bypass if the value does not exactly match a recognized `AppRole` enum value. The bypass is invisible — the API returns normal success responses with no indication that the authorization was trivially satisfied.

**Not confirmed in J-05/J-06:** Correspondence canCreate bypass not specifically exercised. Pattern stands on confirmed J-03 evidence + static code analysis.

---

#### SP-008: Silent Field Discard on Accepted Input

**Type:** Cross-Feature API Contract Pattern
**Status:** Active — confirmed in J-05, J-06
**Scope:** `POST /correspondence` (`linkedDocumentId`), `POST /transmittals` / `PUT /transmittals` (`reference`)

**Root cause (one sentence):** Several fields are accepted in request bodies without validation error, are not included in the route's destructuring, and are never written to the database — callers receive no indication that the field was silently discarded.

**Evidence:**
| Journey | Finding | Field | Route | Behavior |
|---|---|---|---|---|
| J-05 | J05-004 | `linkedDocumentId` | `POST /correspondence` | Accepted, not in destructuring, stored as `null`. Caller receives `{ ..., linkedDocumentId: null }` — identical to a valid create with no linkage intent. |
| J-06 | J06-004 | `reference` | `POST /transmittals`, `PUT /transmittals` | Accepted, not in destructuring, stored as `''`/`null`. All transmittals created with blank reference across J-05 and J-06. |

**Pattern:** The API's destructuring layer is narrower than the schema's column set. Fields in the schema that were not added to the route handler's destructuring are permanently silent no-ops. The caller has no way to know whether the field was stored or discarded — the response shows the stored (null/blank) value, which is indistinguishable from a caller who intentionally left the field empty.

---

---

#### SP-009: `returned` Action Routing Inconsistent — Middle Stages Advance Forward

**Type:** Cross-Journey Bug Pattern
**Status:** Active — confirmed J-07 (F-03), reference J-02 for Stage 1 behavior
**Scope:** `POST /workflow-engine/instances/:id/advance`, stage transition routing

**Root cause (one sentence):** The `returned` action does not route backward to the previous stage in the workflow — from Stage 2 it advances forward to Stage 3 (same movement as `approved`), making the "return for rework" mechanism dysfunctional for any stage beyond Stage 1.

**Evidence:**
| Journey | Workflow | Observation |
|---|---|---|
| J-02 | wf3 (template 6) | `returned` from Stage 1 → stays at Stage 1. No previous stage exists → "loop" at Stage 1. Recorded as finding J02-002. |
| J-07 (F-03) | wf8 (template 6) | `returned` from Stage 2 → advances to Stage 3 (toStageId=21 "Approved for Construction"). Expected: go back to Stage 1 (stageId=19). |

**Behavior summary:**
- Stage 1 return: loop at Stage 1 (no prior stage → incidental correct behavior)
- Stage 2 return: forward to Stage 3 (same as `approved` — incorrect)
- Stage N≥2 return: not yet tested for N>2, but pattern implies it always advances

**Implication:** The "return" mechanism only creates the illusion of a rework cycle from Stage 1. Any multi-stage workflow where Stage 2 or later needs to send work back to Stage 1 cannot do so. The document advances to the terminal stage regardless.

---

---

#### SP-010: Notification System Blind Spots — External Parties and Initiators

**Type:** Cross-Module / Architectural Pattern
**Status:** Active — confirmed J-08 (audit of all 6 actors); corroborated by J-01 (no read receipt), J-05 (CREV blocked from acting on received RFI)
**Scope:** `GET /api/notifications`, all event emitters across transmittal/workflow/correspondence modules

**Root cause (one sentence):** Notifications are emitted only for internal-org events (`workflow_action_required`, `task_assigned`) and broadcast events (`document_uploaded`) — no notification type is emitted to external reviewers when a transmittal is issued for their review, and no notification is emitted back to the initiating party when any action occurs on their submission.

**Evidence:**
| Actor | Notifications | Missing |
|---|---|---|
| DC (id=4, initiator) | 0 | workflow_completed, transmittal_acknowledged, stage_advanced |
| ENG (id=5, internal) | 17 — workflow_action_required (7), document_uploaded (8), correspondence_received (2) | None for internal role |
| PM (id=6, internal) | 28 — workflow_action_required (13), document_uploaded (8), task_assigned (7) | None for internal role |
| CREV (id=7, external) | 8 — ALL document_uploaded | transmittal_received, transmittal_for_review |
| PM_HMT (id=8, external) | 8 — ALL document_uploaded | transmittal_received, transmittal_for_review |
| OWNER (id=10, external) | 8 — ALL document_uploaded | transmittal_received, transmittal_for_review |

**Structural gap:** Two notification categories are entirely absent from the system:
1. **Inbound actionable signal** — no event tells an external reviewer "a transmittal arrived requiring your response"
2. **Outbound status feedback** — no event tells the initiating DC/PM "your submission was acknowledged/reviewed/returned"

The only cross-org notification present (`correspondence_received`) is also broken — the recipient cannot read the correspondence (J05-001), making the notification an actionless dead end.

**Implication:** External reviewers must discover pending transmittals by manually polling the transmittal list. Initiators have zero in-system feedback on the fate of their submissions. The notification system functionally supports only internal workflow — it provides nothing useful for the multi-party, cross-org use case that is the primary value proposition of an EDMS.

---

#### SP-011: Task System Operates Only Within Initiating Org

**Type:** Architectural Pattern
**Status:** Active — confirmed J-08 (all 7 tasks assigned to PM, id=6, org 2; zero tasks for CREV/PM_HMT/OWNER)
**Scope:** `POST /api/tasks` (transmittal send side effect), `GET /api/tasks`

**Root cause (one sentence):** Tasks created on transmittal send are hard-assigned to the internal Project Manager (PM, id=6) rather than to the designated external reviewer — the task system has no mechanism to route work items outside the initiating organization.

**Evidence:**
- 7 tasks created across J-01, J-03, J-04, J-05, J-06, J-07 — all assignedTo PM (id=6)
- CREV (org 3), PM_HMT (org 3), OWNER (org 4): 0 tasks from any event
- `GET /api/tasks` returns all org tasks to any caller — no assignee filter applied

**Compound effect (with SP-010):** External reviewers receive no task and no notification when a transmittal arrives. The only actor notified with an actionable signal is PM internally, who must then contact the external party out-of-band to communicate that a transmittal is waiting for review.

---

*Pattern count after J-08: 11*
*J-08 complete. All journeys done. Next: Final Summary Report.*

---

## LOS Requirements Log

*Populated during execution. These unanswered questions become the specification for Live Operational State.*
*Source: Persona Test failures — moments where DC/PM/Director cannot answer a simple status question.*

| ID | Scenario | Step | Persona | The question they cannot answer | Where they'd expect to find it |
|---|---|---|---|---|---|
| LOS-J01-01 | J-01 | Step 6 | DC | "Has the consultant received and opened our transmittal TRS-HMT-ABC-0001?" | On the transmittal detail page — a read receipt or status indicator next to each recipient |
| LOS-J01-02 | J-01 | Step 4b | DC / PM | "Why can't anyone advance the workflow? Who needs to act on Stage 3?" | On the workflow instance view — a clear message showing "Stage 3 has no assigned reviewer. Contact [admin] to configure the template." |
| LOS-J01-03 | J-01 | Any | PM | "Which documents are currently awaiting review by HMT — and how long have they been waiting?" | Project dashboard or Transmittals register — a "pending response" list grouped by party, with age indicators |
| LOS-J01-04 | J-01 | Step 4b | PM | "Is the Ground Floor Plan approved, or still in review?" | Document status must distinguish between 'actively being reviewed' vs. 'workflow deadlocked at a misconfigured stage' — both currently show 'under_review' |
| LOS-J02-01 | J-02 | Phase A Step 3 | DC | "Has the engineer seen my correction? Is the document back in their queue?" | On the workflow instance view — a "returned to you — correction expected" banner, or a document status like `needs_correction` that resets to `under_review` once re-submitted to the reviewer |
| LOS-J02-02 | J-02 | Phase A Step 4 | DC | "Which documents have been returned to me that I haven't corrected yet?" | A "my action items" list or dashboard showing documents in correction state, distinguished from first-time uploads |
| LOS-J02-03 | J-02 | Phase C | PM | "Is this document in its first review cycle or has it been rejected and corrected before?" | Workflow history summary on the document detail page — shows prior instances count, last rejection date, and current cycle number |
| LOS-J03-01 | J-03 | Phase A | DC | "Can I send this transmittal directly to the consultant in the system, so they get a notification?" | Transmittal form — a "To (system user)" picker that shows org 3 project members, with fallback to free-text email for non-system recipients |
| LOS-J03-02 | J-03 | Phase A | DC | "Document 13 is now 'for revision' — what do I do next? Create a new revision, or re-run the workflow?" | Document detail page — a "Next steps" banner: "This document has been returned for revision (Code C). Create Revision 02 to resubmit." with action buttons |
| LOS-J03-03 | J-03 | Phase C | PM | "Is this a first submission or a resubmission? How many times has this document been through review?" | Document detail page — submission history summary: "2 transmittals sent for this document (TRS-HMT-ABC-0002, TRS-HMT-ABC-0003); last outcome: Code C → for revision" |
| LOS-J03-04 | J-03 | Phase D | PM | "Can I see the full submission chain for document 13 — first submission, code C, revision, second submission?" | Submission chain panel — ordered list of transmittals per document, grouped by revision, with outcome code and date for each cycle |
| LOS-J04-01 | J-04 | Step 2 | PM | "Was HMT-ABC-CIV-DRA-001 sent to the consultant before we ran our internal review?" | Document detail page — a "submission history" section showing all transmittals linked to this document, with icons indicating whether internal review existed at the time of each send |
| LOS-J04-02 | J-04 | Step 8 | DC | "I just received Code B from HMT — but the system now shows the document as 'under review' after I started the internal workflow. Did the Code B get lost?" | Document detail page — a persistent "external review outcomes" section that shows the latest transmittal review code independently of internal status: "External: Code B — Approved with Comments (HMT, 2026-06-28)" |
| LOS-J04-03 | J-04 | Step 8 | PM | "Is document 14 waiting for internal approval, external feedback, or has it already been externally approved?" | Dashboard — document row shows two status pills: internal status (under_review / approved) and external status (draft / pending / code-B / code-A), computed independently |
| LOS-J05-01 | J-05 | Phase B–D | DC | "Is TXN-006 on hold because HMT has a question? Or are they just being slow?" | Transmittal detail — an "Open RFIs" section listing correspondence records that are linked to this transmittal and not yet closed, with the originating party and due date |
| LOS-J05-02 | J-05 | Phase C | Engineer | "HMT sent me a technical question about SD-005 — where do I find it?" | Notification or task inbox — a task directed at the named `toUserId` of the correspondence, with the correspondence body accessible cross-org |
| LOS-J05-03 | J-05 | Phase D | PM | "HMT's RFI was closed and then they approved the drawing — can I see both events on one timeline?" | Document detail page — a unified activity timeline: "2026-06-28: RFI HMT-ABC-2026-0001 raised by HMT (open) → 2026-06-28: RFI closed by DC_HMT → 2026-06-28: TRS-HMT-ABC-0006 completed Code A" |
| LOS-J06-01 | J-06 | Phase A | DC | "Has HMT forwarded our drawing to the Owner yet? Or is it still sitting with them?" | Submission chain view — shows current custodian ("currently with: Owner Authority"), with timestamps for each hand-off. DC can see chain progress without calling each party. |
| LOS-J06-02 | J-06 | Phase C | PM | "The Owner issued Code A — but the approval shows under HMT's name in the system. Who actually approved it?" | Transmittal review record — shows `reviewedBy.name`, `reviewedBy.organization`, and `reviewedOnBehalf` (if proxy). Owner's identity must be capturable even when PM_HMT acts as intermediary. |
| LOS-J06-03 | J-06 | All phases | Director | "Where is document 16 in its approval journey? Has it been to the Owner? What did they say?" | Document detail — submission chain panel showing all transmittals for this doc ordered by date, each labeled with sender org, receiver org, and review outcome. One click from document → full chain. |
| LOS-J08-01 | J-08 | All phases | CREV / PM_HMT / OWNER | "I have no idea a transmittal arrived — nobody told me." | Transmittal notification — a `transmittal_received` event sent to the designated reviewer (`toUserId` or `toOrganizationId` contact) at the moment a transmittal is issued. Not `document_uploaded` — a specific, actionable signal with transmittal subject, sender org, due date, and direct link. |
| LOS-J08-02 | J-08 | All phases | DC | "I sent TXN-007 to HMT three days ago — have they opened it? Did they reply?" | Initiator notification — a `transmittal_acknowledged` or `transmittal_reviewed` event sent back to the sending org's DC/PM when the receiver acts. At minimum: who acknowledged it, when, and the review code if available. |
| LOS-J08-03 | J-08 | All phases | PM | "My notification bell says 28 unread — I need to clear the ones I've already handled." | Mark-as-read endpoint — `PUT /api/notifications/:id/read` or `PATCH /api/notifications/mark-read` with body `{ ids: [...] }`. Without this, the unread count is meaningless noise and the inbox cannot be managed. |
| LOS-J08-04 | J-08 | All phases | ENG / PM | "There are 7 tasks in my list — which ones actually need me to act, and which did PM already handle?" | Assignee-filtered task view — `GET /api/tasks?assignedToMe=true` returns only tasks assigned to the calling user. The current endpoint returns all org tasks, making prioritization impossible at scale. |

---

## Journey J-04: Transmittal Without Internal Workflow — Report

**Execution date:** 2026-06-28
**Status: CLOSED — 2026-06-28**
**Levels reached:** Works ✓ | Operates ✗ | Manages ✗

**Operational Cost:**
| Metric | Count | Notes |
|---|---|---|
| User decisions required | 1 | Which template to use when starting the post-transmission internal workflow (same J01-001 ambiguity). Everything else is natural. |
| Context switches | 2 | (1) DC must navigate to transmittals module from document — no "send externally" action on document page. (2) DC must navigate to workflow module after external review to start internal review — no prompt after Code B received. |
| Read/interpret moments | 2 | No warning when transmitting a draft document — DC must remember that no internal review was done. After Code B + internal workflow start: document now shows `under_review` — no indication the Code B result was already received. |
| Blockers encountered | 1 | Stage 3 deadlock (5th occurrence). Pattern now confirmed across all four journeys. |

---

#### 9. New User Test

**Would a user who has never seen ArcScale complete J-04 without any explanation?**

**No — but this scenario is closer to "yes" than J-01/J-02/J-03.**

J-04 has the fewest steps. A DC who knows the transmittal module could complete the external submission without guidance. The breakdown points are:

1. **No warning on draft transmittal**: DC sends HMT-ABC-CIV-DRA-001 while it's still `draft`. System says nothing. In a real project, if this document has not been internally reviewed, the DC may not realize they've sent unapproved content. The missing signal is "this document has not been through internal review — are you sure?"

2. **State confusion after Code B + internal workflow**: A DC who receives Code B (`approved_with_comments`) and then correctly starts an internal workflow will see the document change from `approved_with_comments` to `under_review`. Without explanation, this looks like the external approval has been reversed. They need prior knowledge that the workflow resets status.

3. **Acknowledge endpoint vs. complete-review**: A user reading the API docs would find `POST /:id/acknowledge` and might use it to mark the review complete. But `complete-review` is what actually applies document status decisions and creates the response transmittal. A user who only calls `/acknowledge` will not trigger document status updates.

**Verdict**: A trained DC can complete J-04 with minimal friction. An untrained DC would send the document without knowing its approval state, and would be confused when Code B is silently overwritten by the internal workflow start.

---

#### 1. What Worked

- **Transmittal on draft document**: System created and sent `TRS-HMT-ABC-0004` with doc 14 in `draft` status. No block, no error. Consistent with J01-005 (POLICY finding — flexibility preserved). ✓
- **Document status after send**: Document stays `draft` after transmittal is sent. Transmittal creation/send does not alter document status. This is correct — the document is not "in review" from a workflow perspective just because a transmittal was sent.
- **Code B complete-review**: `complete-review` with Code B outcome set document 14 to `approved_with_comments`. `reviewOutcome=B` on transmittal. Response transmittal `TRS-HMT-ABC-0005` auto-created. ✓
- **complete-review auto-acknowledges original transmittal**: Original transmittal status updated to `acknowledged`, `acknowledgedAt` populated as part of `complete-review`. DC does not need to call `/acknowledge` separately. The workflow is self-contained. ✓
- **Internal workflow after external review**: `POST /workflow-engine/instances` with templateId=6 on doc 14 succeeded with no 409. No conflict check. System allows this. ✓
- **Correct authorization on template 6 stages**: Stage 1 `canAct=False` for DC (`responsibleUserId=5 ≠ 4`). `canAct=True` for Engineer. PM advanced Stage 2 correctly. Authorization model works for user-ID-based stage assignment (contrast with J03-003 where string-role stages bypass auth).

#### 2. What Failed / Blocked

- **CREV 403 on review code** (J03-001 consistent): CREV cannot set review code on J-04 transmittal for the same reason as J-03 — `toUserId=null`. Confirmed for the second consecutive journey. Pattern is structural, not journey-specific.
- **External approval silently overwritten by internal workflow** (J04-002): After `complete-review` set doc status to `approved_with_comments`, `POST /workflow-engine/instances` reset it to `under_review`. No conflict check, no warning, no user prompt. The Code B approval from HMT is no longer visible in the document status field. It exists only in the transmittal history.
- **Stage 3 deadlock** (5th occurrence, wf6): Confirmed again. Now observed across all four journeys (J-01: wf1, J-02: wf3, J-03: wf4/wf5, J-04: wf6). Every active workflow in the test environment is deadlocked at Stage 3. Pattern is total — this is a systemic condition, not an edge case.

#### 3. What Confused the User

- **No warning on draft-document transmittal** (POLICY confirmed): DC received no signal that doc 14 has not been internally reviewed. The transmittal was sent as smoothly as one for an `approved` document. A real user relying on status as a quality gate would not receive it here.
- **External status overwritten by internal workflow**: After Code B, document shows `approved_with_comments`. DC starts internal workflow. Document immediately shows `under_review`. The Code B result appears gone from the document detail view. DC has no "the external review result was Code B — starting internal workflow does not reverse this" message.
- **`/acknowledge` vs. `complete-review` endpoint confusion** (J04-004): Two endpoints exist: `POST /:id/acknowledge` (sets status=acknowledged only) and `POST /:id/complete-review` (applies document decisions + creates response transmittal). `complete-review` calls `acknowledge` internally. A DC who finds `/acknowledge` first may use it without triggering document status updates. No documentation in the API response distinguishes these.

#### 4. What Confused the Manager

- **No "sent without internal approval" flag**: PM looking at doc 14 sees `under_review` with an active workflow. They cannot tell that this document was transmitted to HMT before internal review. If they opened it on the day of transmittal (when it was still `draft`), they'd see `draft` — but no "pending external review" indicator.
- **Code B result invisible**: After internal workflow starts, PM sees `under_review` at Stage 3 deadlock. No visible record that Code B was already received from HMT. PM would not know whether to wait for external input or internal approval.

#### 5. What This Revealed About Live Operational State

- *"Was HMT-ABC-CIV-DRA-001 sent to the consultant before our internal review was complete?"* — Not visible. Both approved and unapproved documents look the same in the transmittal list.
- *"We received Code B from HMT — has the engineer addressed the turning radius comment yet?"* — Code B is recorded in transmittal history but the document status now shows `under_review` (internal workflow), giving no indication that Code B was already received.
- *"Is this document pending external reply, pending internal review, or both simultaneously?"* — The system cannot express "both" — document status is a single field.

#### 6. What This Revealed About System Flexibility

**Positive flexibility**:
- System allows transmittal on any document status without blocking. J04 confirms J01-005 holds for `draft` documents too. This is the right design for EDMS — the system trusts the DC to know the appropriate timing.
- System allows internal workflow after external review with no constraints. This covers the use case where an org submits externally first (time pressure) and runs internal review in parallel.

**Missing flexibility**:
- No "external pending" status or flag alongside the internal status. A document should be able to say "internally: draft" AND "externally: pending review." Currently only one status value exists.
- No "parallel tracks" concept: internal approval and external submission are two separate processes but the system's single status field can only represent one at a time.

#### 7. What This Revealed About Architecture

- **ARCH-010** (J04-002): `syncDocumentStatus(documentId, "under_review")` is called unconditionally when any workflow instance starts. It does not check existing document status, does not preserve prior external review outcomes, and does not warn. The document status model treats workflow-set status as authoritative — any prior status (including one set by a completed transmittal review) is silently overwritten. This is an architectural limitation: document status is a single scalar, not a composite of internal and external tracks.
- **ARCH-011** (J04-004): `POST /:id/acknowledge` sets `status=acknowledged` only. `POST /:id/complete-review` sets `status=acknowledged + acknowledgedAt + reviewOutcome + applies document decisions + creates response transmittal`. The acknowledge endpoint is a subset of complete-review but the naming suggests equivalence. The `actor ?? "External"` fallback in `acknowledge` is dead code — the endpoint requires auth (router-level `requireAuth`). If the intent was anonymous external acknowledgment via share link, it was not implemented.

#### 8. Would We Design This the Same Way?

**Transmittal flexibility (no status block)**: Yes. EDMS systems should not enforce internal approval before external transmission — project timelines often require parallel processes. The right design is a warning, not a block. The warning is the missing piece.

**Single document status field**: No. An EDMS with both internal workflows and external transmittals needs to represent parallel states. The current model forces a linear history where one status overwrites the previous. The correct model separates `internalStatus` (draft / under_review / approved) from `externalStatus` (none / pending_review / approved_with_comments / for_revision / approved / rejected), computed independently. Both are shown on the document card. Neither overwrites the other.

**Acknowledge vs. complete-review**: The acknowledge endpoint should either be removed (complete-review already acknowledges) or redesigned to support authenticated-external access via share link. In its current state it is confusing and redundant.

---

## Journey J-08: Tasks and Notifications Retrospective Audit — Report

**Execution date:** 2026-06-29
**Status: CLOSED — 2026-06-29**
**Levels reached:** Works ✓ (partial — internal only) | Operates ✗ | Manages ✗

---

### Tasks Audit

**Endpoint:** `GET /api/tasks` (not `/api/projects/:id/tasks` — project-scoped variant returns 404)

**State at end of all journeys (J-01 through J-07):**

| Actor | Tasks visible | Tasks assigned to them | Status breakdown |
|---|---|---|---|
| DC (id=4) | 7 | 0 | — |
| ENG (id=5) | 7 | 0 | — |
| PM (id=6) | 7 | 7 (all) | 7 pending, 0 completed |
| CREV (id=7) | 0 | 0 | — |
| PM_HMT (id=8) | 0 | 0 | — |
| OWNER (id=10) | 0 | 0 | — |

**Observations:**
1. **All 7 tasks assigned to PM (id=6, Sara Al-Benna, org 2)** — every transmittal send created one "Review transmittal" task for PM. CREV (the intended external reviewer), PM_HMT, and OWNER received zero tasks.
2. **DC and ENG both see the same 7 tasks** — the task list shows all tasks in the org/project regardless of assignee. There is no "my tasks" filter in the API response — the caller sees all tasks, not just their own.
3. **All 7 tasks are `sourceType="manual"`** — despite being created by the transmittal send event. No task was created by the workflow engine (stage assignments, returns, advances).
4. **All 7 tasks status=`pending`** — no task was ever auto-completed. TXN-004 (J-04, acknowledged) and TXN-006 (J-05, acknowledged via complete-review) still have `pending` tasks. Task lifecycle is not linked to any workflow or transmittal state change.
5. **No workflow tasks** — no task appears for ENG's Stage 1 review or PM's Stage 2 review across any of the 8 workflow instances. Workflow stage assignments generate only notifications, not tasks.
6. **CREV, PM_HMT, OWNER — no tasks ever**: External reviewers across all three orgs received no tasks from any transmittal, workflow, or correspondence event. The task system exists only within org 2.

**Task titles (all 7):**
```
id=1  "Review transmittal: TRS-HMT-ABC-0001"  → TXN-001 (J-01)
id=2  "Review transmittal: TRS-HMT-ABC-0002"  → TXN-003 (J-03)
id=3  "Review transmittal: TRS-HMT-ABC-0004"  → TXN-004 (J-04)
id=4  "Review transmittal: TRS-HMT-ABC-0006"  → TXN-006 (J-05)
id=5  "Review transmittal: TRS-HMT-ABC-0008"  → TXN-007 (J-06) — wrong ref (J06-004)
id=6  "Review transmittal: TRS-HMT-ABC-0012"  → TXN-012 (J-07/F-02)
id=7  "Review transmittal: TRS-HMT-ABC-0013"  → TXN-013 (J-07/F-05)
```

---

### Notifications Audit

**Endpoint:** `GET /api/notifications` (project-scoped variant returns 404)

| Actor | Total notifications | Unread | Types received |
|---|---|---|---|
| DC (id=4) | 0 | 0 | — |
| ENG (id=5) | 17 | 17 | `workflow_action_required` (7), `document_uploaded` (8), `correspondence_received` (2) |
| PM (id=6) | 28 | 28 | `workflow_action_required` (13), `document_uploaded` (8), `task_assigned` (7) |
| CREV (id=7) | 8 | 8 | `document_uploaded` (8) |
| PM_HMT (id=8) | 8 | 8 | `document_uploaded` (8) |
| OWNER (id=10) | 8 | 8 | `document_uploaded` (8) |

**Key observations:**

1. **DC receives 0 notifications** — the initiator of all workflows (8 instances), transmittals (13 transmittals), and documents (18 documents) is never notified about any event. No `workflow_completed`, no `workflow_rejected`, no `transmittal_acknowledged`. The DC who controls all document activity has the least visibility of any actor.

2. **Workflow notifications work for internal actors** — ENG received 7 `workflow_action_required` (all stage 1 assignments across 8 workflows). PM received 13 (stage 2 + stage 3 assignments). The internal workflow notification path is functional.

3. **No transmittal notifications for external reviewers** — CREV (org 3) received 8 `document_uploaded` notifications and ZERO transmittal notifications. Despite receiving 6 transmittals as the designated reviewer (TXN-001, TXN-003, TXN-004, TXN-006, TXN-007 forwarded, TXN-009), CREV has no `transmittal_received` or `transmittal_for_review` notification. Same for PM_HMT and OWNER.

4. **`correspondence_received` reaches ENG (2 times)** — ENG was the `toUserId` on 2 correspondence records (the J-05 RFI and possibly one other). The notification was sent. But ENG cannot read the correspondence (J05-001 — cross-org read blocked). Notification arrives, action is impossible.

5. **No mark-as-read endpoint** — `PUT /notifications/:id/read` → 404. `PATCH /notifications/:id` → 404. All 53 notifications across ENG and PM are permanently unread with no API surface to change this. The unread count will never decrease.

6. **`document_uploaded` is broadcast** — every new document created in the project sends notifications to all project members across all orgs. CREV, PM_HMT, and OWNER all receive `document_uploaded` for every DC-created document in org 2's project. This is over-notification for external orgs (they don't need to know about every internal document upload).

7. **`task_assigned` for PM** — PM received 7 `task_assigned` notifications, matching the 7 tasks in the task system. This confirms that tasks ARE linked to notifications — but tasks only exist for PM, and the notification is "you have a task" not "review received."

---

### LOS Questions from J-08 Script

| Question | Answer |
|---|---|
| Do tasks from completed workflows appear in closed/historical view? | No completed tasks in the system — none were auto-closed |
| Can a user see tasks across all projects? | Yes — task list appears to be org-wide, not project-filtered |
| Are task descriptions meaningful? | Yes — "Review transmittal: [ref]" with subject as description |
| Is there a due date on any task? | Yes — auto-set to 7 days from creation on transmittal tasks |
| Which notification types exist? | `workflow_action_required`, `document_uploaded`, `correspondence_received`, `task_assigned` |
| Are notifications delivered in-app, by email, or both? | In-app only (confirmed by API) — no email evidence |
| Can a user mark notifications as read? | NO — mark-as-read endpoint returns 404 |
| Do notifications contain a direct link? | Yes — `entityType` and `entityId` fields allow navigation |
| Is there a notification for overdue tasks? | Not observed |

---

#### New Findings (J-08)

| ID | Type | Priority | Title |
|---|---|---|---|
| J08-001 | BUG | P1 | Transmittal review tasks assigned to internal PM, not to external reviewer — external party receives no task signal |
| J08-002 | LOS-REQ | P1 | External reviewers (CREV, PM_HMT, OWNER) receive zero transmittal notifications — designated reviewer has no in-system signal of receipt |
| J08-003 | BUG | P2 | No mark-as-read endpoint for notifications — all notifications are permanently unread |
| J08-004 | LOS-REQ | P2 | DC (initiator) receives 0 notifications — no feedback on workflow completion, transmittal acknowledgment, or stage advances |
| J08-005 | BUG/UX | P2 | Task lifecycle not linked to transmittal/workflow state — tasks never auto-close |
| J08-006 | UX | P3 | Task list shows all tasks (org-wide), not just caller's assigned tasks — no "my tasks" filter in API |
| J08-007 | UX | P3 | `correspondence_received` notification arrives for cross-org RFI recipient (ENG) but ENG cannot read the correspondence — notification creates an actionless dead end |
| J08-008 | UX | P3 | `document_uploaded` broadcast to all orgs — external reviewers notified of every internal document, regardless of relevance |

---

#### J-08 Pattern Updates

**SP-002 (Opposite Isolation Policies):** Notifications confirm the pattern. `document_uploaded` is broadcast to all orgs (no isolation), but correspondence read is org-isolated (full isolation), and transmittal notifications don't reach external orgs at all. Three different notification behaviors for three types of cross-org content.

**SP-006 (Missing Cross-Module Linkage):** The `entityType`/`entityId` fields on notifications provide some linkage — but transmittal notifications are never sent to external reviewers, making the linkage moot for the most important use case.

---

## Journey J-07: Flexibility Matrix — Eight Boundary Cases — Report

**Execution date:** 2026-06-29
**Status: CLOSED — 2026-06-29**
**Levels reached:** Works ✓ (partial) | Operates ✗ | Manages N/A

*Each F-case is independent. Evaluation is per-case: Allowed / Warns / Blocks.*

---

### F-01: Workflow on Already-Approved Document

**Result: ALLOWED — no warning, no prior-approval notice**

- Doc 15 (status=`approved` from J-05 external review Code A) → `POST /workflow-engine/instances` with templateId=6 → new instance wf7 created.
- Doc 15 status changed from `approved` → `under_review`. No block. No "this document was already approved" notice. No history notice citing the prior approval.
- Prior Code A approval (from TXN-6) is now invisible in document status — overwritten by workflow start (SP-005, syncDocumentStatus pattern).

**Classification: POLICY** — Starting a new workflow on an approved document is correct EDMS behavior (documents may need re-review after changes). The gap: no "prior approval will be overridden" warning, and the approved status disappears without trace in the document view. This is SP-005 again, now confirmed for approved-by-transmittal documents.

**SP-003 update:** wf7 (doc 15) will deadlock at Stage 3 — same condition confirmed.

---

### F-02: Transmittal with Document in Active Workflow

**Result: ALLOWED — no warning**

- Doc 11 has active wf1 (status=`under_review`, active instance at Stage 3 deadlock).
- `POST /transmittals` with `documentIds=[11]` → TXN id=12 created (status=draft). `/send` → status=`sent`. No block, no "this document is currently in an active workflow" warning.
- Correct flexibility behavior — confirmed extension of J01-005 / J04-001 policy pattern.

**Classification: POLICY (confirmed)** — The system consistently allows transmittals on documents regardless of workflow state. The missing element is a warning signal, not a block. This is the correct design for EDMS (timelines often require parallel processes). The absence of any indicator on the transmittal that the document was in active review at time of send is the LOS-REQ gap.

---

### F-03: Return Action from Middle Stage — Incorrect Forward Advance

**Result: WORKS technically (no error) but produces WRONG stage transition**

Execution trace on wf8 (doc 18, template 6):
1. DC starts workflow → Stage 1 "Checker Review" (stageId=19, responsibleUserId=5 ENG)
2. ENG calls `action="approved"` → advances to Stage 2 "Senior Engineer Review" (stageId=20)
3. PM calls `action="returned"` from Stage 2 → **advances to Stage 3 "Approved for Construction" (stageId=21)** — NOT back to Stage 1

After step 3: wf8 is at Stage 3 (no responsible, canAct=false for all) → SP-003 deadlock. ENG and PM both get 403 on any further advance. Return path is destroyed.

**Transition evidence:**
```
id=22: fromStageId=20 ("Senior Engineer Review") → toStageId=21 ("Approved for Construction"), action="returned", actorId=6
```

**Expected:** `returned` from Stage 2 → back to Stage 1 (previous stage) for rework by ENG.
**Observed:** `returned` from Stage 2 → Stage 3 (next stage) — same movement as `action="approved"`.

**Contrast with J-02 (F-03 reference):** `returned` from Stage 1 kept the workflow at Stage 1 (no previous stage to go to). This is consistent with "return = go to previous stage; Stage 1 has no previous stage so stays." But from Stage 2, the previous stage should be Stage 1 — instead it went to Stage 3.

**Classification: BUG/P1** — The return routing for middle stages is broken. PM cannot send a document back to Stage 1 for rework. In any multi-stage workflow: "return" is the primary correction mechanism. If return doesn't reverse, the workflow system has no redo path — the document advances regardless of the action label used.

---

### F-04: Reject Mid-Chain (Workflow Inside Active Submission Chain)

**Result: NOT EXECUTABLE — J03-004 blocker**

The submission chain API returns 404 on all paths. No submission chain can be created. The test cannot be executed.

**Classification: BLOCKED by J03-004** — Record as: cannot determine whether workflow rejection affects submission chains until the chain API is built.

---

### F-05: Transmittal with Mixed Document Statuses

**Result: ALLOWED — all three statuses accepted in single transmittal**

TXN id=13 created with:
- doc 17 (status=`draft`)
- doc 15 (status=`approved`)
- doc 11 (status=`under_review` — active workflow)

All three items created (item ids=13, 14, 15). Transmittal sent. No block, no warning, no status-filter.

**Classification: POLICY (confirmed, expected)** — The system correctly allows transmittals with any document status mix. This is the correct EDMS behavior — the DC decides what to transmit and when. Flexibility preserved.

**Note:** Initial call showed `items=0` due to a field-name mismatch in the PowerShell response (the `items` were present when fetched directly — confirmed items=3 on GET /transmittals/13).

---

### F-06: Reopen Acknowledged Transmittal — Mixed Results

**Three operations tested on TXN-9 (status=acknowledged):**

| Operation | Result | Finding |
|---|---|---|
| `PATCH /transmittals/9/items/9` (change review code) | **BLOCKED** 403 | But for wrong reason — SP-001 (DC is not createdById of TXN-9, PM_HMT is). Not blocked by acknowledgment status. |
| `PUT /transmittals/9` (update subject) | **ALLOWED** — status remains `acknowledged` | **BUG** — acknowledged transmittal metadata can be freely updated. |
| `POST /transmittals/9/complete-review` (second review) | **BLOCKED** 403 | SP-001 pattern — DC is not createdById of TXN-9. |

**Critical observation:** Item PATCH and complete-review are blocked, but they're blocked by the **SP-001 authorization pattern** (wrong actor), not by the `acknowledged` status check. If DC were the `createdById` of TXN-9, they could:
1. PATCH item review codes on an acknowledged transmittal (no status lock)
2. Call complete-review again on an already-acknowledged transmittal (no idempotency check)

**Classification:**
- `PUT allowed on acknowledged`: **BUG/P2** — acknowledged transmittals should be immutable. Metadata changes after acknowledgment corrupt the audit record.
- `PATCH / complete-review accidentally blocked by wrong reason`: **DX** — the security model has a coincidental protection from SP-001 that masks the missing status-lock. If SP-001 is ever fixed, this protection disappears.

---

### F-07: Correspondence Without Document Link

**Result: ALLOWED — correct**

`POST /correspondence` with type=`letter`, no `linkedDocumentId` → id=4, `linkedDocumentId=null`. No block, no "document link required" validation.

**Classification: WORKS as expected** — Correspondence is an independent module. Free-standing letters, memos, notices are valid without document links. Flexibility preserved.

---

### F-08: Submission Chain — Add Step After Complete

**Result: NOT EXECUTABLE — J03-004 blocker**

Submission chain API returns 404. No chain exists to test against.

**Classification: BLOCKED by J03-004**

---

#### Summary Table

| Case | Result | Classification | Finding ID |
|---|---|---|---|
| F-01: Workflow on approved doc | ALLOWED, no warning | POLICY + LOS-REQ (SP-005 re-confirmed) | J07-001 |
| F-02: Transmittal on doc in active workflow | ALLOWED, no warning | POLICY (confirmed pattern) | (confirms J01-005) |
| F-03: Return from middle stage | WRONG DIRECTION — advances forward | BUG/P1 | J07-002 |
| F-04: Reject mid-chain | NOT EXECUTABLE (J03-004 blocker) | BLOCKED | — |
| F-05: Mixed-status transmittal | ALLOWED | POLICY (correct) | (confirms J01-005) |
| F-06a: PATCH on acknowledged TXN | BLOCKED (wrong reason) | DX (SP-001 coincidental guard) | J07-003 |
| F-06b: PUT on acknowledged TXN | ALLOWED — audit corruption | BUG/P2 | J07-004 |
| F-07: Correspondence without doc link | ALLOWED | WORKS (expected) | — |
| F-08: Add chain step after complete | NOT EXECUTABLE (J03-004 blocker) | BLOCKED | — |

---

#### New Findings (J-07)

| ID | Type | Priority | Title |
|---|---|---|---|
| J07-001 | LOS-REQ | P3 | No warning or history notice when starting workflow on previously-approved document — prior approval silently overwritten |
| J07-002 | BUG | P1 | `returned` action from middle stage advances FORWARD to next stage instead of returning to previous stage |
| J07-003 | DX | P2 | Acknowledged TXN item PATCH blocked by SP-001 (wrong reason) — status-lock does not exist; fix of SP-001 would expose audit modification |
| J07-004 | BUG | P2 | PUT on acknowledged transmittal is allowed — metadata can be modified after acknowledgment, corrupting the audit record |
| J08-001 | BUG | P1 | Transmittal review tasks assigned to internal PM (id=6), not to the external reviewer — CREV/PM_HMT/OWNER receive zero tasks from any event |
| J08-002 | LOS-REQ | P1 | External reviewers receive zero transmittal-specific notifications — designated reviewer has no in-system signal that a transmittal arrived for review |
| J08-003 | BUG | P2 | No mark-as-read endpoint exists for notifications — `PUT /notifications/:id/read` and `PATCH /notifications/:id` both return 404; all notifications are permanently unread |
| J08-004 | LOS-REQ | P2 | DC (initiator, id=4) receives 0 notifications across all journeys — no `workflow_completed`, `transmittal_acknowledged`, or `correspondence_replied` event reaches the originating party |
| J08-005 | BUG | P2 | Task lifecycle not linked to transmittal or workflow state — tasks are never auto-closed when the associated transmittal is acknowledged or the workflow stage completes |
| J08-006 | UX | P3 | Task list API returns all org tasks to any authenticated caller regardless of assignee — no "my tasks" filter; DC and ENG see PM's tasks |
| J08-007 | UX | P3 | `correspondence_received` notification is delivered to ENG for a cross-org RFI that ENG cannot read (J05-001) — notification creates an actionless dead end |
| J08-008 | UX | P3 | `document_uploaded` is broadcast to all project members including external orgs — CREV/PM_HMT/OWNER notified of every internal DC document upload regardless of relevance |

---

#### J-07 Pattern Updates

**SP-001 (External Reviewer Authorization Collapse):** No new direct evidence. F-06 confirms the `isAssigned` check is the gating mechanism for item PATCH and complete-review — neither checks `transmittal.status`.

**SP-003 (Terminal Stage Deadlock):** wf7 (F-01) and wf8 (F-03) both confirmed deadlocking at Stage 3. F-03 introduces a new path to deadlock via the broken `returned` routing from Stage 2.

**SP-005 (Single Status Field):** F-01 confirms — starting a new workflow on an externally-approved document silently overwrites the `approved` status with `under_review`, no warning.

**New pattern candidate (F-03):** Return action routing is inconsistent across stages. Stage 1 → stays at Stage 1. Stage 2 → advances to Stage 3 (not to Stage 1). This may warrant SP-009 if confirmed in other templates.

---

## Journey J-05: Correspondence Mid-Flight — RFI During Transmittal Review — Report

**Execution date:** 2026-06-28
**Status: CLOSED — 2026-06-28**
**Levels reached:** Works ✓ (partial) | Operates ✗ | Manages ✗

**Operational Cost:**
| Metric | Count | Notes |
|---|---|---|
| User decisions required | 3 | (1) CREV cannot complete review — must route back to DC. (2) DC must complete review on behalf of CREV (createdById workaround). (3) DC_HMT (org 3 DC) must close the RFI — engineer (org 2) cannot. |
| Context switches | 4 | (1) RFI created in correspondence module — no link back to transmittal 6. (2) DC blocked from reading the RFI even as CC'd party. (3) DC_HMT must close RFI (different org). (4) DC (org 2) must complete the review because CREV (org 3) lacks permission. |
| Read/interpret moments | 3 | (1) No signal that transmittal review is "on hold" due to RFI. (2) No notification to engineer that an RFI was raised. (3) RFI closure not visible to org 2 — DC cannot see the RFI was resolved before authorizing review completion. |
| Blockers encountered | 2 | (1) CREV cannot complete-review (toUserId=null — J03-001 cascade). DC completed as workaround. (2) Engineer + DC (org 2) cannot reply to or even READ CREV's RFI — full cross-org read block, not just reply block. |

---

#### 9. New User Test

**Would a user who has never seen ArcScale complete J-05 without any explanation?**

**No. J-05 requires cross-module coordination that the system does not visually support.**

The scenario assumes a natural flow: reviewer raises RFI → contractor responds → reviewer resumes review. ArcScale does not surface this flow at any level:

1. **RFI is invisible to contractor**: The engineer (the person the RFI was addressed to) receives a 403 on read. They cannot see, open, or respond to the RFI. DC (cc'd) also gets 403. The RFI is invisible to the entire contractor org.

2. **No "on hold" indicator on transmittal**: Transmittal 6 shows status=`sent` throughout. No badge, no flag, no linked correspondence. From the contractor's perspective, the transmittal is simply waiting — with no indication why.

3. **Reviewer must complete their own RFI resolution**: Because the engineer cannot reply, CREV created a self-reply to close the RFI. In a real project, the resolution would contain the engineer's actual technical answer — the system cannot receive it.

4. **Review completion requires wrong actor**: CREV cannot call `complete-review` because `toUserId` is null. DC (who created the transmittal) must act. This means the review code, the reviewer's comments, and the response transmittal are all created by the sender — not the reviewer. The audit trail says DC approved their own submission.

**Verdict**: J-05 is not completable as designed by ArcScale. The RFI mechanism requires the contractor org to participate in correspondence created by the consultant org. The system architecturally prevents this. The journey only concluded because the test environment allowed CREV to close the RFI themselves (which would not happen in production) and DC to stand in for CREV on complete-review (which defeats the purpose of the review).

---

#### 1. What Worked

- **Transmittal 6 creation**: DC created `TRS-HMT-ABC-0006` with doc 15 (status=`draft`). Consistent with J01-005 / J04-001 (Policy finding — no draft block). ✓
- **CREV creates RFI**: `POST /correspondence` with type=`rfi` succeeded from CREV (org 3). RFI id=1, ref=`HMT-ABC-2026-0001`, status=`sent`. ✓
- **CREV self-reply**: CREV (org 3) can reply to own org's correspondence (id=3, status=`sent`). Intra-org reply works. ✓
- **DC_HMT closes RFI**: DC_HMT (id=9, org 3, document_controller) closed the RFI via `PUT /correspondence/1`. `canClose` check passes for `document_controller` within same org. ✓
- **Item PATCH by createdById**: DC (createdById) set reviewCode=`A` on transmittal item 6 via `PATCH /transmittals/6/items/6`. ✓
- **complete-review by createdById**: DC completed review as createdById workaround. Transmittal 6 → status=`acknowledged`. Document 15 → status=`approved`. Response transmittal auto-created. ✓
- **`linkedDocumentId` probe** (pre-confirmed): Passing `linkedDocumentId` in POST body silently ignored — not in destructuring, not in DB insert. Confirmed null in response. ✓ (finding already recorded as J05-004)

#### 2. What Failed / Blocked

- **Engineer (org 2) cannot READ the RFI** (J05-001 stronger than pre-confirmed): Not just `reply` blocked — `GET /correspondence/1` returns 403 TENANT_ISOLATION_VIOLATION for Engineer (id=5, org 2), even though they are `toUserId` in the RFI. The tenant isolation check runs before any toUser/cc check.
- **DC (org 2) cannot READ the RFI** (J05-001 cascade): DC (id=4, org 2) was CC'd on the RFI. Still gets 403. CC does not grant cross-org read access. The entire org 2 is locked out of the RFI.
- **CREV cannot complete-review** (J03-001 cascade — J05-003): CREV (id=7) gets 403 on `POST /transmittals/6/complete-review`. Check: `isAssigned = transmittal.toUserId === caller.id || transmittal.createdById === caller.id`. `toUserId` is null (API never accepts it), `createdById=4 ≠ 7`. CREV is the intended reviewer but cannot complete the review.
- **No visible linkage between RFI and transmittal 6** (J05-005): GET /transmittals/6 contains no `correspondenceId`, no `linkedRfi`, no `onHold` flag. GET /correspondence/1 contains no `transmittalId`. The two records exist in isolation. No API surface connects them.
- **`linkedDocumentId` silently ignored** (J05-004): Confirmed in Phase B. Passing `linkedDocumentId=15` in POST body → field is not in destructuring → not stored → null in response. Document linkage to correspondence is a schema artifact only.

#### 3. What Confused the User

- **RFI goes to the wrong place**: CREV addressed the RFI to engineer (org 2). Engineer cannot access it. The "to" field is cosmetic — it does not route the correspondence to a reachable user across orgs. There is no "sent to an unreachable party" warning.
- **No "on hold" state**: During the RFI period, transmittal 6 shows status=`sent`. The reviewer intends to pause review until the RFI is answered. The system has no mechanism to record or display this pause. From DC's view, the transmittal could be: (a) with the reviewer and they're slow, or (b) paused waiting for an RFI answer. These are indistinguishable.
- **DC can't see what they're unblocking**: When DC calls complete-review, they don't know if the RFI has been answered — they can't read it. DC is completing a review on behalf of CREV, for a document where CREV had a technical question that DC cannot see.

#### 4. What Confused the Manager

- **No cross-module timeline**: PM (org 2) looking at project state sees: transmittal sent, no update. PM cannot see that an RFI was raised, that engineer was asked a question, or that the RFI was closed. The correspondence module is a separate island.
- **Transmittal status never shows "waiting on RFI"**: From PM's view, transmittal 6 is `sent` for the entire duration of the scenario. No state change reflects the RFI lifecycle.
- **Review completed by sender**: Document 15 shows status=`approved` — but the approval was logged by DC (transmittal creator), not CREV (the reviewer). PM cannot tell from document history who actually reviewed it.

#### 5. What This Revealed About Live Operational State

- *"Is our transmittal on hold because HMT has a question?"* — Not visible. Transmittal shows `sent` regardless of open RFIs.
- *"Has engineer responded to HMT's question yet?"* — Not visible. Engineer cannot even read the question. RFI is org-isolated.
- *"What was the question and what was the answer before approval?"* — Not reconstructable. No link between transmittal 6, RFI 1, and document 15 approval event.
- *"Who reviewed and approved SD-005?"* — Answer is DC (creator), not CREV (reviewer). The audit trail is inverted.

#### 6. What This Revealed About System Flexibility

**Missing flexibility**:
- No cross-org correspondence: The RFI pattern assumes correspondent and respondent are in different orgs. The system's tenant isolation blocks this at the read level — not just write. An RFI sent across orgs is a one-way letter with no return address.
- No "pause" state on transmittals: Transmittals can be sent, acknowledged, or recalled. No "on hold" state exists. A transmittal waiting on an RFI is indistinguishable from one that's simply being slow.
- No transmittal-to-correspondence linkage: The system has no mechanism to say "this RFI is related to this transmittal." The `linked_document_id` field was the closest mechanism — and it doesn't work via the API.

**Positive flexibility (noting absence)**:
- System did not block DC from completing review on behalf of CREV. The `createdById` check that allows this is technically flexible — but practically it means the sender can impersonate the receiver on review actions.

#### 7. What This Revealed About Architecture

- **ARCH-012** (J05-001): `GET /correspondence/:id` runs `organizationId !== caller.organizationId` check unconditionally before any role or recipient check. Cross-org read is structurally impossible regardless of `toUserId`, `ccUserId`, or correspondence content. This means any cross-org correspondence type (RFI, notice, submittal, technical_query) is single-direction only: readable only by the creating org, invisible to the receiving org.
- **ARCH-013** (J05-003): The `isAssigned` check in `complete-review` (`toUserId === caller.id || createdById === caller.id`) combined with `toUserId` never being set via API (ARCH-006) means the external reviewer can never complete their own review. Only the transmittal creator (internal DC) can complete-review, making the entire external review mechanism self-referential: the sender controls the review outcome.
- **ARCH-014** (J05-004/J05-005): No data model for cross-module linkage between correspondence and transmittals. `linked_document_id` exists in schema but is not in the API. There is no `transmittal_id` field in the correspondence table at all. Two of the three intended linkage axes (doc↔correspondence, transmittal↔correspondence) are either broken or non-existent.

#### 8. Would We Design This the Same Way?

**Tenant isolation on correspondence read**: No. The current implementation treats correspondence as org-private records. This works for internal memo/letter types but breaks for external-facing types (RFI, technical_query, submittal, notice). A correct implementation would distinguish: org-private types stay isolated, cross-org types should be readable by named `toUserId`/`ccUserId` participants regardless of org, with write/reply restricted to the creating org unless a reply-enabled type is chosen.

**`toUserId` null from API (createdById workaround)**: No (confirmed re-finding of J03-001). The complete-review mechanism is designed for an external reviewer to close. The fact that only `createdById` can complete-review turns the external review into an internal rubber stamp.

**No transmittal pause state**: The missing state is the correct absence of a premature feature. Adding an RFI-linked "on hold" transmittal state before the cross-org correspondence read is fixed would add complexity without enabling the core use case. Fix the read isolation first; the pause-state LOS requirement is downstream.

---

#### New Findings (J-05)

| ID | Type | Priority | Title |
|---|---|---|---|
| J05-001 | BUG / Security | P1 | Cross-org correspondence is fully read-blocked — toUserId and ccUserId receive no access |
| J05-002 | LOS-REQ | P2 | No "on hold" state or RFI linkage on transmittal — review pause is invisible |
| J05-003 | BUG | P2 | CREV cannot complete-review own assigned transmittal (J03-001 cascade) |
| J05-004 | BUG | P3 | `linkedDocumentId` silently ignored in correspondence POST |
| J05-005 | LOS-REQ | P2 | No transmittal↔correspondence linkage — cross-module history is unrecoverable |

---

## Journey J-06: Three-Party Submission Chain — Contractor → Consultant → Owner — Report

**Execution date:** 2026-06-28
**Status: CLOSED — 2026-06-28**
**Levels reached:** Works ✓ (partial) | Operates ✗ | Manages ✗

**Chain executed:**
```
ABC (org 2)  →  HMT (org 3)  →  POA (org 4)
  TXN-007         TXN-008
                (Owner Code A)
                       ↓
ABC (org 2)  ←  HMT (org 3)
  TXN-011         TXN-011
```

**Operational Cost:**
| Metric | Count | Notes |
|---|---|---|
| User decisions required | 3 | (1) OWNER cannot complete-review (toUserId bug — J03-001 cascade #3). PM_HMT completes as createdById workaround. (2) PM_HMT manually creates TXN-011 to forward Code A back to Contractor — unaware complete-review auto-created a duplicate draft TXN-010. (3) No submission chain to record chain steps — PM_HMT must reconstruct the chain from memory. |
| Context switches | 3 | (1) No chain view — PM_HMT must hold the chain in memory across three transmittals. (2) Auto-created ghost TXN-010 (draft) clutters transmittal list — DC has no way to dismiss it. (3) DC must manually find TXN-011 — no "response received" notification or link from TXN-007. |
| Read/interpret moments | 3 | (1) All org users can read all transmittals — DC reads TXN-008 (HMT→Owner), OWNER reads TXN-007 (Contractor→Consultant). No org-scoping. (2) Ghost TXN-010 (draft response auto-created by complete-review) sits in PM_HMT's transmittal list with no context. (3) No chain progress indicator — DC cannot tell if TXN-007 has reached the Owner or is still with HMT. |
| Blockers encountered | 2 | (1) Submission chain API returns 404 on all paths — confirmed J03-004 for J-06. No submission chain can be recorded. (2) OWNER cannot complete-review (J03-001 cascade) — PM_HMT must proxy the Owner's decision. |

---

#### 9. New User Test

**Would a user who has never seen ArcScale complete J-06 without any explanation?**

**No. J-06 requires a submission chain concept that the system cannot represent.**

1. **No chain starting point**: DC has no "create submission chain" action. The intended flow (J-06 Step A-2) requires creating a Submission Chain record before TXN-007. The API returns 404 on all chain paths. DC must send TXN-007 with no chain record — the chain exists only in PM_HMT's mental model.

2. **No forwarding concept on transmittals**: PM_HMT receives TXN-007 and decides to forward to Owner. The system has no "forward" action on a transmittal — PM_HMT must create a new transmittal (TXN-008) from scratch, manually selecting the same document. There is no link between TXN-007 and TXN-008 in the system.

3. **Owner cannot complete their own review**: OWNER (id=10, org 4) receives TXN-008 but gets 403 on both item PATCH and `complete-review`. PM_HMT must proxy the Owner's Code A. This means the Owner's review decision is recorded under PM_HMT's identity — a complete misrepresentation of the actual approval chain.

4. **Ghost transmittal after complete-review**: PM_HMT calls `complete-review` on TXN-008. The system auto-creates TXN-010 (draft, responseToId=9). PM_HMT does not know this exists and creates TXN-011 manually. DC now has two response transmittals for the same event — one ghost draft and one live acknowledged. No warning, no deduplication, no "you already have a response" check.

5. **No chain status**: DC sends TXN-007 and has no way to know if it reached the Owner, what the Owner decided, or how many times it was forwarded. The chain is invisible.

**Verdict**: J-06 is the scenario where the submission chain gap has the most visible operational impact. The three-party chain is a common construction project pattern. Without chain records, forwarding actions, and cross-org review completion, the flow degrades to manual tracking with inverted audit trails.

---

#### 1. What Worked

- **Cross-org transmittal read**: All project members (DC/org 2, PM_HMT/org 3, OWNER/org 4) can read any transmittal in project 2. No org-based filtering. DC could read TXN-008 (Consultant→Owner) and TXN-010. OWNER could read TXN-007 (Contractor→Consultant). Transmittals are project-scoped, not org-scoped. ✓ (But see J06-001 over-sharing finding below)
- **TXN-008 Code A applied to document 16**: `complete-review` with Code A set doc 16 to `status=approved`. Correct document status transition. ✓
- **DC acknowledges TXN-011**: DC can acknowledge a transmittal created by org 3. Cross-org acknowledge works. ✓
- **Submission chain API 404**: Confirmed (J03-004 re-confirmed). All 4 probed paths return 404. The absence is consistent — no partial implementation to worry about.
- **PM_HMT patches item as createdById**: PM_HMT (createdById for TXN-008) can set reviewCode=A on TXN-008's item. Same workaround pattern as J-03 (DC), J-05 (DC), J-06 (PM_HMT). Pattern is now confirmed as systemic. ✓

#### 2. What Failed / Blocked

- **Submission chain API** (J03-004, confirmed): All submission chain paths return 404. No chain record can be created for the three-part journey. The link between TXN-007 → TXN-008 → TXN-011 is unrecorded at the system level.
- **OWNER cannot complete-review or PATCH item** (J03-001 cascade — J06-003): OWNER (id=10) gets 403 on both `PATCH /:id/items/:itemId` and `POST /:id/complete-review`. Third confirmation of the toUserId bug. PM_HMT (sender) completes the review instead.
- **Ghost TXN-010 created by complete-review** (J06-002): `complete-review` on TXN-008 auto-creates TXN-010 (draft, responseToId=9). PM_HMT was unaware and manually created TXN-011. DC now sees two response events for the same Owner approval. No deduplication check before creating the response transmittal.
- **Transmittal reference field never stored** (J06-004): `reference` field in both POST and PUT transmittal body is never stored — all transmittals show `ref=''` in GET responses. Confirmed across TXN-007 (id=8), TXN-008 (id=9), TXN-009/011 (id=11). Earlier transmittals (id=6) also confirm blank ref. The reference field is accepted silently and discarded.
- **No forwarding link between TXN-007 and TXN-008**: The two transmittals carry the same document (16) across different orgs but have no foreign-key relationship. The chain only exists in PM_HMT's memory. `GET /transmittals/8` has no `forwardedTo`, `chainId`, or `parentTransmittalId` field.

#### 3. What Confused the User

- **Over-sharing on transmittals**: DC can read TXN-008 (HMT→Owner content). OWNER can read TXN-007 (Contractor→Consultant content). These are confidential inter-party communications that should be scoped to the parties involved. The system broadcasts all transmittals to all project members across all orgs — the opposite of the correspondence isolation problem (J05-001). The two modules apply opposite policies with opposite errors.
- **Ghost TXN-010**: PM_HMT has a draft transmittal (TXN-010) they didn't create intentionally. It shows as `draft` in their list. They cannot tell if someone else created it, if it's a system artifact, or if they started and forgot to complete it.
- **No chain progress for DC**: After sending TXN-007, DC sees status=`sent`. The transmittal stays `sent` until TXN-011 arrives. DC has no way to track whether TXN-007 was forwarded to the Owner, received, or is still with HMT. From DC's view, TXN-007 is simply "out there."

#### 4. What Confused the Manager

- **No chain history view**: PM looking at project 2 sees transmittals 7, 8, 10, 11 as independent items. No view shows "TXN-007 was received by HMT, forwarded to Owner as TXN-008, Owner issued Code A, HMT notified ABC via TXN-011." The chain is recoverable by manually cross-referencing four transmittals, but there is no system-provided reconstruction.
- **Who approved the document?**: Document 16 shows `status=approved`. The approval was triggered by PM_HMT completing TXN-008's review (as Code A). But the actual decision was the OWNER's. The PM looking at document 16 cannot tell: was this approved by HMT, by POA, or by both?
- **Two "responses" for one review**: TXN-010 (ghost draft) and TXN-011 (acknowledged) both exist for the same Owner review event. PM cannot tell which is the authoritative response.

#### 5. What This Revealed About Live Operational State

- *"Has HMT forwarded our drawing to the Owner yet?"* — Not visible. TXN-007 shows `sent` whether it's with HMT or has been forwarded.
- *"The Owner issued Code A — is that recorded under the Owner's name or under HMT's name?"* — Recorded under PM_HMT (id=8). The Owner's identity is not in the system approval record.
- *"Where are all the transmittals for document 16 — and what did each org say?"* — Requires manually reviewing TXN-007, TXN-008, TXN-011. Each has independent context. No joined view exists.
- *"What is the complete chain history for this document from Contractor through to Owner approval?"* — Cannot be reconstructed from a single view. The chain must be traced manually by document number across the transmittal list.

#### 6. What This Revealed About System Flexibility

**Critically missing flexibility**:
- No chain concept: The most common construction chain (Contractor → Consultant → Owner) has no system representation. PM_HMT must manually forward with no link to the original transmittal.
- No forwarding action: "Forward this transmittal to another org" is a common action that the system cannot express. PM_HMT must create a new transmittal with the same document — the relationship is lost.
- No "current custodian" tracking: For a document in a multi-party chain, there is no field indicating "currently with Owner." DC cannot know where in the chain the document sits.

**Revealing inconsistency**:
- Transmittals are fully cross-org readable. Correspondence is fully cross-org blocked. Two modules, opposite policies, both applied universally. This suggests the isolation model was not consistently designed across the application.

#### 7. What This Revealed About Architecture

- **ARCH-015** (J06-001): Transmittals are project-scoped with no org-based filtering. All transmittals in a project are readable by all project members regardless of org. This is the opposite of correspondence (ARCH-012). Both policies are applied absolutely — there is no "shared with your org only" scoping on either module. The correct model is: party-scoped (readable by sender org and explicitly named receiver org), not project-wide broadcast.
- **ARCH-016** (J06-002): `complete-review` unconditionally creates a response transmittal via `createResponseTransmittal()`. No check is made for whether the creator intends to send a response or has already created one. In a three-party chain, this creates orphan draft transmittals that clutter the sender's transmittal list and cannot be disambiguated from intentional drafts.
- **ARCH-017** (J06-004): `transmittal.reference` field is accepted in the POST and PUT body but is not included in the route's destructuring or DB insert. All transmittal references are null. The `reference` column exists in the schema (used as a human-readable identifier like "TRS-HMT-ABC-0007") but is never stored via the API. This means all transmittals are identifiable only by auto-incremented `id` — there is no searchable human reference number.

#### 8. Would We Design This the Same Way?

**Project-wide transmittal visibility**: No. The correct model is party-scoped: a transmittal is visible to the sender org, the named receiver org, and any CC'd orgs. Broadcasting all transmittals to all project members allows DC to read confidential Consultant-Owner correspondence — a significant information boundary violation on real construction projects where each party has commercial sensitivities.

**Auto-create response transmittal in complete-review**: Conditional, not unconditional. The current design assumes every complete-review triggers a response transmittal. In a three-party chain, PM_HMT calling complete-review (on behalf of the Owner) creates a response from HMT back to itself — which is meaningless. The correct design: auto-create only if `responseToTransmittalId` is set and no draft response already exists; or make it an explicit opt-in.

**Submission chain**: The schema design is correct. The routes need to be built. J03-004 is confirmed a build gap, not an architectural gap. Priority: this should be the first API built before J-06 can be considered completable.

---

#### New Findings (J-06)

| ID | Type | Priority | Title |
|---|---|---|---|
| J06-001 | BUG / Security | P1 | All transmittals are project-wide readable — no org-scoping — any org member can read any transmittal |
| J06-002 | BUG / UX | P2 | `complete-review` unconditionally creates ghost draft response transmittal — no dedup check |
| J06-003 | BUG | P2 | OWNER cannot complete-review TXN-008 (J03-001 cascade #3 — pattern confirmed systemic) |
| J06-004 | BUG | P2 | Transmittal `reference` field silently discarded — never stored in POST or PUT |

---

---

# Final Summary Report

**Execution period:** 2026-06-27 – 2026-06-29
**Journeys completed:** J-01 through J-08 (8 of 8)
**Findings recorded:** 33 (P1: 7 · P2: 18 · P3: 8)
**System Patterns identified:** 11 (SP-001 through SP-011)
**Methodology:** No-Fix Rule active throughout. Evidence-only. No production data or logic touched.

---

## Tier 1: Individual Findings Summary

| Priority | Count | IDs |
|---|---|---|
| **P1 — Critical** | 7 | J01-004, J03-004, J05-001, J06-001, J07-002, J08-001, J08-002 |
| **P2 — High** | 18 | J01-002, J01-005, J02-001, J02-002, J04-001, J04-002, J04-003, J05-002, J05-003, J05-004, J05-005, J06-002, J06-003, J06-004, J07-004, J08-003, J08-004, J08-005 |
| **P3 — Medium** | 8 | J01-003, J07-001, J07-003, J08-006, J08-007, J08-008, J01-001(LOS), J07-003(DX) |

Full detail: see Findings Log (above).

---

## Tier 2: Cross-Journey Patterns

Eleven recurring patterns confirmed across multiple journeys. Patterns in bold indicate the root cause recurred in ≥3 distinct journeys.

| ID | Pattern | Journeys | Type |
|---|---|---|---|
| **SP-001** | **External Reviewer Authorization Collapse** | J-01, J-02, J-03, J-04, J-05, J-06, J-07 | Architectural |
| **SP-002** | **Opposite Isolation Policies (Correspondence vs. Transmittals)** | J-01, J-05, J-06 | Architectural |
| **SP-003** | **Terminal Stage Deadlock** | J-01, J-02, J-07 | Cross-Journey Bug |
| SP-004 | `complete-review` Side Effects Silent and Unstable | J-03, J-06 | Cross-Module |
| SP-005 | Single Status Field Per Document | J-01, J-02, J-07 | Architectural |
| SP-006 | Missing Cross-Module Linkage | J-01, J-05, J-06 | Architectural |
| SP-007 | Submission Chain API Routes All Return 404 | J-03, J-06 | Cross-Journey |
| SP-008 | Reference Fields Silently Discarded | J-01, J-06 | Cross-Module |
| SP-009 | `returned` Action Routing Inconsistent | J-02, J-07 | Cross-Journey Bug |
| **SP-010** | **Notification System Blind Spots — External Parties and Initiators** | J-01, J-05, J-08 | Architectural |
| **SP-011** | **Task System Operates Only Within Initiating Org** | J-01, J-04, J-08 | Architectural |

---

## Tier 3: Architectural Principles

Five principles derived from pattern clusters. These are not design recommendations — they are descriptions of what the evidence proved the system actually does.

---

### AP-01: The system is designed for intra-org workflow; cross-org collaboration is structurally absent

**Proven by:** SP-001, SP-010, SP-011, SP-002, J05-001, J06-001

The authorization model, task system, and notification system all operate within a single `organizationId` boundary. Every mechanism for cross-org action — external reviewer assignment (`toUserId`), task routing to external parties, transmittal notifications to receiver org — is either unpopulated or not implemented.

The data model supports multi-tenancy (four org IDs exist, foreign keys exist, `toUserId`/`toOrganizationId` fields exist), but the runtime never populates or enforces them for outbound actions. The system can *store* cross-org data but cannot *route* it.

**Consequence:** Every scenario involving a party outside the submitting org (J-03, J-05, J-06, J-07, J-08) required manual out-of-band workarounds to proceed. The external reviewer role is defined in the data model but is non-functional at every enforcement layer.

---

### AP-02: Module isolation is total — no module can see the state of another

**Proven by:** SP-006, SP-007, SP-008, J05-005, J06-001, LOS-J06-03

Transmittals, correspondence, workflows, tasks, and notifications operate as five independent systems. No module exposes its state to another:
- A transmittal does not reference which workflow it triggered
- A workflow does not reference which transmittal initiated it
- Correspondence cannot be linked to a transmittal (`linkedTransmittalId` field does not exist)
- The submission chain API (the one designed to bridge modules) returns 404 for all routes
- Tasks reference a transmittal by title string, not by foreign key

A DC cannot answer "what is the full chain of custody for document 12?" by querying the system. The answer spans transmittals (sent to HMT), workflow (HMT's internal review), correspondence (RFI raised mid-review), and another transmittal (HMT→Owner) — none of which reference each other.

**Consequence:** Every "where is document X in its journey?" question (LOS-J01-03, LOS-J06-01, LOS-J06-03) is unanswerable. Oversight — the Manages level — is structurally unreachable without a separate integration layer.

---

### AP-03: Workflow state transitions are irreversible, with no user-accessible recovery path

**Proven by:** SP-003, SP-009, J07-002, J01-004, J02-002

Two distinct conditions can produce a permanently deadlocked workflow that no user action can resolve:
1. **Missing `responsibleRole`/`responsibleUserId`** on a terminal stage (SP-003) — `canAct` returns false for everyone; no advance, no cancel, no reassign
2. **`returned` from Stage 2 advancing to Stage 3** (SP-009) — immediately triggers condition 1; wf8 deadlocked in J-07 F-03 and cannot be recovered

In both cases, the only recovery path is direct database access. No API endpoint exists for a PM or admin to cancel a workflow, reassign a stage, or unlock a deadlock.

**Consequence:** Production use of the 3-stage "Standard Review" template (template 6, confirmed in 8 workflow instances) will eventually produce unrecoverable document states. Every "return for rework" from Stage 2 by definition produces a deadlock. This is not a rare edge case — it is the only `returned` code path for any multi-stage review.

---

### AP-04: The notification and task architecture cannot support active project management

**Proven by:** SP-010, SP-011, J08-003, J08-004, J08-005, J08-006

The notification and task systems were audited against 6 actors after 8 journeys. The combined picture:

| What should exist | What exists |
|---|---|
| "Transmittal arrived for your review" → external reviewer | `document_uploaded` broadcast (irrelevant) |
| "Your submission was acknowledged" → DC/PM | Nothing |
| "Task completed" when transmittal acknowledged | Task stays `pending` forever |
| "Mark this notification read" | 404 |
| "Show me only my tasks" | API returns all org tasks |
| "Workflow stage returned to you" → ENG | Nothing (only `workflow_action_required` on advance, not return) |

The notification system functions as a one-way internal broadcast (internal workflow assignments + document uploads). It has no feedback loop to submitters, no actionable signals for external parties, and no state management (read/unread). A PM with 28 notifications has no way to distinguish "requires action today" from "informational, from last month."

**Consequence:** At any non-trivial project scale, the notification inbox becomes unusable noise. External parties have no system-level signal that work is waiting for them. The Operates level — sustained active use — requires the notification and task systems to be functional; they are not.

---

### AP-05: Audit integrity is structurally compromised in acknowledged records

**Proven by:** SP-004, SP-008, J07-004, J06-004, J06-002

Three independent mechanisms allow the audit record to be modified or created after the fact:
1. **Acknowledged transmittal is PUT-modifiable** (J07-004, BUG/P2) — metadata (subject, reference, description) can be changed after the receiver has acknowledged receipt
2. **Reference field always stored as null** (SP-008, J06-004) — the reference number (e.g., "HMT-ABC-0001") appears in PUT/POST request bodies but is never persisted; the audit record is always incomplete
3. **`complete-review` silently auto-creates a response transmittal** (SP-004, J06-002) — TXN-010 was created as a side effect of PM_HMT calling complete-review on TXN-008; this draft transmittal has no audit trail entry and is not announced in the API response

An acknowledged transmittal in an EDMS is the legal equivalent of a signed delivery receipt. If it can be modified after acknowledgment, the document of record does not match what the reviewer received.

**Consequence:** The system cannot produce a reliable audit trail for any transmittal that has been acknowledged. This is a regulatory compliance risk for projects subject to construction document control standards (ISO 19650, UK BIM Mandate equivalent standards).

---

## Production Readiness Assessment

**Assessment date:** 2026-06-29
**Method:** Functional testing across 8 business scenarios, 4 organizations, 6 users, 33 API surfaces

---

### Level Verdicts

| Level | Description | Verdict |
|---|---|---|
| **Works** | Individual mechanics function in isolation | ✓ PARTIAL |
| **Operates** | Sustained use across a project lifecycle | ✗ FAILS |
| **Manages** | Oversight and chain-of-custody visibility | ✗ FAILS |

---

### Works — What functions in isolation

- Document upload and metadata assignment
- Internal workflow advance (happy path, Stage 1→Stage 2 only)
- Transmittal create and send (within org — cross-org review non-functional)
- Internal task creation and notification on transmittal send
- `workflow_action_required` and `document_uploaded` notifications (internal actors)
- Correspondence create and read (within org only)
- Basic transmittal acknowledgment (initiating org)

These mechanics are sufficient for a single-org, single-reviewer, no-external-party workflow. They represent approximately 30% of the stated system scope.

---

### Critical Blockers (system cannot be used for its stated purpose)

| Blocker | Evidence | Scope |
|---|---|---|
| External reviewer role is non-functional | SP-001, J08-001, J08-002 | All cross-org review scenarios |
| Tenant isolation inverted for transmittals | SP-002, J06-001 | Every transmittal between orgs is readable by all project members |
| Workflow deadlock is permanent | SP-003, SP-009, J07-002 | Every 3-stage template using "return for rework" deadlocks irrecoverably |
| Submission chain API returns 404 | SP-007, J03-004 | Primary 3-party submission flow (DC→HMT→Owner) cannot execute |

Any one of these four conditions would be sufficient to block production use. All four are simultaneously active.

---

### Secondary Blockers (must be resolved before sustained operation)

| Issue | Evidence | Risk |
|---|---|---|
| No transmittal notifications for external parties | SP-010 | External reviewers must poll manually; workflow stalls |
| Acknowledged transmittal is PUT-modifiable | J07-004 | Audit integrity — legal/compliance risk |
| Reference field always stored null | SP-008 | All transmittal records missing reference number |
| No mark-as-read endpoint | J08-003 | Notification inbox becomes unusable noise |
| Complete-review creates silent ghost transmittals | SP-004, J06-002 | Uncontrolled object creation in production |
| `returned` from Stage 2 advances forward | SP-009 | Every multi-stage rework produces permanent deadlock |

---

### Recommended Resolution Order

This is not a redesign recommendation — it is a sequencing observation based on dependency. No fix is proposed here; this is the order in which the patterns must be addressed for each subsequent fix to have value.

1. **SP-001 (External Reviewer Authorization)** — without this, no cross-org scenario can be tested. All other external-party findings are untestable until CREV can act on a transmittal.
2. **SP-003 (Terminal Stage Deadlock)** — without this, all workflow testing produces permanent deadlocks. Blocks re-testing SP-009.
3. **SP-009 (Return Routing)** — depends on SP-003 fix (otherwise every "returned" immediately deadlocks).
4. **SP-007 (Submission Chain 404)** — without this, J-03 and J-06 three-party scenarios cannot run.
5. **SP-002 (Isolation Inversion)** — security: transmittal cross-org read must be scoped.
6. **SP-010/SP-011 (Notifications/Tasks)** — functional: re-test after SP-001 fix since external routing depends on external authorization.
7. **SP-004/SP-008 (Silent Side Effects / Reference Field)** — data integrity: lower operational risk, can follow functional fixes.

---

### Sign-off

**Journeys completed:** 8/8
**Methodology compliance:** No-Fix Rule observed throughout. No production data accessed. No production logic modified. All test actors (id=4–10) are seeded test users only.
**Document status:** FINAL — 2026-06-29

---

## Post-Execution: Live Operational State Design

After all scenarios are complete:

1. Group LOS-REQ items by entity type (Document, Transmittal, Correspondence, Chain)
2. For each group: identify which fields in `OperationalState` interface satisfy the requirement
3. Identify any new fields not in the current contract
4. Propose the minimal implementation path per module

> This section is written **after** execution, not before.
> The scenarios define the requirements. The requirements define the implementation.

---

## Final Summary Report

*See full report above — written after J-08 completion (2026-06-29).*
*Original template questions answered in the report under Tier 3: Architectural Principles and Production Readiness Assessment.*

---

#### Question 1: What makes ArcScale ready for real use today?

*The parts of the system that work correctly at all three levels — Works, Operates, Manages — and that a real team could use from day one without workarounds.*

#### Question 2: What must be fixed before the first customer?

*The P1 and P2 findings — bugs that block or degrade core workflows, and Product Debt that would make a real DC or PM unable to do their job reliably. These are non-negotiable before go-live.*

#### Question 3: What can wait until after real customers exist?

*The P3, P4, Future, and DX findings that represent improvement opportunities but do not block adoption. These should be informed by actual customer usage patterns, not assumptions.*

#### Question 4: Which architectural principles did the scenarios prove correct?

*The design decisions that survived real usage and should be preserved — not because they were assumed to be correct, but because the scenarios confirmed them under realistic conditions. These become the protected principles for all future development.*

#### Question 5: Is ArcScale easier than the traditional way?

*The most important question. Not "does it work?" — but "does it make the Document Controller's job easier than what they were doing before?"*

> "Based on the evidence of J-01 through J-08, can we demonstrate that ArcScale reduces the effort, the risk of error, and the cognitive load of document control compared to the traditional method — spreadsheets, email threads, shared folders, and manual tracking?"

Answer per role:
- **Document Controller:** Is day-to-day operation genuinely faster and less error-prone?
- **Project Manager:** Does ArcScale give visibility that wasn't available before, without extra effort?
- **Company Director:** Can project document health be assessed in seconds — something that previously required a status meeting?

If the answer is "not yet proven" — that is the real finding. It means the work is not done, regardless of how few bugs remain.

---

*This report is not written in advance. It emerges from the evidence of J-01 through J-08.*
*Question 5 is the ultimate criterion. Bug counts and feature completeness are secondary.*

---

*Version: 1.3 — 2026-06-28*
*Status: Ready for execution — no code changes made*
*Change in 1.1: Added DX classification, Execution Methodology, Persona Tests, No-Fix Rule, Impact Levels*
*Change in 1.2: Added Works/Operates/Manages levels, ARCH classification, fixed Post-Journey Report template*
*Change in 1.3: Added Technical/Product Debt distinction, "Would we design it the same way?" question, Final Summary Report*
*Change in 1.4: Added Fresh Eyes Rule, Observed vs. Hypothesis distinction, New User Test (section 9 of report)*
*Change in 1.5: Added Decision Freeze Rule, Operational Cost metric, Final Summary Question 5 — METHODOLOGY CLOSED*
