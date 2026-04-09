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
- **Multi-Organization Isolation:** Ensures data separation between different organizations, with a focus on project and user data isolation.
- **Module Licensing:** Per-organization feature flags control module access (e.g., dashboard, deliverables, registers, notifications), enforced via API middleware and UI components.
- **Workflow Approvals:** Implements submit/approve/reject workflows for various records (e.g., NCR, ITR, Transmittal) with associated UI components and audit logging.
- **Pluggable File Storage:** Default is `s3` (S3-compatible — AWS, Cloudflare R2, MinIO, DigitalOcean Spaces). Also supports `onpremise` (NAS/NFS mounted path). Replit cloud storage hidden in production unless `ENABLE_REPLIT_STORAGE=true`. Strict tenant isolation: S3 object keys are prefixed with orgId, on-premise paths include path traversal guards. Unauthorized access attempts logged via audit log.
- **Real-Time WebSockets (Socket.io):** Enables real-time updates for notifications, chat, document, and task events.
- **Circuit Breaker for Rules:** Implements a circuit breaker pattern for automation rules to prevent continuous execution of failing rules.
- **Usage Monitoring Dashboard:** Provides per-organization metrics for documents, correspondence, AI calls, rule executions, and user seats.
- **Onboarding (Self-Service Org Registration):** Allows new organizations and their administrators to register through a public endpoint.
- **Stripe Billing:** Integrated for managing subscription plans, user limits, and storage limits, with webhook handling for payment events.
- **Elasticsearch Search:** Provides full-text search capabilities, falling back to SQL search if Elasticsearch is not configured.

**Key Features and Implementations:**

- **Document Management:** Tracks documents with revision history, AI-powered validation, and multi-file support.
- **Automation Rules Engine:** Admin-configurable rules for document uploads and correspondence creation, supporting actions like user assignment and notifications.
- **AI Classification Abstraction:** Modular AI classification for documents, allowing different providers or disabling AI.
- **Correspondence Management:** Features a full two-pane layout, reply/forward functionality, BCC, and real-time conversation threads.
- **Meetings Module:** Manages the full lifecycle of meetings, including attendees, action items, and minutes.
- **Action Items Tracker:** A cross-project page to view and manage all meeting action items.
- **Reports Dashboard:** An analytics page with various metric widgets and a project filter.
- **Global Search Bar:** A persistent header search widget with categorized results across various entities.
- **Test Data Seed:** An API endpoint to generate realistic test data for development and testing.
- **Workflow Engine:** Automates document lifecycle steps and task creation, such as review tasks for transmittals and action item parsing from meeting minutes.
- **Notifications:** In-app and email notifications for key events, including a notification bell with filtering and a reminder job for overdue tasks.
- **System Admin Panel:** Comprehensive administration for organization settings, user roles, metadata, AI configuration, and more.
- **Reports Module:** Provides tabbed registers with filtering, export options, and bulk actions.
- **Deliverables Module:** Manages project deliverables with status tracking.
- **Link Relationships:** Supports linking between various records (documents, correspondence, NCRs, etc.).
- **AI-Assisted Transmittal Linking:** Suggests links between transmittals based on similarity scoring.

## External Dependencies

- **Database:** PostgreSQL
- **ORM:** Drizzle ORM
- **AI Providers (Pluggable):** Free defaults: OpenRouter (OPENROUTER_API_KEY), Together AI (TOGETHER_API_KEY), HuggingFace (HUGGINGFACE_API_KEY), Ollama (local). Paid optional: OpenAI (OPENAI_API_KEY), Anthropic (ANTHROPIC_API_KEY). Legacy: Groq, Replit OpenAI proxy. Provider selected per-org via admin UI; falls back to system setting then first available free provider. Architecture: `artifacts/api-server/src/lib/ai-providers/` (one file per provider + factory in index.ts).
- **Frontend Framework:** React
- **Build Tool (Frontend):** Vite
- **Backend Framework:** Express 5
- **Package Manager:** pnpm
- **API Client Generation:** Orval
- **Charting Library:** Recharts
- **Object Storage:** AWS S3-compatible (default), Replit Object Storage (dev only), On-Premise NAS/NFS
- **Email:** SMTP (for email notifications)
- **Search:** Elasticsearch (optional, falls back to SQL full-text search)
- **Real-time Communication:** Socket.io
- **Payments:** Stripe