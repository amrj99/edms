# ArcScale EDMS — Design Evolution
> **Purpose:** Architectural context and knowledge base. Explains *why* decisions were made, not just *what* was built.  
> **Audience:** Developers, AI models, architects working on ArcScale — past, present, or future.  
> **Rule:** When code and this document disagree, the code is the authority. But use this document to understand *intent* before changing anything.  
> **Last updated:** 2026-06-26

---

## 1. How ArcScale Evolved — From Idea to Current System

### Phase 0 — The Original Vision (2026-02 to 2026-03)
**Source:** `01-system-requirements-spec.md` (original SRS)

ArcScale started as an answer to a real problem: engineering companies managing projects across multiple organizations — contractors, consultants, clients, regulators — with no single controlled platform for documents, correspondence, and approvals.

The original name was **"Engineering Document & Project Management System (EDMS)"**. The first SRS described:
- A cloud-based SaaS platform for engineering document management
- Two working modes: **Company Workspace** (internal) and **Project Workspace** (multi-company)
- Four organization types: Client, Consultant, Main Contractor, Subcontractor
- Seven roles: Admin, Document Controller, Engineer, Reviewer, Approver, External User, Viewer
- Modules: Documents, Correspondence, Registers, Tasks, Meetings, Inspections, Reports, AI Assistant, Chat

The original technology stack recommended: React + TypeScript (frontend), NestJS (backend), PostgreSQL, Elasticsearch (search), cloud object storage. Also included: mobile app, server sync folder, email import, BIM integration.

**The vision was ambitious** — closer to Aconex or Procore than a typical startup MVP.

---

### Phase 1 — Replit Implementation (2026-03 to 2026-04)
**Source:** Git commits, user feedback `additional 1-6.odt`, conversation logs

The system was built rapidly on Replit. Key implementation decisions made during this phase:

- **NestJS → Express 5:** Simpler, faster to iterate. Made sense at MVP scale.
- **Elasticsearch → PostgreSQL full-text search:** Eliminated operational complexity.
- **Server sync folder, email import, BIM → Dropped:** Too complex for MVP. Not implemented to date.
- **Multi-org shared project access → Org-boundary model:** This was the most significant early decision (see Section 5).
- **Mobile app → Deferred:** API is mobile-ready; app not built yet.

During this phase, the owner tested the system and filed `additional 1-6.odt` — a rich set of UX observations and feature requests that shaped the next iteration significantly.

---

### Phase 2 — Company Edition & AI Removal (2026-05, commit `0521e25`)
**Source:** Git commit `0521e25` — "feat(company-edition): remove AI, billing, submission-chains, public-share"

When the system was prepared for delivery to a company client, several features were stripped:
- **AI removed** (procedures panel, task insights, command assistant)
- **Billing removed** (plan management UI)
- **Submission chains removed**
- **Upload with AI dialog removed** — the rich single-file upload was deleted with the AI feature
- **Storage/trial banners removed**
- **Plan restriction modal removed**

This was a deliberate scoping decision: deliver a clean, non-AI version for company use. The underlying code retained plan/billing infrastructure in the backend; only the frontend UI was stripped.

**Impact:** This removal created the gap reported in the E2E test (Upload with AI dialog missing). The dialog was restored in commit `5d056f3` as "Upload Document" with AI behind `VITE_AI_ENABLED` feature flag.

---

### Phase 3 — Security Review & Production Hardening (2026-05 to 2026-06)
**Source:** `07-production-hardening-roadmap.md`, `08-operational-readiness.md`, `SECURITY_REVIEW_CLOSURE_REPORT.md`, git commits `a85dd5f` through `8c0015d`

A comprehensive security and production readiness review was conducted. Key changes:
- H0.1: `seedDefaultAdmin()` gated behind `NODE_ENV !== "production"`
- H0.2: `/api/dev/*` routes disabled in production
- Password reset made atomic-claim (single UPDATE)
- Progressive login lockout (7 attempts / 15-minute window)
- File upload MIME blocklist + magic-byte content sniffing
- Audit log made append-only
- `requireOrg + requireOrgScope + assertOrgMatch` three-layer org-scoping chain
- Cross-org password reset denied for non-system-owners (`users.ts` line 432-445)
- RLS policies initialized on startup

---

### Phase 4 — Document Types & Metadata Engine (2026-06, commit `8c0015d`)
**Source:** Tasks 1-23 in the project task list

