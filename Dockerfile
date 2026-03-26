# ============================================================
# EDMS - Multi-stage production Dockerfile
# ============================================================

# ── Stage 1: Dependencies ────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@10

# Copy workspace manifests
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY lib/db/package.json ./lib/db/
COPY lib/api-spec/package.json ./lib/api-spec/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/api-client-react/package.json ./lib/api-client-react/
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY artifacts/edms/package.json ./artifacts/edms/

# Install all dependencies
RUN pnpm install --frozen-lockfile

# ── Stage 2: Build API ───────────────────────────────────────
FROM deps AS api-builder
WORKDIR /app

# Copy all source
COPY lib/ ./lib/
COPY artifacts/api-server/ ./artifacts/api-server/

WORKDIR /app/artifacts/api-server
RUN pnpm run build

# ── Stage 3: Build Frontend ──────────────────────────────────
FROM deps AS frontend-builder
WORKDIR /app

COPY lib/ ./lib/
COPY artifacts/edms/ ./artifacts/edms/

WORKDIR /app/artifacts/edms
RUN pnpm run build

# ── Stage 4: Production API Image ────────────────────────────
FROM node:22-alpine AS api
WORKDIR /app

RUN npm install -g pnpm@10

# Copy workspace files for production install
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY lib/db/package.json ./lib/db/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY artifacts/api-server/package.json ./artifacts/api-server/

# Production-only install
RUN pnpm install --frozen-lockfile --prod

# Copy built artifacts
COPY --from=api-builder /app/artifacts/api-server/dist ./artifacts/api-server/dist
COPY --from=api-builder /app/lib/db/src ./lib/db/src

# Copy schema for drizzle
COPY lib/db/drizzle.config.ts ./lib/db/
COPY lib/db/src ./lib/db/src

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/api/health || exit 1

CMD ["node", "--enable-source-maps", "./artifacts/api-server/dist/index.mjs"]
