# ADR 0006 — Primary Keys: Keep `serial` Internal + Add `public_id` (UUID PK rejected for now)

**Status:** Accepted
**Date:** 2026-07-10
**Deciders:** Owner (Product/Engineering), Architecture Review (Phase 2 Remediation)

---

## Context

All ~85 tables use `serial` (int4) primary keys — no UUIDs. Consequences: IDs are enumerable across tenants; there is no path to a global directory / tenant-merge / sharding; and `int4` has a finite ceiling. `DOMAIN_MODEL.md` itself notes its "Global Directory" future is blocked by this. This is the only finding that becomes *impossible* (not merely harder) with data growth, because full PK migration after millions of interlinked rows + FK-less polymorphic references approaches a rewrite.

## Decision

- **Now:** add a **`public_id uuid`** column (unique, indexed) to externally-exposed entities (`documents`, `projects`, `organizations`, `transmittals`, `users`). Internal PKs stay `serial` (fast, small). APIs accept/return the `public_id`. This removes cross-tenant enumeration immediately and keeps the door open — the Stripe pattern (opaque external id, integer internal).
- **Rejected for now:** full migration of PKs to UUID. Taken **only** if a real sharding / tenant-merge need forces it — a decision that may correctly be "never".
- **Gate:** the `public_id` scope decision (which entities) is a Phase 0/6 gate that MUST precede any new indexing or domain consolidation built on the keys (else that work is redone).

### Alternatives considered
- **Full UUID PK now** — opens sharding but the migration is the single most dangerous operation in the whole plan (data + FK + contract breaking); premature. Rejected.
- **`bigint identity`** — removes the int4 ceiling and sequential enumeration with less pain, but doesn't open sharding. A viable middle path if the ceiling (not enumeration) becomes the driver; kept as a fallback.
- **Do nothing** — the migration cost grows every month of data. Rejected.

## Consequences
- **Migration (Phase 6):** two-phase — add nullable `public_id` → backfill (dual-read) → unique + enforce + API accepts/returns UUID. Reversible until the enforce/contract step.
- **Contract:** API surface for the affected entities changes to expose `public_id` (Contract-breaking at the enforce step — sequence after ADR 0003 role work but this is independent).
- No change to internal FKs or joins (they keep using `serial`).
