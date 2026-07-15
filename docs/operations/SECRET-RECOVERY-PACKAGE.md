# Secret Recovery Package — ArcScale EDMS

> **Purpose:** the authoritative inventory of every secret and config value required to
> rebuild production from backups after a total VPS loss. This document is an **inventory
> and policy only** — it contains **NO secret values** and must never contain any. Values
> live exclusively in the encrypted escrow (§3), never in this repository.
>
> **Rule:** no secret value is ever committed to the repository, printed in a report, pasted
> into chat, or stored in plaintext outside the escrow.

---

## 1. Why this matters

Backups (DB dump + file mirror in R2) are useless without the credentials to (a) reach the
R2 bucket, (b) connect to a rebuilt PostgreSQL, and (c) boot the app with the **same**
cryptographic keys. Losing a Tier-1 key is **unrecoverable** — sessions break, and any
data encrypted at rest becomes permanently unreadable. This package closes that gap.

---

## 2. Secret & config inventory (names + criticality — NO values)

Criticality legend:
- **T1 — Cryptographic (irreplaceable):** losing it means data/sessions cannot be recovered. **MUST escrow.**
- **T2 — Infrastructure credential:** needed to reach data/storage on rebuild. **MUST escrow.**
- **T3 — External service key:** functional; re-issuable from the provider console. **SHOULD escrow.**
- **T4 — Config/tuning:** not secret; reconstructable from this doc / deploy config. **Document only.**

### T1 — Cryptographic secrets (MUST escrow; loss = unrecoverable)
| Key name | Protects | If lost |
|----------|----------|---------|
| `JWT_SECRET` | Access-token signature; **also legacy password-hash verify** (`lib/auth.ts`) | All sessions invalid; legacy-hashed logins break |
| `REFRESH_TOKEN_SECRET` | Refresh-token signature | All refresh tokens invalid (forced re-login) |
| `ENCRYPTION_KEY` | AES-256-GCM at-rest field encryption (`lib/encryption.ts`, 64-char hex) | **Any column encrypted with it is permanently unreadable** (helper returns raw ciphertext) |

