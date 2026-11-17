# syntax=docker/dockerfile:1
# Kenning API: user data in ONE SQLite file on a volume. Build context: the repo root
# (see deploy/compose.yml), because @app/api depends on the workspace packages.

# ---- Stage 1: build and prune ----------------------------------------------------------
FROM node:26-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @app/api... build
# Self-contained copy of the service with its production dependencies (workspace packages
# are copied with their built dist/).
RUN pnpm --filter @app/api deploy --prod /out

# ---- Stage 2: runtime ------------------------------------------------------------------
FROM node:26-slim
ENV NODE_ENV=production \
    KENNING_DB=/data/kenning.sqlite \
    KENNING_AUTH_DB=/data/auth.sqlite \
    KENNING_HOST=0.0.0.0 \
    KENNING_PORT=8787
WORKDIR /app
COPY --from=build /out /app
# /data is the volume; the node user owns it.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# ENTRYPOINT (not CMD) so commands can be appended:
#   docker compose run --rm -it api hash-password
ENTRYPOINT ["node", "dist/main.js"]
