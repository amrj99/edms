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

-   **Monorepo Structure:** Facilitates code sharing and consistent tooling.
-   **Role-Based Access Control (RBAC):** Seven fixed roles with a centralized permission matrix (`artifacts/api-server/src/lib/permissions.ts`) governing capabilities across all modules. Role ranks and effective role resolution (`artifacts/api-server/src/lib/governance.ts`) combine organizational and project-specific roles, delegations, and overrides.
-   **Governance:** Includes time-bound authority delegation, temporary project-level role elevation, and a dedicated governance dashboard with KPIs, audit logs, and a visual role matrix.
-   **Document Lifecycle Governance:** Documents have protected states (approved, issued, archived, obsolete) preventing deletion. Non-admin users have limited deletion capabilities, and System Admin hard-deletes are logged with mandatory reasons.
-   **Dynamic Metadata System:** Allows administrators to define custom fields for documents and correspondence.
-   **AI Integration:** Utilizes AI for document analysis, task prioritization, and natural language search, with a modular abstraction allowing pluggable providers and AI insights dashboard.
-   **OpenAPI Specification:** Used for API definition and client code generation.
-   **UI/UX Design:** Emphasizes consistent layouts, theming, reusable React components, and interactive elements, with comprehensive admin panels.
-   **Multi-Organization Isolation:** Enforced at both SQL-level WHERE clauses and individual resource access checks. The `system_owner` role is the only one spanning all tenants.
-   **Module Licensing:** Per-organization feature flags control module access via API middleware and UI components.
-   **Workflow Approvals:** Implements submit/approve/reject workflows with audit logging for various records.
-   **Frontend Permission Hook:** `artifacts/edms/src/hooks/usePermissions.ts` mirrors backend permissions to gate UI actions.
-   **Pluggable File Storage:** Supports S3-compatible storage (default) and on-premise NAS/NFS. Strict tenant isolation is enforced, and all file references in the database are routed through a unified storage system for previewing.
-   **Real-Time WebSockets (Socket.io):** For notifications, chat, document, and task events.
-   **Circuit Breaker:** Implemented for automation rules to prevent continuous execution of failing rules.
-   **Usage Monitoring Dashboard:** Provides per-organization metrics for various system activities.
-   **Onboarding:** Invite-only user creation via admin panel.
-   **Stripe Billing:** Integrated for subscription management and webhooks.
-   **Elasticsearch Search:** Provides full-text search, with SQL fallback.

**Key Features:**

-   **Document Management:** Revision history, AI validation, multi-file support, and unique document number enforcement.
-   **Automation Rules Engine:** Admin-configurable rules for document uploads and correspondence.
-   **Correspondence Management:** Two-pane layout, reply/forward, BCC, and real-time threads.
-   **Meetings & Action Items:** Manages meeting lifecycle, attendees, and tracks action items.
-   **Reports Dashboard:** Analytics with metric widgets and project filtering.
-   **Global Search Bar:** Persistent header search with categorized results.
-   **Test Data Seed:** API endpoint for generating realistic test data.
-   **Workflow Engine:** Automates document lifecycle steps and task creation.
-   **Notifications:** In-app and email notifications with a reminder job.
-   **System Admin Panel:** Comprehensive configuration for organizations, users, roles, metadata, and AI.
-   **Registers & Deliverables:** Modules for tracking project items with filtering and export.
-   **Link Relationships:** Supports linking between various records.
-   **AI-Assisted Linking:** Suggests links between transmittals.
-   **AI Service Modularization:** Abstracted AI services for different domains.
-   **Document AI Analysis Tab:** Document detail pages include an AI analysis tab with history and re-run options.
-   **Version Comparison:** Revision history with metadata diff and AI summary option.
-   **Departments (Phase A — Data Layer):** `departments` and `user_departments` tables (serial integer IDs) in `lib/db/src/schema/departments.ts`. Full CRUD + member-management API at `/api/departments`. Admin panel "Departments" tab with create/edit/delete/member dialogs.
-   **Document/Project Departments (Phase B):** `document_departments` and `project_departments` junction tables added. Assignment APIs (`POST /api/projects/:id/departments`, `POST /api/projects/:id/documents/:docId/departments`) with cross-org guard (403 if dept and resource belong to different orgs).
-   **Access Rulebook Phase C (Shadow Mode):** Three new tables in `lib/db/src/schema/access-control.ts`:
    -   `document_access_rules` — explicit per-doc per-dept allow/deny overrides (deny always wins, except system_owner)
    -   `document_confidential_access` — allowlist for `documents.is_confidential=true` docs (by user_id OR dept_id); project_manager does NOT bypass this gate
    -   `access_shadow_log` — persistent audit log of shadow evaluations (always persists divergences, 5%-samples agreements)
    -   Full 9-rule `AccessResolver` in `artifacts/api-server/src/lib/access-resolver.ts`: system_owner_bypass → explicit_deny → confidential_gate → admin_bypass → project_member_gate → project_manager_scope → workflow_grant → explicit_allow → dept_match/no_dept_restriction → implicit_deny
    -   Shadow evaluation hooked into: `GET /api/documents`, `GET /api/documents/:id`, `GET /api/projects/:id/documents`, `GET /api/projects/:id/documents/:docId`
    -   Fire-and-forget: never blocks requests, never returns 403, never modifies responses
    -   Divergence detection: logs `WARN` when resolver disagrees with system; persists to `access_shadow_log` for SQL analytics

## External Dependencies

-   **Database:** PostgreSQL
-   **ORM:** Drizzle ORM
-   **AI Providers (Pluggable):** OpenRouter, Together AI, HuggingFace, Ollama, OpenAI, Anthropic.
-   **Frontend Framework:** React
-   **Build Tool (Frontend):** Vite
-   **Backend Framework:** Express 5
-   **Package Manager:** pnpm
-   **API Client Generation:** Orval
-   **Charting Library:** Recharts
-   **Object Storage:** AWS S3-compatible, Replit Object Storage (dev only), On-Premise NAS/NFS
-   **Email:** SMTP
-   **Search:** Elasticsearch
-   **Real-time Communication:** Socket.io
-   **Payments:** Stripe