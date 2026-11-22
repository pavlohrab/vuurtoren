# deploy

The Vuurtoren server: sync for your devices and a language server for phones. The full guide is
[docs/guide/self-host.md](../docs/guide/self-host.md).

| File                                    | What it is                                                                                           |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `compose.yml`                           | The server: `web` (the Your devices page and routes), `api` (sign-in, sync), `nlp` (language server) |
| `.env.example`                          | Its settings: user, password hash, port, Cloudflare                                                  |
| `devices/`                              | The Your devices page                                                                                |
| `web.Dockerfile`, `nginx.conf.template` | The `web` image                                                                                      |
| `data-host/`                            | A file server for the language packs (data.vuurtoren.app)                                            |
| `push-images.sh`                        | Build the images here and load them on a server, without a registry                                  |
| `compose.dev.yml`                       | Development: the language server on `127.0.0.1:8000`                                                 |

## Start

```sh
cp deploy/.env.example deploy/.env   # fill in the user and the password hash
docker compose -f deploy/compose.yml up -d
```

Make the password hash with
`docker run --rm -it ghcr.io/pavlohrab/vuurtoren-api:latest hash-password`. Put HTTPS in front of
the port (a Cloudflare Tunnel or a reverse proxy) and open the address: it shows **Your devices**.

## Check it

```sh
VUURTOREN_USER=me VUURTOREN_PASSWORD=… scripts/doctor.sh https://vuurtoren.example.org
```

It checks the page, sign-in, the sync place and the language server with its data.

## Troubleshooting

| You see                             | Look at                                                                             |
| ----------------------------------- | ----------------------------------------------------------------------------------- |
| the page does not load              | `docker compose -f deploy/compose.yml ps`, and the tunnel's address and port        |
| the password is refused             | the hash in `.env` (the whole `scrypt:…` line, no spaces); open the page over HTTPS |
| phones cannot add texts             | `docker compose -f deploy/compose.yml logs nlp`: its data may still be downloading  |
| the language data does not download | that data.vuurtoren.app is reachable from the server, or set `VUURTOREN_PACKS_URL`  |

## The data host

`data-host/compose.yml` serves the language packs as plain files at data.vuurtoren.app:
`packs-<version>/<name>-<version>.tar.gz`, built with `server/nlp/scripts/build_packs.py`. The
apps and servers download from there.