Major feature addition:
- `document_types` table with org_id, code, name
- Dynamic `metadata_fields` with `is_active`, `document_type_id` FK
- `MetadataFieldsForm` component
- Workflow improvements: `canAct` from backend, My Actions view, doc link in workflow, role-based notifications
- Horizontal overflow fix in AppLayout

---

### Phase 5 — Upload Document Restoration (2026-06, commit `5d056f3`)
**Source:** This session

The "Upload with AI" dialog was restored as "Upload Document" with the AI panel behind `VITE_AI_ENABLED=true`. The `AIProcedurePanel` exists as a stub — interface preserved, renders null, waiting for AI backend re-implementation.

---

## 2. What Stayed the Same

These ideas from the original SRS remain exactly as designed:

| Concept | Original Design | Current Implementation |
|---------|----------------|----------------------|
| Organization → Projects → Documents hierarchy | SRS Section 2 | ✅ Exact same structure |
| 6-role permission system | SRS Section 3 / roles.odt | ✅ system_owner, admin, project_manager, document_controller, reviewer, viewer |
| Document lifecycle states | SRS Section 10 | ✅ draft → under_review → approved / rejected → issued → superseded |
| Correspondence as structured communication | SRS Section 11 | ✅ RFI, NCR, Submittal, etc. with SLA tracking |
| Workflow engine with templates | SRS Section 16 | ✅ Template-based, sequential stages, role-based routing |
| Audit logging (append-only) | SRS Section 27 | ✅ Immutable, covers all significant actions |
| Multi-tenant SaaS architecture | SRS Section 29 | ✅ Organization = security boundary |
| PostgreSQL as database | SRS Section 22 | ✅ PostgreSQL 16 with Drizzle ORM |

**The core architecture philosophy has not changed.** What changed is scope, tooling, and security detail.

---

## 3. What Changed and Why

### 3.1 Organization Access Model

**Original SRS:** "Companies can participate in shared projects" / "Organizations can be invited to projects"  
**Current:** Organization boundary = security boundary. Cross-org users cannot access each other's projects.

**Why it changed:** The original SRS described the aspiration (Aconex-like multi-org project collaboration). During implementation, the security architecture document (`MULTI_TENANT_BOUNDARIES.md`) established a clear principle: org boundary is the security boundary. Cross-org project access was not implemented — instead, cross-org collaboration happens via **Transmittals + share links**, which is the correct security pattern for controlled document exchange.

**Is this a regression?** No — it's a stricter security model. The Aconex-style shared project access is a roadmap item (see Section 6).

---

### 3.2 Technology Stack

**Original:** NestJS, Elasticsearch, mobile app, server sync folder, email import  
**Current:** Express 5, PostgreSQL full-text search, no mobile app yet

**Why:** Speed of iteration and operational simplicity. NestJS adds abstraction overhead at MVP scale. Elasticsearch requires separate infrastructure. The backend is well-structured Express — migrating to NestJS later is feasible but not necessary.

---

### 3.3 AI Features

**Original:** AI tagging, document summarization, smart search, project knowledge assistant, meeting minutes AI  
**Current:** AI infrastructure exists in backend (OpenRouter integration, credits system, provider routing), frontend AI removed, stub components in place

**Why:** AI was removed for company delivery in Phase 2. The feature flag `VITE_AI_ENABLED` means re-enabling is a configuration change, not a rewrite.

---

### 3.4 Inspection Module

**Original SRS:** Full inspection module (ITR, MIR, NCR, SOR) with mobile support  
**Current:** NCR/SOR visible in dashboard stats; no dedicated inspection creation UI

**Why:** Scoped out during Replit phase. Dashboard references these registers as planned features. Backend infrastructure partially exists (registers concept).

---

### 3.5 Transmittals Model

**Original SRS:** ABCD review codes, outgoing/incoming tracking, external share links, document packages  
**Current:** Transmittals implemented but plan-gated (Professional tier+)

**Why:** Transmittals are resource-intensive (external links, notifications, file bundling). Plan-gating is intentional — confirmed in `free-plan-clarification.md`.

---

## 4. What Succeeded from the Original Design

These original decisions proved correct and held up through all phases:

1. **Organization-as-security-boundary** — the most important architectural decision. Prevents the most dangerous class of multi-tenant vulnerabilities.

2. **PostgreSQL over Elasticsearch** — full-text search in PostgreSQL handles EDMS query patterns well. Removed operational dependency.

3. **Template-based workflows** — reusable across projects, org-scoped, configurable per document type. The engine is solid.

4. **Audit-log-first design** — every significant action is logged. Made security review, debugging, and compliance verification possible.

