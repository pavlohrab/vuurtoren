# syntax=docker/dockerfile:1
# The server's front door: nginx with the Your devices page (deploy/devices), the sync place
# (/api, the api service) and the language server (/nlp/, the nlp service). The app itself is
# not served here: it runs on your devices. Build context: the repo root.
# Base images are pinned to a patch release; .github/dependabot.yml proposes updates.

# ---- Stage 1: the QR code library of the devices page ------------------------------------
FROM node:26.13.1-slim AS qr
RUN npm install --prefix /qr --no-save --no-fund --no-audit qrcode-generator@2.0.4

# ---- Stage 2: serve --------------------------------------------------------------------
FROM nginx:1.30.6-alpine
# The config is a template: the image's entrypoint renders it to conf.d/default.conf,
# substituting only VUURTOREN_* variables (see the top of deploy/nginx.conf.template).
ENV NGINX_ENVSUBST_FILTER=^VUURTOREN_ \
    VUURTOREN_NLP_AUTH=on
COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template

# Unprivileged nginx: no `user` directive, pid and temp files in /tmp, conf.d writable for the
# entrypoint. Port 80 still works without root: Docker (20.10+) sets
# net.ipv4.ip_unprivileged_port_start=0 inside containers.
# `nginx -t` checks the config rendered with the default variables, so a broken template fails
# the build instead of the container start.
RUN sed -i -e '/^user /d' -e 's,^pid .*;,pid /tmp/nginx.pid;,' /etc/nginx/nginx.conf \
    && printf '%s\n' \
        'client_body_temp_path /tmp/client_temp;' \
        'proxy_temp_path /tmp/proxy_temp;' \
        'fastcgi_temp_path /tmp/fastcgi_temp;' \
        'uwsgi_temp_path /tmp/uwsgi_temp;' \
        'scgi_temp_path /tmp/scgi_temp;' > /etc/nginx/conf.d/00-unprivileged.conf \
    && envsubst '${VUURTOREN_NLP_AUTH}' < /etc/nginx/templates/default.conf.template \
        > /etc/nginx/conf.d/default.conf \
    && nginx -t \
    && rm -rf /tmp/* \
    && chown -R nginx:nginx /etc/nginx/conf.d /var/cache/nginx
COPY deploy/devices/ /usr/share/nginx/html/
COPY --from=qr /qr/node_modules/qrcode-generator/dist/qrcode.js /usr/share/nginx/html/qrcode.js
USER nginx
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO /dev/null http://127.0.0.1/ || exit 1
