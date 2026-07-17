# Backfill: `documents.organization_id` from project owner (owner-run, gated)

## Why
Documents created before the create path populated `organization_id`
(`routes/documents.ts:440`) were left `NULL`. Production carries **57 such
documents across 10 owned projects** (project 14's 7 docs are already correct).
NULL org is harmful in two ways, proven from the code:

- **RLS (`lib/rls-init.ts`)** — the `org_isolation_policy` first clause is
  `organization_id IS NULL` ⇒ a NULL-org row is visible to **every** org
  (defense-in-depth fail-**open**).
- **`orgScopedWhere` (`lib/org-scope.ts`)** — `eq(id) AND eq(org, caller.org)`,
  no NULL branch ⇒ the three document actions **submit-review / archive /
  obsolete** return **404 to the rightful owner** (functional fail-**closed**).

The application-layer project gating (`requireProjectAccess`, project-membership
scoping) means there is **no active cross-org leak** today
(`b2-null-org-isolation.test.ts`), so this is a data-integrity + defense-in-depth
repair, not an incident.

## Source of truth — ONLY
`documents.organization_id = projects.organization_id` (the project owner) — the
same value the create path and migration 0032 use. **No inference** from creator,
file, or any other field. A NULL-org document whose project has **no owner**
**ABORTs** the whole run (no guessing).

## Scope (tightly bounded; never touches a non-NULL row)
| table | rows changed | new value |
|---|---|---|
| `documents` | `organization_id IS NULL` AND project has an owner | project owner |
| `document_files` | `organization_id IS NULL` AND parent doc was a target | project owner |
| `document_revisions` | `organization_id IS NULL` AND parent doc was a target | project owner |

Files/revisions under **already-owned** documents are out of scope: files are
migration 0032's job; such revisions (if any) are reported, not touched.

## Files
- Forward: `lib/db/drizzle/manual_backfill_documents_org_from_project.sql`
- Rollback: `lib/db/drizzle/rollback_backfill_documents_org_from_project.sql`
- Real-restore drill: `scripts/ops/backfill-docs-org-drill.sh`

Both SQL files are journal-excluded (`manual_` / `rollback_` prefixes) — the
drizzle migrator never runs them.

---

## Step 1 — Real-restore drill (run FIRST, zero production impact)
Restores the latest backup to a throwaway container and runs
baseline → pre-image → forward → verify → 0032 → verify → rollback → verify.
```bash
cd /var/www/edms && git fetch origin main \
 && git checkout FETCH_HEAD -- lib/db/drizzle scripts/ops/backfill-docs-org-drill.sh \
 && bash scripts/ops/backfill-docs-org-drill.sh
```
Expected: `null_owned_docs` → 0 after forward; 0032 reports its own residual B1
rows (project-14 files); `null_owned_docs_after_rollback` returns to the baseline.

## Step 2 — Production apply (ONLY after review + explicit approval)
Capture the pre-image bound to prod identity, then apply in one transaction.
```bash
cd /var/www/edms
mkdir -p /root/backfill-preimage
docker exec edms_postgres psql -U edms -d edms -tAc "COPY ( SELECT 'doc' AS kind, d.id AS row_id, d.organization_id AS previous_org, p.organization_id AS target_org, current_database() AS database_name, (SELECT system_identifier FROM pg_control_system())::text AS db_system_identifier, now()::text AS captured_at FROM documents d JOIN projects p ON p.id=d.project_id WHERE d.organization_id IS NULL AND p.organization_id IS NOT NULL UNION ALL SELECT 'file', df.id, df.organization_id, p.organization_id, current_database(), (SELECT system_identifier FROM pg_control_system())::text, now()::text FROM document_files df JOIN documents d ON d.id=df.document_id JOIN projects p ON p.id=d.project_id WHERE df.organization_id IS NULL AND d.organization_id IS NULL AND p.organization_id IS NOT NULL UNION ALL SELECT 'rev', r.id, r.organization_id, p.organization_id, current_database(), (SELECT system_identifier FROM pg_control_system())::text, now()::text FROM document_revisions r JOIN documents d ON d.id=r.document_id JOIN projects p ON p.id=d.project_id WHERE r.organization_id IS NULL AND d.organization_id IS NULL AND p.organization_id IS NOT NULL ) TO STDOUT WITH CSV HEADER" > /root/backfill-preimage/_rb_backfill_docs_org.csv
docker cp /root/backfill-preimage/_rb_backfill_docs_org.csv edms_postgres:/tmp/_rb_backfill_docs_org.csv   # stage for rollback
docker exec -i edms_postgres psql -U edms -d edms -v ON_ERROR_STOP=1 < lib/db/drizzle/manual_backfill_documents_org_from_project.sql
```
Verify: `SELECT count(*) FROM documents d JOIN projects p ON p.id=d.project_id WHERE d.organization_id IS NULL AND p.organization_id IS NOT NULL;` → **0**.

## Step 3 — Rollback (only if needed)
```bash
docker cp /root/backfill-preimage/_rb_backfill_docs_org.csv edms_postgres:/tmp/_rb_backfill_docs_org.csv
docker exec -i edms_postgres psql -U edms -d edms -v ON_ERROR_STOP=1 < lib/db/drizzle/rollback_backfill_documents_org_from_project.sql
```
Reverts only rows still equal to what the backfill set; diverged rows are
reported (`_rb_bf_diverged`) and left untouched; ABORTs on DB-identity mismatch
or an empty artifact.
