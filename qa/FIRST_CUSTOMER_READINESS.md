# ArcScale — First-Customer Readiness Gap List

Date: 2026-08-19. Purpose: shortest **safe** path to the first real customer, per policy (no cosmetic /
over-engineering the first customer doesn't need). Ranked **Critical / Required / Deferred**, each with
current evidence and smallest-scope-to-close. **No implementation started — this is the gate list only.**

---

## 0. CLOSED with evidence — do NOT reopen

| Item | Evidence |
|---|---|
| **Session Management Hardening** | Live Chrome + API/DB + 772/772 regression — `SESSION_MANAGEMENT_CLOSURE.md` (approved 8h default, per-tenant, bounded) |
| **Multi-tenant isolation / RLS** | Zero cross-tenant leakage on every surface, both directions, all roles — `PRODUCT_VALIDATION.md §D` |
| **IDOR / BOLA** | All ID-manipulation cross-org access denied (403/404) — §D |
| **Read-only authz (BUG-005)** | Viewer/member/reviewer create+upload holes closed server-side |
| **5 validation bugs (2 HIGH)** | Fixed + live-verified — §C |
| **Functional depth (all surfaces)** | 6 tenants, role matrix, full regression green — §G |

Security **primitives already implemented in code** (so the security review below is *verify*, not *build*):
helmet + CSP (conditional for file routes), CORS allowlist, rate limits (global 300/min, auth 20/15min,
per-tenant tier-aware), `trust proxy` for CF→Nginx, HttpOnly+SameSite=Strict refresh cookie, hashed
tokens/passwords. Backup **scripted + documented** (nightly pg_dump→R2 90d, pre-deploy snapshots, file mirror).

---

## 1. CRITICAL — real remaining Go-Live blockers (must close before serving a real customer's real data)

### C1. Final Security / Penetration-Resistance Review on the REAL deploy surface — **MANDATORY GATE**
- **Why:** primitives are implemented and isolation validated, but only on **local QA**. A tenant's real data
  must not go live until an adversarial pass runs against the production surface as actually served.
- **Scope (all mandatory):** authentication & sessions · multi-tenancy/RLS · IDOR/BOLA · file upload &
  download authz (incl. direct serve URLs) · role/permission enforcement · secrets & config handling ·
  rate limiting · security headers & cookies **as served in prod** (Secure flag actually on, CSP, HSTS) ·
  injection / XSS / CSRF · the real deployment surface (CF→Nginx→Node, exposed ports, error disclosure).
- **Evidence today:** middleware present (`app.ts`); isolation proven (§D); **prod-surface verification = none**.
- **Smallest scope:** checklist-driven adversarial review against a staging origin that mirrors prod; reuse
  §D/Session evidence for already-closed areas so effort concentrates on prod-surface + injection/XSS/CSRF +
  file authz. Deliver a signed findings report; any HIGH finding is itself a blocker.

### C2. Backup taken **and restore drill actually performed** on production infra
- **Why:** data safety / recoverability is non-negotiable. A backup that has never been restored is unproven.
- **Evidence today:** `scripts/backup.sh`, `scripts/ops/0032-backup-verify.sh`, `docs/operations/BACKUP-AND-RECOVERY.md`
  (nightly→R2, pre-deploy, file mirror). Restore is documented + scripted; **an end-to-end restore into a live
  target on the real infra is not proven** (ops branches `fix-restore-verify-*` suggest it was in progress).
- **Smallest scope:** one real nightly backup → restore into a scratch DB → verify integrity (row counts,
  key tables, a tenant's docs+files resolvable) → record measured **RPO/RTO**. Confirm the nightly cron is
  actually scheduled on the prod host.

### C3. Production deployment validated end-to-end on the real host
- **Why:** everything above is proven only on local QA. Prod entry (CF Flexible→Nginx→api/frontend) exists and
  had a **past outage investigation that did not fully close** (origin excluded, edge/client unresolved; access
  limited — CF panel, no SSH). The customer must reach a correct, stable app.
- **Evidence today:** `nginx.production.conf`, `deploy.sh`, `.github/workflows/deploy.yml`; INTERNAL TEST =
  local QA only; unresolved edge-layer outage note (`project_arcscale_infra_outage`).
- **Smallest scope:** deploy current build to prod/staging → run smoke (login, create project/doc, upload,
  download, cross-tenant deny) + the Session live-tests **against the real origin** → confirm migrations
  (incl. 0032) applied → confirm the outage path is stable/reproducibly healthy.

---

## 2. REQUIRED — needed for a usable, correct first-customer **Pilot** (smaller than full GA)

### R1. Transactional email delivery (user invite + password reset) configured & verified
- **Why:** a real customer's users must be invited and able to reset passwords. Email is config-gated and
  currently **off** (`RESEND_API_KEY not set` in logs).
- **Smallest scope:** set `RESEND_API_KEY` on prod → send one real invite + one real password-reset → confirm
  receipt + working links. (No code — configuration + verification.)

### R2. First-run tenant seeding (default doc types + workflow templates on org create)
- **Why:** without seeded defaults the customer's workspace can be empty/unusable on day one. Flagged in
  validation, **not re-tested**.
- **Smallest scope:** provision one fresh org via the real provisioning path → confirm default doc types +
  workflow templates exist and are usable; fix only if missing.

### R3. Minimal monitoring / error visibility for the pilot
- **Why:** don't fly blind on a live customer. Sentry seam exists (`SENTRY_DSN not set`).
- **Smallest scope:** set `SENTRY_DSN` + one uptime/health check (`/api/health` already returns 200). No new
  system — enable what exists.

> Manual tenant provisioning for the first customer is acceptable (owner uses admin provisioning). Per-tenant
> session settings can be set via the existing `PUT /api/config/session-settings` API — a settings **UI** is
> NOT required for one pilot customer (moved to Deferred).

---

## 3. DEFERRED — explicitly NOT blocking the first customer

| Item | Why deferrable | Evidence |
|---|---|---|
| **Billing / Stripe self-serve UI** | First customer can be **provisioned + invoiced manually** (admin sets plan; bank transfer / manual invoice). Backend is done + config-gated; only the self-serve `/settings/billing` page is missing. Self-serve matters at *signup scale*, not for one known customer. | `project_arcscale_first_customer`; billing backend 772-green, config-gated |
| Per-tenant session-settings **UI** | API covers one pilot; UI is convenience | `config.ts` GET/PUT exists |
| Storage folder-segment inconsistency | Serve URL already resolves either way (robustness cleanup) | §E 🟡 |
| Sprint B performance/scale tuning | Wait for real data volume | §E |
| R2 backup versioning / cleanup policy | Accumulating mirror is safe for now | BACKUP-AND-RECOVERY §1 note |
| Rate-limit fine-tuning | Tune against real traffic post-launch | `app.ts` defaults sane |

---

## 4. Answer to "is Billing required for the first customer?"
**No — Billing is not a technical blocker to reach or serve the first customer.** Provision the tenant and
plan manually via admin, and invoice manually (offline). Building the Stripe self-serve checkout is required
only to scale to self-service signups. → **Deferred** until after the first customer.

## 5. Bottom line — shortest safe path
Close **C1 (security review on real surface) + C2 (restore drill) + C3 (prod deploy validated)** = the true
Go-Live blockers. Add **R1 (email) + R2 (seeding) + R3 (monitoring)** for a usable pilot. Everything else,
**including Billing**, waits. Nothing cosmetic is on the critical path.
