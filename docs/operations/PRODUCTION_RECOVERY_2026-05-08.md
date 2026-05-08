# Production Recovery — 2026-05-08

**Severity:** P1 — API down, production inaccessible
**Duration:** Extended (multiple deploy attempts over the session)
**Resolved:** 2026-05-08
**Resolution commit:** `f66372c7f6cddc223af4504b05ae7599fc057c3e`

---

## 1. Incident Summary

The ArcScale EDMS API container entered a persistent restart loop immediately after startup. The HTTP server never bound. Every container restart failed at the Drizzle ORM migration step in `docker-entrypoint.sh`.

---

## 2. Symptoms

- `edms_api` container restarting in a loop
- `docker compose logs api` showed migration errors before any API log lines
- PostgreSQL (`edms_postgres`) was healthy; data was intact
- Frontend container running but all API calls returning connection errors
- Error in logs:

```
ERROR: 42710 — duplicate_object: enum label "expired" already exists
```

---

## 3. Timeline of False Leads

### False Lead 1 — Suspected `0004a_add_expired_enum_value.sql`
- `0004a` was identified as the first migration adding `'expired'` to `subscription_status`.
- Multiple fixes were applied: `IF NOT EXISTS`, then `DO $$ EXCEPTION` guard.
- Each fix was pushed and deployed — error persisted.
- **Why this was wrong:** The SQL in the log (`ALTER TYPE "public"."subscription_status" ADD VALUE 'expired'`) did not match `0004a`'s SQL in any commit. `0004a` never used the schema-qualified `"public"."subscription_status"` form.

### False Lead 2 — Suspected stale Docker image cache
- Considered that the Docker layer cache was serving an old `0004a`.
- `docker compose build --no-cache api` was already being used.
- **Why this was wrong:** `--no-cache` prevents layer reuse. Image was fresh.

### False Lead 3 — Suspected volume bind mount
- Considered that a volume was overriding `/app/lib/db/drizzle/` inside the container.
- Inspected `docker-compose.yml` — only `uploads_data:/app/uploads` is mounted.
- **Why this was wrong:** No volume touches the migration files.

---

## 4. Actual Root Cause

### The Failing SQL

```sql
ALTER TYPE "public"."subscription_status" ADD VALUE 'expired';
```

**Source:** `lib/db/drizzle/0007_remarkable_ben_urich.sql` — Line 1.

### Why This Was Generated

`drizzle-kit generate` computes migration diffs between consecutive snapshots. The snapshot sequence in `meta/` is:

```
0000_snapshot.json  → subscription_status values: [free, active, trialing, past_due, canceled]
0001_incremental_snapshot.json → same
0003_snapshot.json  → same (no 'expired')
                       ← 0004a was written MANUALLY — no matching snapshot
0007_snapshot.json  → subscription_status values: [..., 'expired']  ← first snapshot with 'expired'
```

When `drizzle-kit generate` created `0007`, it compared `0003_snapshot` → `0007_snapshot` and detected that `'expired'` was missing from the enum in `0003`. It generated a raw `ALTER TYPE ... ADD VALUE 'expired'` without `IF NOT EXISTS`.

### Why This Conflicted

`migrate.ts` calls `ensureEnumValues()` **before** `migrate()`. `ensureEnumValues()` runs:

```sql
ALTER TYPE subscription_status ADD VALUE IF NOT EXISTS 'expired'
```

via `pool.query()` in **autocommit mode**. This successfully commits `'expired'` to the database before Drizzle opens its outer `BEGIN`.

When Drizzle then runs `0007` inside its single outer transaction, PostgreSQL rejects the second `ALTER TYPE ADD VALUE` with error `42710 duplicate_object`.

### Why `IF NOT EXISTS` Alone Didn't Save It

In some PostgreSQL/transaction contexts, `ALTER TYPE ... ADD VALUE IF NOT EXISTS` can still raise `42710` if the value was added in the same session (even outside the current transaction). The `DO $$ EXCEPTION` pattern is the only fully bulletproof guard.

---

## 5. Fix Applied

**File:** `lib/db/drizzle/0007_remarkable_ben_urich.sql`

**Before:**
```sql
ALTER TYPE "public"."subscription_status" ADD VALUE 'expired';--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "plan_id" SET DEFAULT 'expired';--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "status" SET DEFAULT 'expired';
```

**After:**
```sql
DO $$
BEGIN
    ALTER TYPE "public"."subscription_status" ADD VALUE IF NOT EXISTS 'expired';
EXCEPTION
    WHEN duplicate_object THEN NULL;
END;
$$;--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "plan_id" SET DEFAULT 'expired';--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "status" SET DEFAULT 'expired';
```

The `--> statement-breakpoint` suffix after `$$;` is required — Drizzle splits SQL files on this delimiter before executing each statement. Without it, the two `ALTER TABLE` statements would be concatenated to the `DO` block.

---

## 6. Commits Applied During Recovery Session

| Commit | Change |
|---|---|
| (earlier) | PostgreSQL port fix — removed public 5432 binding |
| (earlier) | `free` → `expired` plan rename |
| (earlier) | `DATABASE_URL` underscore fix |
| (earlier) | Migration 0003 `IF NOT EXISTS` guard |
| (earlier) | Schema drift fix |
| `124dca4` | Fix missing `ai_models` table — `CREATE TABLE IF NOT EXISTS` in `0004b` |
| `dfa8680` | Add `ensureEnumValues()` pre-migration step in `migrate.ts` |
| `32116dd` | Rewrite `0004a` as `DO $$ EXCEPTION` block |
| `f66372c` | **Fix `0007` — actual root cause — `DO $$ EXCEPTION` guard** |

---

## 7. Validation Evidence

After deploying `f66372c`:

```
[migrate] ensureEnumValues: committed subscription_status → 'expired'
[migrate] All migrations applied successfully.
GET /api/health → 200 OK
```

`drizzle.__drizzle_migrations` contains 8 rows (entries for 0000 through 0007).

---

## 8. Lessons Learned

### L1 — Always read the full SQL in error messages carefully
The SQL in the log (`"public"."subscription_status"`, no `IF NOT EXISTS`) was the exact signature of a drizzle-kit generated statement — not a manually written one. This should have pointed to `0007` immediately.

### L2 — Manual migrations must update drizzle-kit snapshots
Writing a migration file by hand without running `drizzle-kit generate` afterward leaves the snapshot state out of sync. drizzle-kit will re-generate the same DDL in the next auto-generated migration.

### L3 — Inspect every generated migration before deploying
`git diff lib/db/drizzle/` must be part of the deploy checklist. A human eye would have caught the duplicate `ALTER TYPE` in `0007`.

### L4 — `DO $$ EXCEPTION` is the only fully safe pattern for enum DDL
`IF NOT EXISTS` alone is insufficient in all PostgreSQL + Drizzle transaction contexts. Standardize on the `DO $$ EXCEPTION WHEN duplicate_object THEN NULL` pattern for all enum migrations.

### L5 — `ensureEnumValues()` must stay in sync with migration files
Any enum value added via `ensureEnumValues()` must also be covered by a `DO $$ EXCEPTION` guard in every migration file that references it.