### T2 — Infrastructure credentials (MUST escrow)
| Key name | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string (includes DB password) |
| `R2_ENDPOINT`, `R2_ACCESS_KEY`, `R2_SECRET_KEY`, `R2_BUCKET` | Cloudflare R2 — **backups, DB dumps, and file mirror** (backup.sh / backup-files.sh / restore-verify.sh) |
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID`, `PRIVATE_OBJECT_DIR`, `PUBLIC_OBJECT_SEARCH_PATHS` | Object-storage locations |
| `DEFAULT_STORAGE_TYPE`, `DEFAULT_STORAGE_PATH` | Storage mode (`onpremise`/cloud) + on-prem volume path |

### T3 — External service keys (SHOULD escrow; re-issuable)
| Key name | Service |
|----------|---------|
| `RESEND_API_KEY`, `FROM_EMAIL`, `FROM_NAME` | Transactional email (Resend) |
| `STRIPE_SECRET_KEY` | Billing (Stripe) |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `TOGETHER_API_KEY`, `HUGGINGFACE_API_KEY`, `AI_INTEGRATIONS_OPENAI_API_KEY`, `AI_INTEGRATIONS_OPENAI_BASE_URL`, `CF_ACCOUNT_ID`, `CF_AI_TOKEN`, `OLLAMA_BASE_URL` | AI providers (only those actually enabled for the tenant) |
| `SENTRY_DSN` | Error reporting |
| `ELASTICSEARCH_URL` | Search backend (if enabled) |

### T4 — Config / tuning (not secret — document only, reconstruct from deploy config)
`NODE_ENV`, `APP_URL`, `ALLOWED_ORIGINS`, `LOG_LEVEL`, `MAX_UPLOAD_SIZE_MB`, `SOCKET_IO_PATH`,
`AI_PROVIDER`, `AI_MODEL`, `AI_DEBUG_OVERRIDE`, `MODULE_SYNC_INITIAL_MS`, `MODULE_SYNC_INTERVAL_MS`,
`FILE_AUDIT_DEDUP_WINDOW_MS`, `CRIT_THRESHOLD`, `WARN_THRESHOLD`, `SENTRY_RELEASE`.
(`REPLIT_*`, `ENABLE_REPLIT_STORAGE`, `TEST_DATABASE_URL` are non-production/dev-only.)

### Infra-level secrets & artifacts (outside the app `.env` — also required to rebuild)
| Item | Where it lives today | Needed for |
|------|----------------------|-----------|
| VPS SSH private key / host access | Operator workstation + GitHub Actions secret `SSH_HOST` et al. | Reaching / rebuilding the server |
| GitHub deployment PAT | GitHub Actions secrets (repo) | CD pipeline (`deploy.yml`) |
| Cloudflare account + DNS/proxy config for `www.arcscale.org` | Cloudflare dashboard | DNS, TLS termination, WAF |
| Cloudflare **Origin certificate** (or Let's Encrypt certs) | VPS (`/etc/...`) | HTTPS between Cloudflare and origin |
| Nginx / frontend reverse-proxy config | VPS (ports 8083→80 / 8443→443, api 8080) | Serving the app |
| `docker-compose*.yml` + volume names (`uploads_data`) + postgres container config | Repo + VPS | Rebuilding containers |

---

## 3. Escrow policy (to be completed by the owner)

> Fill the bracketed fields once, then keep them current. **No values in this file** — only
> the *location and process* to reach them.

- **Storage mechanism (choose one):**
  - **Option A (recommended):** an enterprise password manager vault (1Password / Bitwarden
    org / Vaultwarden) — a dedicated "ArcScale Production" vault, values entered directly in
    the vault UI.
  - **Option B:** an offline encrypted container (VeraCrypt / age-encrypted tarball) kept on
    two physically separate media (e.g. an encrypted USB in a safe + one offsite copy). The
    decryption passphrase is itself escrowed separately (not with the container).
- **Package owner:** `[owner name/role]` — primary custodian, accountable for currency.
- **Backup custodian:** `[second person]` — break-glass holder (so a single-person loss
  doesn't lock recovery).
- **Emergency access method:** `[exact steps: which vault, how the backup custodian unlocks
  it, where the offline container + passphrase are physically located]`.
- **Last verified:** `[YYYY-MM-DD]` — date the package was last checked end-to-end (every
  listed secret present, decryptable, and matching production).
- **Verification cadence:** quarterly, and after every rotation.

### Update mechanism (when a secret rotates)
1. Rotate the secret at its source (provider console / DB / key regeneration).
2. Update the running value on the VPS env (and GitHub Actions secret if used by CI).
3. **Immediately** update the escrow entry (§3 storage).
4. If a **T1 crypto key** is rotated, follow a key-rotation runbook (re-encrypt affected
   columns for `ENCRYPTION_KEY`; expect forced re-login for `JWT_SECRET`/`REFRESH_TOKEN_SECRET`).
5. Bump **Last verified** in §3 and note the rotated key + date in the change log below.

### Change log
| Date | Key(s) rotated | By | Escrow updated? |
|------|----------------|----|-----------------|
| `[YYYY-MM-DD]` | `[key names — NOT values]` | `[who]` | `[yes/no]` |

---

## 4. Recovery order (how these are used in a rebuild)

1. Provision VPS + Docker; restore Nginx/TLS config + Cloudflare origin cert (infra table).
2. Load **T2** (`DATABASE_URL`, R2 creds) → reach the R2 backups.
3. `restore-verify.sh` pattern: pull latest DB dump, `pg_restore` into the new Postgres.
4. Load **T1** crypto keys **before first app boot** (else sessions break and encrypted
   columns read as ciphertext).
5. Re-sync files from R2 `files-mirror` into the `uploads_data` volume.
6. Load **T2 storage config** + **T3** service keys; boot the app; run health + smoke.
7. Repoint Cloudflare DNS to the new origin.

See `BACKUP-AND-RECOVERY.md` for the backup side and `RESTORE-LOG.md` for drill evidence.
