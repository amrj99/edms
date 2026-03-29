# EDMS - Engineering Document Management System

## Overview

EDMS is a full-stack Engineering Document Management System designed as a scalable monorepo, evolving into a multi-tenant SaaS platform for engineering companies. It aims to streamline document and correspondence management, workflow automation, and task prioritization. Key capabilities include AI-powered document analysis, natural language search, robust document review workflows, and comprehensive tools for managing engineering projects to improve operational efficiency and ensure compliance with standards like ISO 9001 and PMBOK.

## User Preferences

- I want iterative development.
- I prefer detailed explanations for complex changes.
- Ask before making major architectural changes or introducing new dependencies.
- Use modern TypeScript and React best practices for frontend development.
- Ensure all new features have comprehensive API and unit tests.
- Prioritize security and performance in all implementations.
- Do not make changes to the `artifacts/api-server/src/lib/auth.ts` file without explicit approval.
- Do not make changes to the `lib/db/` folder without explicit approval.
- All database migrations should be explicitly reviewed before execution.

## System Architecture

The EDMS is structured as a pnpm monorepo, separating frontend (React + Vite) and backend (Express 5). Data persistence uses PostgreSQL with Drizzle ORM. Authentication is JWT-based.

**Core Architectural Decisions:**

- **Monorepo Structure:** Facilitates code sharing and consistent tooling.
- **Role-Based Access Control (RBAC):** Granular permissions for users across organizations and projects.
- **Dynamic Metadata System:** Allows administrators to define custom fields for documents and correspondence.
- **AI Integration:** Utilizes Replit AI Integrations (OpenAI proxy) for document analysis, task prioritization, and natural language search.
- **OpenAPI Specification:** Used for API definition and client code generation via Orval.
- **UI/UX Design:** Consistent layouts, theming, reusable React components, and interactive elements. Admin panels provide comprehensive configuration.
- **User Profile & Self-Service:** `/profile` page with 4 tabs — Profile info edit (name/email), Password change (strength indicator, confirmation match), Notification Preferences (per-event in-app/email toggles for 14 notification types across 6 groups), and Recent Activity. Accessible via "My Profile" in the user avatar dropdown. `notificationPrefs` JSONB column added to `user_preferences` table. API: `GET/PUT /api/profile`, `PUT /api/profile/password`, `PUT /api/profile/notification-prefs`.
- **Multi-Organization Isolation:** Ensures data separation between different organizations. Projects page has org filter for sysadmin, organization dropdown in project creation form (replaces raw ID input), Building2 icon on project cards showing org name.
- **Module Licensing:** Per-org feature flags `{ dashboard, deliverables, registers, notifications }` stored as JSONB in `org_config`. `GET/PUT /api/modules` API (admin+system_owner gated). `useModules()` React hook. `ModuleGuard` route wrapper blocks direct URL access to disabled modules (`/`, `/deliverables`, `/reports`) with a bilingual "Module Not Available" placeholder. Sidebar hides Deliverables and Reports links when disabled. Notification bell hidden when notifications module is off. Admin "Modules" tab with 4 i18n-labelled toggle cards; system_owner sees org selector. 28 bilingual i18n keys.
- **RBAC Enforcement:** `requireRole("admin", "project_manager", "document_controller")` guards all write endpoints (POST/PUT/DELETE) on ITR, NCR, NOC registers and Transmittals. Frontend hides "Add Record" button for `viewer` and `reviewer` roles. Also fixed `await hashPassword()` bug in user creation and reset-password routes.
- **Workflow Approvals:** NCR, ITR, and Transmittal records support submit/approve/reject workflow. `approvalStatus` enum column (none/pending/approved/rejected) + `approvedById`/`approvalComment`/`approvedAt`. API: `submit-approval` (admin+pm+dc), `approve`/`reject` (admin+pm). `ApprovalBadge` + `ApprovalPanel` UI with instant panel update via `onRecordUpdated` callback. Approval actions create audit log entries.

**Key Features and Implementations:**

