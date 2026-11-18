# Kenning desktop app

A small native app (Tauri v2, `apps/desktop`) for Linux, Windows and macOS. Today it is a
**thin client** for your Kenning server (plan steps D2 + D3): download one file, enter your
server's address once, sign in, and Anki works without any AnkiConnect setup. The offline
version (D4: everything on this computer, no server) will be the same app.

## Install

Download the file for your system from the GitHub release (or wherever you host them, see
[Updates](#updates)):

| System                                 | File                                     | How                                                                                                                                               |
| -------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linux, any                             | `Kenning_<version>_amd64.AppImage`       | `chmod +x Kenning_*.AppImage && ./Kenning_*.AppImage` (or Properties > "Allow executing as program"). Needs FUSE 2 (`libfuse2` on Ubuntu 22.04+). |
| Debian / Ubuntu                        | `Kenning_<version>_amd64.deb`            | `sudo apt install ./Kenning_*.deb`; then "Kenning" in the app menu. Uses the system WebKitGTK 4.1.                                                |
| Windows 10/11                          | `Kenning_<version>_x64-setup.exe` (NSIS) | Double-click. Installs for the current user, no admin rights. The `.msi` is the same app for managed installs.                                    |
| macOS 10.15+ (Intel and Apple silicon) | `Kenning_<version>_universal.dmg`        | Open the `.dmg`, drag Kenning to Applications, then see "Unsigned on macOS" below.                                                                |

Sizes (0.1.0, Linux): `.deb` 4.8 MB (uses the system WebKitGTK), AppImage 106 MB (carries
its own WebKitGTK and GStreamer so it runs on any distribution). Windows uses the built-in
WebView2 and macOS the system WebKit, so those installers are a few MB.

**Unsigned builds.** The installers are not code-signed (no certificate yet, plan step D5):

- **Windows SmartScreen** says "Windows protected your PC". Click **More info** > **Run anyway**.
  This shows once per downloaded version.
- **macOS** says the app "cannot be opened because Apple cannot check it for malicious software"
  (the app is ad-hoc signed, not notarised). Either right-click Kenning in Applications >
  **Open** > **Open**, or run `xattr -dr com.apple.quarantine /Applications/Kenning.app` once.
  On **macOS 15 (Sequoia) and later** the right-click route is gone: try to open the app once,
  then go to **System Settings > Privacy & Security**, scroll to "Kenning was blocked…", click
  **Open Anyway** and confirm with your password.
- **Linux** has no such check; the AppImage only needs the executable bit.

## First start

1. The **Connect** screen asks for your server's address, the one you open in the browser
   (`kenning.example.com`, `https://kenning.example.com`, or `http://192.168.1.20:8080` on your
   network). The app checks `/api/health`; a wrong address, a site that is not Kenning, or a
   server that does not answer gets a plain message.
2. The window then opens your server. If it requires sign-in you see the usual sign-in screen;
   the session cookie is kept like in a browser (30 days, sliding).
3. Later starts open the saved server straight away. If it does not answer, the Connect screen
   comes back with the reason and the address filled in (fix it or just retry).
4. To switch servers: **Settings > Account > Change server…** ("Back to …" returns to the old one).

"Use on this computer only" is shown but disabled until the offline version (D4) ships.

Settings live in the app's config directory as `desktop.json`
(`~/.config/app.kenning.desktop/` on Linux, `%APPDATA%\app.kenning.desktop\` on Windows,
`~/Library/Application Support/app.kenning.desktop/` on macOS). Window size and position are
remembered; starting Kenning a second time focuses the open window. Links that open a new tab
(dictionaries, docs) go to your normal browser; downloads (backups) go to your Downloads folder.

## Anki

Run Anki with AnkiConnect (add-on `2055492159`) on the same computer. That is all: in the
desktop app the requests to AnkiConnect are sent by the app itself, not by the web page, so
there is **no `webCorsOriginList` entry and no "allow this site?" dialog**. The app forwards
only to `http://127.0.0.1:8765` / `http://localhost:8765`, nothing else (see "Security").

This needs a server running a web build that knows the bridge (this release or later). With an
older server the page falls back to the browser behaviour (Anki asks once to allow the site).

## Updates

The app checks for an update once per start and asks before installing it (it restarts after).
Updates are signed with a key only you have; the app refuses anything else.

**One-time setup (owner):**

1. The key pair was generated locally with
   `pnpm --filter desktop tauri signer generate -w ~/.config/kenning-desktop/updater.key`.
   The private key stays outside the repository (`~/.config/kenning-desktop/updater.key`, no
   password). **Back it up**: if it is lost, installed apps can no longer update and users must
   reinstall by hand. The public key is in `apps/desktop/src-tauri/tauri.conf.json`
   (`plugins.updater.pubkey`); replace it there if you generate a new pair.
2. GitHub > repository > Settings > Secrets and variables > Actions:
   - secret `TAURI_SIGNING_PRIVATE_KEY` = the _contents_ of `updater.key`
     (`cat ~/.config/kenning-desktop/updater.key`);
   - (only if you made a key with a password) secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`;
   - nothing else: the app checks
     `https://github.com/pavlohrab/Kenning/releases/latest/download/latest.json` (the newest
     public release). A repository variable `KENNING_UPDATE_URL` can point it elsewhere.
3. Release: push a tag `vX.Y.Z` (the version comes from the root `package.json`). The
   **Desktop** workflow builds all installers plus the update files (`.AppImage.tar.gz`,
   `.nsis.zip`/`-setup.exe`, `.app.tar.gz` and their `.sig`) and a `latest.json`, all attached
   to a published release, which becomes "latest" and is what installed apps update to.

A user can override the feed in `desktop.json`: `"updateUrl": "https://…/latest.json"` (an
empty string turns update checks off).

## Build it yourself

Needs Rust (rustup) and, on Linux, `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev
patchelf`.

```sh
pnpm install
pnpm --filter desktop tauri build --bundles appimage,deb   # Linux
pnpm --filter desktop tauri dev                            # dev window on the Vite dev server
```

`tauri build` builds the web app first (turbo) and bundles `apps/web/dist`. Installers land in
`apps/desktop/src-tauri/target/release/bundle/`. Windows and macOS installers are built by CI
(`.github/workflows/desktop.yml`, `v*` tags or "Run workflow"). The desktop package has no
`build` script, so `pnpm build` and the normal CI do not need Rust.

## How it works

```
 Kenning window (Tauri)
  ├─ starts on the bundled web build ("home": tauri://localhost)
  │    └─ ConnectScreen ── check_server / connect ──► Rust ── GET <server>/api/health
  └─ navigates to https://your-server/   (the server's own web app, cookies, CSP)
       └─ window.__KENNING_DESKTOP__ (init script) ── anki_fetch ──► Rust ──► 127.0.0.1:8765
```

- **Rust** (`apps/desktop/src-tauri/src/lib.rs`): five commands (`desktop_info`,
  `check_server`, `connect`, `change_server`, `anki_fetch`), plugins single-instance,
  window-state, updater, dialog (update prompt) and opener (external links).
- **Web** (`apps/web/src/desktop/`): `bridge.ts` (detection, the Anki fetch wrapper used by
  `browserPlatform()`), `ConnectScreen.tsx` (shown by `main.tsx` only on the home page),
  `DesktopServer.tsx` (Settings > Account). In a normal browser none of it does anything.

### Why the window loads the server

Two ways were possible:

1. **Bundled UI talks to the remote API.** The page origin is `tauri://localhost` (Windows:
   `http://tauri.localhost`), the API another site. That needs CORS with credentials on
   `server/api` _and_ nginx, the session cookie as `SameSite=None; Secure` (so no plain-http LAN
   servers, and WebKit's tracking prevention may still drop it), a CSRF exception for the Tauri
   origin, an absolute base URL in every `/api`, `/nlp` and blob call of the web app, and the
   app and server versions can drift apart (old app, newer API).
2. **The window opens the server's own page (chosen).** Same origin as in a browser: the
   `SameSite=Lax` cookie, CSRF `Origin` check, nginx CSP and `auth_request` all work unchanged,
   with zero server changes, and the UI is always the version the server runs. The cost is a
   small bridge for what a web page cannot do (AnkiConnect without CORS), given to the server's
   origin only through a runtime Tauri capability.

### Security

- Pages from the server can call only `anki_fetch`, `change_server` and `desktop_info`; this is a
  capability added at runtime for exactly the saved origin (`allow_server`). Any other site the
  window may show (a sign-in provider such as Cloudflare Access) gets no IPC at all; Tauri
  rejects custom commands from remote origins without a capability.
- `anki_fetch` only reaches `http://127.0.0.1:8765` and `http://localhost:8765` with `GET` or
  `POST`. This is the access the web app already has in a browser after you allow the site.
- `check_server` and `connect` are for the bundled home page only.
- Update packages are verified against the public key in `tauri.conf.json`.

### D4 (offline) fits here

The home page is the bundled web build, so "Use on this computer only" will continue the normal
boot there instead of navigating away: a `SqlDriver` over the Tauri SQL plugin (native SQLite
file in the app data directory) in place of the OPFS worker, and the language server as a
sidecar binary on a local port, both behind the existing `Platform` / driver seams. Anki goes
through the same `anki_fetch` bridge already allowed for the home page.

## Troubleshooting

- **Blank window or "Could not reach …" on Linux**: run from a terminal to see errors
  (`./Kenning_*.AppImage`). With an NVIDIA GPU, `WEBKIT_DISABLE_DMABUF_RENDERER=1` helps.
- **AppImage does not start**: install FUSE 2 (`sudo apt install libfuse2`), or extract it:
  `./Kenning_*.AppImage --appimage-extract && ./squashfs-root/AppRun`.
- **Wrong server saved / stuck on a broken page**: Settings > Account > Change server…, or delete
  `desktop.json` (see above) and restart.
- **Sign-in does not stick on a plain-http server**: the session cookie is `Secure`; use `https://`, or set
  `KENNING_COOKIE_SECURE=0` on a plain-http LAN server (as for browsers).
- **Anki shows "not running"**: Anki must be open with AnkiConnect on port 8765; a custom
  AnkiConnect address in Settings is not forwarded by the app.
- **Update check fails**: `latest.json` must be reachable without sign-in, and its file URLs too.
