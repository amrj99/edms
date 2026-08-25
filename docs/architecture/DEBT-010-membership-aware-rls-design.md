# DEBT-010 — Membership-Aware RLS (Decision B) — Read-Only Design / Audit

**Status:** DESIGN ONLY — no policy migration, no code change. Stop for owner decision.
**Scope:** define the real security model for the 13 RLS tables when the DB role moves from
superuser (RLS inert) to `edms_app` (RLS enforced). Separates **Visibility (RLS)** from
**Authorization (RBAC / application guards)**. Does NOT touch background jobs, `/migrations`,
Production roles, `DATABASE_URL`, or cutover.

Ground truth captured from: `lib/rls-init.ts` (current policy), `lib/db/src/index.ts`
(`runInTenantTx`/context), `lib/party-access.ts` + `lib/can-access-project.ts` (cross-org
authority), the Drizzle schema, and the live route handlers.

---

## Current policy (baseline)

`lib/rls-init.ts` applies ONE policy `org_isolation_policy` to all 13 tables, `PERMISSIVE FOR ALL`,
`USING == WITH CHECK`:

```
current_setting('app.is_system_owner', TRUE) = 'true'
OR organization_id = NULLIF(current_setting('app.current_org_id', TRUE), '')::integer
```

Context set per-tx by `runInTenantTx` via `set_config(..., true)` (tx-local): `app.current_org_id`,
`app.is_system_owner`. **`app.current_user_id` does not exist yet.** Missing context ⇒ NULL ⇒ 0 rows
(fail-closed). This is **org_id-only** — no project membership, no per-user grain.

---

## 1. The 13 tables — classification

Two axes matter: the **schema shape** (does the row carry org_id / project_id) and — decisively —
**what the application actually allows cross-org**. Where they diverge, the app behavior governs the
policy (we must not grant visibility the product never grants).

| # | Table | org_id | project_id | Classification | Cross-org grant that EXISTS in the app |
|---|---|---|---|---|---|
| 1 | documents | nullable | NOT NULL | **project-collaborative (org-party)** | `project_parties` (org) + `project_members` (user) via `canAccessProject` |
| 2 | document_revisions | nullable | via `documentId→documents` | **project-collaborative (inherited)** | same as documents (no own project_id) |
| 3 | document_files | nullable | via `documentId→documents` | **project-collaborative (inherited)** | same as documents |
| 4 | projects | **NOT NULL** | (is the project) | **collaborative root** | party org must see the project row it was invited to (`collaborationMode='parties'`) |
| 5 | tasks | nullable | nullable | **tenant-private, per-user leaning** | none cross-org today; org-scoped, `assignedToId`/`createdById` grain |
| 6 | notifications | nullable | nullable | **tenant-private, PER-USER** (`userId` NOT NULL) | none; each recipient row carries its own org |
| 7 | rules | **NOT NULL** | none | **tenant-private** | none — admin automation, never shared |
| 8 | correspondence | nullable | nullable | **collaborative, PER-RECORD** | named `correspondence_recipients`/`cc` (user) — NOT org-blanket |
| 9 | transmittals | nullable | NOT NULL | **collaborative, recipient-org** | recipient org via `to_user_id`'s org + project access |
| 10 | inspection_requests | nullable | NOT NULL | **schema-collaborative but APP-TENANT-PRIVATE** | none — registers router is org-locked (`checkProjectOwnership`) |
| 11 | ncr_records | nullable | NOT NULL | **APP-TENANT-PRIVATE** (as #10) | none |
| 12 | noc_records | nullable | NOT NULL | **APP-TENANT-PRIVATE** (as #10) | none |
| 13 | metadata_fields | nullable (semantic) | none | **system-global + tenant-private hybrid** | `organization_id IS NULL` = global defaults readable by all tenants |

**Cases that do NOT fit cleanly (surfaced, not assumed):**

- **#10–12 registers (ITR/NCR/NOC):** the schema screams "project-collaborative" (`partyType`,
  `direction`, `approvedById`), but the *app* gates them with `checkProjectOwnership` (org-only 403),
  never `canAccessProject`. So today there is **zero cross-org access**. → keep **org-only** RLS. If
  the product later opens registers to parties, they move to the collaborative category — a deliberate
  future decision, not this one.
- **#5 tasks:** `projectId` nullable; no cross-org flow. Real grain is org + per-user
  (`assignedToId`/`createdById`). Org-only RLS matches today; a per-user tightening is possible but is
  a **behavior change** (see §3, decision T).
- **#8 correspondence:** collaborative, but the app grants cross-org access **per record** (named
  recipient), deliberately querying by IDs (`correspondence.ts:702-707`) and forcing cross-org project
  members to mail-model (`606-642`). An org-party-blanket policy here would be **too broad** — it would
  admit a party-org user to project correspondence they were never named on.
