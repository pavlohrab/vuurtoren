# Self-host Vuurtoren

Your own Vuurtoren server does two things. Your devices sync through it, with everything locked
with your passphrase, so the server can't read your data and keeps no words or texts of its own.
And it's a language server for your phone: it prepares and translates the texts you add on the
phone.

The app itself runs on your computer and your phone, not on the server. The server's address only
shows one page, **Your devices**, where you sign in and add or remove devices. The dictionaries,
the translation model and the recordings come from `data.vuurtoren.app`, and the server downloads
what it needs by itself, once.

## The easy way: let a host run it

If you don't have a computer that stays on, you can pay a hosting company to run the server for
you. You give it the Vuurtoren setup file, it starts the server, and you get an HTTPS address back.
You don't need to know Docker for this, and updates and backups are a button.

**Elestio** can do this today. It runs any Docker Compose file on a small server of your own, with
HTTPS, updates and backups included. Choose a server with 4 GB of memory (2 GB is the bare
minimum), because the language server keeps its dictionaries and the translation model in memory.
That's about 17 dollars a month.

1. Make an account on [elest.io](https://elest.io) and create a new service with the template
   **Custom docker-compose**.
2. Paste the contents of `deploy/compose.yml` from the repository, and in the environment settings
   fill in the lines from `deploy/.env.example`: your user name, your password hash, and `8080` as
   the port, and `0` for `VUURTOREN_TRUST_CF` (there's no Cloudflare in front of it). You make the
   hash once on any computer with Docker, see step 2 under [Start it](#start-it).
3. Deploy, and wait a few minutes: on the first start the server downloads its language data.
4. Elestio gives you an HTTPS address. Go on with [Connect your devices](#connect-your-devices).

**PikaPods** is even simpler, you just click an app and pay a few euros a month. But it only runs
apps from its own list, and Vuurtoren isn't on it yet. If you'd like it there, you can vote for it
on their feedback page.

If you're fine with a bit more work, a small cloud server (Hetzner, for example, from about 4 euros
a month) with Docker on it works the same as a NAS. Follow the steps below.

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
