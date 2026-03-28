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
- **Multi-Organization Isolation:** Ensures data separation between different organizations. Projects page has org filter for sysadmin, organization dropdown in project creation form (replaces raw ID input), Building2 icon on project cards showing org name.
- **Module Licensing:** Per-org feature flags `{ dashboard, deliverables, registers, notifications }` stored as JSONB in `org_config`. `GET/PUT /api/modules` API (admin+system_owner gated). `useModules()` React hook. `ModuleGuard` route wrapper blocks direct URL access to disabled modules (`/`, `/deliverables`, `/reports`) with a bilingual "Module Not Available" placeholder. Sidebar hides Deliverables and Reports links when disabled. Notification bell hidden when notifications module is off. Admin "Modules" tab with 4 i18n-labelled toggle cards; system_owner sees org selector. 28 bilingual i18n keys.
- **RBAC Enforcement:** `requireRole("admin", "project_manager", "document_controller")` guards all write endpoints (POST/PUT/DELETE) on ITR, NCR, NOC registers and Transmittals. Frontend hides "Add Record" button for `viewer` and `reviewer` roles. Also fixed `await hashPassword()` bug in user creation and reset-password routes.
- **Workflow Approvals:** NCR, ITR, and Transmittal records support submit/approve/reject workflow. `approvalStatus` enum column (none/pending/approved/rejected) + `approvedById`/`approvalComment`/`approvedAt`. API: `submit-approval` (admin+pm+dc), `approve`/`reject` (admin+pm). `ApprovalBadge` + `ApprovalPanel` UI with instant panel update via `onRecordUpdated` callback. Approval actions create audit log entries.

**Key Features and Implementations:**

- **Document Management:** Tracks documents with revision history, robust review workflows, and AI-powered validation. Supports multiple files per document.
- **Correspondence Management:** Supports various correspondence types, threading, priorities, and attachments.
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