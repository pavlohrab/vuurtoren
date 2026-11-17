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