- **#13 metadata_fields:** the fail-closed org-only policy currently HIDES `organization_id IS NULL`
  global fields from tenant users (only system_owner sees them). This is a latent bug the new policy
  must fix (allow global-field reads).

---

## 2. Access matrix

Actors (rows). "R" = row visible (SELECT); "W" = may INSERT/UPDATE/DELETE the row **at the RLS layer**
(RBAC still applies on top — see the hard rule below). "—" = denied / 0 rows.

**Hard separation rule (applies to every cell):** RLS decides *visibility* and *tenant/project
anchoring only*. It NEVER grants edit/delete/approve/admin — those remain with RBAC/application guards.
A "W" below means "RLS does not block the write"; whether the actor may actually perform it is decided
by the existing role/ceiling checks, unchanged.

### Category CP — tenant-private (rules; registers ITR/NCR/NOC; tasks*)
| Actor | R | W |
|---|---|---|
| owner org (org_id = current_org_id) | R | W |
| project member, same org | R | W |
| project member, **other org** | — | — |
| other-org user, no membership | — | — |
| system_owner (flag true) | R | W |
| missing tenant/user context | — | — |

### Category CU — per-user tenant-private (notifications)
| Actor | R | W |
|---|---|---|
| the recipient user (`userId = current_user_id`) | R | W |
| same-org, different user | — (decision U) | — (decision U) |
| other-org user | — | — |
| system_owner | R | W |
| missing context | — | — |

### Category CC-party — org-party collaborative (documents, document_revisions, document_files, projects)
| Actor | R | W |
|---|---|---|
| owner org | R | W (own-org) |
| project member, same org | R | W |
| **active party org** (`project_parties`, `removedAt IS NULL`, mode='parties') | R | W* (only where the row's org = project owner AND project stays the same — see §3 WITH CHECK; RBAC ceiling still limits to contributor upload) |
| user-level `project_members` cross-org (legacy) | R | W* (same anti-move rule) |
| other-org user, no party/membership | — | — |
| system_owner | R | W |
| missing context | — | — |

### Category CC-rec — per-record collaborative (correspondence)
| Actor | R | W |
|---|---|---|
| owner org | R | W |
| named recipient/cc (`current_user_id`), any org | R | W** (mark-read only; org_id/project_id must not change — see decision X) |
| same-org non-recipient | R (org match) | W (org match) |
| other-org, not named | — | — |
| system_owner | R | W |
| missing context | — | — |

### Category CC-recipient-org — transmittals
| Actor | R | W |
|---|---|---|
| owner (sender) org | R | W |
| recipient org (org of `to_user_id`) | R | W** (acknowledge/complete-review; anti-move enforced) |
| project party/member (read ceiling) | R | — (party destructive denied by RBAC) |
| other-org, unrelated | — | — |
| system_owner | R | W |
| missing context | — | — |

### Category CS — system-global hybrid (metadata_fields)
| Actor | R | W |
|---|---|---|
| owner org (org_id = current_org_id) | R | W |
| any tenant, `organization_id IS NULL` global row | **R** (read only) | — (only system_owner writes globals) |
| other-org tenant row | — | — |
| system_owner | R | W |
| missing context | global rows R; tenant rows — | — |

---

## 3. Proposed policy design per category

All policies keep the two invariants of the current design: **system_owner** via the server-set
`app.is_system_owner='true'` flag, and **fail-closed** on missing context. New building block: a set of
`SECURITY DEFINER STABLE` helper functions (see §5) that answer membership questions without recursion
and without granting `edms_app` direct SELECT on the lookup tables.

Helpers (read-only, definer-owned):
- `app.session_org() → int` = `NULLIF(current_setting('app.current_org_id',true),'')::int`
- `app.session_user() → int` = `NULLIF(current_setting('app.current_user_id',true),'')::int`
- `app.is_sysowner() → bool` = `current_setting('app.is_system_owner',true) = 'true'`
- `app.org_is_active_party(project_id int, org_id int) → bool` — EXISTS active `project_parties` row on a `collaborationMode='parties'` project (mirrors `canAccessProjectAsParty`).
- `app.user_is_project_member(project_id int, user_id int) → bool` — EXISTS `project_members`.
- `app.user_is_corr_recipient(correspondence_id int, user_id int) → bool` — EXISTS in recipients or cc.
- `app.project_owner_org(project_id int) → int` — `projects.organization_id` (anti-move anchor).

### CP — tenant-private (rules, inspection_requests, ncr_records, noc_records; tasks pending decision T)
Unchanged from today (org-only), USING = WITH CHECK:
```
app.is_sysowner() OR organization_id = app.session_org()
```

### CU — per-user (notifications)  — **decision U**
```
USING:      app.is_sysowner() OR userId = app.session_user()
WITH CHECK: app.is_sysowner() OR (userId = app.session_user() AND organization_id = app.session_org())
```
This TIGHTENS notifications from "any same-org row" to "only my rows" (safer; matches the per-user
classification). It is technically a behavior change for any same-org user who today could SELECT
another user's notification via a missing app filter (the app always filters by `userId`, so no known
caller relies on it). **Decision U:** adopt per-user (recommended) vs keep org-only.

