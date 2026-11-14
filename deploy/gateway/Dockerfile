# syntax=docker/dockerfile:1
#
# Apex gateway image: the gateway (apex/, Node built-ins only) plus the production bundles of the
# three web apps, served by `node apex/server.mjs prod` exactly as `start.bat prod` serves them.
#
# Build from the repository root (the gateway serves <project>/apps/web/dist by its repo path):
#
#   docker build -f deploy/gateway/Dockerfile -t apex-gateway .
#
# Each web bundle is built with the environment apex/projects.mjs gives `node apex/run.mjs <id> build`
# (its `webEnv`), so the bases are /showcase/, /vault/ and /academia/. Keep the ENV lines below in
# step with webEnv there. The image carries no secrets: the identity keys arrive as
# APEX_IDENTITY_KEYS_STORE at run time, and the session secret and revocation list are written to
# the /var/lib/apex volume on first start.

ARG NODE_IMAGE=node:22-bookworm-slim

# ------------------------------------------------------------- Innovation Showcase web --
FROM ${NODE_IMAGE} AS showcase-web
WORKDIR /src
COPY inspironics-innovation-showcase/package.json inspironics-innovation-showcase/package-lock.json ./
COPY inspironics-innovation-showcase/packages/shared/package.json packages/shared/
COPY inspironics-innovation-showcase/apps/api/package.json apps/api/
COPY inspironics-innovation-showcase/apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund --workspace @inspironics/web --include-workspace-root=false
COPY inspironics-innovation-showcase/packages/shared packages/shared
COPY inspironics-innovation-showcase/apps/web apps/web
# webEnv of 'showcase'. Its build script also runs the architecture lint, typecheck, tests and the
# bundle budget, as `start.bat prod` does.
ENV VITE_BACKEND=api \
    VITE_API_BASE_URL=/showcase
RUN npm run build -w @inspironics/web

# ------------------------------------------------------------------------ SlidesVault web --
FROM ${NODE_IMAGE} AS vault-web
WORKDIR /src
COPY ["slide vault/package.json", "slide vault/package-lock.json", "./"]
COPY ["slide vault/packages/shared/package.json", "packages/shared/"]
COPY ["slide vault/apps/api/package.json", "apps/api/"]
COPY ["slide vault/apps/web/package.json", "apps/web/"]
RUN npm ci --no-audit --no-fund --workspace @slidesvault/web --include-workspace-root=false
COPY ["slide vault/packages/shared", "packages/shared"]
COPY ["slide vault/apps/web", "apps/web"]
# webEnv of 'vault' (its vite.config.js fixes base to /vault/).
ENV VITE_API_BASE_URL=/vault
RUN npm run build -w @slidesvault/web

# ---------------------------------------------------------------- Inspironics Academia web --
FROM ${NODE_IMAGE} AS academia-web
WORKDIR /src
COPY ["Inspironics Academia/package.json", "Inspironics Academia/package-lock.json", "./"]
COPY ["Inspironics Academia/packages/shared/package.json", "packages/shared/"]
COPY ["Inspironics Academia/apps/api/package.json", "apps/api/"]
COPY ["Inspironics Academia/apps/web/package.json", "apps/web/"]
RUN npm ci --no-audit --no-fund --workspace @academy/web --include-workspace-root=false
COPY ["Inspironics Academia/packages/shared", "packages/shared"]
COPY ["Inspironics Academia/apps/web", "apps/web"]
# webEnv of 'academia'. APEX_DEV_PORT / APEX_GATEWAY_PORT only matter to the dev server; set as
# run.mjs sets them for the prod port so the build sees the same environment.
ENV VITE_API_BASE_URL=/academia \
    APEX_BASE=/academia/ \
    APEX_DEV_PORT=5176 \
    APEX_GATEWAY_PORT=4173
RUN npm run build -w @academy/web

# -------------------------------------------------------------------------------- runtime --
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    APEX_HOST=0.0.0.0 \
    APEX_PORT=4173 \
    APEX_SESSION_SECRET_FILE=/var/lib/apex/session-secret \
    APEX_REVOKED_FILE=/var/lib/apex/revoked-sessions \
    APEX_IDENTITY_KEYS_FILE=/var/lib/apex/identity-keys.json
WORKDIR /app

# The gateway itself: no dependencies to install. Owned by root, so the process cannot rewrite it.
COPY apex/package.json apex/*.mjs apex/
COPY apex/public apex/public
COPY --from=showcase-web /src/apps/web/dist inspironics-innovation-showcase/apps/web/dist
COPY --from=vault-web ["/src/apps/web/dist", "slide vault/apps/web/dist"]
COPY --from=academia-web ["/src/apps/web/dist", "Inspironics Academia/apps/web/dist"]

# Session secret and revocation list must outlive the container (a restart must not sign everyone
# in again, nor un-revoke a signed-out session).
RUN mkdir -p /var/lib/apex && chown node:node /var/lib/apex && chmod 700 /var/lib/apex
VOLUME ["/var/lib/apex"]

USER node
EXPOSE 4173

# /auth/config is public and answered by the gateway itself.
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.APEX_PORT||4173)+'/auth/config').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apex/server.mjs", "prod"]