5. **`requireModule` fail-closed** — missing config → 403. This saved the system from silent feature leakage.

6. **Two-mode design (Internal Operations + Project Collaboration)** — correctly anticipates real-world usage. Companies use both simultaneously.

7. **Correspondence as structured SLA-tracked communication** — not just message threads. This differentiates ArcScale from email-based workflows.

---

## 5. What We Replaced with a Better Design

### 5.1 "Upload with AI" → "Upload Document" + Feature Flag

The original combined upload+AI in one dialog. The replacement separates them: the rich form is always available, AI suggestions are optional. Better UX for organizations without AI enabled.

### 5.2 Static Role List in Frontend → Backend `canAct`

Early frontend code used a static role list to determine if a user could act in a workflow: `["admin", "project_manager", "document_controller", "system_owner"].includes(user.role)`. This excluded `reviewer` — a real bug. Replaced with backend-computed `instance.canAct` which correctly handles all role cases including project-level overrides and delegations.

### 5.3 Notification Recipients Always Admins → Role-Based Routing

Original workflow notifications went to admins/PMs regardless of stage assignment. Fixed to resolve recipients by `responsibleRole` — sends to the users who actually need to act.

### 5.4 Document Types as Free Text → Structured Registry

Original: `documentType` was a free-text string. Current: `document_types` table with org-specific types, linked to metadata fields and workflow templates via FK. Enables validation, auto-classification, and metadata inheritance.

---

## 6. Ideas Not Yet Implemented — Worth Adding to Roadmap

These ideas appear in the original documents and have not been implemented. They represent genuine product value.

### 🔴 High Priority

**Cross-org project collaboration** (SRS Section 4, `02-roles-and-permissions.md`)  
The original vision: contractors from different organizations work on the same project. Current model uses Transmittals as the collaboration boundary. Future: `project_organizations` join table (project_id + organization_id + role) enabling controlled multi-org project access while preserving security boundaries.

**Hybrid Gated Registration** (`03-registration-policies.md`)  
Current: open self-signup. Recommended: 14-day trial with strict limits (3 users, 2GB, limited AI) + paid onboarding track. Protects against abuse and aligns with B2B SaaS best practices.

**admin role org-scoping** (`02-roles-and-permissions.md`, `04-system-logic-analysis.md`)  
`isSysAdmin()` treats `admin` identically to `system_owner`. Design intent: `admin` is org-scoped. Fix: separate `isOrgAdmin()` from `isSystemOwner()` and restrict `admin` from cross-org endpoints.

### 🟡 Medium Priority

**Default workflow template for new organizations**  
Currently: new orgs have no workflow templates and see "No workflow template configured" on every document. A General Document Approval template (Draft → Review → Approved) should be seeded for each new org on creation.

**Report generator with Excel/PDF export** (user feedback `additional 5-6.odt`)  
Dashboard shows statistics but no downloadable registers. The SRS described Excel export as a core feature. High value for EDMS users who need to share status with clients.

**Attach external files from Correspondence** (user feedback `additional 5.odt`)  
Current: correspondence can reference documents but can't attach external files. This breaks real-world RFI/NCR workflows where you need to attach photos or external PDFs.

**Distribution Matrix** (SRS Section 17)  
Define per-project rules: which document types go to which recipients automatically. Would complete the transmittal-based collaboration model.

**Audit log org-scoping** (`06-saas-readiness-assessment.md`)  
Currently any authenticated user can read all audit entries. Add `organization_id` filter to `/api/audit` endpoint.

### 🔵 Low Priority / Future Phases

**Inspection Module** (SRS Section 15) — ITR, MIR, NCR, SOR with mobile submission  
**Revision comparison (diff viewer)** (SRS Section 7.2)  
**Email import to project** (SRS Section 8.4) — send to `project1@edms-system.com`  
**External party login** (System Guide Section 7) — currently share-link only  
**Chat system** (SRS Section 19) — real-time project group + private chat  
**BIM integration** (SRS Section 30)  
**Mobile app** (SRS Section 26)  

---

## 7. Conflict Analysis — Design Intent vs. Current Implementation

