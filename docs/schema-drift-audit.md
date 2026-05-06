# Schema Drift Audit
**Date:** 2026-05-06  
**Scope:** Dev database (Replit) vs Drizzle migration files vs Drizzle schema definitions  
**Tool:** `drizzle-kit generate` + `information_schema.columns` query  
**Status:** ⚠️ ONE ACTIVE DRIFT FOUND — action required

---

## Summary

| Check | Result |
|---|---|
| Migration files vs schema code (`drizzle-kit generate`) | ✅ CLEAN — no new migration generated |
| Dev DB tables vs Drizzle schema barrel | ⚠️ 2 untracked tables (`conversations`, `messages`) |
| Previously drifted columns (`is_read_only_override`, `visible_on_free`) | ✅ RESOLVED — migration `0003_light_toro.sql` committed |
| Production DB comparison | ⚠️ BLOCKED — no VPS DB access from dev environment |

---

## Step 1 — Migration file integrity check

Command run:
```
pnpm db:generate
```

Result:
```
78 tables
No schema changes, nothing to migrate 😴
```

**Interpretation:** Every column and table defined in the Drizzle schema files has a corresponding migration file. The migration journal (`meta/_journal.json`) covers 4 migrations:

| File | Tag | Applied |
|---|---|---|
| `0000_init.sql` | Initial schema | 2026-04-29 |
| `0001_incremental.sql` | Incremental additions | 2026-04-29 |
| `0002_trial_downgrade.sql` | Trial downgrade columns | 2026-05-02 |
| `0003_light_toro.sql` | `users.is_read_only_override`, `projects.visible_on_free` | 2026-05-06 |

---

## Step 2 — Dev DB column inventory

Full query run:
```sql
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;
```

**Result:** 901 column rows across **80 tables**.

Drizzle schema tracks **78 tables**. The discrepancy: **2 extra tables in the live DB** that Drizzle does not know about.

---

## Step 3 — Drift Findings

### FINDING 1 — Two untracked tables: `conversations` and `messages`

**Severity:** HIGH  
**Status:** Schema files exist but are excluded from the schema barrel. No migration file. Drizzle cannot generate a migration for them because it cannot see them.

#### `conversations` table (live DB)
```
Column     | Type      | Nullable | Default
-----------|-----------|----------|--------
id         | integer   | NOT NULL | nextval(...)
created_at | timestamp | NOT NULL | now()
```
Primary key: `id`.  
Referenced by: `messages.conversation_id`.

#### `messages` table (live DB)
```
Column          | Type      | Nullable | Default
----------------|-----------|----------|--------
id              | integer   | NOT NULL | nextval(...)
conversation_id | integer   | YES      |
sender_id       | integer   | YES      |
content         | text      | YES      |
created_at      | timestamp | NOT NULL | now()
```
Primary key: `id`.  
Foreign keys: `conversation_id → conversations(id)`, `sender_id → users(id)`.

#### Root cause
Schema files exist at:
- `lib/db/src/schema/conversations.ts`
- `lib/db/src/schema/messages.ts`

These files are **not re-exported** from the Drizzle schema barrel (`lib/db/src/schema/index.ts` or equivalent). Because `drizzle-kit` only sees tables it can reach from the configured schema export, these two tables are invisible to the migration system. They were created directly in the DB (likely during an early development sprint) and the schema files were written but never wired up.

#### Impact
- `drizzle-kit generate` will never produce a migration for these tables
- `drizzle-kit check` will never fail on them
- They exist unmanaged — no rollback path, no migration history
- Any column changes to them bypass all CI guards

#### Proposed fix (do NOT apply without approval)
Two options:

**Option A — Wire them into the schema barrel (recommended)**
1. Add `export * from "./conversations.js"` and `export * from "./messages.js"` to the schema barrel
2. Run `pnpm db:generate --name=add_conversations_messages`
3. Drizzle will generate a `CREATE TABLE IF NOT EXISTS` migration
4. Commit migration + snapshot

**Option B — Drop the tables and files (if feature is unused)**
1. Confirm no routes reference `conversations` or `messages` tables (current check: no routes use them — `chat.ts` uses `chat_messages`, `chat_groups`, not these tables)
2. Run `DROP TABLE messages; DROP TABLE conversations;`
3. Delete the two schema files
4. No migration needed (Drizzle never tracked them)

**Recommendation:** Option B is cleaner if this was an abandoned prototype — the tables have no FK from any active table except each other, no routes use them, and their schema (2-column `conversations`, 5-column `messages`) looks like an early draft predating the `chat_groups`/`chat_messages` system. This decision must be confirmed by the team before any action.

---

### FINDING 2 — Dual DDL path for `plans`, `org_feature_overrides`, `org_quota_overrides`

**Severity:** MEDIUM (architectural risk, not active drift)

`seed-plans.ts` contains `CREATE TABLE IF NOT EXISTS` DDL for three tables that are also defined in Drizzle schema files. On every server startup, these tables are created via raw SQL if they do not exist.

This means there are two independent sources of truth for these table definitions:
1. `lib/db/src/schema/plan-catalog.ts` (Drizzle schema — what `drizzle-kit` manages)
2. `seed-plans.ts › ensureTablesExist()` (runtime DDL — what gets applied if migrations haven't run)

If either definition drifts from the other, Drizzle will generate a migration but the runtime DDL may have already created the table with stale column definitions, causing a conflict.

`seed-plans.ts` also applies `ALTER TABLE ADD COLUMN IF NOT EXISTS` for:
- `plans.min_users`
- `plans.max_file_size_mb`
- `organizations.trial_ends_at`
- `users.email_verified_at`
- `users.email_verification_token`

These are idempotent but they duplicate what migrations already handle.

**Recommended fix (do NOT apply without approval):** Once the production environment reliably runs migrations on deploy, the `ensureTablesExist()` function and its `ALTER TABLE` statements in `seed-plans.ts` should be removed. Until then, it is a safe (if messy) guard.

---

### FINDING 3 — Previously drifted columns: NOW RESOLVED

**Severity:** N/A — resolved  

The two columns reported as drifted (`users.is_read_only_override`, `projects.visible_on_free`) are present in both the dev DB and migration `0003_light_toro.sql`. CI check now passes. No action needed.

---

## Step 4 — Production DB comparison

**Status: BLOCKED**

The production database runs on the VPS. There is no direct connection string available in the dev environment. To complete this step:

1. SSH into the VPS and run:
```sql
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;
```
2. Compare the output against this document.
3. Pay particular attention to:
   - Whether `conversations` and `messages` exist in production (likely yes — they may have been created there too)
   - Whether `0003_light_toro.sql` has been applied (i.e., `is_read_only_override` and `visible_on_free` exist)
   - Whether all 4 migration tags appear in `drizzle.__drizzle_migrations` (if the migration tracking table exists)

---

## Required actions before closing this audit

| # | Action | Blocker | Owner |
|---|---|---|---|
| 1 | Decide: wire or drop `conversations`/`messages` | Team decision | Tech lead |
| 2 | Execute chosen option and commit | Decision in #1 | Dev |
| 3 | Run production DB comparison (SSH required) | VPS access | Ops |
| 4 | Confirm `0003_light_toro.sql` applied in production | Prod DB access | Ops / Dev |
| 5 | Remove `ensureTablesExist()` DDL from `seed-plans.ts` | After prod is migration-managed | Dev |
