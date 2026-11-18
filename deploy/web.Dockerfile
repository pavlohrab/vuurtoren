# syntax=docker/dockerfile:1
# Kenning web app: static Vite build served by nginx. Build context: the repo root
# (see deploy/compose.yml), because @app/web depends on the other workspace packages.
# Base images are pinned to a patch release; .github/dependabot.yml proposes updates.

# ---- Stage 1: build --------------------------------------------------------------------
FROM node:26.13.1-slim AS build
# The exact pnpm version comes from the "packageManager" field in package.json.
# Node 25+ no longer bundles corepack; install the pnpm version pinned in package.json.
RUN npm install -g pnpm@12.21.0 --no-fund --no-audit
WORKDIR /repo

# Layer caching: `pnpm fetch` needs only the lockfile, so the dependency download stays cached
# until pnpm-lock.yaml changes; a source edit only re-runs the offline install and the build.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY . .
RUN pnpm install --frozen-lockfile --offline
# Optional: bake the NLP service URL into the bundle (default: same-origin /nlp/ proxy).
ARG VITE_NLP_URL=/nlp
ENV VITE_NLP_URL=$VITE_NLP_URL
# Shown next to the version in Settings > Advanced (CI passes the commit SHA).
ARG KENNING_COMMIT=
ENV KENNING_COMMIT=$KENNING_COMMIT
RUN pnpm --filter @app/web... build

# ---- Stage 2: serve --------------------------------------------------------------------
FROM nginx:1.30.6-alpine
# The config is a template: the image's entrypoint renders it to conf.d/default.conf,
# substituting only KENNING_* variables (see the top of deploy/nginx.conf.template).
ENV NGINX_ENVSUBST_FILTER=^KENNING_ \
    KENNING_NLP_AUTH=on
COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template

# Unprivileged nginx: no `user` directive, pid and temp files in /tmp, conf.d writable for the
# entrypoint. Port 80 still works without root: Docker (20.10+) sets
# net.ipv4.ip_unprivileged_port_start=0 inside containers.
# `nginx -t` checks the config rendered with the default variables, so a broken template fails
# the build instead of the container start.
RUN sed -i -e '/^user /d' -e 's,/var/run/nginx.pid,/tmp/nginx.pid,' /etc/nginx/nginx.conf \
    && printf '%s\n' \
        'client_body_temp_path /tmp/client_temp;' \
        'proxy_temp_path /tmp/proxy_temp;' \
        'fastcgi_temp_path /tmp/fastcgi_temp;' \
        'uwsgi_temp_path /tmp/uwsgi_temp;' \
        'scgi_temp_path /tmp/scgi_temp;' > /etc/nginx/conf.d/00-unprivileged.conf \
    && envsubst '${KENNING_NLP_AUTH}' < /etc/nginx/templates/default.conf.template \
        > /etc/nginx/conf.d/default.conf \
    && nginx -t \
    && rm -rf /tmp/* \
    && chown -R nginx:nginx /etc/nginx/conf.d /var/cache/nginx
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
USER nginx
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO /dev/null http://127.0.0.1/ || exit 1
