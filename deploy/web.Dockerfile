# syntax=docker/dockerfile:1
# Kenning web app: static Vite build served by nginx. Build context: the repo root
# (see deploy/compose.yml), because @app/web depends on the other workspace packages.

# ---- Stage 1: build --------------------------------------------------------------------
FROM node:26-slim AS build
# The exact pnpm version comes from the "packageManager" field in package.json.
RUN corepack enable
WORKDIR /repo

# Whole monorepo (minus .dockerignore entries): workspace packages come and go, so listing
# individual manifests for layer caching would silently break `--frozen-lockfile`.
COPY . .
RUN pnpm install --frozen-lockfile
# Optional: bake the NLP service URL into the bundle (default: same-origin /nlp/ proxy).
ARG VITE_NLP_URL=/nlp
ENV VITE_NLP_URL=$VITE_NLP_URL
RUN pnpm --filter @app/web... build

# ---- Stage 2: serve --------------------------------------------------------------------
FROM nginx:1.27-alpine
# The config is a template: the image's entrypoint renders it to conf.d/default.conf,
# substituting only KENNING_* variables (see the top of deploy/nginx.conf.template).
ENV NGINX_ENVSUBST_FILTER=^KENNING_ \
    KENNING_NLP_AUTH=on
COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO /dev/null http://127.0.0.1/ || exit 1
