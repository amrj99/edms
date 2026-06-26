# Module Behavior Documentation
> Source: `منطق الخيارات وعملها.odt`  
> Date: ~2026-04

## 1. Dashboard
- Purpose: Aggregated overview of what needs attention across all projects
- Shows: Open tasks, pending approvals, overdue correspondence, recent activity, project health
- Data source: `GET /api/dashboard` — read-only, no writes
- Landing page after login

## 2. Projects
- The organizing unit of all work
- Every document, correspondence, task, and workflow is anchored to a project
- Entities: `projects` table + `project_members` (join: user + project + role)
- Permissions:
  - Create: `project_manager`, `admin`, `system_owner`
  - Add member: `project_manager` for that project
  - View: any authenticated user **whose org matches** (org boundary enforced)

## 3. Documents
- Core of EDMS — structured storage and lifecycle management
- Status lifecycle: `draft → under_review → approved / approved_with_comments / for_revision / rejected → issued → superseded / void`
- Permissions:
  - Upload: `document_controller` within the project
  - Approve/Reject: `reviewer`
  - View: all project members
- On upload: Rules engine evaluates (type: `document`, passing `documentType`, `discipline`, `projectId`)

## 4. Correspondence
- Inbox-style interface similar to email client
- Folders: Inbox, Sent, Draft, Archive + Smart Views
- Types: RFI, NCR, Submittal, General, Instruction, etc.
- SLA tracking: unread reminder, no-response escalation, due-soon warnings
- Can be project-linked or organization-wide (General)

## 5. Workflow Engine
- Template-based workflow definitions (reusable across projects)
- Templates are per-organization (not per-project)
- Sequential stage types with role-based assignment
- Automatic notifications at each stage
- SLA breach detection

## 6. Rules Engine
- Auto-assignment rules evaluated on document upload
- Matching criteria: `documentType`, `discipline`, `projectId`
- Actions: auto-start workflow, auto-assign reviewer

## Note on Cross-Org Access (Design Intent)
Per this document: "View project: any authenticated user **whose org matches**"
This confirms the org-boundary design is intentional — cross-org project access is not part of the intended design.
