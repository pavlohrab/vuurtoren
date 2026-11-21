# Self-hosting Vuurtoren

A Vuurtoren server gives your devices sync and the language server. It signs you in, serves the
app, stores the locked sync files of your devices (`/api/sync`) and runs the Dutch language
server (`/nlp/`). It holds no readable data: every device, the app opened from the server
included, keeps its own copy and syncs through it.

## Quick start

You need Docker, and Anki desktop with the [AnkiConnect](https://ankiweb.net/shared/info/2055492159)
add-on (code `2055492159`) on the computer where you read.

```sh
docker compose -f deploy/compose.yml up -d
```

Open <http://localhost:8080>, follow the welcome steps and click **Connect to Anki**. Anki asks
once whether to allow the site: click **Yes**.

| Service  | Does                                                 | Port             |
| -------- | ---------------------------------------------------- | ---------------- |
| `web`    | the app and a proxy to the other services            | `127.0.0.1:8080` |
| `api`    | sign-in, sync tokens and the sync files              | internal         |
| `nlp`    | Dutch analysis, dictionary, OCR, translation         | internal         |
| `caddy`  | optional HTTPS (profile `https`)                     | 80, 443          |
| `backup` | optional copies of the sync files (profile `backup`) | —                |

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

| Variable                       | Default | Meaning                                                             |
| ------------------------------ | ------- | ------------------------------------------------------------------- |
| `VUURTOREN_TOKEN`              |         | bearer token for scripts (`scripts/doctor.sh`)                      |
| `VUURTOREN_COOKIE_SECURE`      | `1`     | `0` only for plain `http://` on a trusted LAN                       |
| `VUURTOREN_TRUST_CF`           | `0`     | `1` behind a Cloudflare Tunnel, so rate limits see the visitor's IP |
| `VUURTOREN_ALLOWED_ORIGINS`    |         | extra allowed origins, if a proxy rewrites the `Host` header        |
| `VUURTOREN_NLP_AUTH` (web)     | `on`    | `off` only when running without the `api` service (see below)       |
| `VUURTOREN_CORS_ORIGINS` (nlp) |         | pages on other sites that use the language server with a sync token |

**The language server stays behind the sign-in.** With `VUURTOREN_NLP_AUTH=on`, `/nlp/` answers
a signed-in browser or a device's sync token (`Authorization: Bearer ksync_…`), and nothing
else. Never set it to `off` on a server that the internet can reach: anyone could then use your
language server.

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

Every device keeps its own data and syncs through your server. The server stores locked files
in `sync/` on the `vuurtoren-data` volume; it cannot read them.

- **The app opened from the server:** sign in, then Settings → Sync → **This server**. The page
  makes its own sync token.
- **A phone:** in the server's Settings → Sync → **Add a phone**, show the QR code and scan it in
  the phone's Settings → Sync → **Connect to your server**. The code (`POST /api/sync/pair-code`,
  signed in) works once, for 10 minutes; the phone trades it at `POST /api/sync/pair` for a sync
  token of its own, labelled with its model. The pairing endpoint needs no sign-in (the code is
  the credential) and wrong codes are rate limited like sign-ins.
- **Other devices** (the desktop app, a phone's browser on another address): in the server's
  Settings → Sync make a **sync token** for each device, then on the device choose Settings →
  Sync → **Your Vuurtoren server** with the server's address and the token.

On the first device choose **Start new sync data here**; on every other one **Join my synced
data**, with the same passphrase. A device that syncs with the server also uses its language
server, unless it has its own (the desktop app does).

- A sync token opens `/api/sync` and the language server, nothing else, and belongs to one
  device: the first device folder it writes becomes its own, and it may write only there and
  the shared images. Give each device its own token (a device that starts over, for example
  after a restore, needs a new one).
- The token of the device that started the sync data may change its passphrase and recovery
  key. Others may too when made with **May change the passphrase and recovery key** ticked
  (`POST /api/auth/sync-tokens` with `{"vault": true}`).
- All sync files together may take `VUURTOREN_SYNC_QUOTA_MB` (default 2048 MB).
- With sign-in off, `/api/sync` answers only the server's own address and
  `VUURTOREN_ALLOWED_ORIGINS`: a page on another site cannot read or change your sync files. The
  desktop app is not a site and syncs either way.

## Backup and restore

- **On each device:** Settings → Data & backup → **Download backup** and **Restore from
  backup…**. A restore replaces all data on that device.
- **Sync files:** profile `backup` copies the locked sync files every 24 h into `./backups` next
  to the compose file and keeps 14 days (`VUURTOREN_BACKUP_INTERVAL_HOURS`,
  `VUURTOREN_BACKUP_KEEP_DAYS`), as `vuurtoren-sync-…tar.gz`. Copy the folder off the machine.
  To bring files back, stop the stack and unpack one into the `vuurtoren-data` volume (it holds
  a `sync/` folder).

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
| sync or language server not reached   | `docker compose ps` and `docker compose logs api nlp`       |
