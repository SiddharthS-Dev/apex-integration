# SlidesVault API — the Dropbox integration layer.
#
# The image carries no credentials. Every secret (app key, app secret, token
# encryption key) arrives as an environment variable at run time, and the only
# durable state is the database and the derived-content cache, both of which
# live on a mounted volume. That is what makes a container restart, a rebuild
# or a redeploy a non-event for the Dropbox connection.

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# --omit=dev keeps the test tooling out; optional deps (pg, pdfjs) may fail to
# resolve on a given platform without failing the build.
RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund

FROM node:24-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=4000 \
    DB_FILE=/data/slidesvault.db \
    OBJECT_STORE_DIR=/data/objects

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY scripts ./scripts

# The database and the preview cache must outlive the container.
RUN mkdir -p /data && chown -R node:node /data /app
VOLUME ["/data"]

# Never run as root: a compromised process should not be able to rewrite the
# application it is running.
USER node

EXPOSE 4000

# The liveness endpoint is unauthenticated and touches the database, so it
# fails when the process is up but its storage is not.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
