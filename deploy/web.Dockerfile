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
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
