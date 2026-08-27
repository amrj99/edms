# Read Auto-Wrapper Inventory (DEBT-010 Hybrid-Y, Phase D backlog)

Per the Hybrid-Y contract: **write handlers use explicit `withTenant()`**; **read
handlers (GET/HEAD)** on converted routers are covered transitionally by
`makeReadAutoWrap()` (a short read-only tenant transaction spanning the request).
Every read route served this way is listed here so it can be migrated to explicit
`withTenant()` in **Phase D**.

Rules for a read to stay on the auto-wrapper (all must hold):
- GET/HEAD only, read-only, **no external I/O** (R2 / Resend / filesystem stream).
- Short query; no side effects.

Routes that stream files/do external I/O are **excluded** via each router's `skip`
predicate and are handled with explicit `withTenant()` for the metadata lookup +
streaming OUTSIDE the transaction.

The live set actually exercised is available at runtime via
`getAutoWrappedReadInventory()` (used by the isolation test suite).

---

## Phase A — security-sensitive routers — ✅ COMPLETE

All mounted via `tenantScoped()`. Writes use explicit `withTenant()`; the GET routes
below are served through the transitional read auto-wrapper (Phase-D backlog).

| Router | Mount | Writes → withTenant | Auto-wrapped GET reads (Phase-D) |
|---|---|---|---|
| users | `/api/users` | POST / · PUT/:id · DELETE/:id · POST/:id/reset-password | GET / · GET /:id |
| projects | `/api/projects` | POST / · PUT/:id · DELETE/:id · POST/:id/members · DELETE/:id/members/:userId | GET / · GET /:id · GET /:id/members |
| project-participants | `/api/projects/:projectId` | POST · PUT · DELETE /participants | GET /participants |
| project-parties | `/api/projects/:projectId` | POST/parties · DELETE/parties/:orgId · PATCH/collaboration-mode | GET /available-organizations · GET /parties |
| project-departments | `/api/projects/:projectId` | POST · DELETE /departments | GET /departments |
| project-role-overrides | `/api/projects/:projectId` | POST · DELETE /role-overrides | GET /role-overrides |
| project-governance | `/api/projects/:projectId` | (read-only) | GET (governance reads) |
| departments | `/api/departments` | POST / · PUT/:id · DELETE/:id · POST/:id/members · DELETE/:id/members/:userId | GET / · GET/:id/members · GET/user/:userId |
| organizations | `/api/organizations` | POST / · PUT/:id · DELETE/:id | GET / · GET/cross-org-stats · GET/:id |
| delegations | `/api/delegations` | POST / · DELETE/:id | GET / |
| admin | `/api/admin` | storage-config · restore · seed-test-data · ai-classification · ai-tier · ai-limits · change-plan | system-info · storage-usage · usage · backup · ai-quota · org-plans · shadow-log |

Notes:
- **admin `search/reindex`** (POST): cross-tenant bulk + Elasticsearch I/O → `runUnscoped()`
  (pool, platform op). **admin `search/status`** (GET): excluded from auto-wrap (ES I/O).
- **organizations POST**: best-effort org_config + AI-credits run in their own short
  `withTenant()` calls (independent of org creation).
- bcrypt hashing (users create / reset-password) and the onboarding email run OUTSIDE
  the tenant transaction.

---

## Phase B — Documents / Files / Transmittals / Correspondence / Tasks / Meetings — ⏳ NEXT
## Phase C — Workflows / Registers / remaining mutations — ⏳
## Phase D — migrate the auto-wrapped reads above to explicit withTenant() — ⏳

_(Extended as each phase is converted.)_
