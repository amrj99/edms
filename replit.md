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
- **Role-Based Access Control (RBAC):** 7 fixed roles (system_owner, admin, project_manager, document_controller, reviewer, member, viewer). Role ranks are defined in `artifacts/api-server/src/lib/permissions.ts`. `member` (rank 10) sits between reviewer and viewer — can create/reply to correspondence, complete own tasks, and read project documents.
- **Centralised Permission Matrix:** `artifacts/api-server/src/lib/permissions.ts` is the single source of truth for what each role may do across documents, correspondence, transmittals, workflows, tasks, and user management. Key invariants: (1) workflow/review approvals are assignment-based, not role-based; (2) document deletion is status-gated (DC can delete draft/under_review only; admin+ can delete anything with mandatory reason); (3) correspondence visibility defaults to mail-based To/CC; PM/DC may opt-in to view-all; (4) delegations cannot escalate beyond the delegator's own effective role.
- **Effective Role Resolution:** `artifacts/api-server/src/lib/governance.ts` — `resolveEffectiveRole()` combines org role + project_members role + active project_role_override + active delegation. Highest privilege wins. Returns `ResolvedRole` with flags for delegation context and override source.
- **Governance — Delegation:** Time-bound authority delegation. PM/admin can delegate their role to another user for a defined period (org-wide or project-scoped). Full audit trail. Routes: GET/POST/DELETE /api/delegations.
- **Governance — Project Role Overrides:** Temporary project-level role elevation without changing org role. PM/admin can elevate a member's role within a project until a set expiry. Routes: GET/POST/DELETE /api/projects/:projectId/role-overrides.
- **Document Lifecycle Governance:** Approved, issued, archived, and obsolete documents are protected from deletion. Non-admin users see Archive and Mark Obsolete actions instead of delete. SysAdmin hard-delete requires mandatory reason and is logged as `hard_delete`. Status enum includes `archived` and `obsolete`.
- **Dynamic Metadata System:** Allows administrators to define custom fields for documents and correspondence.
- **AI Integration:** Utilizes Replit AI Integrations (OpenAI proxy) for document analysis, task prioritization, and natural language search.
- **OpenAPI Specification:** Used for API definition and client code generation via Orval.
- **UI/UX Design:** Consistent layouts, theming, reusable React components, and interactive elements. Admin panels provide comprehensive configuration.
- **Multi-Organization Isolation:** Enforced at two levels: (1) SQL-level WHERE clauses on all list endpoints (meetings, action-items, documents, projects, correspondence); (2) `assertOrgMatch()` in `org-scope.ts` guards individual resource access. `isSystemOwner()` is the cross-tenant bypass — not `isSysAdmin()`. Org `admin` users are always scoped to their own organization. Only `system_owner` role spans all tenants.
- **Module Licensing:** Per-organization feature flags control module access (e.g., dashboard, deliverables, registers, notifications), enforced via API middleware and UI components.
- **Workflow Approvals:** Implements submit/approve/reject workflows for various records (e.g., NCR, ITR, Transmittal) with associated UI components and audit logging.
- **Frontend Permission Hook:** `artifacts/edms/src/hooks/usePermissions.ts` — mirrors the backend rank model. Used in all UI surfaces to gate actions. Use `perms.canXxx` flags; for assignment-based actions, use `canSetReviewCode(isAssigned)` / `canCompleteReview(isAssigned)`.
- **Governance Layer (Phase 6):** Three surfaces accessible via a "Governance" tab (DC+ roles) in project-detail:
  1. **Governance Dashboard** — live KPIs (overdue correspondence, awaiting response, SLA %, active workflows + bottleneck stage), transmittal review-code distribution, document status breakdown. Backend: `GET /api/projects/:id/governance/stats` in `project-governance.ts`.
  2. **Audit Log UI** — searchable, filterable (entity type, action, date range, free text), paginated (25/page), exportable (XLSX). Uses the existing `GET /api/audit-logs` route with full user+project joins.
  3. **Role Matrix** — read-only visual table mapping role tiers × permission capabilities. Rows grouped by category (Correspondence, Documents, Transmittals, Workflows, Audit, Member Management). Assignment-based actions shown with "A" badge.
