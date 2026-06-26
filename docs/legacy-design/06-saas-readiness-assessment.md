# SaaS Readiness Assessment — Multi-Tenancy Gaps
> Source: `saas points missing.odt`  
> Date: ~2026-04 (pre-production audit)

## Multi-Tenant Data Isolation

### Tables with direct `organization_id`
✅ `users`, `projects`, `rules`, `ai_settings`, `org_config`, `chat`

### Tables scoped only indirectly (via project_id)
❌ `documents`, `correspondence`, `tasks`, `workflows`, `transmittals`, `notifications`, `document_files`

❌ `audit_logs` — **no org scope at all**

Indirect scoping works but is fragile and adds JOIN complexity.

## API Query Filtering

| Route | Filtering |
|-------|-----------|
| Projects | Directly: `WHERE projects.organization_id = user.organizationId` |
| Documents/Correspondence | Via project: checks `project.organizationId === user.organizationId` |
| Global Documents `/api/documents` | Via project join |
| Tasks (projectId = null) | **No org scope whatsoever** |
| Rules / AI settings / Config | Directly by organizationId |
| Audit logs | **No org filtering** — gap |

## Middleware Gap
No automatic org-injection middleware. Each route manually reads `req.user.organizationId`.
If a developer forgets it on a new route, that route is unscoped. **No safety net at framework level.**

## Cross-Org Access Gaps
- Most routes are protected by org checks ✅
- Audit logs have no org filter ❌ — any authenticated user can potentially read all audit entries
- Tasks with `projectId = null` have no org scope ❌
- `system_owner` can explicitly override org via `?orgOverride=N` — intentional for super-admin ✅

## Database-Level Isolation
❌ **Application level only.** No PostgreSQL Row Level Security (RLS), no schema-per-tenant, no database user per tenant. Isolation is enforced entirely by application code.

## Note on Current State
Some of these gaps may have been addressed after this audit (e.g., RLS policies were added per `ARCHITECTURE_STATE.md`). Always verify against current code.
