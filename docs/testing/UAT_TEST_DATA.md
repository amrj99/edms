# UAT Test Data Registry & Cleanup List — ArcScale EDMS

**Purpose:** track any data deliberately created in a **local/staging** environment during
manual UAT, so no record is of unknown origin, and provide the sanctioned cleanup path.

**Policy (important):** the `audit_logs` table is **append-only by design** — a database
trigger (`fn_audit_logs_immutable()`) rejects `UPDATE`/`DELETE`. This integrity control
**must not be bypassed** to remove test data. Because a created org/user is referenced by
its immutable audit row, **selective row deletion of such data is intentionally impossible**.
The sanctioned cleanup for a local/staging environment is therefore an **operator-run full
reset + reseed** of that environment's database — never a targeted audit-log deletion.

---

## Active test artifacts

| Artifact | Env | Created | By / Why | Status |
|---|---|---|---|---|
| Org `UAT-8B1-REGTEST` (id 8) + admin user `uat-reg-8b1@example.test` (id 17) | **Local Docker staging** (`edms_postgres`, DB `edms`) — **NOT the VPS/production** | 2026-07-10 | Phase 8B-1 Acceptance UAT — exercising the **register-org success** state (localized Arabic message). The unverified admin's token was then reused to exercise the **verify-email success** state. | **Retained (inert).** No projects/documents/transmittals. Full deletion blocked by append-only `audit_logs` (by design). |

### Cleanup instruction (operator / DBA)
This artifact is confined to **local staging**. To remove it, reset that environment's DB
(e.g. recreate the `edms` volume, or truncate+reseed) — do **not** disable or delete from
`audit_logs`. No action is required on the VPS/production (the artifact never existed there).

---

## Log

| Date | Change |
|---|---|
| 2026-07-10 | Registry created; recorded `UAT-8B1-REGTEST` artifact from Phase 8B-1 UAT. |