- **Pluggable File Storage:** Default is `s3` (S3-compatible — AWS, Cloudflare R2, MinIO, DigitalOcean Spaces). Also supports `onpremise` (NAS/NFS mounted path). Replit cloud storage hidden in production unless `ENABLE_REPLIT_STORAGE=true`. Strict tenant isolation: S3 object keys are prefixed with orgId, on-premise paths include path traversal guards. Unauthorized access attempts logged via audit log.
  - **Storage Access Layer Principle (enforced):** All file references stored in the database (`file_url` column) MUST be one of: (a) a `/api/storage/...` path served through the unified storage router, or (b) a fully-qualified external `http(s)://` URL. Raw backend references — `s3://` URIs, filesystem paths (`/mnt/...`), relative seed paths (`seed/...`) — are NEVER stored. This ensures the preview pipeline (`usePreviewUrl`) remains consistent: internal paths go through the view-token flow, external http(s) URLs load directly, and anything else is classified `not-previewable` with a fallback UI. Future storage backends (NAS, new S3 bucket, etc.) add a route under `/api/storage/` and are transparent to all clients.
- **Real-Time WebSockets (Socket.io):** Enables real-time updates for notifications, chat, document, and task events.
- **Circuit Breaker for Rules:** Implements a circuit breaker pattern for automation rules to prevent continuous execution of failing rules.
- **Usage Monitoring Dashboard:** Provides per-organization metrics for documents, correspondence, AI calls, rule executions, and user seats.
- **Onboarding (Invite-Only):** Public self-registration is disabled (`registrationEnabled=false` in system_settings). Internal user creation via `POST /api/users` (Admin panel → Add User) is unaffected. System owner or org admin can create users, invite them, and assign them to organizations at any time.
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
- **AI Service Modularisation (Phase 3):** `ai-service.ts` is a re-export barrel for six domain modules (`ai-core`, `ai-settings`, `ai-documents`, `ai-correspondence`, `ai-tasks`, `ai-search`). The `ai_analysis` table stores permanent, append-only AI analysis results with `isLatest` flagging.
- **Document AI Analysis Tab (Phase 4):** Each document detail page has a tabbed layout (Overview / Revisions / AI Analysis). The AI tab loads on demand, shows latest analysis with urgency badge and recommendations, supports manual re-run, and keeps full analysis history.
- **Version Comparison (Phase 4):** The Revisions tab on each document shows the full revision history with A/B selector. A metadata diff is always available; an optional "Summarise with AI" button calls the AI only on demand.
- **AI Insights Dashboard (Phase 4):** A dedicated `/ai-insights` page shows organisation-wide risk distribution, documents needing attention (high/critical urgency), duplicate detection signals (discipline+type density per project), and a future-ready workflow bottleneck placeholder. All data is loaded lazily — no AI calls on render.
- **Document Number Uniqueness (Phase 3):** Unique constraint on `(project_id, document_number)`. Upload dialog has a debounced check (400 ms) with inline amber warning when a number is taken.

## Production Deployment — Known Issues & Solutions

> **Server**: VPS at `/var/www/edms` | Docker Compose | Cloudflare proxy → Nginx → Express
> **Deploy command**: `cd /var/www/edms && bash deploy.sh`
> **Canonical domain**: `https://www.arcscale.org` (non-www redirects to www)

---

### ISSUE 1: Site doesn't open — `ERR_CONNECTION_TIMED_OUT`

**Symptoms**: Browser shows "This site can't be reached" or timeout error.

