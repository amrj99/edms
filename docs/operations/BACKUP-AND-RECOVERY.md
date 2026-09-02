# Backup and Recovery — ArcScale EDMS

> **Operational document.** Read before handling any production incident or migration.
> **Reflects the R1 hardening (2026-09): age-encrypted backups, an isolated backup
> token, and an off-VPS restore drill.** Architecture, RPO/RTO and upgrade triggers
> live in the *ArcScale Backup & DR* reference artifact.

---

## 0. What R1 changed (read this first)

- **Encryption at rest.** Every backup object is `age`-encrypted to **two** public
  recipients (primary + break-glass) **before** it leaves the VPS. Nothing is
  uploaded in plaintext once `AGE_RECIPIENTS` is configured. The private identities
  live **off the VPS** (owner's keeping) — a VPS or R2 compromise cannot read backups.
- **Isolated credentials.** Uploads use a **scoped** R2 token (`BACKUP_R2_ACCESS_KEY`
  / `BACKUP_R2_SECRET_KEY`) that can reach **only** the `edms-backups` bucket — not
  the customer `edms-files` bucket. The app keeps its own all-buckets token.
- **File backup = encrypted dated tarball**, not a raw per-file sync.
- **`.env` snapshot** is backed up (encrypted) so a fresh VPS can be reconstituted.
- **Restore drill runs OFF the VPS** (needs a private key) and passes on the
  backup's **own integrity**, not a live-count comparison.

> **Legacy objects:** pre-R1 `nightly/*.dump` (raw) and `files-mirror/*` (raw sync)
> may still exist; they age out under the 90-day retention. New objects are
> `nightly/*.dump.age`, `config/*.snap.age`, `files-mirror-enc/*.tar.age`.

---

## 1. Architecture Overview

| Component | What's backed up | Method | Destination | Retention |
|---|---|---|---|---|
| PostgreSQL | all tables/indexes/sequences/schema | `pg_dump -Fc` → **age-encrypt** | `edms-backups/nightly/*.dump.age` | 90 days |
| `.env` config | production configuration (secrets) | copy → **age-encrypt** | `edms-backups/config/*.snap.age` | 90 days |
| Uploaded files (on-prem) | `uploads_data` volume | `tar` → **age-encrypt** (dated) | `edms-backups/files-mirror-enc/*.tar.age` (+`.sha256`) | 90 days |
| Uploaded files (R2 mode) | document binaries | protected in place (R2) | `edms-files` (customer bucket) | until user deletes |
| Uploaded files (per-org S3) | document binaries | S3 provider redundancy | org's bucket | tenant-managed |

> Customer object storage is **never** full-copied into backups — see the artifact's
> 42 TB rule. Only the small on-premise residual is snapshotted.

---

## 2. Bucket & Credential Separation (failure domains)

| Bucket | Purpose | Access |
|---|---|---|
| `edms-files` (`R2_BUCKET`) | live customer documents | app's all-buckets token (`R2_ACCESS_KEY`) |
| `edms-backups` | encrypted backups only | **scoped** token (`BACKUP_R2_*`) — cannot reach `edms-files` |

The scoped backup token and the production token are **independent**: leaking one
does not expose the other. Both buckets are on Cloudflare R2 (same provider) — a
cross-provider replica is a documented Scale trigger, not a first-customer need.

`.env` keys required:
```
R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com
BACKUP_R2_ACCESS_KEY=<scoped token key>      # edms-backups only
BACKUP_R2_SECRET_KEY=<scoped token secret>
HEALTHCHECK_URL=https://hc-ping.com/<db-check-uuid>
FILES_HEALTHCHECK_URL=https://hc-ping.com/<file-check-uuid>
BACKUP_BUCKET=edms-backups
```
`R2_ACCESS_KEY`/`R2_SECRET_KEY` (the app's token) remain for the application.

---

## 3. One-time Setup

1. **age on the VPS:** `apt-get install -y age` (verify `age --version`).
2. **Keys (generated OFF the VPS):** `age-keygen -o primary.key` and
   `age-keygen -o breakglass.key`. Store each **private** key in **two** independent
   off-site locations (password manager + sealed offline). Never place a private key
   on the VPS, in Git, or in logs. Extract public recipients with `age-keygen -y`.
3. **Recipients file on the VPS:** put the two **public** `age1…` recipients (one per
   line) in `/etc/edms-age-recipients.txt` (mode 600). Encryption activates when this
   file has ≥1 `age1` line.
4. **Scoped token:** create an R2 API token limited to `edms-backups` (Object R&W);
   set `BACKUP_R2_*` in `.env`.
5. **Monitoring:** two healthchecks.io checks (DB + file backup); set
   `HEALTHCHECK_URL` and `FILES_HEALTHCHECK_URL`.

---

## 4. Nightly Backup

Cron (root):
```
0 2 * * *  /var/www/edms/scripts/backup.sh >> /var/log/edms-backup.log 2>&1
15 3 * * * bash /var/www/edms/scripts/backup-files.sh >> /var/log/edms-backup-files.log 2>&1
```
`backup.sh` also calls `backup-files.sh` at the end of its run. Expected log:
```
[backup] Encryption: ON (2 recipient(s))
[backup] Dump complete: edms_<ts>.dump (…)
[backup] Encrypted: edms_<ts>.dump.age (…)
[backup] Upload complete.                       # s3://edms-backups/nightly/…dump.age
[backup] .env snapshot uploaded (encrypted) to config/.
[backup] Dead-man ping sent.
[backup-files] Encrypted tar: … (N files)
[backup-files] Uploaded to s3://…/files-mirror-enc/
[backup-files] Dead-man ping sent.
```
> If `[backup] Encryption OFF` appears, `/etc/edms-age-recipients.txt` is missing —
> fix before relying on the backup (a raw dump would otherwise be uploaded).

---

## 5. Restore Drill (recoverability) — OFF the VPS

Run **monthly** on a host that holds a **private** age identity (never the prod VPS).
Requires: `age`, `aws`, `docker`.
```
AGE_IDENTITY=/path/to/primary.key \
BACKUP_R2_ACCESS_KEY=<scoped> BACKUP_R2_SECRET_KEY=<scoped> \
R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com \
bash scripts/restore-verify.sh
```
The script: pulls the latest `nightly/*.dump.age` → decrypts with the private key →
starts a throwaway scratch container → **pre-creates the `edms_app`/`edms_rls_owner`
roles** → restores → checks **self-integrity** (schema + critical non-empty tables +
zero dangling FKs) → tears down. **PASS = the backup restores to a consistent DB**
(live-count comparison is optional, non-gating). Log each run in
`docs/operations/RESTORE-LOG.md`.

---

## 6. Disaster Recovery — fresh VPS from encrypted backups

Use when the VPS is unrecoverable. **Target RTO ≤ 4–8h, RPO ≤ 24h** (engineering
targets, validated by drill — not a contractual SLA).

> **Recovery inputs — all off-site:** GitHub repo + deployed SHA · a **private age
> key** (owner off-site copies) · the scoped `BACKUP_R2_*` token · Cloudflare/DNS
> access. Without the private key the backups cannot be read.

```
STEP 1 — Provision VPS; install docker, docker-compose, git, age, aws.

STEP 2 — Clone + checkout the deployed release:
  git clone <repo> /var/www/edms && cd /var/www/edms && git checkout <TARGET_SHA>

STEP 3 — Restore .env:
  Decrypt the latest config/*.snap.age WITH A PRIVATE KEY on a trusted host, place
  as /var/www/edms/.env (mode 600). It carries the R2 credentials for customer files.
    aws s3 cp s3://edms-backups/config/<latest>.snap.age ./env.age \
      --endpoint-url "$R2_ENDPOINT" --region auto   # uses BACKUP_R2_* creds
    age -d -i <private-key> -o /var/www/edms/.env ./env.age

STEP 4 — Start postgres only:
  docker compose up -d postgres
  docker exec edms_postgres pg_isready -U edms -d edms

STEP 5 — Pull + decrypt the latest DB backup (private key):
  source /var/www/edms/.env
  a(){ AWS_ACCESS_KEY_ID="$BACKUP_R2_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$BACKUP_R2_SECRET_KEY" aws "$@" --endpoint-url "$R2_ENDPOINT" --region auto; }
  LATEST=$(a s3 ls s3://edms-backups/nightly/ | awk '{print $4}' | grep 'dump.age$' | sort | tail -1)
  a s3 cp s3://edms-backups/nightly/$LATEST /tmp/db.age
  age -d -i <private-key> -o /tmp/restore.dump /tmp/db.age

STEP 6 — Ensure roles exist, then restore:
  # The app's migrator recreates roles on boot, but for a direct restore pre-create them:
  docker exec edms_postgres psql -U edms -d edms \
    -c "DO \$\$ BEGIN CREATE ROLE edms_app; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$;" \
    -c "DO \$\$ BEGIN CREATE ROLE edms_rls_owner; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$;"
  docker exec -i edms_postgres pg_restore -U edms -d edms --no-owner --verbose < /tmp/restore.dump
  shred -u /tmp/restore.dump /tmp/db.age

STEP 7 — (on-premise files) pull + decrypt + unpack the latest tarball:
  LATESTF=$(a s3 ls s3://edms-backups/files-mirror-enc/ | awk '{print $4}' | grep 'tar.age$' | sort | tail -1)
  a s3 cp s3://edms-backups/files-mirror-enc/$LATESTF /tmp/files.tar.age
  age -d -i <private-key> -o /tmp/files.tar /tmp/files.tar.age
  docker run --rm -v edms_uploads_data:/target -v /tmp:/src:ro alpine sh -c "tar -xf /src/files.tar -C /target && echo done"
  shred -u /tmp/files.tar.age; rm -f /tmp/files.tar

STEP 8 — set edms_app password to match .env (not in the dump):
  docker exec -it edms_postgres psql -U edms -d edms -c "\\password edms_app"

STEP 9 — Start full stack: docker compose up -d
STEP 10 — Health: curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/api/health   # 200
STEP 11 — Runtime roles: SELECT rolname,rolsuper,rolbypassrls FROM pg_roles WHERE rolname IN ('edms_app','edms_rls_owner');  # edms_app f/f
STEP 12 — Authenticated file open (proves metadata re-points to surviving R2 objects).
STEP 13 — DNS: point arcscale.org / www to the new IP (Cloudflare).
STEP 14 — Verify row counts + recent audit entries; notify org admins of the recovery point.
```

---

## 7. Retention & Monitoring Summary

| Backup | Schedule | Retention | Script | Dead-man |
|---|---|---|---|---|
| DB dump (encrypted) | 02:00 daily | 90 days | `backup.sh` | `HEALTHCHECK_URL` |
| `.env` snapshot (encrypted) | with `backup.sh` | 90 days | `backup.sh` | (DB check) |
| File tarball (encrypted) | 03:15 + with `backup.sh` | 90 days | `backup-files.sh` | `FILES_HEALTHCHECK_URL` |
| Restore drill | monthly (off-VPS) | log only | `restore-verify.sh` | recoverability check |

**Job health ≠ recoverability health.** A green nightly ping means an encrypted
object landed off-site; only the restore drill proves it is restorable.

---

## 8. Failure Investigation

If a healthchecks alert fires:
```
tail -50 /var/log/edms-backup.log            # or /var/log/edms-backup-files.log
docker ps | grep edms_postgres               # container up?
grep -c '^age1' /etc/edms-age-recipients.txt # encryption armed? (expect 2)
# scoped token reachable (read-only):
source /var/www/edms/.env
AWS_ACCESS_KEY_ID="$BACKUP_R2_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$BACKUP_R2_SECRET_KEY" \
  aws s3 ls s3://edms-backups/ --endpoint-url "$R2_ENDPOINT" --region auto
df -h /tmp                                    # space for the temp dump?
bash /var/www/edms/scripts/backup.sh         # run manually for live output
```

---

## 9. Known follow-ups (non-blocking)
- Convert `backup.sh`/`backup-files.sh` to **fail-closed** when `BACKUP_R2_*` is unset
  (currently falls back to prod creds with a WARN — a rollout convenience).
- `backup-files.sh` executable bit (invoked via `bash`, so non-blocking).
- Legacy raw `nightly/*.dump` + `files-mirror/*` objects age out under 90-day retention.
- Pre-deploy snapshot (`pre-deploy-backup.sh`) not yet hardened to the encrypted flow.
