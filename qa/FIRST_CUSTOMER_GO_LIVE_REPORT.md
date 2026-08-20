# ArcScale — First-Customer Go-Live Report

Date: 2026-08-19. Executed against a **production-like isolated staging** stack (owner production
untouched). Path followed exactly as approved: Staging → C3 → C2 → C1 → R2 (R1/R3 in parallel).
No Billing, no cosmetic work, no unnecessary refactoring.

## Environment (production-like staging)
TLS edge (self-signed, simulates Cloudflare/host-Nginx termination) → **Nginx** (container, prod
`nginx.staging.conf`) → **Node/API** `NODE_ENV=production` → **PostgreSQL 16** → **on-prem storage volume**.
Real image build from the production `Dockerfile`; real entrypoint (runtime Drizzle migrator + seeders).
Reached at `https://localhost:8443`. Isolated names `edms_sglocal_*`, own network/volumes. The owner's
`.env` and any real production data were never touched; all staging secrets were freshly generated.

---

## Verdict: **PILOT READY — conditional** (see conditions)

No code, security, data-safety, isolation, or recoverability blocker remains — all were proven on the
production-like surface, and full regression is green (**772/772**). The remaining items are **owner-provided
configuration**, not engineering blockers:
1. **R1** — set `RESEND_API_KEY` (+ verified sender domain) so real users receive verification / password-reset / invite emails.
2. **R3** — set `SENTRY_DSN` for error reporting (uptime is already checkable via `/api/health`).
3. **Real-edge cutover** — validate the actual Cloudflare + real domain + managed TLS in front of this exact
   build (could not be done here: no SSH / Cloudflare-panel access). This is the gate to **PRODUCTION READY**.

Not **NO-GO** (nothing broken/unsafe remains). Not **PRODUCTION READY** (real edge + R1/R3 config outstanding).

---

## C3 — Deployment Verification — **PASS**
Driven end-to-end over HTTPS on the deployed surface (not just `health=200`):

| Step | Evidence | Result |
|---|---|---|
| Fresh DB migrations | entrypoint ran all 37 + **0033** from scratch — "All migrations applied successfully"; session cols + `expires_at`=timestamptz present | ✅ |
| Login (TLS) | 200; refresh cookie `edms_rt` **Secure + HttpOnly + SameSite=Strict** | ✅ |
| Session/refresh | `POST /api/auth/refresh-token` via cookie → 200 on the deployed surface | ✅ |
| Tenant identity | `/api/auth/me` → correct org | ✅ |
| Project → Document → Upload | 201 / 201 / 201 | ✅ |
| Download + hash | serve URL → 200; **server sha256 == uploaded == downloaded** (663b14c0…) | ✅ |
| Permissions / cross-tenant deny | org B → org A project/document/files/download = **403 / 403 / 403 / 403** | ✅ |
| Restart / redeploy persistence | after `docker restart` of API: login recovered, prior file re-downloaded 200, **hash matches** (2084 bytes) | ✅ |

## C2 — Backup & Restore Drill — **PASS**
Restore performed into an **isolated** target; original staging data never touched.

| Item | Evidence | Result |
|---|---|---|
| Backup | `pg_dump --format=custom` (387 KB) + upload files copied · **RPO = 2026-08-19T04:09:25Z** | ✅ |
| Restore (DB) | `pg_restore` into fresh `edms_restore`, rc=0 · restored **5 orgs, 2 projects, 2 docs, 2 revisions, 2 files** | ✅ |
| Original untouched | `edms_staging` still 5 orgs / 2 files during & after drill | ✅ |
| Files (object storage) | both restored files **byte-for-byte intact** (on-disk sha256 == DB-recorded sha256) | ✅ |
| Functional after restore | restored tenant login 200 → **downloaded its file via the app, hash matches** | ✅ |
| **RTO** | ≈ **83 s** (backup → restore → service up → verified) | ✅ |

## C1 — Final Security / Penetration-Resistance Review — **PASS (no Critical/High)**
Reviewed on the deployed surface; closed areas reused (Session closure, Product-Validation §D isolation).

