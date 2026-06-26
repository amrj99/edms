# Legacy Design Documents — Index
> Migrated from: `C:\Users\home\Desktop\edms\` (original Replit-era documents)  
> Migration date: 2026-06-26  
> **Rule:** Current code is the final authority when there is conflict with these documents.  
> These documents are the *design intent* — the code is the *implemented reality*.

---

## How to Use This Index

Each document has a **Status** classification:
- 🟢 **Current** — still represents the implemented design
- 🟡 **Needs Update** — partially implemented or partially outdated
- 🔴 **Legacy/Historical** — superseded; kept for context only
- 💡 **Future Ideas** — good concepts not yet implemented

---

## Documents

| File | Title | Source | Status | Summary |
|------|-------|--------|--------|---------|
| [01-system-requirements-spec.md](01-system-requirements-spec.md) | System Requirements Specification | `02-edms_to_aconex_plan.md` | 🟡 Needs Update | Original SRS defining all modules, roles, document lifecycle, and DB schema. Core philosophy still valid; some module names and tech stack differ. |
| [02-roles-and-permissions.md](02-roles-and-permissions.md) | Roles & Permissions Design | `الادوار والصلاحيات.odt` | 🟡 Needs Update | 6-role hierarchy definition. **Known gap:** `admin` currently treated as cross-org (same as `system_owner`) contrary to design intent. |
| [03-registration-policies.md](03-registration-policies.md) | Registration Policies | `سياسات التسجيل في النظام.odt` | 💡 Future Ideas | B2B SaaS registration strategy. Recommends Hybrid Gated model (Trial Track + Paid Track). Current system has open self-signup. |
| [04-system-logic-analysis.md](04-system-logic-analysis.md) | System Logic Analysis | `system logic 1.odt` | 🟡 Needs Update | Code audit: signup flow, role hierarchy bug, org switching, module gating, audit log gap. Some issues fixed since this audit. |
| [05-module-behavior.md](05-module-behavior.md) | Module Behavior Documentation | `منطق الخيارات وعملها.odt` | 🟢 Current | Accurate description of Dashboard, Projects, Documents, Correspondence, Workflow Engine behavior and permissions. Confirms org-boundary design is intentional. |
| [06-saas-readiness-assessment.md](06-saas-readiness-assessment.md) | SaaS Readiness Assessment | `saas points missing.odt` | 🟡 Needs Update | Multi-tenancy gap analysis. Some gaps (RLS, audit log org-scope) may have been addressed. Verify against current code before acting. |
| [07-production-hardening-roadmap.md](07-production-hardening-roadmap.md) | Production Hardening Roadmap | `Production Hardening...odt` | 🟢 Current | H0-H2C hardening phases. H0.1/H0.2 implemented. H2B (invitation flow) implemented in `07af9b1`. |
| [08-operational-readiness.md](08-operational-readiness.md) | Operational Readiness Assessment | `ArcScale EDMS — Operational Readiness...odt` | 🔴 Legacy | May 2026 assessment on commit `a7b47b1`. Security baseline confirmed safe. Superseded by current state (commit `5d056f3`). |
| [09-pricing-model.md](09-pricing-model.md) | Pricing Model | `التسعيير.odt` | 💡 Future Ideas | AED-based pricing tiers (Starter 45 / Basic 70 / Professional 95 / Enterprise 120). Add-on model. Not yet implemented in billing. |
| [10-user-feedback-and-feature-requests.md](10-user-feedback-and-feature-requests.md) | User Feedback & Feature Requests | `additional 1-6.odt` | 🟡 Needs Update | Owner testing feedback from Replit phase. Many items implemented; some still pending (report export, correspondence attachments). |
| [11-required-phases-may2026.md](11-required-phases-may2026.md) | Required Phases — May 2026 | `مراحل مطلوبة 2026-05-09.odt` | 🟢 Current | Stabilization roadmap. Confirms shift from feature sprint to Production Governance. Phases 1-4 largely complete; 5-7 in progress. |

---

## Documents NOT Migrated (with reasons)

| File | Reason |
|------|--------|
| `System Name.txt` | ⚠️ **Contains production credentials** (server IP + password) — never commit |
| `باسوود.txt` / `باسوود2.odt` / `باسوورد.odt` / `password.odt` / `postgres password.odt` | ⚠️ Passwords — never commit |
| `اي بي اي كي.txt` / `مفتاح الذكاء الاصطناعي اوبن رواتر.odt` / `mafateh jwt jadedih.odt` | ⚠️ API keys / JWT secrets — never commit |
| `HALAL_VIDEO_HANDOFF.md` / `HALAL_VIDEO_HANDOFF_SESSION2.md` / `Halal-Video-Suite detials.odt` | Different project (Halal Video Suite) |
| `conversation till *.odt/docx` / `اخر محادثة *.odt/docx` | Chat logs — no design value |
| `Prompt to replit.docx` | Historical Replit prompts — superseded |
| `*.pptx` / `*.docx` (presentations) | Binary; summarized in system guide. Available at original path if needed. |
| `*.zip` / `*.exe` / `*.png` | Archives/binaries — not relevant |
| `Untitled *.odt` / `666.odt` / `84849.odt` / etc. | Unnamed scratch files |
| `برومبت *.odt` | AI prompts — operational, not design |

---

## Key Design Principles (Summary)

From reading all documents, these are the non-negotiable design intents:

1. **Organization = Security boundary.** Project = Workspace only. Never use project_id alone for isolation.
2. **`system_owner` is the only cross-org role.** `admin` should be org-scoped (currently bugged).
3. **Cross-org collaboration uses Transmittals + share links**, not shared project access.
4. **Module gating is fail-closed.** Missing config → 403. Never fails open.
5. **All actions are audit-logged.** Audit logs are append-only.
6. **Registration should be Hybrid Gated** (Trial + Paid tracks). Current open registration is a known gap.
7. **The system is B2B SaaS**, not consumer. Target: engineering companies (consultants, contractors, clients).

---

## Conflicts Between Design Intent and Current Implementation

| # | Design Intent | Current Reality | Priority |
|---|---------------|-----------------|----------|
| C1 | `admin` is org-scoped only | `admin` sees all orgs (isSysAdmin bug) | High |
| C2 | Hybrid Gated registration | Open self-signup | Medium |
| C3 | All tables have direct org_id | Tasks/docs/correspondence are indirectly scoped | Low (works, fragile) |
| C4 | Audit logs org-scoped | Audit logs have no org filter | Medium |
| C5 | `mustChangePassword` cleared on admin reset | Not cleared by reset-password endpoint | **Bug — fix now** |
