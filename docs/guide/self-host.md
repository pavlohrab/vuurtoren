# Self-host Vuurtoren

Most people don't need a server. The desktop app does everything by itself: it keeps your words,
reads your texts and prepares them, all on your computer. Your phone is for reading. It gets the
texts your computer prepared through sync, by WebDAV (Nextcloud, a NAS) or through your own server
(see [Sync your devices](sync.md)), and reads them offline.

Your own server is for when you want more. Your devices sync through it, with everything locked
with your passphrase, so the server can't read your data. And it prepares texts for your phone, so
you can add a text on the phone, or take a photo of a page, without your computer.

The server doesn't run the app itself. Its address shows one page, **Your devices**, where you sign
in and add or remove devices. The dictionaries, the translation model and the recordings come from
`data.vuurtoren.app`, and the server downloads what it needs by itself, once.

## No computer that stays on?

Then rent a small cloud server. At Hetzner one with 2 cores and 4 GB of memory costs about 4 euros
a month, and that's enough: the language server keeps its dictionaries and the translation model in
memory, so don't go below 2 GB. When you create it, choose the **Docker CE** app, so Docker is
already there, and log in with SSH. From there it works the same as on a NAS, so follow the steps
below.

Don't want to run anything? **Vuurtoren Sync** is planned: the same server, run for you, and you
just sign in.

## What you need

You need a computer that stays on, like a NAS, a mini PC or a small cloud server, with Docker on
it. It also needs HTTPS in front of it, because phones only connect over HTTPS. The simplest way is
a Cloudflare Tunnel, but any reverse proxy with a certificate works too.

## Start it

1. Get `deploy/compose.yml` and `deploy/.env.example` from the repository.
2. Make a password hash:

   ```sh
   docker run --rm -it ghcr.io/pavlohrab/vuurtoren-api:latest hash-password
   ```

3. Copy `.env.example` to `.env` and fill in your user name, the hash and a free port.
4. Start it:

   ```sh
   docker compose -f compose.yml up -d
   ```

   In Dockge: a new stack, paste `compose.yml` and the `.env`, then **Deploy**.

5. Point your HTTPS address at `http://<server-ip>:<port>`. With a Cloudflare Tunnel: Zero Trust
   → Networks → Tunnels → your tunnel → Public hostnames → Add.

On the first start the language server downloads its data and prepares the grammar examples,
which takes a few minutes. You can watch it with `docker compose logs -f nlp`.

## Connect your devices

1. Open your server's address in a browser and sign in. You see **Your devices**.
2. **First device** (your computer or your phone): in the app, Settings → Your devices → Connect
   to your server. Type the address, your user name and password. Then choose **Start new sync
   data here** and a passphrase. Keep the recovery key it shows.
3. **Every other device:** connect the same way, or scan the QR code from **Add a device** on the
   server's page with the phone. Then **Join my synced data** with the same passphrase. Your words
   and texts download.

If you lose a device, remove it on the server's page, and it can no longer sync.

## Back it up

The sealed sync files are in the `api-data` volume. Copy it now and then, for example with
`docker run --rm -v vuurtoren_api-data:/data -v "$PWD":/out alpine tar czf /out/vuurtoren-sync.tgz /data`.
Every device also keeps a full copy of your data.

## Update

```sh
docker compose -f compose.yml pull && docker compose -f compose.yml up -d
```

In Dockge: **Update**. Your devices and sync files stay.

## Before images are published

Build the images on your computer and load them on the server:

```sh
deploy/push-images.sh user@server
```

Then use **Restart** in Dockge instead of **Update**.
