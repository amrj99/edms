# ArcScale Disaster Recovery Runbook (R1-P4)

**Scenario:** the production VPS (`edms-server`, Hetzner) is gone and its disk is
unreachable. Goal: bring ArcScale back on a **fresh empty VPS** from off-site
assets only. Customer files on R2 are independent and survive; this runbook
restores the DB, config, code, and re-attaches the files.

**Recovery inputs (all off-site — none on the dead VPS):**
| Input | Where it lives off-site |
|---|---|
| Application code | GitHub `amrj99/edms`, deployed SHA (current: `1649ce67…`) |
| DB backup (encrypted) | R2 `edms-backups` bucket, `daily/<latest>/edms_pg_*.pgc.age` |
| `.env` snapshot (encrypted) | same bucket, `daily/<latest>/edms_env_*.snap.age` |
| Local uploads (encrypted) | same bucket, `daily/<latest>/edms_uploads_*.tar.age` |
| age private identity | owner password manager + sealed offline copy (2 locations) |
| R2 backup token + R2 prod token | owner password manager |
| Cloudflare/DNS access | owner Cloudflare account |

> If any row above is unavailable, DR cannot complete — keep this table current
> (see the "off-site inventory" review). RPO target ≤ 24h; RTO target ≤ 4–8h
> (engineering targets — validate by timing an actual drill before quoting an SLA).

---

## Steps

1. **Provision VPS** — same region/spec class; Ubuntu; root access; note the new IP.
2. **Install prerequisites** — Docker + compose, git, age, rclone, curl.
3. **Clone the exact release**
   ```bash
   git clone https://github.com/amrj99/edms.git /var/www/edms
   cd /var/www/edms && git checkout 1649ce67b8e212d7f555dc8def8b891b1e0db24c
   ```
4. **Restore configuration securely**
   - `rclone config` → recreate remote `r2backup` with the backup token (from password manager).
   - Pull + decrypt `.env` **with a private age key on a trusted host**, place at `/var/www/edms/.env` (mode 600). The `.env` carries the R2 **prod** credentials that map to customer files.
5. **Restore PostgreSQL**
   - `docker compose up -d postgres` (fresh empty volume).
   - Pull latest `edms_pg_*.pgc.age`, decrypt (private key), `pg_restore` into `edms`:
     ```bash
     age -d -i <private> -o d.pgc <pulled>.pgc.age
     docker exec -i edms_postgres pg_restore -U edms -d edms --clean --if-exists < d.pgc
     ```
   - Recreate least-privilege roles if the fresh DB lacks them: the app's migrator
     (`docker-entrypoint.sh` → `migrate.mjs`, `applyMembershipRls`) reinstalls schema
     `app`, membership RLS, and `edms_app` grants on boot. `edms_app`'s **password**
     is not in the dump — set it out-of-band (`\password edms_app`) to match `.env`.
6. **Restore local uploads** (if used): pull `edms_uploads_*.tar.age`, decrypt, untar into the `edms_uploads_data` volume path.
7. **Verify RLS / runtime roles**
   ```bash
   docker exec edms_postgres psql -U edms -d edms -c "SELECT rolname,rolsuper,rolbypassrls FROM pg_roles WHERE rolname IN ('edms_app','edms_rls_owner');"
   # expect edms_app super=f/bypass=f
   docker exec edms_api sh -c 'echo "$DATABASE_URL"' | sed -E 's#(://[^:]+:)[^@]+@#\1***@#'   # expect edms_app
   ```
8. **Application health** — `docker compose up -d` (api+frontend); `curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/api/health` → 200.
9. **Authenticated file access** — log in; open a document whose file lives on R2; confirm view-token → r2-object → presigned redirect works (proves the restored metadata re-points to the surviving R2 objects).
10. **Smoke tests** — create/list a project; upload a small doc; cross-org isolation spot-check (a second org can't see the first's project).
11. **DNS / Cloudflare cutover** — point `arcscale.org` / `www` to the new IP; verify TLS and the CF→Nginx→api/frontend path. (Do NOT perform during a drill on the live domain.)
12. **Post-recovery verification** — row counts vs the last known snapshot; recent audit entries present; schedulers started (`trial-downgrade`, notifications) in `docker logs edms_api`.
13. **Declare DR PASS — evidence required:** health 200 · runtime `edms_app` (super/bypass=f) · RLS enforced (isolation spot-check) · authenticated R2 file opened · row counts within expected drift · **restore duration recorded** (feeds RTO validation).

## Safe-to-rehearse vs live-only
- **Rehearse now (safe):** steps 1–10 on a throwaway VPS or locally, restoring the latest backup into an isolated stack. This is the real RTO measurement.
- **Live-only (do not rehearse against prod):** step 11 DNS cutover.

## Failure-domain note
Customer files and DB backups both currently reside in Cloudflare R2 (isolated
bucket + token). A Cloudflare-account or global-R2 failure is a single domain this
does not cover → escalate to a second provider when a DR clause or provider-outage
RTO requires it (tracked as a Scale trigger, not a first-customer requirement).
