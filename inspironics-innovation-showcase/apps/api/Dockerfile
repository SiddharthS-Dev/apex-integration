# syntax=docker/dockerfile:1
#
# Innovation Showcase API image.
#
# Build from the Showcase workspace root, like SlidesVault's API image: the API depends on the
# workspace package @inspironics/shared, which must come from packages/shared, never the registry.
#
#   docker build -f apps/api/Dockerfile -t showcase-api inspironics-innovation-showcase
#
# API only: behind Apex the gateway serves the web bundle (SERVE_WEB=false). No secrets in the
# image: ENCRYPTION_KEY, DATABASE_URL and the identity keys arrive as environment variables.
# Durable state lives on /data (object cache; SQLite when DATABASE_URL is unset).

ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# Exactly the locked production dependencies of the API (optional `pg` included). No fallback.
RUN npm ci --omit=dev --no-audit --no-fund --workspace @inspironics/api --include-workspace-root=false

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=4176 \
    SERVE_WEB=false \
    SQLITE_PATH=/data/app.db \
    OBJECT_STORE_DIR=/data/objects
WORKDIR /app
COPY --from=deps /app /app
COPY packages/shared/src packages/shared/src
COPY apps/api/src apps/api/src
COPY apps/api/scripts apps/api/scripts
# The seed corpus sync uses to title known plates (SEED_PATH default, relative to apps/api).
COPY apps/web/public/data/showcase.json apps/web/public/data/showcase.json

RUN mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]

USER node
WORKDIR /app/apps/api
EXPOSE 4176

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4176)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
