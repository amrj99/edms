# EDMS - Engineering Document Management System

## Overview

EDMS is a full-stack Engineering Document Management System designed as a scalable monorepo. Its primary purpose is to evolve into a multi-tenant SaaS platform for medium-sized engineering companies, streamlining their document and correspondence management, workflow automation, and task prioritization. Key capabilities include AI-powered document analysis, task prioritization, natural language search, and robust document review workflows. The system aims to provide comprehensive tools for managing engineering projects, ensuring compliance with standards like ISO 9001 and PMBOK, and improving operational efficiency.

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

The EDMS is structured as a pnpm monorepo, separating frontend and backend concerns into `artifacts/edms` (React + Vite) and `artifacts/api-server` (Express 5) respectively. Data persistence is handled by PostgreSQL using Drizzle ORM. Authentication is JWT-based with HS256, storing tokens in `localStorage`.

**Core Architectural Decisions:**
- **Monorepo Structure:** Facilitates code sharing and consistent tooling across frontend and backend.
- **Micro-frontend potential:** `artifacts/edms` is a single-page application, but the structure allows for future decomposition.
- **Role-Based Access Control (RBAC):** Granular permissions for users (admin, project_manager, document_controller, reviewer, viewer) across organizations and projects.
- **Dynamic Metadata System:** Allows administrators to define custom fields for documents and correspondence, enhancing flexibility.
- **AI Integration:** Utilizes Replit AI Integrations (OpenAI proxy) for advanced features like document analysis, task prioritization, and natural language search, with dedicated caching and logging mechanisms.
- **OpenAPI Specification:** Used for API definition and client code generation via Orval, ensuring strong typing and consistency between frontend and backend.
- **UI/UX Design:**
    - **Consistent Layouts:** Three-pane layouts for Correspondence (folders, list, preview) and Document Review (list, detail).
    - **Theming:** Implemented for a modern, clean interface.
    - **Component-based:** Reusable React components for UI consistency.
    - **Interactive Elements:** Features like bulk actions, searchable dropdowns, and visual status indicators (e.g., state machine visualization for document review).
    - **Admin Panels:** Comprehensive tabbed interface for system-wide configuration, user roles, metadata, and AI settings.

