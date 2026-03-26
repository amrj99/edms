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
- **System Activity Feed:** Dashboard shows a live `SystemActivityFeed` widget sourced from `/api/audit-logs`. Colour-coded icons for uploads, approvals, transmittals, AI checks, and other actions. Refreshes every 30 seconds.
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