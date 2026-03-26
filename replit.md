# EDMS - Engineering Document Management System

## Overview

Full-stack Engineering Document Management System (EDMS) built as a scalable monorepo. Designed to evolve into a multi-tenant SaaS platform for medium-size engineering companies.

## AI Features (Powered by OpenAI via Replit AI Integrations)

- **Document AI Analysis** — Auto-summarize, classify type, suggest discipline/tags, urgency detection
- **Correspondence AI Analysis** — Categorize, urgency score, reply draft generation, key point extraction
- **Task Prioritization** — AI priority scores (0-100), bottleneck detection, risk assessment, recommendations
- **Natural Language Search** — Parse plain English queries into structured EDMS filters
- **AI Document Procedure** — AI-assisted document numbering and classification during upload (follows engineering standards ISO 9001, PMBOK)
- **AI Settings Admin** — Per-module enable/disable toggles for the organization (`/ai-settings`)
- **AI Caching** — Results cached 1 hour in `ai_cache` table to minimize API calls
- **AI Logging** — Every AI call logged in `ai_logs` table with latency, tokens, success

### AI Integration
- Provider: Replit AI Integrations (OpenAI proxy, no API key required, billed to Replit credits)
- Fast model: `gpt-5-mini` for document/correspondence analysis
- Smart model: `gpt-5.2` for task prioritization (complex reasoning)
- Package: `@workspace/integrations-openai-ai-server` at `lib/integrations-openai-ai-server/`

### AI Routes
- `POST /api/ai/documents/:id/analyze` — Document analysis
- `POST /api/ai/correspondence/:id/analyze` — Correspondence analysis
- `POST /api/ai/tasks/prioritize` — Task list prioritization
- `POST /api/ai/search/natural` — Natural language search parsing
- `POST /api/ai/documents/suggest-procedure` — Document numbering/classification suggestion
- `GET /api/ai/settings` — Get AI module settings
- `PUT /api/ai/settings` — Update AI module settings

### AI Frontend Components
- `artifacts/edms/src/components/ai/AIInsightsPanel.tsx` — Reusable AI analysis panel (Sheet slide-over on documents)
- `artifacts/edms/src/components/ai/AISearchBar.tsx` — Natural language search with example queries
- `artifacts/edms/src/components/ai/AITaskInsights.tsx` — Task prioritization panel
- `artifacts/edms/src/components/ai/AIProcedurePanel.tsx` — AI document numbering panel (embedded in Upload Document dialog)
- `artifacts/edms/src/pages/ai-settings.tsx` — Admin module toggle page

### AI Service Notes
- `max_completion_tokens` must be 8192+ (models truncate to `{}` with lower limits when using response_format json_object)
- `suggestDocumentProcedure` uses `jsonMode=false` to avoid empty responses from `response_format: json_object`; it parses JSON from text output with a fallback generator

## Usability & Administration Improvements (Latest)

### Multi-Document Transmittals
- Documents tab has checkboxes in first column (click row or header to select/deselect all)
- Bulk action bar appears when docs selected: Create Transmittal, Change Status, Download, Clear
- "Create Transmittal" bulk action opens dialog pre-filled with selected docs (number, title, revision)
- AI Summary button generates cover note text listing selected documents
- Floating bottom bar shows count and quick transmit button

### Outlook-Style Correspondence UI (`/correspondence`)
- Three-pane layout: Left (folders), Middle (list), Right (preview + quick reply)
- Left pane: All/General/Projects/Flagged/Starred/Overdue folders, per-project folders, per-type filters
- Middle pane: search bar, sort by date/priority/subject/type, type filter dropdown
- Right pane: full item detail with metadata, body, conversation thread placeholder, quick reply box
- Item-level flagging (🚩) and starring (⭐) via icon buttons
- Compose dialog creates general or project-specific correspondence

### Project Navigation
- Header "Switch Project" button opens searchable project dropdown (Command-palette style)
- Recent Projects section in sidebar (last 5 visited, stored in localStorage per browser)
- Recent projects update when user navigates to a project detail page

