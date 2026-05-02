# EDMS - Engineering Document Management System

## Overview

EDMS is a full-stack Engineering Document Management System designed as a scalable monorepo, evolving into a multi-tenant SaaS platform. It streamlines document and correspondence management, workflow automation, and task prioritization for engineering companies. Key capabilities include AI-powered document analysis, natural language search, robust document review workflows, and comprehensive project management tools to improve operational efficiency and ensure compliance with industry standards.

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
-   **Role-Based Access Control (RBAC):** Seven fixed roles with a centralized permission matrix governing capabilities. Role ranks and effective role resolution combine organizational and project-specific roles, delegations, and overrides.
-   **Governance:** Includes time-bound authority delegation, temporary project-level role elevation, and a dedicated governance dashboard with KPIs and audit logs.
-   **Document Lifecycle Governance:** Documents have protected states, preventing deletion by non-admin users. System Admin hard-deletes are logged with mandatory reasons.
-   **Dynamic Metadata System:** Allows administrators to define custom fields for documents and correspondence.
-   **AI Integration:** Utilizes AI for document analysis, task prioritization, and natural language search, with a modular abstraction for pluggable providers and an AI insights dashboard.
-   **OpenAPI Specification:** Used for API definition and client code generation.
-   **UI/UX Design:** Emphasizes consistent layouts, theming, reusable React components, and interactive elements, with comprehensive admin panels.
-   **Multi-Organization Isolation:** Enforced at both SQL-level and individual resource access checks.
-   **Module Licensing:** Per-organization feature flags control module access via API middleware and UI components.
-   **Workflow Approvals:** Implements submit/approve/reject workflows with audit logging.
-   **Frontend Permission Hook:** Mirrors backend permissions to gate UI actions.
-   **Pluggable File Storage:** Supports S3-compatible storage (default) and on-premise NAS/NFS, with strict tenant isolation.
-   **Real-Time WebSockets (Socket.io):** For notifications, chat, document, and task events.
-   **Circuit Breaker:** Implemented for automation rules.
-   **Usage Monitoring Dashboard:** Provides per-organization metrics.
-   **Onboarding:** Invite-only user creation via admin panel.
-   **Stripe Billing:** Integrated for subscription management.
-   **AI Credits System:** Organization-level credit wallet with atomic deduction, separate from subscription plans. Offers free credits and purchasable packs via Stripe Checkout.
-   **Trial Mode:** Self-service organization registration for a 14-day trial with limits on users, storage, file size, projects, and AI credits. Enforcement gates prevent usage past limits or without email verification.
-   **Elasticsearch Search:** Provides full-text search with SQL fallback.
-   **Key Features:**
    -   **Document Management:** Revision history, AI validation, multi-file support, unique document numbers.
    -   **Automation Rules Engine:** Admin-configurable rules for documents and correspondence.
    -   **Correspondence Management:** Two-pane layout, reply/forward, BCC, real-time threads.
    -   **Meetings & Action Items:** Manages meeting lifecycle and action items.
    -   **Reports Dashboard:** Analytics with metric widgets.
    -   **Global Search Bar:** Persistent header search with categorized results.
    -   **Workflow Engine:** Automates document lifecycle steps and task creation.
    -   **Notifications:** In-app and email notifications.
    -   **System Admin Panel:** Comprehensive configuration.
    -   **Registers & Deliverables:** Tracking project items.
    -   **Link Relationships:** Supports linking between records, with AI-assisted suggestions for transmittals.
    -   **AI Service Modularization:** Abstracted AI services for different domains.
    -   **Document AI Analysis Tab:** Provides AI analysis history and re-run options.
    -   **Version Comparison:** Revision history with metadata diff and AI summary.
    -   **Departments:** Manages organizational departments and user assignments.
    -   **Access Rulebook:** Implements a comprehensive access control system with explicit allow/deny rules, confidential document access, and shadow mode evaluation for logging divergences before full enforcement.
    -   **AI Provider Architecture Overhaul:** Dynamic registry for AI providers with categories (`cloud_free`, `fast`, `aggregator`, `cloud_paid`, `local`), tier-aware fallback chains, and a privacy mode that restricts data sent to external providers.

## Database Migration System

Schema changes are managed via **Drizzle migration files** (`lib/db/drizzle/`).

### Developer workflow
When you add or modify a column/table in any `lib/db/src/schema/*.ts` file:

```bash
pnpm db:generate        # generates a new SQL file in lib/db/drizzle/
git add lib/db/drizzle/ # commit the migration alongside the schema change
```

The new migration is applied automatically when the API container next starts
(via `dist/migrate.mjs` in `docker-entrypoint.sh`).

> **Rule:** A schema change is not complete until `pnpm db:generate` has been
> run and the resulting file in `lib/db/drizzle/` is committed.

### Safeguard: detecting drift
Run `pnpm db:check` at any time to verify schema and migrations are in sync:

```bash
pnpm db:check   # exits 0 if in sync, exits 1 + instructions if drift detected
```

This runs `drizzle-kit check` (migration file integrity) then `drizzle-kit generate`
(schema drift detection). If a new migration file is generated, it means a schema
change was made without a corresponding `pnpm db:generate` — commit the file.

### How it works
- `lib/db/drizzle/0000_init.sql` — baseline snapshot of the full schema.
- Each subsequent `pnpm db:generate` call appends a new incremental file.
- `artifacts/api-server/src/migrate.ts` is compiled to `dist/migrate.mjs` and
  runs via `docker-entrypoint.sh` before the API starts on every deploy.
- **Baseline detection:** if the `organizations` table exists but
  `__drizzle_migrations` doesn't (first deploy after this change), the runner
  marks all existing migrations as already applied and only runs new ones.
- `migrate_production.sql` is kept as an emergency manual reference but is
  no longer part of the automated deploy process.

### Emergency manual migration
```bash
# Only needed if the container can't start and you must patch the DB manually:
docker exec -i edms_postgres psql -U edms -d edms < migrate_production.sql
```

## External Dependencies

-   **Database:** PostgreSQL
-   **ORM:** Drizzle ORM
-   **AI Providers:** Cloudflare Workers AI, OpenRouter, HuggingFace, Groq, Together AI, Ollama, OpenAI, Anthropic (pluggable, dynamic registry with tiered fallback)
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