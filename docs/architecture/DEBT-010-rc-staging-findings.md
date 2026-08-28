# DEBT-010 RC — Staging Findings & Backlog Follow-ups

Non-blocking observations gathered during the DEBT-010 Release-Candidate live
staging tests (edms_app + membership RLS, on `edms_staging`). **None of these are
DEBT-010 blockers** and **none were fixed during the cutover** — they are recorded
here as product/hardening backlog items to be scheduled separately.

| # | Area | Observation | Severity | Status |
|---|------|-------------|----------|--------|
| F1 | Cross-org document route | Unauthorized/cross-org access to a document returns **403** in some paths instead of a uniform **404**, leaking resource existence (info-hiding). Tenant isolation itself holds (no data returned). | Low (info-hiding) | Backlog |
| F2 | Document PUT immutability | `PUT /projects/:projectId/documents/:id` ignores immutable `organizationId`/`projectId` in the body and returns **200** rather than rejecting. No cross-tenant move occurs (RLS `WITH CHECK` + code ignore the fields), but the silent 200 is misleading. | Low | Backlog |
| F3 | Staging backup path | `scripts/backup.sh` defaults to the **production** DB (`ENV_FILE=/var/www/edms/.env`, `DB_CONTAINER=edms_postgres`, `DB_NAME=edms`). `deploy.yml` (prod) calls it correctly; `deploy-staging.yml` takes **no** backup at all, and reusing the script naively on staging would dump prod. **NOT a prod-cutover blocker** — prod's own backup path (deploy.yml + the manual, verified cutover backup) is correct. Staging operational hygiene only. Fix: a staging wrapper passing `DB_CONTAINER=edms_staging_postgres DB_NAME=edms_staging ENV_FILE=/var/www/edms-staging/.env BACKUP_PREFIX=staging-nightly` (separate prefix/bucket). | Low–Medium (ops hygiene, staging-only) | Backlog |
| F4 | Task-assignment notification (cross-org) | Assigning a task to a **project member from a different tenant** (cross-org party/member on a shared project) does **not** create a `Task assigned` notification for that assignee, whereas the `New document` flow correctly notifies cross-org members. No leakage, no security impact — a potential missed-notification UX gap in the task-notify path for cross-org assignees. | Low (product/UX) | Backlog |
| F5 | `storage-quota.reconcile` not wired | The Category-A `reconcile(orgId, trigger)` service is correctly restructured under `withSystemTenantTx(orgId)`, but it has **no production caller** (no scheduler/route) — invoked only by tests. It cannot be exercised as a *live* background job until wired to a nightly scheduler and/or an admin `manual` trigger endpoint. | Low (incomplete wiring) | Backlog |
| F6 | Migration-tracker drift (staging) | Migrator emits: `WARNING: migration drift detected — journal has 35 entries but tracking table has 34. 1 migration(s) may have been applied manually without updating the tracker.` Idempotent-safe (rerun exits 0, no dup objects, RLS/data intact), but a real tracker/journal mismatch. | Medium (deploy hygiene) | **PRODUCTION GATE BLOCKER** |

## F6 Phase A result (Production tracking audit — READ-ONLY, evidence)

Production `drizzle.__drizzle_migrations` holds **33 rows**; the RC journal has **35** entries. Timestamp mapping (`created_at = journal when`) is valid (33 present + 2 missing = 35). **TWO** journal entries are absent from Production tracking (Staging had only one — Production drift is worse):

- **idx 11 — `0010_audit_schema`** (when `1779899523704`)
- **idx 12 — `0011_must_change_password`** (when `1749168000000`)

Corroborated by the `id` gap in tracking (173 `0009_audit_immutable` → 175 `0013_document_types`; `id=174` absent). This is a **tracking claim only** — whether the objects those two migrations create actually exist in the Production schema is the Phase B question (not yet checked). Objects to verify in Phase B: `0010_audit_schema` (audit table/schema changes — read the .sql) and `0011_must_change_password` (`users.must_change_password`). Note `0011` is `ADD COLUMN` **without** `IF NOT EXISTS` → if the column already exists but stays untracked, a future migrate would fail "column already exists".

## F6 Phase B result + VERDICT (Production schema audit — READ-ONLY, evidence)

Both untracked migrations' objects are **fully present in Production** (and in fresh Staging):
- `0010_audit_schema` → `audit_logs.before_state/after_state/actor_role/user_agent` (4 cols) **present** + indexes `idx_audit_logs_entity`, `idx_audit_logs_user_created` **present**.
- `0011_must_change_password` → `users.must_change_password boolean NOT NULL DEFAULT false` **present** (exact match).

**Per-migration verdict:** BOTH = **applied-but-untracked**. Neither is unapplied or partial.