### CC-party — documents / document_revisions / document_files / projects
Visibility admits owner-org, same-org members, active party orgs, and user-level members. The two child
tables have no `project_id` → resolve via `documentId → documents.project_id`.

`projects`:
```
USING: app.is_sysowner()
    OR organization_id = app.session_org()
    OR app.org_is_active_party(id, app.session_org())
```
`documents` (project_id NOT NULL):
```
USING: app.is_sysowner()
    OR organization_id = app.session_org()
    OR app.org_is_active_party(project_id, app.session_org())
    OR app.user_is_project_member(project_id, app.session_user())
```
`document_revisions` / `document_files` (via parent):
```
USING: app.is_sysowner()
    OR EXISTS (SELECT 1 FROM documents d WHERE d.id = <tbl>.document_id AND (
         d.organization_id = app.session_org()
         OR app.org_is_active_party(d.project_id, app.session_org())
         OR app.user_is_project_member(d.project_id, app.session_user())
       ))
```
**WITH CHECK (anti-move — the key write guard):** bind `organization_id` to the project's owner and
require the project to be accessible. This makes org_id a *function* of project_id, so a cross-org
contributor cannot forge org_id or relocate the row:
```
WITH CHECK: app.is_sysowner()
    OR ( organization_id = app.project_owner_org(project_id)          -- can't forge/move tenant
         AND ( organization_id = app.session_org()                    -- own-org write
               OR app.org_is_active_party(project_id, app.session_org())  -- party contributor upload
               OR app.user_is_project_member(project_id, app.session_user()) ) )
```
(For the child tables, `project_id` is read from the parent document in the WITH CHECK EXISTS, same
shape.) A cross-org party uploading a file writes a row whose `organization_id` = the document-owner
org (exactly what `documents.ts:1512` already does), passes WITH CHECK, and **cannot** set org_id to
its own org or move `project_id` to a project it isn't a party to.

### CC-rec — correspondence  — **decision X**
```
USING: app.is_sysowner()
    OR organization_id = app.session_org()
    OR app.user_is_corr_recipient(id, app.session_user())
WITH CHECK: app.is_sysowner() OR organization_id = app.session_org()
```
- A cross-org **reply** creates a NEW correspondence owned by the replier's own org (`1064-1077`) →
  passes the same-org WITH CHECK. ✓
