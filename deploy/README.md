# Self-hosting Vuurtoren

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

Settings go in `deploy/.env`. Change the port with `VUURTOREN_WEB_PORT=9000`.

## HTTPS

Browsers only keep data and allow AnkiConnect on `https://` or `http://localhost`. To use
Vuurtoren from other devices, pick one:

- **Caddy:** set `VUURTOREN_DOMAIN=vuurtoren.example.com` (or `VUURTOREN_DOMAIN=vuurtoren.lan` and
  `VUURTOREN_TLS=internal` on a home network), then
  `docker compose -f deploy/compose.yml --profile https up -d`.
- **Tailscale:** `tailscale serve --bg 8080`.
- **Cloudflare Tunnel:** see [Dockge + Cloudflare Tunnel](#dockge--cloudflare-tunnel).

Each new address must click **Connect to Anki** once.

## Sign-in

Set a password before Vuurtoren is reachable from anywhere but your own computer.

```sh
docker compose -f deploy/compose.yml run --rm -it api hash-password
```

Put the printed line in `deploy/.env` and restart:

```sh
VUURTOREN_USER=anna
VUURTOREN_PASSWORD_HASH=scrypt:65536:8:1:...
```

Settings → Account has **Sign out** and **Sign out all devices**. A new hash signs out every
device.

| Variable                    | Default | Meaning                                                             |
| --------------------------- | ------- | ------------------------------------------------------------------- |
| `VUURTOREN_TOKEN`           |         | bearer token for scripts, backups and the stdio MCP server          |
| `VUURTOREN_COOKIE_SECURE`   | `1`     | `0` only for plain `http://` on a trusted LAN                       |
| `VUURTOREN_TRUST_CF`        | `0`     | `1` behind a Cloudflare Tunnel, so rate limits see the visitor's IP |
| `VUURTOREN_ALLOWED_ORIGINS` |         | extra allowed origins, if a proxy rewrites the `Host` header        |
| `VUURTOREN_NLP_AUTH` (web)  | `on`    | `off` only when running without the `api` service                   |

## Dockge + Cloudflare Tunnel

A public `https://` address with no open ports.

1. **Password hash:** `docker run --rm -it ghcr.io/pavlohrab/vuurtoren-api:latest hash-password`.
2. **Stack:** in Dockge, **+ Compose**, name it `vuurtoren`. Paste
   [`dockge/compose.yaml`](dockge/compose.yaml) into the compose editor and
   [`dockge/.env.example`](dockge/.env.example) into the `.env` editor, then set:

   ```sh
   VUURTOREN_IMAGE_OWNER=pavlohrab
   VUURTOREN_USER=anna
   VUURTOREN_PASSWORD_HASH=scrypt:...
   VUURTOREN_TRUST_CF=1
   VUURTOREN_TOKEN=<openssl rand -hex 32>
   TUNNEL_TOKEN=<from step 3>
   COMPOSE_PROFILES=tunnel,backup
   ```

3. **Tunnel:** Cloudflare Zero Trust → Networks → Tunnels → **Create a tunnel**. Copy the token
   into `TUNNEL_TOKEN`. Add a public hostname pointing to service **HTTP**, URL **`web:80`**.
4. **Deploy.** After about a minute the services are healthy. Open your address and sign in.

Anki keeps working: your browser talks to AnkiConnect on your own computer, not the server.

## Updating

Dockge: **Update**. Plain compose: `docker compose -f deploy/compose.yml pull && docker compose -f deploy/compose.yml up -d`.

`VUURTOREN_TAG` chooses what you follow: `latest` (default), a release such as `0.1.0`, or `edge`
(every commit).

## Language data

The dictionary, example sentences and translation model (about 100 MB) download on first start
and update by themselves. Vuurtoren works meanwhile; Settings → Advanced → Server status shows the
progress.

| Setting                       | Effect                                              |
| ----------------------------- | --------------------------------------------------- |
| `VUURTOREN_NLP_VARIANT=-full` | data inside the image, nothing downloaded (offline) |
| `VUURTOREN_NLP_VARIANT=-slim` | no OCR, smaller image                               |
| `VUURTOREN_PACKS_URL=<url>`   | download the data from another host                 |

## Sync for your devices

The desktop app (and later phones) keep their own data and sync through your server: in the
server's Settings → Sync make a **sync token** for each device, then on the device choose
Settings → Sync → **Your Vuurtoren server** with the server's address, the token and a passphrase.
On the first device choose **Start new sync data here**; on every other one **Join my synced
data**, with the same passphrase. The server stores sealed files in `sync/` next to the
database; it cannot read them.

- A sync token opens `/api/sync` and nothing else, and belongs to one device: the first device
  folder it writes becomes its own, and it may write only there and the shared images. Give
  each device its own token (a device that starts over, for example after a restore, needs a
  new one).
- The token of the device that started the sync data may change its passphrase and recovery
  key; other tokens may not. A token made with `{"vault": true}` (`POST /api/auth/sync-tokens`)
  may too.
- All sync files together may take `VUURTOREN_SYNC_QUOTA_MB` (default 2048 MB).
- With sign-in off, `/api/sync` answers only the server's own address and
  `VUURTOREN_ALLOWED_ORIGINS`: a page on another site cannot read or change your sync files. The
  desktop app is not a site and syncs either way.

## Backup and restore

- **Scheduled:** profile `backup` saves a snapshot every 24 h into `./backups` next to the
  compose file and keeps 14 days (`VUURTOREN_BACKUP_INTERVAL_HOURS`, `VUURTOREN_BACKUP_KEEP_DAYS`).
  Needs `VUURTOREN_TOKEN` when sign-in is on. Copy the folder off the machine. The sync files of
  your devices go there too, as `vuurtoren-sync-…tar.gz`: to bring them back, stop the stack and
  unpack one into the `vuurtoren-data` volume (it holds a `sync/` folder).
- **In the app:** Settings → Your data → **Download backup** and **Restore from backup…**.
- **Shell:** `curl -H "Authorization: Bearer $VUURTOREN_TOKEN" -o vuurtoren.sqlite https://vuurtoren.example.com/api/export`.

A restore replaces all data. Backups never contain sign-in sessions.

## Troubleshooting

Settings → Advanced → **Server status** checks everything; **Copy** it for a bug report. From a
shell: `scripts/doctor.sh https://vuurtoren.example.com`.

| Symptom                               | Fix                                                         |
| ------------------------------------- | ----------------------------------------------------------- |
| "Anki is not running"                 | open Anki, install add-on `2055492159`, restart Anki        |
| "This site is not allowed yet"        | click **Connect to Anki** and answer Yes in Anki            |
| data lost, Anki fails                 | you are on plain `http://` from another device: use HTTPS   |
| signed out right after signing in     | plain `http://` with `VUURTOREN_COOKIE_SECURE=1`: use HTTPS |
| "origin does not match"               | set `VUURTOREN_ALLOWED_ORIGINS=https://your.address`        |
| "Too many attempts" behind Cloudflare | set `VUURTOREN_TRUST_CF=1`                                  |
| "Can't reach your Vuurtoren server"   | `docker compose ps` and `docker compose logs api`           |
