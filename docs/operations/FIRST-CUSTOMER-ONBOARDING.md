# First Customer Onboarding — ArcScale EDMS

> **Operational runbook.** Bring one real customer from zero to daily use.
> Manual / offline-billing path — **no Stripe required**. No DB edits, no code, no
> deploys. Every side-effectful action is through the product UI/API.

**Roles:** **Owner** = you (business). **System Owner** = the platform admin
account (`amr_j_98@hotmail.com`) used for cross-tenant actions (plan changes).
**Admin** = the customer's own admin user (created at signup).

## Preconditions (verify once, before onboarding)
- Production healthy: `https://www.arcscale.org/api/health` → 200.
- Backup live & recoverable: R1 CLOSED — nightly encrypted backup + monthly off-VPS restore drill (see `BACKUP-AND-RECOVERY.md`). Confirm the last nightly ping is green on healthchecks.io.
- Email configured: `RESEND_API_KEY` + `FROM_EMAIL` set in prod `.env` (confirmed 2026-09-02). Team invites and password resets depend on it.
- Tenant isolation enforced: runtime `edms_app` (NOSUPERUSER/NOBYPASSRLS) + membership RLS (DEBT-010).

## ⛔ Never do by hand in the database
- Do **not** `INSERT`/`UPDATE`/`DELETE` in `users`, `organizations`, `subscriptions`, `projects`, `documents`, or any tenant table directly.
- Do **not** edit `drizzle.__drizzle_migrations`.
- Do **not** set a user's `organization_id` to NULL or change roles via SQL.
- Do **not** touch `edms-backups` objects or run `docker prune`.
- All tenant changes go through the app (RLS + audit_logs capture them). Direct SQL bypasses isolation, audit, and invariants.

---

## Step 1 — Create the organization + first Admin
**Who:** Owner (or the customer self-serves).
**How:** Public signup `POST /api/auth/register-org` (the signup form): org name + admin first/last/email/password. Creates the org on a 14-day trial + an **active** admin who can log in immediately with the password they set (no email needed for the admin to log in).
**Verify:** admin can log in at `https://www.arcscale.org`; org appears in System Owner → Admin → Organizations.
**Rollback if failed:** if signup errored mid-way, do **not** hand-fix in DB — retry signup with a different org name; if a half-created org/user exists, System Owner deletes the org via the Admin UI (never SQL) and retry.

## Step 2 — Activate the paid plan (no Stripe)
**Who:** **System Owner** (cross-tenant).
**How:** Admin → Organizations → the customer org → **Change Plan** → select the paid plan (e.g. `professional`). This sets `subscriptions` active + `organizations.subscription_tier` + clears `trial_ends_at` + restores any prior downgrade — atomically (proven live, P8).
**Verify:** the org's plan shows the paid tier; `trial_ends_at` cleared. (Optional read-only: `SELECT subscription_tier,trial_ends_at FROM organizations WHERE id=<org>;` → paid / NULL.)
**Rollback if failed:** re-run Change Plan (idempotent upsert). Do not edit `subscriptions`/`organizations` by hand.
**Why before use:** once paid, the trial-downgrade scheduler can never touch this tenant (it only targets `subscription_tier='trial'`).

## Step 3 — Load starter content
**Who:** customer **Admin** (or Owner on their behalf during setup).
**How:** `POST /api/config/starter-templates` (Settings → onboarding action). Idempotent, RLS-scoped to the caller's org. Seeds 4 generic workflow templates (General / Correspondence / Contract / Drawing approval). **Note:** it does **not** create document types — see Step 4.
**Verify:** workflow templates appear under the org's workflow settings; re-running returns `workflowTemplates: 0` (already present).
**Rollback if failed:** safe to re-run (idempotent, no duplicates). Templates are `isActive` and can be disabled in the UI.

