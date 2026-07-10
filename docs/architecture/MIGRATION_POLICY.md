# Migration Policy

Governs how database schema changes are made in ArcScale, so the Drizzle meta
snapshots never drift from the migrations again (the drift that kept the
`Schema Migration Check` CI job permanently red until the 0030 baseline sync).

## Principle

**The default is `drizzle-kit generate`.** Change the schema in
`lib/db/src/schema/`, then run `pnpm db:generate` to produce the paired
migration SQL **and** its meta snapshot together. Commit both in the same change.

This keeps three things in lockstep, which is exactly what `db:check` verifies:
1. `lib/db/src/schema/*.ts` — the TypeScript source of truth
2. `lib/db/drizzle/*.sql` — the applied migrations
3. `lib/db/drizzle/meta/*` — the snapshots drizzle-kit diffs against

## Exceptional hand-written SQL

Sometimes a migration must be hand-written (e.g. `ALTER TYPE ... ADD VALUE`,
data backfills, or DDL drizzle-kit cannot express). When that is unavoidable, the
same PR **must** also:

1. Regenerate the meta snapshot so `pnpm db:generate` produces **nothing**
   afterwards (run it twice; the second run must say "No schema changes").
2. Include a **fresh-DB apply test**: apply all migrations to an empty database
   and confirm the resulting schema matches the TypeScript definitions.
3. Keep `drizzle-kit check` and `db:check` green.

A hand-written migration without its meta snapshot is what caused the 0015–0028
drift. Do not repeat it.

## CI enforcement

- `Schema Migration Check` (`.github/workflows/check-migrations.yml`) runs
  `pnpm db:check` on every push to `main` and every PR. It fails if
  `drizzle-kit generate` would produce any uncommitted migration — i.e. if the
  meta snapshots do not match the schema.
- `pnpm db:check` = `scripts/check-db-migrations.sh`:
  - [1/2] `drizzle-kit check` — migration file / snapshot chain integrity.
  - [2/2] `drizzle-kit generate` must yield no new files (no drift).

## Verifying a migration change locally

```bash
pnpm db:generate          # produces the migration + snapshot
pnpm db:generate          # run again → must say "No schema changes"
pnpm db:check             # must PASS
# fresh-DB apply test (needs the test Postgres up):
#   drop/recreate an empty DB, run the migrator, diff schema vs TS defs
```

## History

- Snapshots drifted: they stopped at `0014`; migrations `0015`–`0028` were
  hand-written without regenerating snapshots, so `drizzle-kit generate` always
  diffed against the stale 0014 baseline and produced a phantom recreate.
- `0030_baseline_meta_sync` fixed it: a **no-op** SQL migration carrying a fresh
  full snapshot as the new baseline. No production DB change — every object it
  records already existed live.