### System Owner Control Panel (`/admin`)
- 10-tab admin interface: Organization, User Roles, Metadata, Corr. Types, Numbering, Workflows, AI Config, Email, Storage, Security
- User Roles tab: change any user's role from a dropdown inline
- Metadata tab: define custom metadata fields (name, label, type: text/number/date/dropdown/boolean/url, required, scope: global/project)
- Correspondence Types tab: view built-in types, add custom types with prefix, SLA days, color
- Numbering tab: manage document numbering format, revision format, reference prefixes, SLA defaults
- AI Config tab: per-module AI enable toggles, model selection, cache duration
- Email tab: SMTP configuration form
- Storage tab: storage provider, file size limits, allowed extensions
- Security tab: session timeout, password policy, 2FA, audit settings, IP allowlisting, JWT expiry

### Settings Access (Role-Based)
- `system_owner` role added to user_role enum (DB schema updated and pushed)
- System Admin and Configuration pages gated to `admin` or `system_owner` roles
- User role management available via System Admin → User Roles tab

### Document Bulk Actions
- Select all: click header checkbox
- Select individual: click row or checkbox
- Bulk Create Transmittal: opens pre-filled dialog with doc list
- Bulk Change Status: set new status for all selected documents
- Bulk Download: triggers toast confirmation with count
- Clear selection: X button in action bar

### General Inbox Fix
- Fixed `items.slice is not a function` — response unwrapping now handles both array and `{ items: [...] }` shapes

## Construction EDMS Expansion

### New DB Tables
- `transmittals` + `transmittal_items` — Formal document transmittal tracking
- `notifications` — In-app notifications (14 types)
- `org_config` — Organization-level EDMS configuration
- `packages` — Document work packages (per project)
- Extended `correspondence` enum: `submittal`, `ncr`, `technical_query` added
- New fields on `correspondence`: `priority`, `assignedToId`, `linkedDocumentId`, `packageId`, `dueDate`, `closedAt`

### New API Routes
- `GET/POST /api/projects/:id/transmittals` — Transmittal CRUD
- `POST /api/projects/:id/transmittals/:id/send` — Mark sent
- `POST /api/projects/:id/transmittals/:id/acknowledge` — Mark acknowledged
- `GET/POST /api/projects/:id/packages` — Package CRUD
- `GET /api/notifications`, `POST /api/notifications/:id/read`, `POST /api/notifications/read-all` — Notification management
- `GET/PUT /api/config` — Org configuration

### New Frontend Pages
- `/config` — System Configuration panel (numbering format, disciplines, doc types, workflow templates, SLA defaults, reference prefixes)
- `/reports` — Reports page (document register, RFI log, submittal log, transmittal log with CSV export)

### Enhanced Sidebar Navigation
- Added: Reports, Configuration (admin-only) to sidebar
- General Inbox label updated
- Notification Bell in header with unread count badge, popover with mark-read

### Enhanced Project Detail (7 tabs)
- **Transmittals tab**: Create/list/send/acknowledge transmittals with purpose, to-field, due date
- **Packages tab**: Create/list/delete document work packages with card layout
- **Correspondence tab**: Full RFI/Submittal/NCR/TQ UI with priority, due date, type filter pills, overdue highlighting
- **Tasks tab**: Project-scoped task list with priority and overdue indicators
- **Members tab**: Project team member cards

### Enhanced Dashboard
- Recharts PieChart for document status distribution
- Project Portfolio progress bars (active/on-hold/completed/cancelled)
- Overdue Items widget with task due dates
- Priority badges on tasks
- Correspondence type color-coded badges

## General Section (Cross-Department Inbox)
- Route: `/general` — Cross-department inbox for items not tied to any specific project
- `correspondenceTable.projectId` is nullable — items with `projectId IS NULL` appear in General
- Correspondence types added: `notice`, `email`, `internal` (in addition to existing transmittal, letter, memo, rfi)
- API Routes at `/api/general/`:
  - `GET /api/general/correspondence` — List general inbox items
  - `POST /api/general/correspondence` — Create new general item
  - `POST /api/general/correspondence/:id/move-to-project` — Move item to a project
  - `POST /api/general/correspondence/:id/reply` — Reply to an item
