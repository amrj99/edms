# Migration Governance — ArcScale EDMS

> Mandatory rules for all database migrations in production.
> Violations have caused production outages. Read before touching any migration file.

---

## The Incident That Created This Document

On 2026-05-08, the production API was down for an extended period because a `drizzle-kit`-generated migration (`0007`) contained a raw `ALTER TYPE ... ADD VALUE 'expired'` that duplicated a value already committed by a manual migration (`0004a`). The root cause was that `0004a` was written by hand without updating the drizzle snapshot, so drizzle-kit re-generated the same DDL later.

Full incident record: `docs/operations/PRODUCTION_RECOVERY_2026-05-08.md`

---

## 1. Enum DDL Rules

### Rule E1 — Never write raw `ALTER TYPE ... ADD VALUE`

```sql
-- FORBIDDEN
ALTER TYPE subscription_status ADD VALUE 'new_value';

-- FORBIDDEN (insufficient alone)
ALTER TYPE subscription_status ADD VALUE IF NOT EXISTS 'new_value';
```

### Rule E2 — Always use the `DO $$ EXCEPTION` pattern

```sql
-- REQUIRED
DO $$
BEGIN
    ALTER TYPE your_enum_type ADD VALUE IF NOT EXISTS 'new_value';
EXCEPTION
    WHEN duplicate_object THEN NULL;
END;
$$;
```

**Why `IF NOT EXISTS` alone is not enough:**
In some PostgreSQL / transaction contexts (particularly when a value was committed by a prior autocommit statement in the same session), `IF NOT EXISTS` may still raise `42710`. The `EXCEPTION` handler is the only fully reliable guard.

### Rule E3 — Drizzle-kit auto-generated migrations that add enum values must be inspected and rewritten

`drizzle-kit generate` always outputs raw `ALTER TYPE ... ADD VALUE` without guards. Before deploying, rewrite every such statement using the `DO $$ EXCEPTION` pattern above.

---

## 2. Manual Migration Rules

### Rule M1 — After writing a manual migration, run `drizzle-kit generate` immediately

```bash
pnpm --filter @workspace/db generate
# or
pnpm db:generate
```

Inspect the output. If drizzle-kit generates SQL that duplicates your manual migration, the snapshot is now out of sync. Fix the snapshot, or mark the generated file as a no-op, before it reaches production.

### Rule M2 — Manual migrations must have a matching journal entry

Every `.sql` file in `lib/db/drizzle/` must have an entry in `lib/db/drizzle/meta/_journal.json`. Files without journal entries are invisible to the Drizzle migrator and will silently be skipped or cause errors.

### Rule M3 — Document all manual migrations

Create a comment block at the top of every manual migration file explaining:
- Why it was written manually (not generated)
- What schema state it depends on
- Whether `ensureEnumValues()` in `migrate.ts` must be updated

---

## 3. `ensureEnumValues()` Sync Rule

`migrate.ts` contains `ensureEnumValues()` which pre-commits enum values via `pool.query()` (autocommit) before Drizzle's outer `BEGIN`. This is necessary because Drizzle wraps all pending migrations in a single transaction, and PostgreSQL forbids using a new enum value in the same transaction where it was added.

**Rule:** Any enum value that appears in a migration file must also be pre-committed in `ensureEnumValues()`.

```typescript
// In artifacts/api-server/src/migrate.ts
const statements = [
  {
    sql: "ALTER TYPE subscription_status ADD VALUE IF NOT EXISTS 'expired'",
    label: "subscription_status → 'expired'",
  },
  // Add new enum values here
];
```

---

## 4. Pre-Deploy Checklist

Before every production deployment that includes migration files:

- [ ] Read every new `.sql` file added since the last production deploy
- [ ] Search for `ALTER TYPE.*ADD VALUE` — rewrite any without `DO $$ EXCEPTION`
- [ ] Search for `CREATE TYPE` — ensure idempotent (`CREATE TYPE IF NOT EXISTS`)
- [ ] Search for `DROP` — there must be none in forward migrations
- [ ] Check `meta/_journal.json` — every `.sql` file has a matching entry
- [ ] Verify `ensureEnumValues()` covers all new enum values
- [ ] Run `git diff lib/db/drizzle/` — review every line
- [ ] Take a database backup before deploying

---

## 5. Safe DDL Patterns Reference

| DDL operation | Safe pattern |
|---|---|
| Add enum value | `DO $$ BEGIN ALTER TYPE t ADD VALUE IF NOT EXISTS 'v'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;` |
| Create table | `CREATE TABLE IF NOT EXISTS ...` |
| Create index | `CREATE INDEX IF NOT EXISTS ...` |
| Create schema | `CREATE SCHEMA IF NOT EXISTS ...` |
| Add column | `ALTER TABLE t ADD COLUMN IF NOT EXISTS c type;` |
| Create extension | `CREATE EXTENSION IF NOT EXISTS ...` |
| Rename value | PL/pgSQL with EXCEPTION guard |

---

## 6. Never Do These

| Action | Why |
|---|---|
| Edit `drizzle.__drizzle_migrations` directly | Breaks migration history; use only for emergency recovery with prior backup |
| Deploy without reading generated SQL | Will cause production outages |
| Write a manual migration without updating the snapshot | drizzle-kit will re-generate the same DDL |
| Skip the pre-deploy checklist | The 2026-05-08 outage resulted from skipping inspection |
| Commit secrets or credentials | Use `.env` on VPS; never in git |

---

## 7. Emergency Journal Correction

If a migration is known to have been applied outside of Drizzle (e.g. via `ensureEnumValues()` or a manual `psql` run) and Drizzle keeps failing trying to apply it, insert a journal record manually:

```sql
-- Only do this after taking a backup and confirming the schema state
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT '<sha256-of-current-file>', <journal-when-timestamp>
WHERE NOT EXISTS (
  SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = <journal-when-timestamp>
);
```

Compute the hash with:
```bash
node -e "
const c = require('fs').readFileSync('lib/db/drizzle/<tag>.sql','utf8');
console.log(require('crypto').createHash('sha256').update(c).digest('hex'));
"
```