**Is a future prod migrate safe?** YES (evidence-based, not assumed):
- drizzle `migrate()` runs only migrations with `when > max(created_at)` in tracking. Max tracked = `1787279822140` (0034). Both missing are far below (0010=1779899523704, 0011=1749168000000) ⇒ **permanently skipped**. Empirically confirmed by Test 10 (staging re-ran migrate cleanly under a similar drift).
- `repairStaleBaseline()` only force-re-applies CREATE INDEX migrations whose indexes are **absent**; 0010's indexes are present ⇒ untouched. 0011 has no index ⇒ ignored.
- `ensureBaseline()` early-returns because schema `drizzle` already exists.
- Net: a cutover migrate is a no-op for these two + idempotent seed/RLS. **No "column already exists" failure fires.**

**Conditional hazard (recorded, not active):** `0011` is `ADD COLUMN` **without** `IF NOT EXISTS`. It only fails **if** tracking is manually reset/manipulated to force re-application (or the drizzle schema is dropped and re-baselined incorrectly). Under normal migrate it never re-runs. Do NOT manually edit tracking.

**F6 classification: tracking-only drift with COMPLETE schema. STATUS: CLOSED as Production blocker → `PROCEED WITH AWARENESS`** (operator-approved).

Documented facts (permanent record):
- Production `drizzle.__drizzle_migrations` = **33 rows** vs RC journal = **35 entries**.
- `0010_audit_schema` and `0011_must_change_password` are **applied-but-untracked**.
- Production **schema verified complete** for both (4 audit_logs cols + 2 indexes; `users.must_change_password`).
- A normal migrate will **not** re-apply them (both older than current `max(created_at)=1787279822140`).

Standing constraints (no cleanup approved):
- **Do NOT drop/recreate the `drizzle` schema and do NOT re-baseline** — no cosmetic chase; a re-baseline is not worth its risk.
- **Do NOT edit `__drizzle_migrations` manually** (INSERT/UPDATE/DELETE).
- **Any future migration MUST carry a `when` newer than the current max** and pass the normal migration gate — otherwise drizzle's watermark algorithm will silently skip it.

## F8 — Storage direct-download requires a view-token (PRE-EXISTING, not a cutover regression)

**Observed (Phase 8, prod browser):** opening certain documents navigated the browser directly to a bare `/api/storage/r2-object/org_15%2F…png?orgId=15` (no `vt=` token) → `{"error":"Unauthorized","message":"No token provided"}`.

**Root cause / fault domain — FRONTEND storage-open path.** The `r2-object` route is `requireAuthOrViewToken`: a direct browser navigation carries no `Authorization` header, so the URL must first be wrapped via `/api/storage/view-token` (adds `?vt=<token>`) or fetched with the Bearer header. Most UI open paths do wrap it (`use-preview-url.ts`, `view-url.ts`, `documents.tsx`, `project-detail.tsx`, `DocumentFilesPanel.tsx`), but at least one open/download entrypoint navigates to the bare stored serve-URL (`orgStorage.ts` builds `/api/storage/r2-object/…?orgId=`). Known DEBT-008 area (`view-url.test.ts` uses this exact R2 URL shape).

**Cutover-related? NO — pre-existing.** (1) `requireAuthOrViewToken` guarded r2-object already at `9fb48613` (pre-cutover). (2) **Zero frontend files changed in the RC** (`origin/main..c937038`) and only `api` was rebuilt → served frontend is byte-identical pre/post. (3) `No token provided` originates in the JWT middleware **before any DB access** → independent of the edms→edms_app switch.

**Security impact:** none negative — the route correctly **rejects** unauthenticated access (401, no data, no bypass). Secure-by-default.

**User impact:** certain document open/download actions fail to load the file in-browser (broken preview/download for those paths). Pre-existing UX defect.

**Smallest correct fix (do NOT weaken auth / do NOT make storage public):** the offending frontend open/download path must wrap the stored storage URL with a view-token (same pattern as `view-url.ts`/`use-preview-url.ts`) or use an authenticated blob fetch, before navigation. Requires a **frontend** change + frontend rebuild/deploy — separate from the backend-only DEBT-010 cutover.

**Verdict impact:** does NOT block the DB-role cutover (which is functioning: smoke 401-not-500, RLS enforced, no 500s/leaks). Classified **Fix-before-broad-use (frontend)** — follow-up, not a rollback trigger. | Medium (UX) | Follow-up |

## Cutover isolation evidence is COMPOSITE (not any single check)

