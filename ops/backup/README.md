# ArcScale Backup & Recovery — R1 Hardening (operator guide)

The canonical backup system lives in **`scripts/`** and runs on the VPS via cron
(prod DB 02:00, staging DB 03:00, files 03:15, container/disk monitors). R1
hardens the existing scripts in place — it does **not** introduce a parallel
system. No secrets live in these files; the owner supplies each secret directly
to the tool that needs it.

| Script | Runs on | R1 hardening |
|---|---|---|
| `scripts/backup.sh` | VPS (cron) | age-encrypted DB dump · isolated backup token · encrypted `.env` snapshot |
| `scripts/backup-files.sh` | VPS (cron) | on-premise volume → dated **age-encrypted tarball** (was raw per-file sync) |
| `scripts/restore-verify.sh` | **OFF the VPS** | decrypt (private key) → scratch restore → **self-integrity** PASS/FAIL |

Customer object storage (R2 `edms-files`) is **never** copied here — protected in
place. Backups go to the separate **`edms-backups`** bucket. Existing pre-R1
objects (`nightly/*.dump`, `files-mirror/*`) are left untouched; hardened runs
write `nightly/*.dump.age`, `files-mirror-enc/*.tar.age`, `config/*.snap.age`.

## Owner setup (secrets entered by you; never sent to the assistant)

1. **Scoped backup token** (done): R2 API token `edms-backups-rw`, Object R&W, bucket `edms-backups` only. Isolation proven (denied on `edms-files`).
2. **age keys — OFF the VPS.** On your own machine: `age-keygen -o primary.key` and `age-keygen -o breakglass.key`; store each **private** key in two independent off-site places (never on the VPS/Git/logs). Get the public recipients with `age-keygen -y <key>`.
3. **Install `age` on the VPS** (`aws` is already present).
4. **VPS config files (mode 600):**
   - `/etc/edms-age-recipients.txt` — the two **public** `age1…` recipients, one per line (NON-secret).
   - Append to `/var/www/edms/.env` (the scoped token — secret, entered by you):
     `BACKUP_R2_ACCESS_KEY=…` and `BACKUP_R2_SECRET_KEY=…` (keep the existing `R2_*` for the app).
   - `FILES_HEALTHCHECK_URL=https://hc-ping.com/<uuid>` (create a 2nd healthchecks check for the file backup).
5. **First hardened run:** `bash /var/www/edms/scripts/backup.sh` → confirm `nightly/…dump.age`, `files-mirror-enc/…tar.age`, `config/…snap.age` land in R2.
6. **Restore drill (off the VPS):** on a host with a private key + docker + age + aws:
   `AGE_IDENTITY=~/secure/primary.key BACKUP_R2_ACCESS_KEY=… BACKUP_R2_SECRET_KEY=… R2_ENDPOINT=… bash scripts/restore-verify.sh` → expect `✓ PASS`.
7. Cron is already scheduled; once step 5 passes, nightly runs are automatically encrypted. Run the restore drill **monthly**.

## Behaviour & guardrails
- Encryption is active whenever `/etc/edms-age-recipients.txt` has ≥1 `age1` line; DB falls back to a RAW upload only if it is absent (with a loud WARN) — file backups require it (fail-closed).
- The isolated token is used when `BACKUP_R2_ACCESS_KEY` is set; otherwise it falls back to the prod token (WARN) so the job never silently breaks mid-rollout.
- Retention: 90 days (DB + file tarballs); prune runs only after the day's upload; never touches `edms-files` or pre-R1 objects.
- The production VPS never holds a private key — recoverability is proven off-VPS.

See `dr-runbook.md` for full disaster recovery on a fresh VPS, and the
**ArcScale Backup & DR** artifact for the architecture, RPO/RTO, and triggers.
