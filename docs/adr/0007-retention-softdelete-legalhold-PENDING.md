# ADR 0007 — Retention / Soft-Delete / Legal Hold

**Status:** ⚠️ **PROPOSED — Policy Decision PENDING (blocks Phase 6 G5)**
**Date:** 2026-07-10
**Deciders:** Owner + Legal (Policy), Owner (Product), Engineering (Technical only)

---

## Context

Findings: `audit_logs` (and other append-only tables) grow unbounded with **no partitioning / retention** (F24); soft-delete exists only on a few tables — core aggregates (`documents`, `correspondence`, `transmittals`, `projects`) have **none**, and many FKs `cascade` (destructive, irreversible deletes) (F25); backups are single `pg_dump` (F26). Note also (live evidence, Phase 0): `audit_logs` is protected by an **append-only immutability trigger** (`fn_audit_logs_immutable`) — `DELETE`/`UPDATE` are rejected, so any retention on audit data must be **partition-drop**, never row deletion.

## Decision — split three layers

### Technical (Engineering — decided, executable)
- Mechanism for `deleted_at` soft-delete columns.
- Mechanism for time-partitioning append-only tables.
- Mechanism for a `legal_hold` flag that blocks deletion/partition-drop while set.
- Partition-drop (not `DELETE`) is the only sanctioned purge path for `audit_logs` (immutability trigger).

### Product Decision — **PENDING OWNER INPUT** ⚠️
- [ ] Which entities get soft-delete? (documents / correspondence / transmittals / projects / … ?)
- [ ] User-visible delete behaviour (trash/restore? hard-delete option? who can?).

### Policy / Legal Decision — **PENDING OWNER + LEGAL INPUT** ⚠️
- [ ] Retention period per data class (documents, audit_logs, notifications, user PII …).
- [ ] Legal-hold requirements (what triggers a hold, who can set/release).
- [ ] What is ever hard-purged, and after how long.

> **Engineering is explicitly forbidden from inventing any retention period, purge rule, or soft-delete scope** (per Blueprint §1.5). These fields stay blank until the Owner (with Legal) provides them. The owner's message of 2026-07-10 referenced a policy but delivered a placeholder only — **the actual policy text was not provided**, so this ADR remains PENDING.

## Consequences
- **Blocks (Gate G5):** B6.5 (soft-delete behaviour), B6.6 (partition retention). These do **not** proceed until the Policy/Product fields above are filled.
- **Not blocked:** backup strategy (B6.7), partitioning *mechanism/structure* (can be built; retention *policy* applied later), `public_id` (ADR 0006).
