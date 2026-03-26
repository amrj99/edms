# EDMS - Engineering Document Management System

## Overview

Full-stack Engineering Document Management System (EDMS) built as a scalable monorepo. Designed to evolve into a multi-tenant SaaS platform for medium-size engineering companies.

## AI Features (Powered by OpenAI via Replit AI Integrations)

- **Document AI Analysis** — Auto-summarize, classify type, suggest discipline/tags, urgency detection
- **Correspondence AI Analysis** — Categorize, urgency score, reply draft generation, key point extraction
- **Task Prioritization** — AI priority scores (0-100), bottleneck detection, risk assessment, recommendations
- **Natural Language Search** — Parse plain English queries into structured EDMS filters
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
- `GET /api/ai/settings` — Get AI module settings
- `PUT /api/ai/settings` — Update AI module settings

### AI Frontend Components
- `artifacts/edms/src/components/ai/AIInsightsPanel.tsx` — Reusable AI analysis panel (Sheet slide-over on documents)
- `artifacts/edms/src/components/ai/AISearchBar.tsx` — Natural language search with example queries
- `artifacts/edms/src/components/ai/AITaskInsights.tsx` — Task prioritization panel
- `artifacts/edms/src/pages/ai-settings.tsx` — Admin module toggle page

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
