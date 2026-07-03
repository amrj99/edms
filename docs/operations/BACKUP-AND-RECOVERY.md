# Backup and Recovery — ArcScale EDMS

> **Operational document.**
> Read before handling any production incident or migration.

---

## 1. Architecture Overview

| Component | What's backed up | Method | Destination | Retention |
|---|---|---|---|---|
| PostgreSQL database | All tables, indexes, sequences, schema | `pg_dump --format=custom` | Cloudflare R2 `edms-backups/nightly/` | 90 days |
| Pre-deploy snapshots | Same as above | `pg_dump --format=custom` | Cloudflare R2 `edms-backups/pre-deploy/` | 30 days |
| Uploaded files (on-prem mode) | Document binaries from `uploads_data` volume | `aws s3 sync` (no `--delete`) | Cloudflare R2 `edms-backups/files-mirror/` | Accumulating mirror |
| Uploaded files (R2 mode) | Document binaries | Cloudflare R2 geo-redundancy | Cloudflare-managed | Until user deletes |
| Uploaded files (per-org S3 mode) | Document binaries | S3 provider redundancy | Org's S3 bucket | Tenant-managed |

> **Note on file backup policy (v1):** The `files-mirror` sync uses no `--delete` flag — files removed from the VPS are retained in R2. This is a safe accumulating mirror. Cleanup policy and R2 versioning will be defined in a future sprint.

---

## 2. Storage Bucket Separation

Two separate R2 buckets are used:

| Bucket | Purpose | Retention policy |
|---|---|---|
| `edms-files` (or your R2_BUCKET) | User-uploaded documents, the live application | Controlled by users via delete |
| `edms-backups` | Database dumps only | 90 days nightly, 30 days pre-deploy |

**Create the backup bucket** in the Cloudflare R2 dashboard before running the first backup. The same R2 credentials work for both buckets. Add to `.env` on the VPS:

```
BACKUP_BUCKET=edms-backups
```

---

## 3. Nightly Backup Setup

### Step 1: Install AWS CLI on the VPS

```bash
apt-get update && apt-get install -y awscli
```

Verify:

```bash
aws --version
```

### Step 2: Test R2 credentials

```bash
source /var/www/edms/.env
AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY" \
AWS_SECRET_ACCESS_KEY="$R2_SECRET_KEY" \
aws s3 ls "s3://${BACKUP_BUCKET:-edms-backups}/" \
  --endpoint-url "$R2_ENDPOINT" \
  --region auto
```

Expected output: an empty listing (or existing files), no error. If you see `NoSuchBucket`, create the bucket in Cloudflare R2 dashboard first.

### Step 3: Set up healthchecks.io monitoring

1. Go to https://healthchecks.io and create a free account.
2. Create a new check: period = 25 hours, grace = 1 hour.
3. Copy the ping URL (looks like `https://hc-ping.com/your-uuid`).
4. Add to `/var/www/edms/.env`:

```
HEALTHCHECK_URL=https://hc-ping.com/your-uuid-here
```

5. Configure your email in healthchecks.io alerts. When the backup does not ping within 25 hours, you receive an email.

### Step 4: Run the first backup manually

```bash
bash /var/www/edms/scripts/backup.sh
```

Expected output:
```
[backup] ── ArcScale EDMS Backup ── Mon May 12 02:00:01 UTC 2026
[backup] Dumping database 'edms' from container 'edms_postgres'...
[backup] Dump complete: edms_20260512_020001.dump (124K)
[backup] Uploading to R2 bucket 'edms-backups/nightly/'...
[backup] Upload complete: s3://edms-backups/nightly/edms_20260512_020001.dump
[backup] Local temp file removed.
[backup] Pruning backups older than 90 days...
[backup] Pruned 0 old backup(s).
[backup] Dead-man ping sent: https://hc-ping.com/...
[backup] ── Done: Mon May 12 02:00:04 UTC 2026 ──
```

### Step 5: Install the cron job

```bash
crontab -e
```

Add:
```
0 2 * * * /var/www/edms/scripts/backup.sh >> /var/log/edms-backup.log 2>&1
```

This runs every night at 02:00 server time. Adjust the hour if another time works better.

---

## 4. Pre-Deployment Backup

**Before every production deployment that includes migrations**, run:

```bash
bash /var/www/edms/scripts/pre-deploy-backup.sh
```

Then proceed with deployment only after seeing:

```
[pre-deploy-backup] Safe to proceed with deployment.
```

