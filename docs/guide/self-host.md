# Self-host Vuurtoren

Run Vuurtoren on your own computer or server. Every device can then use it in a browser, and the
desktop app can sync through it.

## What you need

- A computer that stays on (a home server, a NAS, a small cloud server).
- [Docker](https://docs.docker.com/get-docker/) with Docker Compose.

## Start it

```sh
git clone https://github.com/pavlohrab/Vuurtoren.git
cd Vuurtoren
docker compose -f deploy/compose.yml up -d
```

Open <http://localhost:8080> and follow the welcome steps.

## Set a password

Do this before other devices can reach Vuurtoren.

1. Make a password hash:

   ```sh
   docker compose -f deploy/compose.yml run --rm -it api hash-password
   ```

2. Put the two printed lines in `deploy/.env`:

   ```sh
   VUURTOREN_USER=anna
   VUURTOREN_PASSWORD_HASH=scrypt:...
   ```

3. Restart: `docker compose -f deploy/compose.yml up -d`.

## Reach it from other devices

Browsers need `https://` for Vuurtoren. Pick one:

- **Tailscale** (easiest at home): run `tailscale serve --bg 8080`.
- **Your own domain:** put `VUURTOREN_DOMAIN=vuurtoren.example.com` in `deploy/.env`, then run
  `docker compose -f deploy/compose.yml --profile https up -d`.
- **Cloudflare Tunnel:** see the [full self-hosting guide](../../deploy/README.md).

## Sync your devices through it

Your server can be the place your devices sync through. See [Sync](sync.md).

## Backups

Turn on daily backups:

```sh
docker compose -f deploy/compose.yml --profile backup up -d
```

They go to `deploy/backups`. Copy that folder somewhere else from time to time.

## Update

```sh
git pull
docker compose -f deploy/compose.yml pull
docker compose -f deploy/compose.yml up -d
```

More settings (other ports, Dockge, Cloudflare) are in the
[full self-hosting guide](../../deploy/README.md).