- A cross-org **mark-read** is an UPDATE of the *other* org's row → the same-org WITH CHECK would
  **block it**. RLS is row-level, not column-level, so it cannot both "allow status update by a
  recipient" and "forbid org_id/project_id change" in one predicate (a recipient EXISTS check keys on
  `correspondence_id`, which survives an org_id change → it would NOT stop a move).
  **Decision X — pick one:**
  - **X-a (recommended):** keep WITH CHECK same-org-only AND add a `BEFORE UPDATE` trigger that lets a
    named recipient update ONLY `is_read`/`first_read_at`/`updated_at` and rejects any change to
    `organization_id`/`project_id` by a non-owner. Preserves cross-org mark-read; hard-stops tenant move.
  - **X-b:** accept that cross-org mark-read becomes a no-op under `edms_app` (recipients still read the
    item; the read-receipt just isn't recorded cross-org). Simplest; a minor behavior change.

  (The column-immutability trigger in X-a is the general, robust guarantee the brief asks for —
  "USING/WITH CHECK must not allow changing organization_id/project_id even via membership" — for any
  table where a legitimate cross-org UPDATE exists but the columns must stay put.)

### CC-recipient-org — transmittals
```
USING: app.is_sysowner()
    OR organization_id = app.session_org()
    OR app.org_is_active_party(project_id, app.session_org())
    OR EXISTS (SELECT 1 FROM users u WHERE u.id = transmittals.to_user_id AND u.organization_id = app.session_org())
WITH CHECK: app.is_sysowner()
    OR ( organization_id = app.project_owner_org(project_id)
         AND organization_id = app.session_org() )     -- writes stay sender-org; acknowledge = decision X-a trigger
```
Cross-org **acknowledge/complete-review** are status writes on the sender-org row → same anti-move
concern as correspondence mark-read → covered by the decision X-a column-immutability trigger (allow
status columns for the recipient org; freeze org_id/project_id).

### CS — metadata_fields
```
USING: app.is_sysowner()
    OR organization_id = app.session_org()
    OR organization_id IS NULL                         -- global defaults readable by all tenants
WITH CHECK: app.is_sysowner()
    OR organization_id = app.session_org()             -- tenants write only their own; globals = sysowner
```
Fixes the latent bug where global fields vanish for tenants under the fail-closed policy.

---

## 4. `app.current_user_id` design (propagation proof — required before any policy change)

`userId` already lives in `requestContext` (`lib/db/src/index.ts:80`, set by `tenantScoped` /
`withTenantRequest` from `req.user.id`). It is currently DROPPED at the tx boundary. Plan:

1. **`runInTenantTx`** (`index.ts:115`): add `userId: number | null` to the ctx param and a third
   `set_config('app.current_user_id', <userId or ''>, true)` alongside the existing two. Add `userId`
   to `TenantStore` (dbContext) for symmetry.
2. **`withTenant`** (`middlewares/tenant-scope.ts:35`): read `ctx.userId` from `requestContext` and pass
   it to `runInTenantTx` (today it passes only `{orgId,isSystemOwner}`).
3. **`tenantRead`**: unchanged — it delegates to `withTenant` (short read tx) or reuses the active tx,
   so it inherits `current_user_id` automatically. Pool fallback (unauthenticated) sets nothing → user
   NULL → per-user predicates deny (correct).
4. **`setRlsContext`** (legacy pool middleware, pre-marker): optionally also `set_config` the user for
   defense-in-depth, but it is NOT the authoritative path (pooled, non-LOCAL) and per-user RLS must not
   depend on it.

**Background boundaries — propagation table (must be proven, handled at the edms_app/background gate,
NOT now):**

| Boundary | carries userId? | runs runInTenantTx today? | current_user_id today | action at background gate |
|---|---|---|---|---|
| HTTP request → `withTenant`/`tenantRead` | yes (requestContext) | yes | **set after step 1–2** | ✅ covered by this design |
| `dispatchSkillEventBackground` / `executeSkillBackground` | yes (explicit `{organizationId,userId,skillId}`) | **no — detached on pool** | none | when moved to `runInTenantTx`, pass the explicit userId (or a system actor) |
| `dispatchClassificationBackground` / `classifyDetached` | yes (explicit ctx) | **no — detached on pool** | none | same |
| `notificationDb` (pool) | n/a (infra, non-RLS tables) | no | none | leave on pool (non-RLS) |
| schedulers (notification / trial-downgrade / skill cron) | n/a | no | none | must adopt a per-org (+ system actor) `runInTenantTx` |

**Consequence:** membership-aware RLS on per-user / collaborative tables is safe for the **request
path** immediately after steps 1–3. Background writes to those tables must NOT be switched to
`edms_app` until each boundary sets `current_user_id` (or an audited system context). This is the
ordering the owner already mandated (background jobs after RLS design).

---

## 5. Recursion / privilege-escalation analysis (project_members / project_parties)

**Recursion:**
- The collaborative policies read `project_parties`, `project_members`, `correspondence_recipients`,
  `correspondence_cc`, `projects`, `users` inside `USING`/`WITH CHECK`.
- Those lookup tables are **NOT in RLS_TABLES** and have **no policy** today → subqueries against them
  run without RLS → **no recursion**.
- **Risk:** if any lookup table later gains an RLS policy that itself references a protected table, the
  policy evaluation could recurse or silently return fewer rows. **Mitigation (adopted):** implement the
  membership checks as `SECURITY DEFINER STABLE` functions owned by a privileged role. Definer functions
  execute with the owner's rights and bypass the callers' RLS deterministically, so (a) no recursion is
  possible, (b) `edms_app` needs no direct SELECT grant on the lookup tables, and (c) the membership
  logic is centralized/audited. `projects` is read only via `app.project_owner_org()` /
  `app.org_is_active_party()` definer functions — never as a bare correlated subquery that could re-enter
  a future `projects` policy.
- **Constraint to record:** `project_members`, `project_parties`, `project_participants`,
  `correspondence_recipients`, `correspondence_cc` must **stay out of RLS_TABLES** (or, if ever added,
  get a self-contained non-recursive policy). They are authority-lookup tables, not collaborative data.

**Privilege escalation via membership writes:**
- **`project_parties` (org-level cross-org grant):** created/removed only by the **owner org's** admins
  — `routes/project-parties.ts` `resolveOwnerProject` returns 404 to any non-owner caller. A guest org
  **cannot** add itself as a party. Soft-delete (`removedAt`) immediately revokes; policies filter
  `removedAt IS NULL`. → No self-escalation to cross-org visibility. ✅
- **`project_members` (user-level):** `POST /projects/:id/members` is `requireAuth` + tenant-isolation
  (the project must be in the caller's org; else `TenantIsolationError`). So **cross-org self-add is
  blocked** — a user cannot make themselves a member of another org's project to gain cross-org
  document visibility. ✅
  - ⚠️ **Pre-existing app-RBAC gap (OUT OF SCOPE — observation only):** that route has **no role gate**
    beyond org-isolation, so *any* same-org authenticated user can add members (any role). Because
    same-org rows are already visible via `organization_id` match, this does **not** expand RLS
    visibility (member-add only matters cross-org, which is blocked). It is an application-authorization
    weakness to fix separately in RBAC — **do not** compensate for it by moving role logic into RLS.
- **No RBAC-in-RLS:** membership makes a row *visible*; edit/delete/approve/admin stay with the existing
  role + party-ceiling checks (`lib/party-ceiling.ts`, `requireRole`, `denyPartyDestructive`,
  `isWithinPartyCeiling`). The policies above deliberately grant broad `W` at the RLS layer and rely on
  RBAC for the real gate — RLS is a tenant/project floor, not the authorization system.
- **Anti-move guarantee:** the CC-party `WITH CHECK` binds `organization_id = app.project_owner_org(project_id)`
  and requires the project to be accessible → a member/party cannot change `organization_id` or move
  `project_id` to relocate a record into another tenant/project. For status-only cross-org writes
  (correspondence mark-read, transmittal acknowledge) the column-immutability trigger (decision X-a)
  provides the same guarantee where RLS column-blindness cannot.

---

## 6. Legitimate cross-org operations in the product (that the new policy must preserve)

From the route audit (all verified file:line):

1. **Correspondence — named recipient (per-record):** reply (`correspondence.ts:992-1097`, must be a
   recipient of the parent), mark-read (`763-773`), list-by-IDs visibility (`687-711`). Cross-org WRITE:
   reply (creates replier-own-org row) + mark-read (status on other-org row).
2. **Transmittals — recipient org:** read via `transmittalPartyFilter` (`39-50`), acknowledge
   (`419-507`, recipient org), complete-review / per-item review-code (named recipient user).
3. **Documents — project party (org) / member (user):** project-scoped read (`documents.ts:270-291`,
   `646-707` behind `canAccessProject`), party **contributor upload** of files/revisions
   (`1480-1565`; row org = document-owner org, `1512`). Party observers read-only (ceiling).
4. **Projects — party visibility:** a party org must see the project row it was invited to
   (`collaborationMode='parties'`).
5. **Submission chains — participant custody:** forward/return/advance across orgs. **Out of RLS scope**
   — `submission_chains*` are NOT in the 13 RLS tables (noted so it isn't accidentally pulled in).
6. **Registers (ITR/NCR/NOC):** **no** cross-org flow today (org-locked) — policy stays org-only.

Party management (grant lifecycle): `routes/project-parties.ts` — owner-admin add/remove
(`157-228`, `236-270`), collaboration-mode toggle (`282-302`).

---

## 7. Required tests (positive + negative) — must all exist before enforcement

Run under a **non-superuser role** (so RLS is actually enforced), tenant-scoped via
`runInTenantTx` with `current_user_id` set. Per category + the owner-mandated global list.

**Owner-mandated minimum (each mapped to a concrete table):**
1. **owner-org allowed** — org A user reads/writes org A `documents`, `rules`, `notifications`. ✅ rows.
2. **legitimate cross-org project member/party allowed only where the product allows** —
   party-org B contributor reads org A project `documents` and uploads a file (row org = A); NOT allowed
   to see org A `rules`/registers.
3. **unrelated org denied** — org C (no party, not named) reads org A documents/correspondence → 0 rows;
   write → denied.
4. **missing context** — no `current_org_id`/`current_user_id` → every table returns 0 rows; every write
   denied (fail-closed).
5. **forged context gives no illegitimate access** — set `current_org_id`=A while session is org C, or
   set `current_user_id` to a non-recipient: policies derive membership from the DB (party/recipient
   tables), so a forged id that has no real party/recipient row still yields 0 rows; `is_system_owner`
   cannot be set from client input (server-only).
6. **membership does not bypass RBAC** — a party **observer** can SELECT a document but a write blocked
   by ceiling stays blocked (RLS `W` present, RBAC denies); a member with `viewer` role cannot
   approve/delete.
7. **illegitimate `organization_id`/`project_id` change rejected** — cross-org party UPDATE of a document
   attempting to set `organization_id` to org B, or `project_id` to a non-accessible project → WITH CHECK
   / trigger denies. Same for correspondence/transmittal status writes attempting a tenant move.
8. **membership removal cuts access** — soft-delete the `project_parties` row (`removedAt`) → party-org B
   immediately returns 0 rows for that project's documents; remove a `correspondence_recipients` row →
   the named user loses visibility of that correspondence.
9. **concurrent tenant A/B no leak** — parallel `runInTenantTx` for A and B (as in
   `tenant-scope-integration.test.ts` PROOF 1) each see only their own rows with the new predicates.
10. **system_owner only with the trusted flag** — `is_system_owner='true'` sees all; a tenant session
    (flag 'false') with a high org id does not; the flag is never client-settable.

**Per-category additions:**
- **CC-party:** party contributor upload writes row with org = project owner (passes); attempt to write
  org = self → denied. document_revisions/document_files inherit visibility through the parent (delete
  the parent's party → child rows disappear too).
- **CC-rec (correspondence):** named recipient in org B sees only the specific correspondence, NOT other
  project correspondence (proves per-record, not org-blanket); reply creates a B-owned row; mark-read
  behavior per decision X (X-a: recorded + org/project frozen; X-b: no-op).
- **CS (metadata_fields):** every tenant reads `organization_id IS NULL` global fields; a tenant cannot
  read another tenant's fields; only system_owner writes globals.
- **CU (notifications):** user X cannot SELECT user Y's notifications even in the same org (decision U);
  writing a notification for another user in another org denied.
- **CP (rules, registers):** strictly org-only; a party-org user sees zero registers/rules of the owner.
- **Propagation:** a test asserting `current_user_id` is set inside `runInTenantTx`/`withTenant`/
  `tenantRead` and is EMPTY on the pool/unauthenticated path; and (background gate) that detached
  boundaries do NOT carry a stale user.

---

## Decisions required from the owner (before implementation)

- **Decision U** — notifications: adopt per-user RLS (recommended) vs keep org-only.
- **Decision X** — cross-org status writes (correspondence mark-read, transmittal acknowledge):
  X-a column-immutability trigger (recommended, preserves the flow + hard tenant-move stop) vs
  X-b accept mark-read/ack becomes a no-op under edms_app.
- **Decision M** — documents cross-org visibility: org-party (`project_parties`) alone, or ALSO
  user-level `project_members` (recommended: include both, matching `canAccessProject`).
- **Decision R** — confirm registers (ITR/NCR/NOC) stay org-only (no cross-org) — matches the app today.
- **Confirm** — `project_members`/`project_parties`/recipients/cc remain NON-RLS authority lookups.

**No policy migration will be written until these are decided.** Out of scope now (kept separate per
owner): background-job tenant context, `/migrations`, Production roles, `DATABASE_URL`/cutover,
the N+1 and indentation engineering observations.

---

# Security-Definer Gate (read-only audit + design) — owner decisions U/X-a/M/R adopted

The membership-aware policies depend on `SECURITY DEFINER` authority-lookup functions. Before any
migration, this gate audits the role/grant reality and specifies the definer-function security model.

## Live posture audit (isolated test DB, read-only introspection)

Queried `edms_postgres_test` (localhost:5433, db `edms_test`) via `docker exec psql`:

- **🔴 CRITICAL — the test role bypasses RLS entirely.** `edms_test` is `rolsuper=t`, `rolbypassrls=t`,
  and **owns every table**. Under this role RLS policies are inert. ⇒ **the current test suite has NEVER
  exercised DB-level RLS** — "tenant isolation" today is proven only at the app layer (fail-closed proxy
  + org filters). Membership-aware RLS (and, honestly, all of DEBT-010's RLS) can only be validated under
  a NEW least-privilege role. This is exactly the owner's requirement ("tests under
  non-superuser/non-BYPASSRLS").
- `edms_test` has **CREATE on schema `public`** (`has_schema_privilege = true`) ⇒ object-shadowing
  surface exists for the current role.
- `edms_test` has full `SELECT/INSERT/UPDATE/DELETE` on `project_parties`, `project_members`,
  `correspondence_recipients`, `correspondence_cc` (it owns them).
- Schema `app` does not exist yet.
- `ops/verify-security-posture.sql` already encodes the target posture (non-super, non-bypassrls, owns no
  tenant table, RLS ENABLE+FORCE, **exactly one policy** named `org_isolation_policy`, fail-closed smoke).
  ⇒ the membership-aware design MUST stay **one `FOR ALL` policy per table, same name** (richer predicate)
  so this gate keeps passing. It also confirms the runtime role must be a pure **grantee, never owner**.

**Consequence:** implementation needs a dedicated least-privilege **runtime test role** (call it
`edms_app` to match Production intent, created only in the isolated DB) plus a distinct **owner role**
for the definer functions. Creating these two roles in the *isolated* DB is test-harness setup, not a
Production role — the owner's "no Production roles / no cutover" constraint is respected.

## 1. Function OWNER (≠ edms_app)
Each `SECURITY DEFINER` function runs with its OWNER's privileges. Owner = a dedicated
**`edms_rls_owner`** role (NOLOGIN) that owns schema `app` and every function in it. The runtime role
`edms_app` gets **EXECUTE only** and is NOT a member of `edms_rls_owner`, so it cannot
`CREATE OR REPLACE` or `ALTER` the functions (that needs ownership). Never make the runtime role the
owner — that would let a compromised/altered app role rewrite the authority logic.

## 2. Safe `search_path` + full qualification
Every function is declared `SET search_path = ''` (empty) and **every** identifier is fully
schema-qualified — tables (`public.project_parties`), functions, operators via `pg_catalog`, and types.
An empty search_path + qualification makes object shadowing impossible: there is no schema on the path
for an attacker to plant `project_parties` into, and unqualified name resolution never occurs. (Pinning
to a fixed non-writable schema list is the fallback; empty is strictest.)

## 3. REVOKE FROM PUBLIC + least GRANT
For each function: `REVOKE EXECUTE ON FUNCTION app.<fn> FROM PUBLIC;` then
`GRANT EXECUTE ON FUNCTION app.<fn> TO edms_app;`. `GRANT USAGE ON SCHEMA app TO edms_app;` (USAGE only,
no CREATE). No other role gets EXECUTE.

## 4. edms_app must have NO CREATE on resolution schemas
`REVOKE CREATE ON SCHEMA public FROM edms_app;` and grant only `USAGE` on `app`
(`REVOKE CREATE ON SCHEMA app FROM PUBLIC; GRANT USAGE ON SCHEMA app TO edms_app;`). This closes the
shadowing vector: edms_app cannot create `public.project_parties` shadow objects nor replace the
functions. **Audit shows the current role HAS create on public — the migration must revoke it for the
runtime role.** (The definer functions' empty search_path already makes shadowing inert; no-CREATE is
defense-in-depth #2.)

## 5. No dynamic SQL
All functions are static SQL (`EXISTS(SELECT 1 FROM public.project_parties …)`), `LANGUAGE sql`,
`STABLE`. No `EXECUTE`, no `format()`, no concatenation. This is enforceable by a static test grepping
the function bodies from `pg_proc.prosrc`.

## 6. Functions return an access PREDICATE only, never authority data
Signatures return `boolean` (membership tests) or a single scalar anchor:
- `app.org_is_active_party(p_project_id int, p_org_id int) → boolean`
- `app.user_is_project_member(p_project_id int, p_user_id int) → boolean`
- `app.user_is_corr_recipient(p_corr_id int, p_user_id int) → boolean`
- `app.project_owner_org(p_project_id int) → int` (owner-org anchor for WITH CHECK; the row already
  implies this — not a leak of another tenant's authority rows)

They never return sets of `project_parties`/`project_members` rows to the caller.

## 7. Current GRANTs on the four lookup tables — can edms_app modify them?
Audit: today `edms_test` owns all four ⇒ full DML. Target model for `edms_app`:
- `project_parties`, `project_members`: the **application manages these** (party routes, member routes)
  ⇒ `edms_app` legitimately needs `SELECT, INSERT, UPDATE, DELETE`. **Yes, edms_app can modify them
  directly** — this is necessary and gated at the app layer by RBAC (party routes = owner-admin only;
  member route = org-bounded, see the RBAC debt in §10). RLS **policy correctness does not depend on
  these grants** because policy evaluation goes through the DEFINER functions (owner-privileged), so even
  a wrong/loose grant here cannot change how a DATA-table policy resolves.
- `correspondence_recipients`, `correspondence_cc`: app manages recipients on send ⇒ `SELECT, INSERT,
  DELETE` (UPDATE not needed). Grant the minimum the routes actually use.
- These four stay **non-RLS authority lookups** (owner decision), so no policy/recursion on them. Residual
  risk (an app bug doing a bad membership write) is bounded by app RBAC + the §10 debt item; if the owner
  later wants defense-in-depth, org-scoped RLS could be added to `project_members`/`project_parties`
  WITHOUT recursion precisely because the data-table policies read them via DEFINER functions that bypass
  RLS — noted as a future option, not adopted now.

## 8. search_path / object-shadowing attack test (design)
Under the least-priv `edms_app` role:
- assert `CREATE TABLE public.project_parties_shadow (...)` and `CREATE VIEW public.project_parties AS …`
  both **raise `insufficient_privilege`** (no CREATE on public) — the attacker cannot even plant a shadow.
- introspect `pg_proc.proconfig` for each `app.*` function and assert it contains `search_path=` set to
  empty/pinned (drift guard).
- positive control: with a legitimate party row, `app.org_is_active_party` returns true; after (as owner)
  planting a decoy object in a NON-path schema, the function result is unchanged (proves resolution is
  qualified, not path-dependent).

## 9. Membership-revocation cuts access immediately (design)
Under `edms_app` with tenant context set: party-org B sees project A documents; then (as the app/owner)
`UPDATE project_parties SET removed_at = now()` → the very next SELECT under B's context returns 0 rows.
Same for deleting a `correspondence_recipients` row (named user loses that correspondence) and a
`project_members` row (member loses document visibility). No caching — RLS re-evaluates per statement.

## 10. RBAC security debt (recorded separately — NOT fixed here, NOT via RLS)
**`POST /projects/:id/members` has no role gate.** `routes/projects.ts:459-517`: only `requireAuth` +
tenant-isolation (project must be in caller's org). Any authenticated **same-org** user — including a
`viewer` — can add members (any role, incl. `admin`) to any project in their own org.
- **Severity: MEDIUM.** Within-tenant privilege escalation (a low-role user grants themselves/others a
  higher project role) and unaudited membership changes.
- **Impact on RLS: NONE for cross-org.** Cross-org self-add is blocked (`TenantIsolationError`), and
  same-org rows are already visible via `organization_id` match, so this gap does **not** widen
  membership-aware RLS visibility. It is a pure application-RBAC weakness.
- **Fix (separate track):** add `requireMinRole('project_manager')`/project-admin gate + audit log to the
  member routes. **Do NOT** move this into RLS. Logged as **DEBT-013**.

## X-a — cross-org write column allowlist (exact)
The X-a guard is a per-table `BEFORE UPDATE` trigger that applies ONLY to a **cross-org writer**
(`current_org_id <> OLD.organization_id AND NOT is_system_owner`; owners/sysowner are governed by
WITH CHECK). For such a writer it rejects the UPDATE unless the ONLY changed columns are in the
allowlist. No dynamic SQL — explicit `IS DISTINCT FROM` tuple comparison of all NON-allowlisted columns.

| Table | cross-org writer | MUTABLE (allowlist) | IMMUTABLE (any change ⇒ RAISE) |
|---|---|---|---|
| `correspondence` | named recipient/cc (mark-read) | `is_read`, `first_read_at`, `updated_at` | everything else — esp. `organization_id`, `project_id`, `from_user_id`, `subject`, `body`, `status`, `scope` |
| `transmittals` | recipient org (acknowledge / complete-review) | `status`, `acknowledged_at`, `review_outcome`, `updated_at` (note: `completed_at` is on `tasks`, not `transmittals`) | everything else — esp. `organization_id`, `project_id`, `created_by_id`, `to_user_id`, `direction`, `subject` |

Scope note: only these two tables need the trigger. **documents/revisions/files** cross-org writes are
INSERTs (party upload; row org = project owner) fully governed by the CC-party `WITH CHECK` anchor — no
UPDATE by a cross-org actor changes org/project, so no trigger. **registers** have no cross-org write
(org-locked). The trigger is a targeted allowlist, not a broad "block org/project" rule; a schema-column
drift test asserts the enumerated column set matches the table so the allowlist can't silently go stale.

## Gate verdict
Design is clean and implementable IF the owner approves creating, **in the isolated DB only**, the two
roles (`edms_rls_owner` owner, `edms_app` least-priv runtime) and the `app` schema. Everything else
(function owner ≠ runtime, empty search_path + qualification, REVOKE PUBLIC + least GRANT, no CREATE for
runtime, no dynamic SQL, predicate-only returns, non-RLS lookups) is specified above. On approval the
implementation order is: (1) roles + `app` schema + DEFINER functions + grants; (2) rewrite
`org_isolation_policy` per-category (single policy per table, same name) + X-a triggers; (3) tests under
`edms_app` (non-super/non-bypassrls) including the §8/§9 security tests and the owner's 10-point matrix;
(4) before/after behavior comparison of the six legitimate cross-org flows (§6 of the design) to prove no
expansion and no breakage.
