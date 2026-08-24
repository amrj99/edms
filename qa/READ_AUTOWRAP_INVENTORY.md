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

## Phase A — security-sensitive routers

### `users` router (`/api/users`) — converted (writes → withTenant)
Auto-wrapped reads (Phase-D backlog):
- `GET /api/users` — org/project-scoped user list (DB-only)
- `GET /api/users/:id` — user profile incl. project memberships (DB-only)

Writes migrated to explicit `withTenant()`:
- `POST /api/users` — create user (+ onboarding token); email sent OUTSIDE tx
- `PUT /api/users/:id` — update user
- `DELETE /api/users/:id` — delete user
- `POST /api/users/:id/reset-password` — reset password (bcrypt hash OUTSIDE tx)

---

_(Extended as each Phase A/B/C router is converted.)_
