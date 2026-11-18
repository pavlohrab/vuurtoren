# Kenning in Dockge: quick card

Five steps from nothing to `https://kenning.example.com`. The full guide, with the why behind
each setting, is [deploy/README.md](../README.md#dockge-and-cloudflare-tunnel).

## 1. Let the Docker host pull the images (once)

The images are on `ghcr.io/<owner>`. If the packages are private, create a GitHub token
(classic) with only `read:packages` and run on the Docker host:

```sh
docker login ghcr.io -u <github-user>     # paste the token as the password
```

## 2. Make a password hash

```sh
docker run --rm -it ghcr.io/<owner>/kenning-api:latest hash-password
```

Type the password twice; copy the `scrypt:...` line it prints.

## 3. Create the stack

Dockge, **+ Compose**, name `kenning`:

- compose editor: paste [`compose.yaml`](compose.yaml)
- `.env` editor: paste [`.env.example`](.env.example), then set

```sh
KENNING_IMAGE_OWNER=<owner>
KENNING_USER=<your name>
KENNING_PASSWORD_HASH=scrypt:...          # from step 2
KENNING_TRUST_CF=1                        # behind the Cloudflare Tunnel
KENNING_TOKEN=<openssl rand -hex 32>      # for scheduled backups and scripts
TUNNEL_TOKEN=<from step 4>
COMPOSE_PROFILES=tunnel,backup
```

## 4. Cloudflare Tunnel

Zero Trust, Networks, Tunnels, **Create a tunnel** (Cloudflared). Copy the token (the long string
after `--token`) into `TUNNEL_TOKEN`. Add a **Public hostname**: `kenning.example.com`, service
**HTTP**, URL **`web:80`**.

## 5. Deploy and check

**Deploy** in Dockge. After about a minute `web`, `api` and `nlp` show healthy. Open
`https://kenning.example.com`, sign in, then **Settings > Advanced > Server status**: every row
should have a green dot. Then Settings > Language & decks > **Connect to Anki** on each computer
that runs Anki.

## Everyday

| Task           | How                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Update         | Dockge **Update** (pulls `latest`). Pin a release with `KENNING_TAG=0.1.0`; `edge` follows every commit on main.                            |
| Backups        | Profile `backup`: a snapshot every 24 h in `./backups` of the stack folder (`/opt/stacks/kenning/backups`), kept 14 days. Copy it off-site. |
| Restore        | Settings > Data & backup > **Restore from backup...**, pick a `kenning-*.sqlite`.                                                           |
| Something off? | Server status in Settings, or `scripts/doctor.sh https://kenning.example.com` with `KENNING_TOKEN` set. Logs: Dockge, each container.       |
| New password   | Step 2 again, replace `KENNING_PASSWORD_HASH`, **Deploy**. Every device is signed out.                                                      |
