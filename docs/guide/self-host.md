# Self-host Vuurtoren

Run Vuurtoren on your own computer or server. It gives your devices two things:

- **Sync:** your phone, laptop and desktop app keep the same words, texts and progress.
- **The language server:** Dutch analysis, the dictionary, translation and reading photos, for
  every device that has none of its own.

Every device keeps its own copy of your data. The server only stores locked files it cannot
read. You can also open the app from the server in a browser: it then keeps its data in that
browser and syncs through the server like any other device.

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

The language server then answers only a signed-in browser or a device with a sync token. Keep it
that way: **never set `VUURTOREN_NLP_AUTH=off` on a server that the internet can reach.**

## Reach it from other devices

Browsers need `https://` for Vuurtoren. Pick one:

- **Tailscale** (easiest at home): run `tailscale serve --bg 8080`.
- **Your own domain:** put `VUURTOREN_DOMAIN=vuurtoren.example.com` in `deploy/.env`, then run
  `docker compose -f deploy/compose.yml --profile https up -d`.
- **Cloudflare Tunnel:** see the [full self-hosting guide](../../deploy/README.md).

## Sync your devices through it

1. Open your server in a browser, sign in and go to **Settings → Sync**.
2. To sync this browser, choose **This server**. Nothing else to fill in.
3. For every other device, click **Make a sync token** and give that device the server address
   and its token. Tick **May change the passphrase and recovery key** for a device you want to
   do that from.

A device that syncs with your server also uses its language server. See [Sync](sync.md).

## Copies of the sync files

Your devices hold your data. To keep copies of the locked sync files too:

```sh
docker compose -f deploy/compose.yml --profile backup up -d
```

They go to `deploy/backups` once a day. Copy that folder somewhere else from time to time.

## Update

```sh
git pull
docker compose -f deploy/compose.yml pull
docker compose -f deploy/compose.yml up -d
```

More settings (other ports, Dockge, Cloudflare) are in the
[full self-hosting guide](../../deploy/README.md).
