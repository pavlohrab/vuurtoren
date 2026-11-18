# Running Kenning on your own computer

Kenning is a Dutch reading and vocabulary app. Everything runs on your machine; nothing is sent
to a third party.

**Using Dockge?** The five-step [quick card](dockge/README.md) is all you need; this page has the
details.

## Quick start (3 steps)

1. **Install Docker** (Docker Desktop on Windows/macOS, or Docker Engine on Linux).
2. **Start Kenning.** In a terminal, from this repository:

   ```sh
   docker compose -f deploy/compose.yml up -d
   ```

   This downloads the ready-made images. To build them yourself instead, add `--build`
   (the first build downloads about 300 MB of dictionary data and takes several minutes).

3. **Open <http://localhost:8080>**, go to Settings, Anki, and click **Connect to Anki**.
   Anki must be open with the [AnkiConnect](https://ankiweb.net/shared/info/2055492159) add-on
   installed (code `2055492159`). Anki asks whether to allow this site: click **Yes**.

## What runs

| Service  | What it does                                                          | Port                  |
| -------- | --------------------------------------------------------------------- | --------------------- |
| `web`    | The app (static files) and a same-origin proxy to the language server | `127.0.0.1:8080`      |
| `nlp`    | Dutch analysis, dictionary, example sentences, OCR, translation       | none (only via `web`) |
| `api`    | Your data (one SQLite file) and sign-in                               | none (only via `web`) |
| `caddy`  | Optional HTTPS front (profile `https`)                                | 80 and 443            |
| `backup` | Optional scheduled backups (profile `backup`), see below              | none                  |

Change the web port with `KENNING_WEB_PORT=9000` in `deploy/.env`.

## Why HTTPS matters

Browsers only give a page persistent storage, encryption APIs and permission to talk to local
programs such as AnkiConnect in a _secure context_: `https://...` or `http://localhost`. That is
why the app listens on localhost only by default. If you open it from another device over plain
`http://192.168.x.x:8080`, your data may be erased by the browser and Anki will not connect.

### Option A: Caddy (LAN or public server)

Create `deploy/.env`:

```sh
# Public server with a real domain pointing at it (certificate is automatic):
KENNING_DOMAIN=kenning.example.com
# Or on a home network (local certificate authority; trust it once on each device):
# KENNING_DOMAIN=kenning.lan
# KENNING_TLS=internal
```

Then:

```sh
docker compose -f deploy/compose.yml --profile https up -d
```

On a LAN, make the name resolve (router DNS or each device's hosts file). When you use another
origin, click **Connect to Anki** again from that address: Anki allows each origin separately.

### Option B: Tailscale (no configuration)

With [Tailscale](https://tailscale.com) installed on this machine and your other devices:

```sh
tailscale serve --bg 8080
```

Tailscale prints an `https://<machine>.<tailnet>.ts.net` address with a valid certificate that
works on every device in your tailnet.

### Option C: Cloudflare Tunnel (public address, no open ports)

See [Dockge and Cloudflare Tunnel](#dockge-and-cloudflare-tunnel) below. Turn on sign-in first.

## Sign-in

Anyone who can open the app can read and change all of your data, so **set a password before
the app is reachable from anywhere but your own computer** (a LAN, a VPS, a tunnel). There is
one user; sign-in is off when neither a password nor a token is set (fine on `localhost`), and
the `api` log says so at startup.

1. Create a password hash (you type the password twice; nothing is echoed or stored):

   ```sh
   docker compose -f deploy/compose.yml run --rm -it api hash-password
   # or without a checkout:  docker run --rm -it ghcr.io/<owner>/kenning-api:latest hash-password
   ```

   It prints one line such as `scrypt:65536:8:1:AbC...:XyZ...`. It contains no `$`, so it can be
   pasted into `.env` as it is.

2. Put it in `deploy/.env` (or Dockge's `.env`) and restart (`up -d`):

   ```sh
   KENNING_USER=anna
   KENNING_PASSWORD_HASH=scrypt:65536:8:1:AbC...:XyZ...
   ```

The app then opens on a sign-in screen. A session lasts 30 days from the last use (at most 180
days), in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie. **Settings > Account** shows who is
signed in and has **Sign out** and **Sign out all devices**. Changing the password signs out
every device.

| Variable                  | Default             | Meaning                                                                                                                                             |
| ------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `KENNING_USER`            |                     | Username on the sign-in screen.                                                                                                                     |
| `KENNING_PASSWORD_HASH`   |                     | scrypt hash from `hash-password`.                                                                                                                   |
| `KENNING_PASSWORD`        |                     | Plain password instead of the hash. Works, logs a warning; prefer the hash.                                                                         |
| `KENNING_TOKEN`           |                     | Optional bearer token for scripts and the MCP server (`Authorization: Bearer ...`). Generate with `openssl rand -hex 32`.                           |
| `KENNING_COOKIE_SECURE`   | `1`                 | Set `0` only if you open the app over plain `http://` from another device (LAN). `http://localhost` works with `1` in Chrome and Firefox.           |
| `KENNING_TRUST_CF`        | `0`                 | `1` behind a Cloudflare Tunnel: the sign-in rate limit uses the visitor's IP from `CF-Connecting-IP`. Keep `0` otherwise (the header is forgeable). |
| `KENNING_ALLOWED_ORIGINS` |                     | Extra origins allowed to change data, comma-separated. Only needed if a proxy in front rewrites the `Host` header.                                  |
| `KENNING_AUTH_DB`         | `/data/auth.sqlite` | Session database (and Claude Code MCP token hashes), separate from your data: backups never contain or replace it.                                  |
| `KENNING_NLP_URL` (api)   | `http://nlp:8000`   | Language server the api uses for the Claude Code endpoint (`/api/mcp`: coverage checks, analysing saved stories). See docs/ai.md.                   |
| `KENNING_NLP_AUTH` (web)  | `on`                | The web container lets `/nlp/` through only for signed-in requests. Set `off` only when you run **without** the `api` service.                      |

Protection in short: wrong attempts from one address wait 1 s, 2 s, 4 s, ... (up to 15 minutes)
after three free tries, and at most 100 failures per 15 minutes are accepted from everyone
together. Requests that change data must come from the app itself (same origin, JSON or an
`X-Kenning: 1` header), which stops cross-site forgery. nginx sends a strict Content Security
Policy and refuses to be framed. Forgot the password? Make a new hash and restart.

## Dockge and Cloudflare Tunnel

[Dockge](https://github.com/louislam/dockge) runs compose stacks from a web UI. Kenning has a
self-contained stack for it, `deploy/dockge/compose.yaml`: published images only, no build, no
files next to it. A [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
gives it a public `https://` address without opening a port on your router.

1. **Images.** The stack pulls `ghcr.io/<owner>/kenning-web`, `-nlp` and `-api`, published by
   `.github/workflows/images.yml` (amd64 and arm64): `edge` and `sha-<commit>` on every push to
   `main`, `X.Y.Z`, `X.Y` and `latest` when a `v*` tag is pushed. If the packages are private, log the Docker host in once:
   `docker login ghcr.io -u <github-user>` with a token that has `read:packages`. (Or make the
   packages public in GitHub, Packages, Package settings.)
2. **Password hash.** On the Docker host: `docker run --rm -it ghcr.io/<owner>/kenning-api:latest hash-password`.
3. **Stack.** In Dockge, **+ Compose**, name it `kenning`, paste `deploy/dockge/compose.yaml`
   into the compose editor and `deploy/dockge/.env.example` into the `.env` editor. Fill in:

   ```sh
   KENNING_IMAGE_OWNER=<github-user-or-org>
   KENNING_USER=anna
   KENNING_PASSWORD_HASH=scrypt:65536:8:1:...
   KENNING_TRUST_CF=1
   TUNNEL_TOKEN=<token from step 4>
   COMPOSE_PROFILES=tunnel
   ```

4. **Tunnel.** In the Cloudflare dashboard: Zero Trust, Networks, Tunnels, **Create a tunnel**
   (Cloudflared). Copy the token from the shown install command (the long string after
   `--token`) into `TUNNEL_TOKEN`. Under **Public hostname** add e.g. `kenning.example.com`
   with service **HTTP** and URL **`web:80`** (that is, `http://web:80`: the tunnel container
   reaches the web container by its service name on the stack's network).
5. **Deploy** in Dockge, wait until `api`, `nlp` and `web` show healthy (the language server
   needs up to a minute), and open `https://kenning.example.com`. You see the sign-in screen.

Notes:

- `KENNING_TRUST_CF=1` matters: behind the tunnel every request comes from the `cloudflared`
  container, so without it all visitors would share one rate-limit bucket. Set it only when the
  app is reached through Cloudflare.
- The web port is published on `127.0.0.1:8080` only (`KENNING_BIND`, `KENNING_WEB_PORT`). The
  tunnel does not need it; it is there for a quick look from the host.
- **Anki keeps working.** AnkiConnect runs on your own computer and the app talks to it from
  your browser, not from the server. Allow the new address once: in the app, Settings, Anki,
  **Connect to Anki** and click **Yes** in Anki, or in Anki, Tools, Add-ons, AnkiConnect,
  Config, add `"https://kenning.example.com"` to `webCorsOriginList` and restart Anki. Chrome
  may also ask whether the site may access devices on your local network: allow it.
- **Optional extra layer: Cloudflare Access.** Zero Trust, Access, Applications, add a
  self-hosted application for `kenning.example.com` with a policy such as "emails ending in
  ...". Visitors then prove their identity to Cloudflare before they even reach the Kenning
  sign-in. Keep the Kenning password anyway. Scripts and the MCP server then also need an
  Access service token (`CF-Access-Client-Id` / `CF-Access-Client-Secret` headers).
- Your data is the `kenning-data` volume (`kenning.sqlite` plus `auth.sqlite` for sessions).
  Back it up as described below.
- Updates: in Dockge, **Update** (pulls the images). `KENNING_TAG` picks what you follow:
  `latest` (newest release, the default), a release such as `0.1.0` (pinned), or `edge` (every
  commit on `main`, for testing).

## Checking an installation

- **In the app:** Settings > Advanced > **Server status**. One row per check, each with a dot:
  app version and commit, where your data lives (and its size), the server database's state,
  whether sign-in is on, the language server's version and whether its dictionary, example
  sentences, translation model and grammar examples are present, whether _this browser_ reaches
  Anki, and whether the page is a secure context. **Copy** puts it on the clipboard for a bug
  report.
- **From a shell:** `scripts/doctor.sh [address]` (default `http://127.0.0.1:8080`) checks the
  page, security headers, `/api/health`, that data is refused without a sign-in, signs in, and
  checks `/api/info` and `/nlp/health`. With sign-in on, set `KENNING_TOKEN`, or `KENNING_USER`
  and `KENNING_PASSWORD`. It needs only `curl`; exit code 0 means all good. CI runs it against
  freshly built images on every pull request.

## Images

| Image         | Base                              | Runs as                     | Health check      |
| ------------- | --------------------------------- | --------------------------- | ----------------- |
| `kenning-web` | `nginx` (Alpine), static files    | `nginx` (port 80, see note) | `GET /`           |
| `kenning-api` | `node` (Alpine), build output     | `node`                      | `GET /api/health` |
| `kenning-nlp` | `python` (slim) + Tesseract, data | `kenning` (uid 10001)       | `GET /health`     |

Base images are pinned to a patch release and updated by Dependabot. The NLP image is the big
one: it contains the dictionary, the example-sentence database, the translation model and the
spaCy pipeline so it works offline; CI prints the current sizes in its job summary (_images +
smoke test_). Note: the web container binds port 80 without root, which needs Docker 20.10 or
newer (it allows unprivileged ports inside containers by default).

## Updating

```sh
git pull
docker compose -f deploy/compose.yml pull     # or: up -d --build
docker compose -f deploy/compose.yml up -d
```

Dictionary data is pinned to a known snapshot so builds are reproducible. If the upstream sources
have moved on, a self-build stops with a message; see `server/nlp/Dockerfile` for the
`KAIKKI_ACCEPT_NEW` and `TATOEBA_ACCEPT_NEW` build-args.

## Troubleshooting

| Symptom                                                       | Cause and fix                                                                                                                                                                                       |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Anki is not running" in Settings                             | Anki is closed or AnkiConnect is not installed. Open Anki, install add-on `2055492159`, restart Anki.                                                                                               |
| "This site is not allowed yet"                                | Anki is running but does not know this address. Click **Connect to Anki** and answer Yes. Or in Anki: Tools, Add-ons, AnkiConnect, Config, add the shown line to `webCorsOriginList`, restart Anki. |
| "Needs an API key"                                            | You set a key in AnkiConnect. Enter it in the key field in Settings.                                                                                                                                |
| Storage not persistent / data lost, Anki fails                | You are on plain `http://` with a non-localhost address. Use `http://localhost:8080` or the HTTPS profile.                                                                                          |
| First word or text is slow                                    | The language server loads its models on the first request (up to a minute). Later requests are fast.                                                                                                |
| Sign-in screen says "Request refused (origin does not match)" | A proxy in front changes the `Host` header. Set `KENNING_ALLOWED_ORIGINS=https://your.address`, or make the proxy keep the original host.                                                           |
| "Too many attempts"                                           | Wait for the shown time. Behind Cloudflare without `KENNING_TRUST_CF=1` everyone shares one limit.                                                                                                  |
| Signed in, then signed out again at once                      | Plain `http://` from another device with `KENNING_COOKIE_SECURE=1`: the browser drops the cookie. Use https, or set it to `0` on a trusted LAN.                                                     |
| "Can't reach your Kenning server"                             | The `api` container is down or restarting. `docker compose ps`, `logs api`. The app never switches to an empty browser database by itself.                                                          |
| Page does not load                                            | `docker compose -f deploy/compose.yml ps` and `logs web nlp`. The web container shows `healthy` when ready.                                                                                         |
| Build stops with "does not match the pinned"                  | Upstream data changed. Use the published images, or rebuild with `--build-arg KAIKKI_ACCEPT_NEW=1 --build-arg TATOEBA_ACCEPT_NEW=1`.                                                                |

## For developers

`deploy/compose.dev.yml` publishes the language server on `127.0.0.1:8000`:

```sh
docker compose -f deploy/compose.yml -f deploy/compose.dev.yml up --build
```

`nlp` and `web` are stateless. Your data lives in the `api` service's volume, see below.

## Where your data lives

The compose stack has a third service, `api` (`server/api`), which keeps **all your data in one
SQLite file**, `/data/kenning.sqlite`, on the named volume `kenning-data`. Every device that opens
the site shares it (nginx proxies `/api/` to it; the browser finds it through `GET /api/health`).
Without the `api` service (for example `pnpm dev`, or opening the static files), the app stores
data in the browser (OPFS) instead. Settings > Your data shows which mode is active.

| Variable       | Where | Meaning                                                                                                                                               |
| -------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `KENNING_DB`   | `api` | Database file (default `/data/kenning.sqlite`).                                                                                                       |
| `KENNING_HOST` | `api` | Bind address. Default `127.0.0.1` outside Docker (so no auth is fine); the image sets `0.0.0.0` and the port is not published, only nginx reaches it. |
| `KENNING_PORT` | `api` | Port (default `8787`).                                                                                                                                |

Sign-in variables are listed under [Sign-in](#sign-in). Turn it on if the site is reachable
from anywhere but this computer, and use HTTPS (see above): the session cookie is only sent
over https by default.

### Backup and restore

**Scheduled backups (recommended).** Both compose files have an optional `backup` service.
Start it with the profile (`COMPOSE_PROFILES=backup` in `.env`, or
`docker compose --profile backup up -d`). Every `KENNING_BACKUP_INTERVAL_HOURS` (default 24) it
saves a consistent snapshot from `/api/export` as `kenning-YYYY-MM-DD-HHMM.sqlite` into
`KENNING_BACKUP_DIR` (default `./backups`, next to the compose file; in Dockge
`/opt/stacks/kenning/backups`) and deletes files older than `KENNING_BACKUP_KEEP_DAYS` (default
14). With sign-in on it needs `KENNING_TOKEN`; `docker compose logs backup` shows each run. The
files are readable by root only (`umask 077`): they hold all your data. Copy the folder off the
machine (restic, rclone, a NAS sync) for a real backup.

**Or a cron job on any machine that reaches the app** (here: daily at 03:15, 30 days kept):

```sh
15 3 * * * curl -fsS -H "Authorization: Bearer $KENNING_TOKEN" -o "$HOME/kenning-backups/kenning-$(date +\%F).sqlite" https://kenning.example.com/api/export && find "$HOME/kenning-backups" -name 'kenning-*.sqlite' -mtime +30 -delete
```

**Restore** any of these files in the app (below) or with `curl` (`/api/import`, below). Restore
replaces all data; download a fresh backup first if you might want the current state back.

- In the app: Settings > Your data > **Download backup (.sqlite)** and **Restore from backup...**.
  This works in both modes. A restore replaces all current data, gives this installation a new
  device id and rebuilds the derived tables from the event log.
- From the shell (server mode): `curl -H "Authorization: Bearer $KENNING_TOKEN" -o kenning.sqlite http://localhost:8080/api/export`
  (a consistent snapshot, safe while the app is in use; drop the header when sign-in is off).
  Restore with
  `curl -X POST -H "Authorization: Bearer $KENNING_TOKEN" --data-binary @kenning.sqlite http://localhost:8080/api/import`
  (with sign-in off, send `-H "X-Kenning: 1"` instead: the server refuses requests that a web
  page on another site could forge).
- Backups contain your data only, never sign-in sessions (those are in `auth.sqlite`).
- Or copy the volume: `docker run --rm -v kenning_kenning-data:/data -v "$PWD":/b alpine cp /data/kenning.sqlite /b/` (stop `api` first for a plain file copy).

A backup made by a newer Kenning than the running one is refused, and a database that is newer
than the app is never replaced by demo data: the app shows a blocking screen with a backup
download and asks you to update.