The `/projects/1` UI attempt is only **supplementary** app-level evidence (it returned "Project not found" with no data and no 500 — but project 1's existence was not owner-confirmed, so it is not proof on its own). The authoritative cross-tenant isolation proof for the cutover is the combination of:
1. **DB canary as `edms_app` on real prod data** → `other_orgs_visible = 0` and `no_ctx_documents = 0`.
2. `edms_app` = `NOSUPERUSER` + `NOBYPASSRLS`.
3. Membership RLS FORCEd on all 13 tables (13 `org_isolation_policy` via `app.*`).
4. UI for the org-15 account lists only its own project (16), no foreign orgs.
5. `/projects/1` returned no data and no 500 — **supplementary** app-level signal only.

## PRODUCTION GATE BLOCKER (from F6, original mandate — now satisfied by the Phase A/B audit above) — read-only migration/schema-drift audit

Before **any** future Production migration, a **read-only** audit MUST run and be reviewed. It must determine:

1. **Which migration is journal entry #35** (present in the drizzle journal) that is **absent** from the `__drizzle_migrations` tracking table.
2. **Whether that migration's content is actually applied** in Production (inspect the real schema objects it creates/alters), independent of the tracker.
3. **Three-way comparison: journal ↔ tracking table ↔ actual schema** — never rely on counts alone.
4. **Critical objects/columns surfaced by the Staging trial**, including `users.must_change_password` and the other columns whose absence caused the earlier staging register-org 500.

Hard constraints:
- **Do NOT manually edit the migration tracking table.**
- **Do NOT run any migration against Production** before the difference is understood and explicitly approved.

## F7 — Reminder-job dedup is blind under the edms_app background context (duplicate notifications)

**Observed (staging, Test 11):** every overdue task accumulated **4** `task_overdue` notifications — one synchronous (at task create) plus **one per reminder-job run** (three runs across restarts: 18:17, 18:23, 01:50). The 24h dedup guard prevented none.

**Root cause:** `sendDueDateReminders` runs each org inside `withSystemTenantTx(orgId)` — a system-tenant context with **org set but NO session user**. The `notifications` RLS policy is **per-user** (`user_id = session_user()`). So the dedup `SELECT ... WHERE userId=assignee AND type='task_overdue' AND entityId=... AND createdAt>yesterday` returns **zero rows** (no session user ⇒ RLS hides every existing notification), the job concludes "not yet sent," and **re-inserts a duplicate** on every run. The INSERT itself succeeds (edms_app is a grantee); ownership stays correct (task 3 → user_id 1 only, task 4 → user_id 2 only) — **no data loss, no cross-tenant leakage**. The defect is functional: **hourly duplicate `task_overdue` (and likely `task assigned`/workflow) notifications in production** once running under edms_app.

**Severity:** Medium (functional/UX + notification-table growth). **Not** a security/isolation regression; **not** a rollback failure. Exposed by DEBT-010's least-privilege + per-user RLS + no-user background context.

**Blast radius:** the same blind dedup-then-insert pattern covers **all** reminder-job notification types — `task_overdue`, action-item overdue, `workflow_action_required`, `workflow_sla_reminder` — so every one duplicates on every hourly run. **STATUS: Fix-before-production (confirmed).**

**Fix options (design only — none executed; no policy/grant/RLS/semantics change now):**
- **Option B (recommended)** — add a `SECURITY DEFINER SET search_path=''` helper `app.recent_notification_exists(uid, type, etype, eid, since)` that performs the dedup read (bypassing per-user RLS but strictly parameterized); reminder-job calls it instead of a direct `SELECT`. Keeps the RLS policy untouched, preserves the rolling-24h semantic, testable. DDL via migrator.
- **Option E (lightest, app-only)** — before the per-assignee dedup read, set `app.current_user_id` to the assignee within the existing tenant tx so `user_id = session_user()` matches; reset per assignee. No new DB object, no policy change; must be carefully scoped/reset.
- **Option C (defense-in-depth)** — DB guard + `INSERT ... ON CONFLICT DO NOTHING`. Caveat: the dedup is a rolling-24h window, not once-ever, so a plain unique is too strict; would need a per-day generated column — awkward. Consider only as a secondary guard.
- **Rejected — Option D**: broadening the `notifications` USING clause to let the system/org context read other users' rows — this weakens the per-user isolation just proven in Test 7. Do not do.

Verify any chosen fix on Staging (re-run the F7 scenario: multiple reminder runs must NOT accumulate duplicates) before production. | Medium | **Fix-before-production** |

**STATUS: FIXED & VERIFIED ON STAGING (B′, commits `5ab02d1`+`da9eff4`).** Live F7 Staging Gate results:
- Existing overdue tasks (entity 3,4): reminder boot-run after the fix left counts UNCHANGED (4→4) — no increase (dedup now sees prior rows).
- Clean owner-fixture task (entity 5, no synchronous notif): across TWO reminder cycles over container restarts → exactly **1** `task_overdue` ("is past its due date") — created on cycle 1, deduped on cycle 2 (dedup survives process restart).
- `enum = text` operator bug caught live and fixed (`n.type::text` / `n.entity_type::text` under `search_path=''`).
- `notifications` policy byte-unchanged (USING per-user); Test 7 isolation intact (A=[1], B=[2,1], C=[3]); runtime = `edms_app` (super/bypass=false); no `permission denied`/context errors.
- Pre-fix duplicate rows already in staging (entity 3,4 = 4 each; plus synchronous create-time ones) are historical data left in place — optional cleanup, not required by the fix.
- Unit tests (`f7-reminder-dedup.test.ts`, #1–#4) run in CI (no local DB here).

## Notes
- F1/F2 discovered in Tests 2/4/5; F3 during staging deploy prep; F4 during Test 7 (Notifications).
- These do **not** change the DEBT-010 scope, roadmap, RLS policy, grants, or background-job semantics.
- Revisit under a dedicated hardening pass after DEBT-010 production cutover closes.
