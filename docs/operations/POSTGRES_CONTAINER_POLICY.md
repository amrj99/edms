# Postgres Container Policy

## Current State (as of 2026-07-05)

`edms_postgres` is running **without Docker Compose labels**. It was started
outside of Compose during early production setup and is tracked only as a plain
container, not as a Compose-managed service.

As a side effect of the Phase 5 deployment (2026-07-05), the container is now
connected to **two networks**:

| Network | How | Purpose |
|---|---|---|
| `edms-project_default` | Original network from container creation | Legacy |
| `arcscale_default` | Added manually via `docker network connect` | Allows `api` container to resolve hostname `postgres` |

The `postgres` DNS alias in `arcscale_default` was added manually:
```
docker network connect --alias postgres arcscale_default edms_postgres
```

This alias is **not persisted** in `docker-compose.yml`. If the container is
recreated, it must be re-applied.

---

## Policy: How to Restart or Upgrade Postgres

Because `edms_postgres` currently lacks Compose labels, running
`docker compose up -d postgres` will **not** manage the existing container —
Compose will try to create a new one and fail if the name is taken.

### Correct procedure for the next postgres restart or upgrade:

1. Take a database backup first:
   ```bash
   bash scripts/pre-deploy-backup.sh
   ```

2. Stop and remove the current unlabeled container:
   ```bash
   docker stop edms_postgres
   docker rm edms_postgres
   ```

3. Start via Compose so it receives proper labels and network configuration:
   ```bash
   docker compose up -d postgres
   ```
   This will create a Compose-managed container with the `postgres` service
   alias auto-applied inside `arcscale_default`, eliminating the need for the
   manual `docker network connect` step.

4. Verify healthy:
   ```bash
   docker inspect --format '{{.State.Health.Status}}' edms_postgres
   ```

### What NOT to do

- Do **not** `docker restart edms_postgres` and assume the network alias is
  still present — a restart preserves the container but network aliases
  survive; however, a `docker rm` followed by `docker run` will lose them.
- Do **not** run `docker compose up -d` (all services) expecting Compose to
  adopt the existing unlabeled postgres container — it will conflict.
- The `deploy-production.sh` script explicitly never touches `edms_postgres`.
  Postgres must be managed separately and deliberately.

---

## Long-Term Recommendation

Once postgres is next restarted using `docker compose up -d postgres` (step 3
above), it will have Compose labels and the `postgres` alias will be managed
automatically by Compose. From that point this document becomes historical.

The network configuration in `docker-compose.yml` already declares the alias:
```yaml
services:
  postgres:
    networks:
      default:
        aliases:
          - postgres
```

No changes to `docker-compose.yml` are needed.