| # | Conflict | Root Cause | Type |
|---|----------|------------|------|
| C1 | `admin` sees all orgs (cross-org) | `isSysAdmin()` lumps admin with system_owner. Known since system logic audit. | Bug — needs fix |
| C2 | Open self-signup vs. recommended Hybrid Gated | MVP prioritized speed; security model not yet applied to registration | Deliberate deferral — should be roadmap item |
| C3 | Cross-org project members can't access project | Org-boundary security model chosen over Aconex-style sharing | Intentional security decision — not a bug |
| C4 | `mustChangePassword` not cleared by reset-password API | `POST /api/users/:id/reset-password` missing `mustChangePassword: false` in update | Implementation bug — fix immediately |
| C5 | Audit logs have no org filter | Audit log was designed as system-wide; org scoping was not added | Security gap — medium priority |
| C6 | Tasks with `projectId = null` have no org scope | Edge case in task creation; tasks tied to project have scope, global tasks don't | Design gap — needs architecture decision |
| C7 | No workflow templates for new orgs | Seed runs only for orgs with users at seed time | Onboarding gap — add default template on org creation |
| C8 | Inspection module absent | Scoped out during Replit phase | Known deferral — SRS clearly described it |
| C9 | Transmittals plan-gated | Intentional per `free-plan-clarification.md` | Design decision — not a conflict |

---

## 8. Final Assessment of Legacy Documents

### Still the Primary Reference (🟢 Current)

**`05-module-behavior.md`** — the most accurate description of how Dashboard, Projects, Documents, Correspondence, and Workflow Engine work today. Read this before modifying any of those modules.

**`07-production-hardening-roadmap.md`** — the H0-H2C framework still guides security decisions. New endpoints should be checked against this checklist.

**`11-required-phases-may2026.md`** — the Stabilization > Feature philosophy is still correct. Phases 1-4 complete; phases 5-7 (Observability, CI/CD, Tenant Governance) are still the right next steps.

**`MULTI_TENANT_BOUNDARIES.md`** (in `docs/architecture/`) — **the most important document in the entire project.** Read before touching any data access code.

**`ArcScale_EDMS_System_Guide.md`** (project root) — accurate system module descriptions and cross-module relationships.

---

### Needs Update (🟡 Needs Update)

**`01-system-requirements-spec.md`** — the philosophy and module list are correct. The tech stack section (NestJS, Elasticsearch) and some feature assumptions (mobile, email import) no longer reflect reality. Should be updated to document actual implemented modules.

**`02-roles-and-permissions.md`** — role definitions are correct. The visibility table needs updating to reflect current Admin panel behavior, and the `isSysAdmin()` bug should be noted as a known issue awaiting fix.

**`06-saas-readiness-assessment.md`** — some gaps it identified (RLS, MIME checking, audit log) have been addressed. Others remain. Needs a current-state column added.

**`10-user-feedback-and-feature-requests.md`** — many items are now implemented. The pending column needs updating as features are completed.

---

### Historical/Context Only (🔴 Legacy)

**`08-operational-readiness.md`** — based on commit `a7b47b1` (May 2026). Useful to understand the security baseline at that point; superseded by the SECURITY_REVIEW_CLOSURE_REPORT.md which covers subsequent fixes.

**`04-system-logic-analysis.md`** — the role hierarchy bug and module gating analysis were accurate at the time. Several issues have been addressed. Kept as context for why certain fixes were made.

---

### Future Ideas Worth Restoring (💡)

**`03-registration-policies.md`** — the Hybrid Gated Registration recommendation is sound B2B SaaS practice. As ArcScale acquires real customers, open self-signup becomes a liability. This document should be the reference when implementing registration controls.

**`09-pricing-model.md`** — the AED-based pricing tiers and add-on model are well-reasoned for the MENA engineering market. If billing UI is re-enabled, this is a solid starting point.

**Inspection Module** (from SRS) — ITR/MIR/NCR workflows appear in the Dashboard as metrics (Open NCR/SOR counts) but no creation UI exists. This is a high-value gap for construction and infrastructure clients.

**Distribution Matrix** (from SRS) — the ability to define per-project document distribution rules would complete the transmittal workflow and eliminate manual recipient selection for common document types.

---

## Usage Instructions for Future Developers and AI Models

When working on ArcScale, read in this order:

1. **`docs/architecture/MULTI_TENANT_BOUNDARIES.md`** — security foundation. Non-negotiable.
2. **`docs/legacy-design/INDEX.md`** — quick classification of all design docs.
3. **`docs/legacy-design/05-module-behavior.md`** — how each module works today.
4. **`ArcScale_EDMS_System_Guide.md`** — why each module exists and how they connect.
5. **`docs/legacy-design/DESIGN_EVOLUTION.md`** (this file) — why decisions were made.
6. **Current code** — the final authority on what is actually implemented.

> "Know the intent before you change the implementation."