- **Document Management:** Tracks documents with revision history, robust review workflows, and AI-powered validation. Supports multiple files per document.
- **Correspondence Management:** Full two-pane layout with folder/project/type/priority filters. Reply (wired to POST `/:id/reply` API), Forward (pre-fills compose with quoted content), BCC field (schema column + compose form). Conversation Thread shows all child replies in real time. Quick Reply sends inline. Draft save vs. Send distinction. Thread count badge.
- **Meetings Module:** Full meetings lifecycle — scheduled/in_progress/completed/cancelled. DB tables: `meetingsTable`, `meetingAttendeesTable`, `meetingActionItemsTable`, `meetingAttachmentsTable`. API: `GET/POST /api/meetings`, `GET/PUT /api/meetings/:id`, `PUT /api/meetings/:id/attendees/:attId`, `POST/PUT/DELETE /api/meetings/:id/action-items`, `GET /api/meetings/action-items` (cross-project), `DELETE /api/meetings/:id`. Frontend at `/meetings`: two-pane list+detail, tabs for Agenda/Attendees/Action Items/Minutes, create/edit dialog, minutes editor. Action items trackable as open/in_progress/done with priority (low/medium/high/critical) and updatedAt timestamp.
- **Action Items Tracker:** New cross-project page at `/action-items`. Shows all meeting action items across all projects with priority badges, overdue highlighting (red border), status icons, project/priority/status/assignee filters, quick status cycling, and inline edit dialog. Stats cards show Open/Overdue/Critical/Done counts. Link to originating meeting. DB: `priority` + `updatedAt` columns added to `meetingActionItemsTable`.
- **Reports Dashboard:** New analytics page at `/reports-dashboard`. 6 metric widgets: (1) Documents by Status donut chart, (2) Deliverables Progress donut with % complete, (3) Correspondence Volume 7-day area chart, (4) Meetings This Week timeline, (5) Open NCRs list, (6) Overdue Action Items list. Summary stat cards at top. Project filter dropdown. API: `GET /api/dashboard/reports`. Uses Recharts.
- **Document Version History UI:** History icon button added to each row in the Documents table. Opens a slide-out panel showing a visual timeline of all document revisions. Each revision shows: revision code, "Latest" badge (primary colored for the current), upload date, uploader name, status, change note, and download button. Empty state when no revisions exist.
- **Correspondence Conversation Thread:** Thread view redesigned as a proper conversation timeline. Original message shown as first bubble with "Original" badge. Each reply shows colored avatar initials, sender name, timestamp, status badge, and attachment list. Timeline connecting line and ring effect on avatars.
- **Global Search Bar:** Persistent header search widget (Search... button with ⌘K hint). Opens full-screen modal with debounced search against `/api/search`. Results show type icon, title, and navigate to the relevant section. Results categorized by type (document, project, correspondence, meeting, etc.).
- **Test Data Seed:** `POST /api/admin/seed-test-data` (admin/system_owner only). Creates: 6 documents (3 reports + 3 drawings), 3 correspondence with 1 reply each, 3 transmittals, 3 NCR, 3 ITR, 3 NOC, 3 deliverables, 3 meetings. All with realistic engineering content and varied statuses. "Seed Test Data" card in the Admin → System tab with status display grid.
- **General Inbox removed:** `/general` route and "General Inbox" sidebar nav entry removed. Replaced by the Meetings entry in the sidebar.
- **Workflow Engine:** Automates document lifecycle steps and task creation.
- **Task Management:** Tracks tasks from various sources with priority and assignment.
- **Global Search:** Full-text search with advanced filtering across documents and correspondence.
- **Audit Logging:** Logs all create/update actions with filtering, pagination, and export capabilities.
- **Transmittals:** Formal document transmittal tracking with external recipients and audit trails.
- **Notifications:** In-app and email notifications for various events.
- **Object Storage:** Integration with Replit Object Storage for file uploads and serving.
- **System Admin Panel:** Comprehensive administration for organization settings, user roles, metadata, AI config, email, storage, security, and backup.
- **Reports Module:** Provides 7 tabbed registers (e.g., Master Register, Correspondence Register) with filtering, Excel/PDF/Print export, and bilingual support. Registers support clickable rows for detail views, column visibility toggles, bulk actions, and saved filter presets.
- **Dashboard:** Configurable with 11 widgets and a contextual alert banner for notifications.
- **Deliverables Module:** Manages project deliverables with status tracking, detailed views, and export options.
- **User Preferences API:** Stores user-specific settings like dashboard layout and filters.
- **Link Relationships:** Supports linking between documents, correspondence, and various records (e.g., NCRs, ITRs, NOCs).
- **Production Hardening:** Implements security headers, rate limiting, and structured logging.

## External Dependencies

- **Database:** PostgreSQL
- **ORM:** Drizzle ORM
- **AI Provider:** Replit AI Integrations (proxy for OpenAI models)
- **Frontend Framework:** React
- **Build Tool (Frontend):** Vite
- **Backend Framework:** Express 5
- **Package Manager:** pnpm
- **API Client Generation:** Orval
- **Charting Library:** Recharts