# ============================================================
# EDMS - Multi-stage production Dockerfile
# ============================================================
# NOTE: Build stages use node:22-slim (Debian/glibc) because the
# pnpm lockfile is generated on a glibc host. Alpine (musl) causes
# missing native rollup binaries. Final runtime images stay small.

# ── Stage 1: Dependencies (glibc build environment) ──────────
FROM node:22-slim AS deps
WORKDIR /app

RUN npm install -g pnpm@10

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY lib/db/package.json ./lib/db/
COPY lib/api-spec/package.json ./lib/api-spec/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/api-client-react/package.json ./lib/api-client-react/
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY artifacts/edms/package.json ./artifacts/edms/

RUN pnpm install --frozen-lockfile

# ── Stage 2: Build API ────────────────────────────────────────
FROM deps AS api-builder
WORKDIR /app

COPY tsconfig.base.json ./
COPY lib/ ./lib/
COPY artifacts/api-server/ ./artifacts/api-server/

WORKDIR /app/artifacts/api-server
RUN pnpm run build

# ── Stage 3: Build Frontend ───────────────────────────────────
FROM deps AS frontend-builder
WORKDIR /app

# Inject build identity — values come from deploy.sh --build-arg flags.
# Vite bakes VITE_* env vars into the bundle at build time.
# IMPORTANT: Any VITE_* var used in the app MUST be declared here as ARG + ENV,
# otherwise it will never be visible inside the container during `vite build`.
ARG BUILD_TIME=unknown
ARG GIT_HASH=unknown
ARG VITE_OWNER_NAME=ArcScale EDMS
ENV VITE_BUILD_TIME=$BUILD_TIME
ENV VITE_GIT_HASH=$GIT_HASH
ENV VITE_OWNER_NAME=$VITE_OWNER_NAME

COPY tsconfig.base.json ./
COPY lib/ ./lib/
COPY artifacts/edms/ ./artifacts/edms/

WORKDIR /app/artifacts/edms
RUN pnpm run build

# ── Stage 4: Production Frontend Image (nginx, small) ─────────
FROM nginx:alpine AS frontend
COPY --from=frontend-builder /app/artifacts/edms/dist/public /usr/share/nginx/html
# nginx.conf is mounted at runtime via docker-compose volume

# ── Stage 5: Production API Image (alpine, small) ─────────────
FROM node:22-alpine AS api
WORKDIR /app

RUN npm install -g pnpm@10

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY lib/db/package.json ./lib/db/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY artifacts/api-server/package.json ./artifacts/api-server/

RUN pnpm install --frozen-lockfile --prod

COPY --from=api-builder /app/artifacts/api-server/dist ./artifacts/api-server/dist
COPY --from=api-builder /app/lib/db/src ./lib/db/src
COPY lib/db/drizzle.config.ts ./lib/db/
COPY lib/db/src ./lib/db/src
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/api/health || exit 1

# The entrypoint runs drizzle-kit push (schema sync) then starts the API.
# This ensures any newly added columns are applied on every deploy.
CMD ["./docker-entrypoint.sh"]
