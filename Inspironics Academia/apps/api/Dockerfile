# syntax=docker/dockerfile:1
#
# APEX Core (Inspironics Academia API) image.
#
# Build from the Academia workspace root, like SlidesVault's API image: the API depends on the
# workspace package @academy/shared, which must come from packages/shared, never the registry.
#
#   docker build -f apps/api/Dockerfile -t apex-core "Inspironics Academia"
#
# Debian slim rather than Alpine: @resvg/resvg-js ships glibc binaries and ffmpeg-static downloads a
# static linux build at install time (checked below, as the runtime user). No secrets in the image:
# DATABASE_URL, identity keys and the bootstrap admin arrive as environment variables at run time.
# Durable state: /data (DATA_DIR: media store, SQLite when DATABASE_URL is unset). Scratch space for
# renders and voice conversion: /work (TEMP_PROCESSING_DIR). Both are volumes.

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# Exactly the locked production dependencies of the API (optional `pg` included). No fallback.
RUN npm ci --omit=dev --no-audit --no-fund --workspace @academy/api --include-workspace-root=false

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=4177 \
    DATA_DIR=/data \
    TEMP_PROCESSING_DIR=/work
WORKDIR /app
COPY --from=deps /app /app
COPY packages/shared/src packages/shared/src
COPY apps/api/src apps/api/src

RUN mkdir -p /data /work && chown -R node:node /data /work

USER node
WORKDIR /app/apps/api

# The bundled FFmpeg must run on this platform, as this user — fail the build otherwise.
RUN node -e "const f=require('ffmpeg-static');const o=require('child_process').execFileSync(f,['-version']).toString();if(!/^ffmpeg version/.test(o))process.exit(1);console.log(o.split('\n')[0])"

VOLUME ["/data", "/work"]
EXPOSE 4177

HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4177)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
