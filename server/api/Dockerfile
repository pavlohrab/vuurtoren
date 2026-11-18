# syntax=docker/dockerfile:1
# Kenning API: user data in ONE SQLite file on a volume. Build context: the repo root
# (see deploy/compose.yml), because @app/api depends on the workspace packages.
# Base images are pinned to a patch release; .github/dependabot.yml proposes updates.

# ---- Stage 1: build and prune ----------------------------------------------------------
FROM node:26.13.1-slim AS build
# Node 25+ no longer bundles corepack; install the pnpm version pinned in package.json.
RUN npm install -g pnpm@12.21.0 --no-fund --no-audit
WORKDIR /repo
# Dependency download cached until pnpm-lock.yaml changes (see deploy/web.Dockerfile).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY . .
RUN pnpm install --frozen-lockfile --offline
RUN pnpm --filter @app/api... build
# Self-contained copy of the service with its production dependencies (workspace packages
# are copied with their built dist/).
RUN pnpm --filter @app/api deploy --prod /out

# ---- Stage 2: runtime ------------------------------------------------------------------
# Alpine is enough: SQLite is WebAssembly (@sqlite.org/sqlite-wasm), there are no native modules.
FROM node:26.13.1-alpine
ENV NODE_ENV=production \
    KENNING_DB=/data/kenning.sqlite \
    KENNING_AUTH_DB=/data/auth.sqlite \
    KENNING_HOST=0.0.0.0 \
    KENNING_PORT=8787
WORKDIR /app
# Only what runs: the build output, production node_modules and the manifest (type: module).
COPY --from=build /out/package.json /app/package.json
COPY --from=build /out/node_modules /app/node_modules
COPY --from=build /out/dist /app/dist
# /data is the volume; the node user owns it.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# ENTRYPOINT (not CMD) so commands can be appended:
#   docker compose run --rm -it api hash-password
ENTRYPOINT ["node", "dist/main.js"]
