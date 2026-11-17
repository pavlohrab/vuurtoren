# Running Kenning on your own computer

Kenning is a Dutch reading and vocabulary app. Everything runs on your machine; nothing is sent
to a third party.

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

| Service | What it does                                                          | Port                  |
| ------- | --------------------------------------------------------------------- | --------------------- |
| `web`   | The app (static files) and a same-origin proxy to the language server | `127.0.0.1:8080`      |
| `nlp`   | Dutch analysis, dictionary, example sentences, OCR, translation       | none (only via `web`) |
| `caddy` | Optional HTTPS front (profile `https`)                                | 80 and 443            |

A storage service for syncing your data between devices is documented separately when enabled.
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

| Symptom                                        | Cause and fix                                                                                                                                                                                       |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Anki is not running" in Settings              | Anki is closed or AnkiConnect is not installed. Open Anki, install add-on `2055492159`, restart Anki.                                                                                               |
| "This site is not allowed yet"                 | Anki is running but does not know this address. Click **Connect to Anki** and answer Yes. Or in Anki: Tools, Add-ons, AnkiConnect, Config, add the shown line to `webCorsOriginList`, restart Anki. |
| "Needs an API key"                             | You set a key in AnkiConnect. Enter it in the key field in Settings.                                                                                                                                |
| Storage not persistent / data lost, Anki fails | You are on plain `http://` with a non-localhost address. Use `http://localhost:8080` or the HTTPS profile.                                                                                          |
| First word or text is slow                     | The language server loads its models on the first request (up to a minute). Later requests are fast.                                                                                                |
| Page does not load                             | `docker compose -f deploy/compose.yml ps` and `logs web nlp`. The web container shows `healthy` when ready.                                                                                         |
| Build stops with "does not match the pinned"   | Upstream data changed. Use the published images, or rebuild with `--build-arg KAIKKI_ACCEPT_NEW=1 --build-arg TATOEBA_ACCEPT_NEW=1`.                                                                |

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

| Variable        | Where | Meaning                                                                                                                                                       |
| --------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `KENNING_TOKEN` | `api` | Optional access token. When set, every request needs `Authorization: Bearer <token>`; the app asks for it once and keeps it in the browser. Default: no auth. |
| `KENNING_DB`    | `api` | Database file (default `/data/kenning.sqlite`).                                                                                                               |
| `KENNING_HOST`  | `api` | Bind address. Default `127.0.0.1` outside Docker (so no auth is fine); the image sets `0.0.0.0` and the port is not published, only nginx reaches it.         |
| `KENNING_PORT`  | `api` | Port (default `8787`).                                                                                                                                        |

Set a token if the site is reachable from the internet: `KENNING_TOKEN=long-random-string docker compose -f deploy/compose.yml up -d`.
The token is sent over the connection, so use HTTPS (see above). Browsers also need HTTPS (or
`http://localhost`) for some features; in server mode data storage itself does not depend on it.

### Backup and restore

- In the app: Settings > Your data > **Download backup (.sqlite)** and **Restore from backup...**.
  This works in both modes. A restore replaces all current data, gives this installation a new
  device id and rebuilds the derived tables from the event log.
- From the shell (server mode): `curl -H "Authorization: Bearer $KENNING_TOKEN" -o kenning.sqlite http://localhost:8080/api/export`
  (a consistent snapshot, safe while the app is in use). Restore with
  `curl -X POST --data-binary @kenning.sqlite http://localhost:8080/api/import`.
- Or copy the volume: `docker run --rm -v kenning_kenning-data:/data -v "$PWD":/b alpine cp /data/kenning.sqlite /b/` (stop `api` first for a plain file copy).

A backup made by a newer Kenning than the running one is refused, and a database that is newer
than the app is never replaced by demo data: the app shows a blocking screen with a backup
download and asks you to update.