**Strong / verified:** unauth API → 401 · SQL-injection login → 401, no SQL leak, no bypass · XSS payload not
reflected raw · path traversal (encoded `../etc/passwd`) → blocked (404, basename guard) · no stack/SQL in
error bodies · **API Helmet headers** (CSP `default-src 'none'`, HSTS, `X-Content-Type-Options`, `X-Frame-Options`,
Referrer-Policy, Permissions-Policy; no `X-Powered-By`) · **CORS rejects foreign origin** (no ACAO) · cookies
**Secure+HttpOnly+SameSite=Strict** · **rate limiting live** (auth: 3×401 then 429; register-org 429 after 3) ·
tenant isolation / RLS / IDOR-BOLA (403×4 live + §D zero-leakage) · auth/session (Session closure).

**Findings:**
- **F1 (MEDIUM) — FIXED & retested.** The SPA **HTML document** shipped with **no** security headers
  (`X-Frame-Options`, `X-Content-Type-Options`, HSTS, Referrer-Policy, Permissions-Policy): an `add_header`
  inside the `location /` and `location = /index.html` blocks cancels inheritance of the server-level headers
  (nginx behaviour) → clickjacking / MIME-sniff exposure of the app shell. **Fix:** repeat the security header
  set inside those two blocks in **`nginx.conf` (production)** and `nginx.staging.conf`. **Retest:** `/index.html`
  and `/` now return `X-Frame-Options: SAMEORIGIN`, `nosniff`, HSTS, Referrer-Policy, Permissions-Policy
  (+ CSP-Report-Only in prod).
- **F2 (LOW) — deferred.** `OPTIONS` preflight from a disallowed origin, and a malformed-JSON body, return
  **500** instead of a clean 4xx. **No information leak** (no stack/SQL); the foreign origin still gets no CORS
  grant. Cosmetic error-handling; not a first-customer blocker.

## R2 — Fresh-tenant provisioning — **PASS (starter content is OPT-IN)**
- **Finding:** starter document types + workflow templates were **auto-seeded for every org** (originally at
  container boot; briefly at `/register-org`). This imposed an engineering/construction taxonomy
  (Drawing/ITP/Method Statement…) on *every* tenant regardless of industry.
- **Coupling investigation (read-only):** **no business logic depends on any default.** `documents.documentType`
  is free-text (not enum/catalog-constrained); metadata validation returns `ok` for an unknown/inactive type;
  numbering derives `{TYPE}` from any string with a generic fallback; workflows are opt-in and match by free-text
  or an optional FK; permissions are role-based; no reporting/dashboard coupling. `document_types` is read only
  by its CRUD, metadata validation, workflow linkage, and the seeder. **Disabling ALL types is safe** — verified
  live: after `is_active=false` on all 11 types, both existing documents still listed and a new document with a
  custom type saved (201).
- **Product decision (2026-08-19) → OPT-IN, implemented (minimal change):** a new tenant now starts **empty**;
  removed the auto-seed from `/register-org` **and** from `docker-entrypoint.sh`; added
  **`POST /api/config/starter-templates`** (admin) to load the starter set on demand (onboarding / Settings),
  reusing `lib/org-defaults.ts`. Idempotent. Soft-disable (`isActive=false`) is retained for document types
  (no hard delete — history/audit preserved); workflow templates keep full CRUD incl. delete.
- **Retest (staging):** fresh org 7 → **0 workflow templates / 0 document types**; boot log shows no seed steps;
  a document with custom type `BespokeLegalBrief` → 201; `POST /starter-templates` → **{workflowTemplates:4,
  documentTypes:11}**; second call → **{0,0}** (idempotent); after disabling all 11 types, both docs still listed
  and a new custom-type doc → 201. Full regression **772/772**.
- **Remaining wiring (not blocking):** a Settings/onboarding **button** that calls `POST /starter-templates`
  (backend capability is complete and reachable via API). Industry Profiles: deferred (post-first-customer).

## R1 — Transactional email — **✅ CLOSED (all 3 journeys E2E on production: reset · verification · invitation)**
**Password Reset — E2E PASS on real production** (`https://www.arcscale.org`, owner-run 2026-08-19): the owner
triggered a real password reset, **received the email**, opened the reset link (accepted), set a new password
(changed successfully), and verified login with the new password. This single real flow proves the entire
shared email pipeline in production:
- `RESEND_API_KEY` is **present + valid + actually sending** (a real message was delivered) — note a Sending-only
  key can 401 on `/api-keys`|`/domains`, so those admin endpoints are NOT a validity signal; delivery is.