**Cause A — Corporate/Fortinet network (most common)**
The Fortinet SSL inspection system blocks HTTPS connections. `ERR_CERT_AUTHORITY_INVALID` or timeout.
- **Fix**: Test from mobile data (not corporate WiFi). If it opens → it's the network, not the server.
- **Permanent fix**: IT admin must whitelist `arcscale.org` in Fortinet, or install the corporate CA cert.

**Cause B — Cloudflare DNS set to "DNS Only" (grey cloud)**
Browser tries to connect directly to server port 443 → no SSL cert on server → timeout.
- **Fix**: Cloudflare Dashboard → DNS → A records for `arcscale.org` and `www` → set icon to **orange (Proxied)**.
- SSL/TLS → set to **Flexible**.
- Edge Certificates → enable **Always Use HTTPS**.

**Cause C — Firewall on VPS**
```bash
sudo ufw status          # if inactive, rules aren't applied
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

**Cause D — Docker containers crashed**
```bash
docker ps                             # check all containers are Up
docker compose logs --tail=30 api    # check API logs
```

---

### ISSUE 2: File preview blocked by Chrome — `X-Frame-Options: DENY`

**Symptoms**: "Unsafe attempt to load URL … from frame with URL chrome-error://chromewebdata/"
Iframe shows Chrome's error page instead of PDF/image.

**Root cause**: Helmet sets `X-Frame-Options: DENY` globally on all API responses.
File-serving routes must remove this header so the browser allows iframe embedding.
The view token (5-min signed JWT) is the security layer — clickjacking protection is redundant here.

**Fix applied in commits**:
- `51c72d0`: Added `res.removeHeader("X-Frame-Options")` in success path of storage routes
- `6acf1e3`: Removed `add_header X-Frame-Options` from `nginx.conf` server block
- `ebb3b68`: Moved `res.removeHeader` to top of route handler (before early returns)
- `bef8f17`: Added `allowIframe` middleware **before** `requireAuthOrViewToken` so even 401/403/404 responses have no X-Frame-Options

**Verification after deploy**:
```bash
# Must return EMPTY (no x-frame header even on 401)
curl -si "https://www.arcscale.org/api/storage/onpremise/1/1/document/FILENAME.pdf?vt=TOKEN" 2>/dev/null | grep -i "x-frame"
```

---

### ISSUE 3: www vs non-www origin mismatch in iframe

**Symptoms**: Preview URL shows `www.arcscale.org` but page is on `arcscale.org` (or vice versa).
Chrome treats them as different origins for `X-Frame-Options: SAMEORIGIN`.

**Fix applied in `6acf1e3`**:
`nginx.conf` has a canonical redirect server block:
```nginx
server {
    listen 80;
    server_name arcscale.org;
    return 301 https://www.arcscale.org$request_uri;
}
```
All traffic is normalized to `www.arcscale.org`. The preview URL is always relative (`/api/storage/...`) so the browser resolves it to the same origin as the page.

---

### ISSUE 4: Session expired / 401 on API calls

**Symptoms**: Console shows `api/auth/me → 401`, `[socket] Connection error: Invalid token`.

**Fix**: Log out and log back in. The JWT access token (15 min) or refresh token (7 days) expired.
In the browser: Ctrl+Shift+Delete → clear cookies/local storage → log in again.

---

### ISSUE 5: Preview shows "This file cannot be previewed"

**Symptoms**: Grey icon with message in preview panel.

**Cause**: File URL stored in DB is a legacy path (`s3://`, `/mnt/`, `seed/...`) that bypasses the unified storage router.

**This is expected behavior** for seed data and legacy files. The preview pipeline classifies these as `not-previewable` and shows a fallback UI with a Download button.
New uploads always store `/api/storage/...` paths and are previewable.

---

### Deploy checklist

```bash
cd /var/www/edms && bash deploy.sh
```
All 7 steps should show ✓:
1. Code updated (git pull)
2. Migration applied
3. Images rebuilt
4. Containers recreated
5. API healthy
6. Env vars verified
7. Cloudflare cache purge (skipped unless CF_API_TOKEN set in .env)

---

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