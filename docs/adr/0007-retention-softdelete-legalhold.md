# ADR 0007 — Retention / Soft-Delete / Legal Hold (Product Policy v1)

**Status:** Accepted — **Product Policy v1** (initial; customizable per org/customer/country/contract, not final legal policy)
**Date:** 2026-07-10
**Deciders:** Owner (Product Policy), Engineering (technical mechanisms)

---

## Context

`audit_logs` and other append-only tables grow unbounded with no partitioning/retention (F24); core aggregates lack soft-delete and many FKs cascade destructively (F25); backups are single `pg_dump` (F26). Live evidence: `audit_logs` has an append-only immutability trigger (`fn_audit_logs_immutable`) — so audit retention must be **partition-drop**, never row `DELETE`. The owner supplied an initial product policy (2026-07-10) to unblock Gate G5; it is explicitly **customizable in future** and **not** a final legal policy.

## Decision — Product Policy v1

| # | Entity | Policy |
|---|---|---|
| 1 | **Documents** | No direct delete. Normal delete = **Soft Delete** (restorable within retention). **Hard Delete only via administrative Purge Job**, never from the UI. |
| 2 | **Projects** | Soft Delete; no auto-purge; archive/restore. Cannot hard-delete if it contains anything under **Legal Hold**. |
| 3 | **Organizations** | **No Hard Delete.** Only Disable / Archive. Never removed in normal operation. |
| 4 | **Users** | Not deletable if they have audit history / documents / reviews / workflow actions. Only Disable / Archive; history preserved. |
| 5 | **Audit Logs** | Immutable; never user-deletable. Default retention **7 years**. After expiry, purge **only via administrative Job** and only if no Legal Hold / contractual bar. (Purge = partition-drop, per immutability trigger.) |
| 6 | **Activity / Notifications** | Activity default retention **1 year**; Notifications deletable after **180 days**. Both **configurable per org** in future. |
| 7 | **Sessions** | Security-policy driven. Auto-deleted on expiry. Immediately revocable on: Disable User, password change, admin session-revoke. |
| 8 | **Legal Hold** | Any entity under Legal Hold: no Hard Delete, no Purge, no Auto-Cleanup — preserved until the hold is removed. |
| 9 | **Purge** | Never from daily operations. Only via Administrative Job, with full audit, after retention expiry, and after confirming no Legal Hold. |
| 10 | **Configurability** | These are **Default Values**. Design MUST allow changing retention periods per org / customer type **without code changes**, defaults unchanged. |

## Technical mechanisms (Engineering)
- `deleted_at` soft-delete on: documents, projects, organizations (as disable/archive state), users (as disable/archive), + the aggregates in §1–4.
- `legal_hold` flag (entity-level) that blocks delete/purge/cleanup while set (§8).
- Time-partitioning for append-only tables; **partition-drop** is the only purge path for `audit_logs` (§5, immutability trigger).
- A **retention-config** store (per-org overrides with system defaults) to satisfy §10 — a settings mechanism, not hardcoded periods.
- Administrative **Purge Job** (§9): audited, retention-gated, legal-hold-gated; never invoked by daily flows.

## Consequences
- **Unblocks Gate G5:** Phase 6 B6.5 (soft-delete behaviour) and B6.6 (partition retention) may proceed.
- **Migration (Phase 6):** add `deleted_at` + `legal_hold` columns; partitioning; retention-config table. Reversible except partitioning-after-growth (maintenance window).
- **Product/UX:** trash/restore surfaces; disable/archive for orgs/users; admin purge tooling.
- **Not final legal policy** — revisit per customer/country/contract; defaults stay unless overridden.

## Note
Per owner directive: if any part conflicts with current design or needs a new architectural decision during implementation, stop at that point, present evidence + alternatives, and do not assume a different policy.
