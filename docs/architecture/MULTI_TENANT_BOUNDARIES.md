# Multi-Tenant Boundaries — ArcScale EDMS

> **Critical security document.**
> Read before implementing any data access query, API endpoint, or RLS policy.

---

## Core Rule

```
Organization boundary = Security boundary.
Project boundary      = Workspace boundary only.

Never rely on project_id alone for tenant isolation.
```

---

## 1. Boundary Definitions

### Organization (Security Boundary)

The `organization_id` is the **only** authoritative isolation key.

- Every table that holds tenant data includes `organization_id`.
- Every server-side query that returns tenant data **must** include a `WHERE organization_id = ?` clause (or equivalent RLS policy).
- Membership, roles, permissions, and module entitlements are all scoped to `organization_id`.
- A user may belong to multiple organizations. Their session must always carry the active `organization_id` and it must be verified server-side.

### Project (Workspace Boundary — NOT Security)

The `project_id` groups documents and workflows within an organization for business / UX purposes.

- Filtering by `project_id` is never a substitute for `organization_id` enforcement.
- A query that filters by `project_id` only — without also filtering by `organization_id` — is a **security defect**.
- Project membership does not grant cross-organization access.

---

## 2. Enforcement Model

| Layer | Responsibility | Notes |
|---|---|---|
| RLS policies | PostgreSQL row-level security | Initialized on startup; scope to org ownership |
| API middleware | Express request handler | Attaches `req.organizationId` from JWT; validated before every handler |
| Service layer | Business logic | Must pass `organizationId` to every DB call |
| Frontend | UX filtering only | Never authoritative; never relied upon for security |

### Chain of Trust

```
JWT (organization_id claim)
  → API middleware extracts + validates
    → Service layer passes to DB call
      → RLS policy enforces at PostgreSQL level
```

Any break in this chain is a tenant isolation vulnerability.

---

## 3. Forbidden Patterns

```typescript
// FORBIDDEN — project_id only
db.select().from(documents).where(eq(documents.projectId, projectId));

// FORBIDDEN — trusting user-supplied org without validation
db.select().from(documents).where(eq(documents.organizationId, req.body.orgId));

// FORBIDDEN — skipping org check because project membership is verified
if (userBelongsToProject(userId, projectId)) {
  return db.select().from(documents).where(eq(documents.projectId, projectId));
}
```

---

## 4. Required Patterns

```typescript
// REQUIRED — always scope to organization_id from validated session
db.select()
  .from(documents)
  .where(
    and(
      eq(documents.organizationId, req.organizationId), // from validated JWT
      eq(documents.projectId, projectId)                // additional UX filter
    )
  );
```

---

## 5. Cross-Organization Access

Cross-organization access is **forbidden by default**.

Exceptions (e.g. system owner impersonation) must be:
- Explicitly gated by a system-owner role check
- Logged and auditable
- Never accessible via normal user JWT

---

## 6. RLS Policy Principles

- Every policy must reference `organization_id` from the organizations table.
- Policies must be initialized during API startup and verified after every migration.
- Never bypass RLS via `SET row_security = off` in production application code.

---

## 7. Checklist for New Endpoints

- [ ] Does the endpoint extract `organizationId` from the validated JWT?
- [ ] Does every DB query include `WHERE organization_id = :orgId`?
- [ ] Is `project_id` used only as an additional filter, never as the primary tenant key?
- [ ] Is the response scoped to the organization — no cross-org data leaked?
- [ ] Is there an RLS policy covering the underlying table?
