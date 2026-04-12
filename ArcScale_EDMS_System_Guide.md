# ArcScale EDMS — System Guide Outline

> Version 0.1 — Internal Draft  
> Status: Outline only — to be expanded into full user manual and marketing guide

---

## 1. What Is ArcScale EDMS?

ArcScale EDMS (Engineering Document Management System) is a multi-tenant SaaS platform for managing engineering documents, correspondence, transmittals, and project workflows. It is designed to serve two distinct operational modes — often simultaneously within the same organisation:

| Mode | Description |
|------|-------------|
| **Internal Operations** | A company manages its own documents, correspondence, and tasks internally across departments, without external project parties |
| **Project Collaboration** | A company runs engineering projects involving external contractors, consultants, clients, or regulators who submit and receive controlled documents |

---

## 2. System Modules

### 2.1 Documents
The core module. All other modules exist to manage the lifecycle of engineering documents.

**Key capabilities:**
- Upload, version, and classify documents (by discipline, type, revision)
- Document numbering with configurable prefixes per organisation
- Revision history and comparison
- Folder structure per project
- Approval workflows (submit → review → approve / reject / comment)
- Lifecycle states: Draft → Under Review → Approved → Issued → Superseded → Archived / Obsolete
- Confidentiality controls (watermark, download restriction)
- AI tagging and analysis
- Shared access links with password and expiry

**Relationship to other modules:**
- Documents are attached to **Transmittals** (for sending)
- Documents are referenced in **Correspondence**
- Documents trigger **Workflows**
- Documents are grouped into **Packages**

---

### 2.2 Transmittals
Formal cover sheets for sending one or more documents to an external or internal party. Transmittals create an auditable record of what was sent, when, to whom, and for what purpose.

**Key capabilities:**
- ABCD review codes (A = Approved, B = Approved with Comments, C = Revise and Resubmit, D = Rejected)
- Outgoing / Incoming direction tracking
- Purpose classification (For Information, For Review, For Approval, For Construction, etc.)
- Response tracking — link a response transmittal to its original
- Document selection with search and ×/+ controls
- External recipients (email) and internal recipients
- Share links for external access without login
- Approval gate (transmittal must be approved before issue)

**Relationship to other modules:**
- Transmittals contain **Documents**
- Transmittals can be grouped into **Packages**
- Transmittals generate **Notifications** and **Audit Logs**
- Transmittals can trigger **Correspondence** threads

---

### 2.3 Correspondence
Formal communication tracking between internal teams or with external parties. Replaces ad-hoc email for any communication that must be traceable and SLA-governed.

**Key capabilities:**
- Reference numbering (auto-assigned, prefix-configurable)
- To / CC recipients with full user lookup
- Scope classification (RFI, NCR, Submittal, General, Instruction, etc.)
- SLA tracking: unread reminder, no-response escalation, due-soon warnings
- Threaded replies (parent-child correspondence)
- Attachments
- Link to a specific document
- Mark as read / unread
- Requires-response flag with due date
- Inbox-style layout with filters (direction, scope, status, project)

**Relationship to other modules:**
- Correspondence can reference a **Document**
- Correspondence can be linked to a **Project** or be organisation-wide (General)
- Correspondence generates **Notifications** and **Scheduled Reminders**

---

### 2.4 Workflows
Structured approval sequences applied to documents. Defines who must review and in what order, with SLA deadlines at each stage.

**Key capabilities:**
- Template-based workflow definitions (reusable across projects)
- Sequential or parallel stage types
- Stage assignees with due dates
- Automatic notifications at each stage
- SLA breach detection and escalation
- Workflow history and audit trail

**Relationship to other modules:**
- Workflows are attached to **Documents**
- Workflow outcomes update **Document** status
- Workflows generate **Notifications** and **Audit Log** entries

---

### 2.5 Packages
A container for grouping related documents and transmittals — typically corresponding to a deliverable set, specification package, or submission batch.

**Key capabilities:**
- Group documents and transmittals under a named package
- Package-level status and metadata
- Cross-reference across projects

**Relationship to other modules:**
- Packages contain **Documents** and **Transmittals**
- Packages can be referenced from **Correspondence**

---

### 2.6 Notifications
Automatic alerts delivered within the system (and optionally by email) when actions are taken or deadlines approach.

**Event types include:**
- Document submitted for review
- Document approved / rejected
- Transmittal received
- Correspondence requires response
- SLA due-soon / overdue
- Workflow stage assigned
- Delegation activated

---

### 2.7 Tasks
Ad-hoc action items assigned to users, independent of the document workflow. Used for tracking follow-up actions arising from reviews, meetings, or correspondence.

---

### 2.8 Calendar & Meetings
Schedule and record meetings linked to projects. Auto-generates action items from meeting minutes.

---

### 2.9 Reports & AI Insights
Cross-project visibility dashboards. AI-powered document analysis, tagging, and anomaly detection.

---

