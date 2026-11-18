# SlidesVault API — the Dropbox integration layer.
#
# Build from the repository root (the npm workspace), not from apps/api: the API depends on the
# workspace package @slidesvault/shared, which must come from packages/shared — never from the
# public registry. docker-compose.yml sets this context; by hand:
#
#   docker build -f apps/api/Dockerfile -t slidesvault-api .
#
# The image carries no credentials. Every secret (app key, app secret, token
# encryption key) arrives as an environment variable at run time, and the only
# durable state is the database and the derived-content cache, both of which
# live on a mounted volume. That is what makes a container restart, a rebuild
# or a redeploy a non-event for the Dropbox connection.

FROM node:24-alpine AS deps
WORKDIR /app
# The workspace manifests and the lockfile only, so this layer is cached until dependencies change.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# Exactly the locked versions of the API's production dependencies. No `npm install` fallback: a
# failed install must fail the build instead of resolving packages from the registry.
RUN npm ci --omit=dev --no-audit --no-fund --workspace @slidesvault/api --include-workspace-root=false

FROM node:24-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=4000 \
    DB_FILE=/data/slidesvault.db \
    OBJECT_STORE_DIR=/data/objects

# node_modules links @slidesvault/shared to packages/shared, so both keep their workspace paths.
COPY --from=deps /app /app
COPY packages/shared/src ./packages/shared/src
COPY apps/api/src ./apps/api/src
COPY apps/api/scripts ./apps/api/scripts

# The database and the preview cache must outlive the container.
RUN mkdir -p /data && chown -R node:node /data /app
VOLUME ["/data"]

# Never run as root: a compromised process should not be able to rewrite the
# application it is running.
USER node
WORKDIR /app/apps/api

EXPOSE 4000

# The liveness endpoint is unauthenticated and touches the database, so it
# fails when the process is up but its storage is not.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