## Step 4 — Define document types (optional)
**Who:** customer **Admin**.
**How:** Settings → Document Types → add the customer's types (`PUT /api/config`). **Optional:** the Upload dialog already falls back to a built-in generic list and defaults to `general`, and accepts custom free-text types — so classification works even with none defined. Define types only to give the customer a tailored controlled list.
**Verify:** added types appear in the Upload dialog dropdown.
**Rollback if failed:** remove the type in Settings; existing documents keep their stored type string.

## Step 5 — Add the customer's team
**Who:** customer **Admin**.
**How:** Admin → Users → Add User (email + role: document_controller / reviewer / project_manager / admin / viewer). The system creates the user with a random temp password + `mustChangePassword`, and **emails a set-password link** (48h). The link is **not** shown in the response — it is email-only.
**Verify:** the invited user receives the email and sets their password, then logs in.
**Manual fallback (if email doesn't arrive / not yet configured):** Admin → Users → the user → **Reset Password**, set a known password (`POST /api/users/:id/reset-password`, org-scoped), and communicate it to the user out-of-band. This clears `mustChangePassword`.
**Rollback if failed:** deactivate the user in the UI (do not delete/null in SQL). Re-add or reset as needed.

## Step 6 — Create the first project
**Who:** Admin (or PM).
**How:** Projects → New Project (name/code). Add team members to the project (project membership drives per-project access under membership RLS).
**Verify:** the project lists for its members; a non-member in the SAME org cannot see it (membership isolation); another org cannot see it at all.
**Rollback if failed:** archive/cancel the project in the UI.

## Step 7 — Upload & classify a document
**Who:** any member with upload rights (DC/PM/admin).
**How:** open the project → Upload → pick file, set document number + type (dropdown or free text) → upload. Files go to the org's storage backend (R2 by default). Open/download uses a short-lived view-token (works in-browser; F8).
**Verify:** the document appears in the project; open it (renders/downloads); a member of another org cannot access the file URL.
**Rollback if failed:** delete the file in the UI (soft-delete; retained 90d). Do not delete storage objects by hand.

---

## Step 8 — Quick verify after each step
| After | Check |
|---|---|
| 1 | admin login 200; org in Admin list |
| 2 | plan = paid; trial_ends_at cleared |
| 3 | workflow templates present |
| 4 | types show in Upload (or fallback shows) |
| 5 | invited user logs in (email or reset) |
| 6 | project visible to members only; other org blind |
| 7 | document opens for members; cross-org blocked |

## Step 9 — Final go-live checks
- **Login:** admin + at least one team member can log in.
- **Tenant isolation:** from the customer's account, no other org's projects/documents/users are visible (spot-check). Runtime is `edms_app` (super=f/bypass=f).
- **Email readiness:** one real invite (or password reset) email was received (confirms Resend domain delivery end-to-end).
- **Backup/DR:** last nightly backup ping green; a recent off-VPS restore drill passed (recoverability proven). Customer data is now covered by the encrypted off-site backup from the next nightly run.
- **No trial downgrade:** org is on a paid tier (`subscription_tier` ≠ trial, `trial_ends_at` NULL) → the scheduler cannot downgrade or lock out the customer.

---

## Rollback / recovery philosophy
- Prefer **UI reversal** (deactivate, archive, reset, change-plan re-run) over any SQL.
- All the above steps are idempotent or UI-reversible; none require DB surgery.
- If data was genuinely lost, use `BACKUP-AND-RECOVERY.md` (restore is to scratch first, never over production).
- Escalate to `DISASTER_RECOVERY.md` only for full-VPS loss.

## Known constraints (not blockers for the first customer)
- Trial is not surfaced in the tenant UI and expiry is silent — mitigated by activating the paid plan at Step 2 (see the Trial UX backlog item).
- `starter-templates` provides workflows only, not document types (Step 4 / backlog `DEFAULT_DOC_TYPES`).
- Billing is manual/offline (contract + invoice + transfer); `/settings/billing` (Stripe) is deferred.