- Frontend: `artifacts/edms/src/pages/general.tsx` — Full inbox UI with compose dialog, detail pane, AI analysis, move-to-project
- Sidebar nav: Dashboard, Projects, **General** (Inbox icon), My Tasks, Search

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + TypeScript + Vite (artifacts/edms)
- **Backend**: Express 5 (artifacts/api-server)
- **Database**: PostgreSQL + Drizzle ORM
- **Auth**: JWT (custom HS256 implementation)
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express REST API server
│   │   └── src/
│   │       ├── routes/     # All API route handlers
│   │       │   ├── auth.ts, organizations.ts, users.ts, projects.ts
│   │       │   ├── documents.ts, correspondence.ts, workflows.ts
│   │       │   ├── tasks.ts, metadata.ts, dashboard.ts, search.ts
│   │       │   └── audit-logs.ts
│   │       └── lib/
│   │           ├── auth.ts    # JWT signing/verification, middleware
│   │           └── audit.ts   # Audit log helper
│   └── edms/               # React + Vite frontend
│       └── src/
│           ├── pages/      # Login, Dashboard, Projects, Documents, etc.
│           ├── components/ # AppLayout, sidebar, UI components
│           ├── hooks/      # use-theme
│           └── lib/        # auth.tsx (AuthProvider + JWT fetch interceptor)
├── lib/
│   ├── api-spec/           # OpenAPI spec (openapi.yaml) + Orval codegen
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas
│   └── db/                 # Drizzle ORM schema + DB connection
│       └── src/schema/
│           ├── organizations.ts, users.ts, projects.ts, documents.ts
│           ├── correspondence.ts, workflows.ts, tasks.ts
│           ├── metadata.ts, audit-logs.ts
└── package.json
```

## Core Modules

### 1. Organizations
- Types: client, consultant, contractor, subcontractor
- Contact details, user count tracking

### 2. Projects
- Status: active, on_hold, completed, cancelled
- Members with per-project roles
- Dashboard, documents, correspondence, tasks, workflows

### 3. User Management (RBAC)
- Roles: admin, project_manager, document_controller, reviewer, viewer
- JWT authentication, first user auto-gets admin role

### 4. Document Management
- Document number, title, type, discipline, revision, status
- Status flow: draft → under_review → approved → issued
- Revision history tracking

### 5. Correspondence
- Types: transmittal, letter, memo, rfi
- Folders: inbox, sent, draft, archive
- Reply threading, reference numbers

### 6. Workflow Engine
- Steps: uploaded → under_review → approved → issued
- Approve/reject/comment actions
- Auto-creates review tasks for reviewers

### 7. Task Management
- Source: manual, workflow, correspondence
- Priority: low, medium, high, urgent
- Assigned user tracking

### 8. Metadata System
- Dynamic field definitions: text, number, date, select, multiselect, boolean
- Applies to: document, correspondence, or all

### 9. Search
- Full-text search across documents and correspondence
- Filter by project, discipline, status, type

### 10. Audit Logs
- Every create/update action is logged with user, entity, details

## Authentication

JWT-based auth using HS256. Token stored in `localStorage` as `edms_token`. All API calls include `Authorization: Bearer <token>` header via fetch interceptor in `src/lib/auth.tsx`.

- `POST /api/auth/login` - login with email/password
- `POST /api/auth/register` - register (first user gets admin role)
- `GET /api/auth/me` - get current user info

## Development Commands

```bash
# Start all services
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/edms run dev

# Push DB schema changes
pnpm --filter @workspace/db run push

# Regenerate API client after spec changes
pnpm --filter @workspace/api-spec run codegen
```

## Environment Variables

- `DATABASE_URL` - PostgreSQL connection string (auto-provisioned by Replit)
- `JWT_SECRET` - Secret for JWT signing (defaults to dev value, change in production)
- `PORT` - Server port (auto-assigned by Replit)

## Default Admin Account

Register at `/login` - the first registered user automatically gets the `admin` role.
