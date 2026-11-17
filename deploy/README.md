# Self-hosting Kenning

Two containers: `web` (static app behind nginx, port 8080) and `nlp` (FastAPI: analysis, URL/PDF
import, OCR, glosses). The web container also proxies `/nlp/*` to the NLP service, so the browser
only ever talks to one origin.

## Quick start

```sh
git clone <repo> && cd <repo>
docker compose -f deploy/compose.yml up --build -d
```

- App: <http://localhost:8080>
- NLP service (dev, loopback only): <http://127.0.0.1:8000/health>

The first build is slow (it downloads the spaCy model, installs Tesseract, and downloads the
~250 MB Kaikki Dutch dictionary to build a ~35 MB SQLite file; the download is discarded and only
the SQLite file ends up in the image). Later builds reuse cached layers. To refresh the
dictionary, run `docker compose -f deploy/compose.yml build --no-cache nlp`.

The same build also fetches the offline Dutch to English translation model (OPUS-MT, ~160 MB,
checksum-verified) in its own throwaway stage, so `POST /translate` works without internet or API
keys. It adds ~160 MB to the image and ~0.7 GB RAM once loaded (lazily, on the first request);
about 0.1 s per sentence on one CPU core set. Outside Docker run
`uv run python scripts/fetch_mt_model.py` in `server/nlp`.

Practice data (M4) is built the same way: the Tatoeba sentence DB (`POST /sentences`, ~50 MB, from
~30 MB of exports) is built in a throwaway stage that reuses the Python dependency layer and spends
about 4 extra minutes on the first build (spaCy analyses ~150k sentences). `POST /forms` reads the
morphology the dictionary stage extracts, and `POST /similar` builds a word-vector index in memory on
its first request (a few seconds, ~40 MB). Run `build --no-cache nlp` to pick up newer Tatoeba
exports.

Smoke test:

```sh
curl -s localhost:8000/health
curl -s localhost:8000/gloss -H 'content-type: application/json' \
  -d '{"lang":"nl","words":["fiets"]}'
curl -s localhost:8080/nlp/health          # same service through the web container
```

## Configuration

| Variable                 | Where         | Meaning                                                                                                                                                                                             |
| ------------------------ | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `KENNING_CORS_ORIGINS`   | `nlp`         | Comma-separated browser origins allowed to call the NLP service directly (default `http://localhost:8080`). Not needed for the `/nlp/` proxy. Set it to your public origin if you expose port 8000. |
| `KENNING_DICT_PATH`      | `nlp`         | Dictionary file (default `/data/dictionary-nl.sqlite` in the image).                                                                                                                                |
| `KENNING_SENTENCES_PATH` | `nlp`         | Tatoeba sentence database (default `/data/sentences-nl.sqlite` in the image).                                                                                                                       |
| `KENNING_MT_DIR`         | `nlp`         | Translation model directory (default `/data/mt-nl-en` in the image).                                                                                                                                |
| `KENNING_OCR_PSM`        | `nlp`         | Tesseract page segmentation mode (default `3`, automatic with column detection).                                                                                                                    |
| `VITE_NLP_URL`           | web build arg | NLP base URL baked into the bundle (default `/nlp`).                                                                                                                                                |

Example: `KENNING_CORS_ORIGINS=https://kenning.example.com docker compose -f deploy/compose.yml up -d`.

For production, remove the `ports:` entry of the `nlp` service in `deploy/compose.yml` so only the
web container is reachable. The NLP service has no authentication; its URL import fetches
arbitrary public web pages (private and reserved addresses are blocked), so do not expose it
publicly unless you accept that.

## HTTPS with Caddy

Put Caddy in front of the web container (it obtains certificates automatically):

```caddyfile
kenning.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Run it on the host (`caddy run --config Caddyfile`) or as another compose service on the same
network pointing at `web:80`. Large PDF uploads work out of the box: nginx allows 32 MB bodies
and Caddy has no body limit by default.

## AnkiConnect

The browser app talks to AnkiConnect directly (`http://127.0.0.1:8765`), so Anki's add-on must
allow your site's origin. In Anki: Tools > Add-ons > AnkiConnect > Config, then add the origin
(scheme + host + port, no path or trailing slash) to `webCorsOriginList` and restart Anki:

```json
{
  "webCorsOriginList": ["http://localhost", "http://localhost:8080", "https://kenning.example.com"]
}
```

Notes:

- An HTTPS page calling `http://127.0.0.1:8765` is allowed by Chrome, Edge and Firefox (loopback is
  treated as secure) but blocked by Safari as mixed content; use a Chromium/Firefox browser, or run
  the app on `http://localhost:8080`.
- Anki must be running on the same machine as the browser, not on the server.
- Chrome may ask for "local network access" permission the first time.

## Operations

```sh
docker compose -f deploy/compose.yml logs -f nlp
docker compose -f deploy/compose.yml pull && docker compose -f deploy/compose.yml up --build -d
docker compose -f deploy/compose.yml down
```

Both services are stateless; user data lives in the browser (and in Anki). Nothing needs backing
up on the server.