This is the most valuable backup category. The 2026-05-08 production outage was a migration failure — having a pre-deploy backup would have enabled a clean rollback.

This is also listed in `docs/deployment/MIGRATION_GOVERNANCE.md` pre-deploy checklist.

---

## 5. Restore Verification Drill

Run monthly during beta. Run weekly (automated) after beta with paying clients.

```bash
bash /var/www/edms/scripts/restore-verify.sh
```

This script:
1. Downloads the most recent nightly backup from R2.
2. Starts a throwaway postgres container on port 5433.
3. Restores the dump into it.
4. Compares row counts against the live database.
5. Tears everything down cleanly.

**Expected pass output:**
```
[restore-verify] users: 16 rows (MATCH)
[restore-verify] organizations: 6 rows (MATCH)
[restore-verify] documents: 131 rows (MATCH)
[restore-verify] ✓ PASS — Restore verification successful.
```

**Log the result:**
After each drill, add an entry to `docs/operations/RESTORE-LOG.md`:
```
2026-05-12 — PASS — Restored edms_20260511_020001.dump — 16 users, 131 docs — 4m 12s
```

---

## 6. Disaster Recovery Procedure

Use this when the VPS is unrecoverable, the database is corrupted, or data is lost.

**Target recovery time: < 4 hours from incident detection.**

```
STEP 1 — Provision new VPS
  Same specs, same region (or closest).
  Install Docker, Docker Compose:
    apt-get update && apt-get install -y docker.io docker-compose awscli

STEP 2 — Clone repository
  git clone https://github.com/your-org/arcscale-edms /var/www/edms
  cd /var/www/edms

STEP 3 — Restore .env file
  Copy from secure secrets store (1Password, Bitwarden, etc.)
  Never store .env in git.

STEP 4 — Verify R2 credentials work
  source /var/www/edms/.env
  AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$R2_SECRET_KEY" \
    aws s3 ls "s3://$BACKUP_BUCKET/nightly/" --endpoint-url "$R2_ENDPOINT" --region auto | tail -5

STEP 5 — Find and download the most recent backup
  LATEST=$(
    AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$R2_SECRET_KEY" \
    aws s3 ls "s3://$BACKUP_BUCKET/nightly/" --endpoint-url "$R2_ENDPOINT" --region auto \
    | awk '{print $4}' | grep '^edms_' | sort | tail -1
  )
  AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$R2_SECRET_KEY" \
    aws s3 cp "s3://$BACKUP_BUCKET/nightly/$LATEST" /tmp/restore.dump \
    --endpoint-url "$R2_ENDPOINT" --region auto
  echo "Downloaded: $LATEST"

STEP 6 — Start postgres only (not the full stack yet)
  docker compose up -d postgres
  # Wait for it to be ready:
  docker exec edms_postgres pg_isready -U edms -d edms

STEP 7 — Restore the dump
  docker exec -i edms_postgres pg_restore \
    -U edms -d edms --no-password --verbose < /tmp/restore.dump
  # Some "already exists" notices are normal for idempotent statements — not errors.

STEP 7b — Restore uploaded files (on-premise mode only)
  # Skip this step if your deployment uses R2 or S3 file storage.
  #
  # Download the file mirror from R2 to a local staging directory:
  mkdir -p /tmp/edms-files-restore
  AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$R2_SECRET_KEY" \
    aws s3 sync "s3://$BACKUP_BUCKET/files-mirror/" /tmp/edms-files-restore/ \
    --endpoint-url "$R2_ENDPOINT" --region auto
  #
  # Verify the staging directory is not empty:
  echo "Files downloaded: $(find /tmp/edms-files-restore -type f | wc -l)"
  #
  # Copy files into the Docker volume (container must be stopped or volume must be writable):
  docker run --rm \
    -v edms_uploads_data:/target \
    -v /tmp/edms-files-restore:/source:ro \
    alpine sh -c "cp -a /source/. /target/ && echo 'Files copied.'"
  #
  # Clean up staging directory:
  rm -rf /tmp/edms-files-restore

STEP 8 — Verify row counts
  docker exec edms_postgres psql -U edms -d edms -c \
    "SELECT
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM organizations) AS orgs,
      (SELECT COUNT(*) FROM documents) AS docs,
      (SELECT COUNT(*) FROM audit_logs) AS audit_logs;"

STEP 9 — Start the full stack
  docker compose up -d

STEP 10 — Verify API health
  curl http://localhost:8080/api/health

STEP 11 — Verify login works
  curl -X POST http://localhost:8080/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"owner@system.com","password":"<your-password>"}'

STEP 12 — Confirm startup integrity lines in logs
  docker logs edms_api 2>&1 | grep -E '\[integrity\]|\[migrate\]'
  Expected lines:
    [migrate] All migrations applied successfully.
    [integrity] FK constraints verified.
    [integrity] Orphan detection complete.

STEP 13 — Update DNS if VPS IP has changed
  Update A record in Cloudflare DNS to point to new VPS IP.
  Wait for propagation (typically < 5 minutes with Cloudflare proxy).

STEP 14 — Notify users
  Send email to all active org admins:
  "ArcScale EDMS has been restored after a service interruption.
   Data is current as of [backup timestamp]. Any activity between
   [backup time] and [incident time] may need to be re-entered."
```