### 2.10 Governance
- **Role Matrix**: visualises which roles have which permissions across all modules
- **Audit Log**: full history of every action in the system
- **Project Role Overrides**: temporarily elevate or restrict a user's role for a specific project
- **Delegations**: one user delegates authority to another for a period (e.g., during leave)

---

## 3. Core Philosophy

### 3.1 Two Usage Modes

| | Internal Operations Mode | Project Collaboration Mode |
|---|---|---|
| **Documents** | Internal procedures, policies, technical standards | Project submittals, drawings, specifications |
| **Transmittals** | Internal handoffs between departments | Formal issue to contractor / client / regulator |
| **Correspondence** | Internal memos, instructions, NCRs | External RFIs, site instructions, formal letters |
| **Projects** | Optional — used to group internal work | Central — all documents and transmittals live under a project |
| **External parties** | Rarely involved | Always involved |

Both modes co-exist within one organisation. A civil engineering firm might use Projects for its external client work and use the General (non-project) area for internal HR, procurement, and policy documents.

---

### 3.2 Roles and Permissions

Roles are defined at the organisation level and can be overridden at the project level.

| Role | Description |
|------|-------------|
| **System Owner** | Full system access. Manages organisations, billing, and system settings. |
| **Admin** | Full organisational access. Manages users, projects, and configuration. |
| **Project Manager** | Creates and manages projects. Approves transmittals. Can create workflows. |
| **Engineer** | Uploads documents, submits for workflow, creates transmittals and correspondence. |
| **Reviewer** | Reviews and comments on documents in assigned workflows. |
| **Viewer** | Read-only access to documents they are members of. |
| **External** | Limited access via share links only. No login to the main system. |

**Governance rules:**
- Every action is logged in the Audit Log with user, timestamp, and IP
- Permissions are enforced centrally on the API — the UI reflects permissions but enforcement is backend-side
- Project membership is required to access project documents (org boundary + project boundary)

---

### 3.3 Document Lifecycle

```
Draft
  └→ Submitted for Review
        ├→ Approved
        │     └→ Issued
        │           └→ Superseded (when a new revision supersedes this one)
        ├→ Approved with Comments (minor revisions needed, conditionally accepted)
        ├→ Rejected → back to Draft (major revision required)
        └→ For Revision → back to Draft
                    
At any terminal state → Archive (retained, not active) or Obsolete (no longer current)
```

---

## 4. Intended User Flows

### 4.1 Internal Company Usage (No External Projects)

1. Admin sets up the organisation and invites internal users
2. Engineers upload internal documents (procedures, standards, templates) to the global Documents module
3. Correspondence module is used for internal memos and NCRs
4. Workflows are used to get documents approved before publication
5. Tasks and Calendar are used for operational management
6. Reports provide visibility into document status and pending actions

---

### 4.2 Project-Based Collaboration

1. Project Manager creates a project and adds team members
2. Engineers upload project documents (drawings, specifications, submittals)
3. Documents go through an Approval Workflow before being issued
4. Once approved, documents are packaged into a Transmittal and sent to the external party
5. The external party receives a share link (no login required) to view and respond
6. Correspondence (RFIs, NCRs, instructions) is tracked against the project
7. All actions are audit-logged; reports show project-level metrics

---

### 4.3 Receiving External Submittals

1. Contractor sends documents (via their own system or email)
2. PM creates an Incoming Transmittal, attaches the received documents
3. Documents are uploaded and assigned to the project register
4. A review workflow is triggered
5. Review outcome (ABCD code) is recorded on the transmittal
6. A response transmittal is created and sent back to the contractor

---

## 5. Module Relationships Map

```
Organisation
  ├── Users (roles)
  ├── Projects
  │     ├── Documents ──────┐
  │     │     └── Revisions │
  │     ├── Transmittals ←──┘ (contain documents)
  │     │     └── Items (per-document review codes)
  │     ├── Correspondence
  │     │     └── Threads (parent-child)
  │     ├── Workflows → applied to Documents
  │     ├── Packages → group Documents + Transmittals
  │     ├── Tasks
  │     └── Members
  ├── General Correspondence (non-project)
  ├── Notifications
  ├── Delegations
  ├── Audit Logs
  └── Configuration (storage, prefixes, SLA defaults, AI settings)
```

---

## 6. Planned Expansion

This outline will be expanded into:

1. **User Manual** — step-by-step instructions per role per module
2. **Administrator Guide** — setup, configuration, storage, user management
3. **API Reference** — for integration with third-party systems
4. **Marketing / Onboarding Guide** — product positioning, feature highlights, onboarding checklist for new company accounts

---

## 7. Open Policy Decisions

| Decision | Status | Notes |
|----------|--------|-------|
| Bulk Import (Migration Wizard) availability | Pending | Should it be plan-gated or available to all? |
| External party login | Not implemented | External parties currently access only via share links |
| Multi-language support | Partial | i18n framework in place |
| Mobile app | Roadmap | API is mobile-ready |
