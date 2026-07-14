# ADR-0008 — Tenant Isolation & Object-Level Authorization Pattern v1

- **Status:** Accepted
- **Date:** 2026-07-13
- **Scope:** Project-scoped API routers (documents, transmittals, correspondence, and future routers)

## Context

Across the B2.x security batches (B2.7 documents, B2.4 transmittals, B2.5
correspondence) the same class of cross-organization authorization defect was
found and fixed three times. The root causes were consistent:

1. **`resolveEffectiveRole` used as an access gate.** It grants a cross-org
   admin an effective role (incl. `admin_override`) *before* tenant access is
   proven, so role authorization silently substituted for resource
   authorization. This alone caused several confirmed cross-org leaks.
2. **Inconsistent enforcement shape.** Documents and transmittals gate access at
   the router edge (`canAccessProject`); correspondence scopes per-handler
   (`orgScopedWhere`, because it is dual-mounted at `/projects/:projectId/...`
   **and** `/correspondence`). The two are legitimately different tenancy models,
   but the enforcement was hand-rolled per router.
3. **Object-scoping gaps.** Child resources (transmittal items, attachments) were
   looked up by bare id, not tied to their parent + tenant.
4. **Party default-allow.** `PARTY_CEILING_V1` allows unlisted actions by
   default — unsafe for destructive writes.

## Decision

### The mandatory order

Every project-scoped mutation MUST follow this order:

```
Authenticate
→ Prove tenant/project access        (requireProjectAccess / orgScopedWhere)
→ Apply party capability             (denyPartyDestructive / isWithinPartyCeiling)
→ Resolve effective role             (resolveEffectiveRole)
→ Scope resource to its parent+tenant (object-level WHERE)
→ Execute mutation
```

### Rules (normative)

- **`resolveEffectiveRole` is NOT an access gate.** It may run only *after*
  tenant access is proven. Role authorization never substitutes for resource
  authorization.
- **Every child resource is bound to its parent inside the query** — never
  mutate/delete by a bare child id (item → transmittal → project;
  attachment → parent → tenant).
- **Unapproved party actions are never allowed incidentally** — a destructive
  action with no explicit `PARTY_CEILING_V1` capability is denied
  (Party Policy v1), not bound to an unrelated capability, and never relies on
  the permissive default.

### The shared primitive

`middlewares/project-access.ts` provides:

- **`requireProjectAccess()`** — router-wide gate. Proves access via
  `canAccessProject`, fail-closed 403 for non-members, stashes the resolved
  context (`{ projectOrgId, mode, partyRole }`, derived from the resolver's own
  type) on `req.projectAccess`.
- **`requireProjectAccessContext(req)`** — fail-closed accessor. Throws if the
  request never passed `requireProjectAccess()`; a security primitive must never
  run without its context.
- **`denyPartyDestructive`** — fail-closed party guard for destructive actions
  with no capability. Denies party callers (403); fails closed (throws) if the
  context is missing rather than silently calling `next()`.

Project-scoped routers (documents, transmittals) consume the primitive.

### The org-scoped variant (legitimate)

Routers that are **dual-tenancy** (a resource may exist at org level, not only
under a project — e.g. correspondence via its `/correspondence` mount) enforce
access with **`orgScopedWhere`** on the resource lookup instead of the
project-access gate. This is an accepted variant of the same pattern: the tenant
(the owning org) is proven before role resolution and before mutation. A party
caller is, by definition, a different org than the resource owner, so
`orgScopedWhere` denies party destructive mutations automatically.

## Consequences

- One primitive, one order, applied uniformly to project-scoped routers.
- New routers consume the primitive instead of re-deriving a variant.
- `req.projectAccess` is centrally typed; no per-route casts.
- Behaviour of the existing routers is unchanged by the extraction (same
  status codes and messages; proven by the existing test suites).

## Future work (recorded in ARCHITECTURE_DEBT_REGISTER.md — NOT decided here)

- **D1 — Party Ceiling default-deny.** Preliminary direction: unknown party
  actions should ultimately be denied by default. **Decision Required
  (Security/Product)** — needs a full inventory of party actions, explicit
  registration of legitimate capabilities, regression tests, and its own PR.
- **D2 — Correspondence dual mount.** Whether correspondence is org-scoped or
  strictly project-scoped is **Evidence Required (Architecture/Product)** —
  needs a data + usage inventory before deciding.
- **Observation — `workflow-engine` resolveEffectiveRole usage** needs an
  independent security review to confirm every entry point scopes the org
  before resolving the role. Non-blocking; a separate security batch, no
  pre-emptive fix.