---

## 7. On-Premise File Storage

If your deployment uses `DEFAULT_STORAGE_TYPE=onpremise`, uploaded files are stored in the `uploads_data` Docker volume on the VPS disk. The `backup-files.sh` script syncs this volume to R2 automatically as part of the nightly backup.

### How file backup works

`backup.sh` calls `backup-files.sh` immediately after the DB dump completes, minimising the consistency window between DB and file backups. The file sync uses `aws s3 sync` with the same R2 credentials as the DB backup.

```
R2 bucket: edms-backups
  ├── nightly/               ← DB dumps (pg_dump)
  ├── pre-deploy/            ← Pre-deployment DB snapshots
  └── files-mirror/          ← On-premise file sync (aws s3 sync)
```

### Setup

No additional setup is required beyond what `backup.sh` already needs. The file backup runs automatically as part of the nightly cron job.

**Optional:** Add a separate healthchecks.io check for file backup monitoring:

```bash
# In /var/www/edms/.env:
FILES_HEALTHCHECK_URL=https://hc-ping.com/your-files-check-uuid
```

**Optional:** Override the uploads directory path (default is auto-detected from Docker volume):

```bash
# In /var/www/edms/.env:
UPLOADS_VOLUME_DIR=/var/lib/docker/volumes/edms_uploads_data/_data
```

### Manual run

```bash
bash /var/www/edms/scripts/backup-files.sh
```

Expected output:
```
[backup-files] ── ArcScale EDMS File Backup ── Mon May 12 02:00:05 UTC 2026
[backup-files] Local files found: 847 (in /var/lib/docker/volumes/edms_uploads_data/_data)
[backup-files] Syncing to R2 s3://edms-backups/files-mirror/ ...
[backup-files]   Mode: accumulating mirror (no deletion propagation)
[backup-files] Sync complete.
[backup-files] R2 files-mirror total: 847 objects (local: 847)
[backup-files] ── Done: Mon May 12 02:00:38 UTC 2026 ──
```

### Backup policy (v1)

- **No `--delete` flag** — files deleted from the VPS are **retained** in R2. The mirror accumulates over time.
- This is intentional: protects against accidental deletion propagating to the backup.
- Future sprint: define cleanup policy and optionally enable R2 Object Versioning.

### If using R2 or S3 file storage

`backup-files.sh` detects that the uploads volume directory is absent and exits cleanly with a skip message. R2 and S3 storage modes are inherently redundant and do not need this script.

---

## 8. Retention Policy Summary

| Backup type | Schedule | Retention | Script |
|---|---|---|---|
| Nightly database dump | 02:00 daily (cron) | 90 days | `scripts/backup.sh` |
| On-premise file sync | 02:01 daily, called by backup.sh | Accumulating mirror (no deletion) | `scripts/backup-files.sh` |
| Pre-deploy database dump | Before every deploy (manual) | 30 days | `scripts/pre-deploy-backup.sh` |
| Restore verification | Monthly (manual during beta) | Log only | `scripts/restore-verify.sh` |

---

## 9. Backup Failure Investigation

If the healthchecks.io alert fires (no ping in 25 hours):

```bash
# Check the backup log
tail -50 /var/log/edms-backup.log

# Common causes and fixes:
# 1. Container not running:
docker ps | grep edms_postgres

# 2. R2 credentials expired or rotated:
source /var/www/edms/.env
AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$R2_SECRET_KEY" \
  aws s3 ls "s3://$BACKUP_BUCKET/" --endpoint-url "$R2_ENDPOINT" --region auto

# 3. Disk full (no space to write the temp dump):
df -h /tmp

# 4. Run backup manually to see real-time output:
bash /var/www/edms/scripts/backup.sh
```
