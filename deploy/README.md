# Self-hosting Kenning

## Quick start

You need Docker, and Anki desktop with the [AnkiConnect](https://ankiweb.net/shared/info/2055492159)
add-on (code `2055492159`) on the computer where you read.

```sh
docker compose -f deploy/compose.yml up -d
```

Open <http://localhost:8080>, follow the welcome steps and click **Connect to Anki**. Anki asks
once whether to allow the site: click **Yes**.

| Service  | Does                                          | Port             |
| -------- | --------------------------------------------- | ---------------- |
| `web`    | the app and a proxy to the other services     | `127.0.0.1:8080` |
| `api`    | your data (one SQLite file) and sign-in       | internal         |
| `nlp`    | Dutch analysis, dictionary, OCR, translation  | internal         |
| `caddy`  | optional HTTPS (profile `https`)              | 80, 443          |
| `backup` | optional scheduled backups (profile `backup`) | —                |

Settings go in `deploy/.env`. Change the port with `KENNING_WEB_PORT=9000`.

## HTTPS

Browsers only keep data and allow AnkiConnect on `https://` or `http://localhost`. To use
Kenning from other devices, pick one:

- **Caddy:** set `KENNING_DOMAIN=kenning.example.com` (or `KENNING_DOMAIN=kenning.lan` and
  `KENNING_TLS=internal` on a home network), then
  `docker compose -f deploy/compose.yml --profile https up -d`.
- **Tailscale:** `tailscale serve --bg 8080`.
- **Cloudflare Tunnel:** see [Dockge + Cloudflare Tunnel](#dockge--cloudflare-tunnel).

Each new address must click **Connect to Anki** once.

## Sign-in

Set a password before Kenning is reachable from anywhere but your own computer.

```sh
docker compose -f deploy/compose.yml run --rm -it api hash-password
```

Put the printed line in `deploy/.env` and restart:

```sh
KENNING_USER=anna
KENNING_PASSWORD_HASH=scrypt:65536:8:1:...
```

Settings → Account has **Sign out** and **Sign out all devices**. A new hash signs out every
device.

| Variable                  | Default | Meaning                                                             |
| ------------------------- | ------- | ------------------------------------------------------------------- |
| `KENNING_TOKEN`           |         | bearer token for scripts, backups and the stdio MCP server          |
| `KENNING_COOKIE_SECURE`   | `1`     | `0` only for plain `http://` on a trusted LAN                       |
| `KENNING_TRUST_CF`        | `0`     | `1` behind a Cloudflare Tunnel, so rate limits see the visitor's IP |
| `KENNING_ALLOWED_ORIGINS` |         | extra allowed origins, if a proxy rewrites the `Host` header        |
| `KENNING_NLP_AUTH` (web)  | `on`    | `off` only when running without the `api` service                   |

## Dockge + Cloudflare Tunnel

A public `https://` address with no open ports.

1. **Password hash:** `docker run --rm -it ghcr.io/pavlohrab/kenning-api:latest hash-password`.
2. **Stack:** in Dockge, **+ Compose**, name it `kenning`. Paste
   [`dockge/compose.yaml`](dockge/compose.yaml) into the compose editor and
   [`dockge/.env.example`](dockge/.env.example) into the `.env` editor, then set:

   ```sh
   KENNING_IMAGE_OWNER=pavlohrab
   KENNING_USER=anna
   KENNING_PASSWORD_HASH=scrypt:...
   KENNING_TRUST_CF=1
   KENNING_TOKEN=<openssl rand -hex 32>
   TUNNEL_TOKEN=<from step 3>
   COMPOSE_PROFILES=tunnel,backup
   ```

3. **Tunnel:** Cloudflare Zero Trust → Networks → Tunnels → **Create a tunnel**. Copy the token
   into `TUNNEL_TOKEN`. Add a public hostname pointing to service **HTTP**, URL **`web:80`**.
4. **Deploy.** After about a minute the services are healthy. Open your address and sign in.

Anki keeps working: your browser talks to AnkiConnect on your own computer, not the server.

## Updating

Dockge: **Update**. Plain compose: `docker compose -f deploy/compose.yml pull && docker compose -f deploy/compose.yml up -d`.

`KENNING_TAG` chooses what you follow: `latest` (default), a release such as `0.1.0`, or `edge`
(every commit).

## Language data

The dictionary, example sentences and translation model (about 100 MB) download on first start
and update by themselves. Kenning works meanwhile; Settings → Advanced → Server status shows the
progress.

| Setting                     | Effect                                              |
| --------------------------- | --------------------------------------------------- |
| `KENNING_NLP_VARIANT=-full` | data inside the image, nothing downloaded (offline) |
| `KENNING_NLP_VARIANT=-slim` | no OCR, smaller image                               |
| `KENNING_PACKS_URL=<url>`   | download the data from another host                 |

## Backup and restore

- **Scheduled:** profile `backup` saves a snapshot every 24 h into `./backups` next to the
  compose file and keeps 14 days (`KENNING_BACKUP_INTERVAL_HOURS`, `KENNING_BACKUP_KEEP_DAYS`).
  Needs `KENNING_TOKEN` when sign-in is on. Copy the folder off the machine.
- **In the app:** Settings → Your data → **Download backup** and **Restore from backup…**.
- **Shell:** `curl -H "Authorization: Bearer $KENNING_TOKEN" -o kenning.sqlite https://kenning.example.com/api/export`.

A restore replaces all data. Backups never contain sign-in sessions.

## Troubleshooting

Settings → Advanced → **Server status** checks everything; **Copy** it for a bug report. From a
shell: `scripts/doctor.sh https://kenning.example.com`.

| Symptom                               | Fix                                                       |
| ------------------------------------- | --------------------------------------------------------- |
| "Anki is not running"                 | open Anki, install add-on `2055492159`, restart Anki      |
| "This site is not allowed yet"        | click **Connect to Anki** and answer Yes in Anki          |
| data lost, Anki fails                 | you are on plain `http://` from another device: use HTTPS |
| signed out right after signing in     | plain `http://` with `KENNING_COOKIE_SECURE=1`: use HTTPS |
| "origin does not match"               | set `KENNING_ALLOWED_ORIGINS=https://your.address`        |
| "Too many attempts" behind Cloudflare | set `KENNING_TRUST_CF=1`                                  |
| "Can't reach your Kenning server"     | `docker compose ps` and `docker compose logs api`         |