**Key Features and Implementations:**
- **Document Management:** Tracks document numbers, titles, types, revisions, and status with revision history. Includes a robust review workflow (Draft → Under Review → Approved / Rejected) and AI-powered validation.
- **Correspondence Management:** Supports various types (transmittal, letter, memo, RFI, submittal, NCR, TQ, notice, email, internal) with features like threading, priority, due dates, and project association (or general inbox for non-project items).
- **Workflow Engine:** Automates document lifecycle steps (e.g., uploaded → under_review → approved → issued) and automatically creates review tasks.
- **Task Management:** Tracks tasks sourced from manual input, workflows, or correspondence, with priority and assignment.
- **Global Search:** Full-text search with advanced filtering capabilities across documents and correspondence.
- **Audit Logging:** Logs all create/update actions with full filtering (action, entity type, user, date range, search) and paginated UI in the admin panel. CSV export available at `GET /api/audit-logs/export`.
- **Transmittals:** Formal document transmittal tracking with external recipients, access links, and audit trails.
- **Notifications:** In-app notification system for various events.
- **Email Notifications:** SMTP integration via nodemailer. Triggered on document review submitted (emails reviewers), approved (emails creator), and rejected (emails creator with reason). Config via env vars: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE`, `APP_URL`. Silently skips if not configured.
- **Object Storage:** Replit object storage integration via `ObjectStorageService`. Upload URL endpoint at `POST /api/storage/uploads/request-url`, private serving at `GET /api/storage/objects/*`, public assets at `GET /api/storage/public-objects/*`.
- **System Admin Panel:** New admin tabs — Audit Log (filterable table + CSV export), System (live server stats, SMTP test, backup/restore with actual restore + confirm dialog), Email (SMTP status and trigger list), Storage (per-org usage bars + quota editing), Branding (system name/logo/color). Backend at `GET /api/admin/system-info`, `POST /api/admin/smtp/test`, `GET /api/admin/backup`, `POST /api/admin/restore/validate`, `POST /api/admin/restore` (actual upsert restore), `GET /api/admin/storage-usage`, `PUT /api/admin/storage-config/:orgId`.
- **Multi-Organization Isolation:** Projects/tasks/orgs routes now enforce `organizationId` scoping. Non-admin users see only their own org's data. `isSysAdmin()` + `requireSysAdmin()` helpers added to auth.ts. Organizations route returns full list only to sys_admins; regular users see only their own org.
- **Storage Finalization:** `org_config` table has `storage_quota_mb` (default 10240) and `storage_path` columns. Per-org storage usage tracked via `SUM(fileSize)` on documents. Admin Storage tab shows usage bars with colour-coded warnings.
- **FileDropZone Component:** Shared `artifacts/edms/src/components/file-drop-zone.tsx` with real drag-and-drop, click-to-browse, presigned URL XHR upload (via `/api/storage/uploads/request-url`) with per-file progress bars and success/error state indicators, multi-file support (`multiple` + `onMultiUpload` props), and per-file removal.
- **RecipientAutocomplete Component:** `artifacts/edms/src/components/recipient-autocomplete.tsx` — live search input filtering users by name/email/org. Multi-select mode (To field) shows chips with remove; single-select mode (Task To) shows full-user card. `CCAutocomplete` variant supports free-text email entry with smart user suggestions.
- **Multiple Files per Document:** `documents` table has `additional_files JSONB` column (default `[]`). Edit Document dialog has "Additional Files" section with FileDropZone for attaching supplementary files. Files merged with existing on save; individual removal supported.
- **Document Search Enhancement:** Documents toolbar includes discipline and doc-type dropdown filters (populated from unique values of loaded docs). Search input covers title, documentNumber, discipline, revision, and documentType. "Clear filters" button resets both dropdowns.
- **Transmittal Bulk Select:** Create Transmittal dialog has "Select All / Deselect All" toggle button next to the documents checklist header. Shows "{n} of {total} selected" count.
- **Document Edit & Share:** Each document row in project-detail has Edit (pencil) and Share (link) row actions. Edit dialog: title/discipline/revision/documentType/description + optional file replacement via FileDropZone. Share dialog: time-limited (expiresInDays) + optional password → returns `shareUrl`; revoke supported. DB columns: `shareToken`, `shareExpiresAt`, `sharePasswordHash` on `documents` table.
- **Transmittal Attachments:** Create Transmittal dialog has a scrollable checklist of project documents to attach (`documentIds[]`). Detail sheet shows attached items with remove (×) and an add-from-project dropdown (only for draft transmittals). Queries `GET /api/projects/:id/transmittals/:id` (returns `items[]` with embedded `document`).
- **Correspondence Enhancements:** Compose dialog now includes CC (comma-separated emails), Task To (user select), and an Attachments section (FileDropZone, multiple files). Payload sends `cc`, `taskToId`, `attachments:[{fileName,fileUrl,fileSize}]`. Detail pane shows existing attachments and a Secure Share Link panel (generate + copy + revoke).
- **Bilingual Reports Module (EN/AR):** Full i18n system at `artifacts/edms/src/lib/i18n.tsx` with `I18nProvider`, `useI18n()` hook (`t()`, `lang`, `setLang`, `isRtl`), and ~80 translated keys for English and Arabic. Language stored in `localStorage` as `edms_lang`. Sets `document.documentElement.dir` for global RTL/LTR. Language toggle button (flag + label) in the AppLayout sticky header. `I18nProvider` wraps the entire app in `App.tsx`.
- **Reports Page — 7 Registers:** Complete rewrite at `artifacts/edms/src/pages/reports.tsx`. 7 tabbed registers: Master Register (all org docs), Correspondence Register, Transmittal Register, Drawing Register (filtered by drawing-family documentType), ITR/MIR Register, NCR/SOR Register, NOC Register. Shared FilterBar (project, status, date from/to, search, discipline, party). Excel + PDF + Print export on every tab. ITR, NCR, NOC tabs include "+ Add Record" dialog forms. Master Register includes pagination (50/page). All register labels are bilingual.
- **New DB Tables:** `inspection_requests` (ITR/MIR), `ncr_records` (NCR/SOR), `noc_records` — all in `lib/db/src/schema/registers.ts` with full enums. Full CRUD API at `artifacts/api-server/src/routes/registers.ts`, mounted as `/api/projects/:projectId/inspection-requests|ncr-records|noc-records`.
- **System Activity Feed:** Dashboard shows a live `SystemActivityFeed` widget sourced from `/api/audit-logs`. Colour-coded icons for uploads, approvals, transmittals, AI checks, and other actions. Refreshes every 30 seconds.
- **Configurable Dashboard (11 Widgets):** Dashboard completely rewritten with 11 configurable widgets: Documents by Status, Drawings by Status, Project Portfolio, Open ITR, Open NCR/SOR, NOC Status, Open Correspondence, Overdue Items, Recent Documents, My Tasks, System Activity. "Customize" button opens a drag-and-drop panel to toggle widgets on/off and reorder them. Layout persisted to `localStorage` (`edms_dashboard_layout`) and synced to `PUT /api/user/preferences`.
- **Notification Alert Banner:** Dashboard shows a contextual alert banner with colour-coded chips for open NCR/SOR, overdue correspondence, open ITR, and pending NOC — sourced from `GET /api/notifications/summary`.
- **Deliverables Module:** New dedicated page at `/deliverables` (nav item: Deliverables). Full CRUD via `GET/POST/PUT/DELETE /api/projects/:id/deliverables`. Includes status summary cards (clickable as filters), searchable table with planned/actual date highlighting (red if late), clickable rows open detail side panel, edit and delete dialogs, linked document selector, Excel/PDF/Print export. `deliverables` table in `lib/db/src/schema/deliverables.ts`.
- **User Preferences API:** `GET /api/user/preferences` and `PUT /api/user/preferences`. `user_preferences` table stores `dashboardLayout`, `dashboardWidgets`, `savedFilters`, `columnPrefs` as JSONB columns.
- **Notification Summary API:** `GET /api/notifications/summary` returns `{ openITR, openNCR, pendingNOC, overdueCorrespondence, newRevisions }` aggregated across all org projects.
- **Reports Enhancements:** All 7 register tabs now have **clickable rows** (open a side panel detail view with all record fields). **Master Register** gains: column visibility toggle (Columns button, persisted to `localStorage` per register key), bulk checkboxes (select all/individual), bulk action bar with status change + export selected. **FilterBar** gains a **Saved Filters** system (Save/Load named filter presets stored in `localStorage` as `edms_saved_filters`).
- **Link Relationships:** `ncr_records` table has `linkedDocumentId` and `linkedCorrespondenceId`. `noc_records` table has `linkedDocumentId` and `linkedCorrespondenceId`. `inspection_requests` table already had `linkedDocumentId`. Enables NCR↔doc, ITR↔drawing, NOC↔correspondence linking.
- **Production Hardening:** `helmet` (security headers), `express-rate-limit` (300/min global, 20/15min on auth routes in production), global error handler middleware with pino structured logging all added to `app.ts`.
- **Document Pagination:** `GET /api/projects/:id/documents` supports `page`, `limit`, `search` query params and returns `{documents, total, page, totalPages, limit, hasMore}`.
- **System Configuration:** Extensive admin panel for managing organization settings, user roles, metadata, numbering schemes, AI config, email settings, storage, security, audit logs, and system backup.

## External Dependencies

- **Database:** PostgreSQL
- **ORM:** Drizzle ORM
- **AI Provider:** Replit AI Integrations (proxy for OpenAI models: `gpt-5-mini`, `gpt-5.2`)
- **Frontend Framework:** React
- **Build Tool (Frontend):** Vite
- **Backend Framework:** Express 5
- **Package Manager:** pnpm
- **API Client Generation:** Orval (from OpenAPI spec)
- **Charting Library (Dashboard):** Recharts