- Sender/domain is **deliverable** (the message reached a real inbox).
- **`APP_URL` is correct** (`https://www.arcscale.org`) — the reset link resolved and worked.
- The email code path (`lib/email.ts` → Resend), token issue, and one full link→endpoint round-trip all work.

**R1 = CLOSED** — all three first-customer email journeys proven E2E on **real production** via Chrome (owner-run):
- **Password Reset** — email received → reset link (`/reset-password`) → new password → login. PASS (see above).
- **Email Verification** — registered a real trial tenant "R1 Verification Test" (`arcscaleedms@gmail.com`) via
  the UI → verification email delivered from `noreply@arcscale.org` → link `…/verify-email?token=` → **"Email
  verified successfully"** → login as admin. The email-verified **gate passed** (the upload `request-url` call
  authenticated and proceeded — not blocked by `EMAIL_NOT_VERIFIED`).
- **Invitation / Onboarding** — Admin → Users → Add User (`d.khanfar86@gmail.com`, role Reviewer) → "User
  created successfully" → onboarding email delivered → set-password link (`…/set-password?token=`) → set
  password → login → `/api/auth/me` confirms **role reviewer**, org "R1 Verification Test".

**Reviewer permission cross-check (server-side, not just UI):** `/admin` UI → "Access Restricted"; and via the
reviewer's own session — `POST /api/users` → **403**, `POST /api/projects` → **403**, reads (`GET /api/projects`)
→ 200. Two findings recorded (do NOT reopen R1): (a) `POST …/documents` returns **500** (not 403) on Production —
no doc created; the current code tree already returns a clean 403, so this is Production running the pre-fix
build → folds into DEBT-003; (b) **DEBT-004 (MEDIUM):** `POST /api/storage/uploads/request-url` lacks a
read-only role gate (reviewer got 200) — within-org storage-write gap, not cross-tenant.

The upload-to-storage step itself is blocked by **DEBT-002 (R2 CORS)** — unrelated to email; tracked separately.
Welcome email (self-signup) shares the same proven pipeline — no separate test needed.

## R3 — Monitoring / error visibility — **PARTIAL / owner credential**
`/api/health` returns rich status (db/disk/uploads) → uptime-checkable now. Error reporting is gated
(`SENTRY_DSN not set`). **Needs from owner:** `SENTRY_DSN` to enable error capture.

---

## Bugs found & fixed during this run
- **BUG-008 (HIGH, deployment) — FIXED.** The Session-Management schema (org_config session columns +
  refresh_tokens `last_used_at`/`family_id` + `expires_at`→timestamptz) had **no Drizzle migration file** — a
  fresh production/staging DB would boot **without** those columns and the session code would fail. Generated
  `0033_session_hardening.sql` (with `USING … AT TIME ZONE 'UTC'` for a correct timestamptz conversion on
  existing data). **Verified:** fresh staging DB migrated cleanly incl. 0033; columns present; full app works.
- **F1 (MEDIUM)** and **R2 (workspace seeding)** — see above.

## Regression
Full suite after all changes (0033, `org-defaults`, seeder refactor, `/register-org`, nginx): **772 / 772
(55 files), exit 0.**

## What the owner must provide to reach the gates
- **To complete PILOT:** `RESEND_API_KEY` + verified sender domain (R1); `SENTRY_DSN` (R3, optional-but-recommended).
- **To reach PRODUCTION READY:** validate this exact build behind the real Cloudflare + domain + managed TLS
  (C3/C1 re-run on the real edge — needs Cloudflare-panel / host access), then confirm the past edge outage is
  reproducibly healthy.

## Files changed (in scope)
`lib/db/drizzle/0033_session_hardening.sql` (+ journal/snapshot) · `artifacts/api-server/src/lib/org-defaults.ts`
(new) · `scripts/seed-wf-defaults.ts` · `scripts/seed-document-types.ts` · `routes/auth.ts` (register-org: no
auto-seed) · `routes/config.ts` (`POST /starter-templates` opt-in) · `docker-entrypoint.sh` (removed auto-seed
steps) · `nginx.conf` · `nginx.staging.conf`. Open debt: `qa/OPEN_DEBT.md` (DEBT-001 / F2).
