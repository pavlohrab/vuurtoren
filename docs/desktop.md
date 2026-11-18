# Kenning desktop app

A small native app (Tauri v2, `apps/desktop`) for Linux, Windows and macOS. **Open it, keep
Anki open, and it works**: no server, no Docker, no address to type. Everything runs on your
computer: your texts and words live in one file in `Documents/Kenning`, and the Dutch language
tools (analysis, dictionary, translations) run inside the app. With a Kenning server you can
also use the app as a window onto that server instead (plan steps D2–D4).

## Install

Download the file for your system from the GitHub release:

| System                   | File                                     | How                                                                                                                                               |
| ------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linux, any               | `Kenning_<version>_amd64.AppImage`       | `chmod +x Kenning_*.AppImage && ./Kenning_*.AppImage` (or Properties > "Allow executing as program"). Needs FUSE 2 (`libfuse2` on Ubuntu 22.04+). |
| Debian / Ubuntu          | `Kenning_<version>_amd64.deb`            | `sudo apt install ./Kenning_*.deb`; then "Kenning" in the app menu. Uses the system WebKitGTK 4.1.                                                |
| Windows 10/11            | `Kenning_<version>_x64-setup.exe` (NSIS) | Double-click. Installs for the current user, no admin rights. The `.msi` is the same app for managed installs.                                    |
| macOS 10.15+, Apple chip | `Kenning_<version>_aarch64.dmg`          | Open the `.dmg`, drag Kenning to Applications, then see "Unsigned on macOS" below.                                                                |
| macOS 10.15+, Intel      | `Kenning_<version>_x64.dmg`              | As above.                                                                                                                                         |

Each file also comes as **`Kenning_offline_…`**: the same app with the language data inside
(about 104 MB more), for a computer that has no internet the first time Kenning starts. The
normal installers download that data once on first start instead.

**Sizes** (0.1.0, Linux, measured locally; the language server dominates):

SIZES_TABLE

Windows uses the built-in WebView2 and macOS the system WebKit, so their installers are the
`.deb` size plus or minus a few MB (the language server is built per system by CI).

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

1. Kenning opens straight into the app (the welcome steps: your level, your Anki decks). There
   is nothing to set up.
2. A quiet line above the page shows the language tools getting ready: "Starting the language
   tools…", then, the first time only, "Downloading the Dutch dictionary… 14 MB" with a progress
   bar, then example sentences (20 MB) and the translation model (70 MB), about 104 MB in all
   (the offline installer skips the download). The library, Anki and settings work meanwhile;
   word help, glosses and translations appear when it is done. If the download fails (no
   internet), the line says so and offers **Try again**; Kenning keeps working without it.
3. **Anki**: open Anki with the AnkiConnect add-on. If Kenning cannot reach it, the welcome step
   shows the one thing to do (Anki > Tools > Add-ons > Get Add-ons > code **2055492159**,
   restart Anki) and a **Check again** button. No `webCorsOriginList`, no "allow this site?".

Starting Kenning a second time focuses the open window. Window size and position are
remembered. Links that open a new tab (dictionaries, docs) go to your normal browser; backups go
to your Downloads folder.

## Where your data lives

One SQLite file, outside the app, in a folder you can see:

| System  | File                                 |
| ------- | ------------------------------------ |
| Linux   | `~/Documents/Kenning/kenning.sqlite` |
| Windows | `Documents\Kenning\kenning.sqlite`   |
| macOS   | `~/Documents/Kenning/kenning.sqlite` |

(`Documents` is your system's documents folder, also when it is localised or moved.) It is the
same database as in the browser version (event log, schema, migrations, backups), so a backup
from the browser or a server can be restored here and the other way round (**Settings > Your
data > Download backup / Restore from backup**). Copying the file while Kenning is closed is a
full backup too.

**Settings > Your data** shows the path, **Show in folder**, and **Move…**: pick another folder
(an external disk, a synced folder); Kenning writes a consistent copy there, switches to it and
remembers the new place. The old file stays where it was until you delete it. Moving refuses to
overwrite a `kenning.sqlite` that is already in the chosen folder.

**Two computers.** Next to the file sits `kenning.sqlite.lock`: which computer has it open,
refreshed every minute and removed when Kenning closes. If the folder is synced (Dropbox,
OneDrive, Syncthing, Nextcloud) and Kenning is open on the other computer, this one says
"Kenning is open on another computer" with the computer's name and when it was last active,
and offers **Try again** or **Open anyway** (for when the other one crashed or is switched off).
If a sync tool made a conflict copy (`kenning (1).sqlite`, `kenning (… conflicted copy …).sqlite`,
`kenning.sync-conflict-….sqlite`, `kenning-LAPTOP.sqlite`), a notice names it: Kenning keeps
using `kenning.sqlite`, the copy may hold the other computer's changes. Use Kenning on one
computer at a time; real sync between devices is plan step M7.

The language data (≈ 170 MB installed) and the app's settings are elsewhere and need no
backup: `nlp-data/` in the app data folder (`~/.local/share/app.kenning.desktop/` on Linux,
`%APPDATA%\app.kenning.desktop\` on Windows, `~/Library/Application Support/app.kenning.desktop/`
on macOS), `desktop.json` in the config folder (same places, `~/.config/…` on Linux).

## Language tools (the bundled language server)

The same language server as on a Kenning server (`server/nlp`), built with PyInstaller into a
folder inside the app (no Python needed). Kenning starts it on a free `127.0.0.1` port with a
random token when the window opens and stops it when you quit (if Kenning crashes it stops by
itself). Its data — dictionary, example sentences, translation model — are the versioned data
packs (docs/architecture.md, "Data packs"): downloaded once from the public `packs-<version>`
release, checked against their SHA-256, and updated with a later app version. Texts analysed
before the dictionary arrived are analysed again automatically (analyzer version).

**Photos and scans.** The desktop app has no text recognition (Tesseract, ~110 MB): **Import**
hides the Photo tab and says why. PDFs with a text layer, web pages and pasted text work. If
Tesseract is installed on the computer (`tesseract` on the PATH, with the Dutch language), the
language server finds it and photo import appears.

## Connect to a Kenning server (advanced)

**Settings > Your data > Connect to a Kenning server** opens the Connect screen: enter the
address you open in the browser (`kenning.example.com`, `https://kenning.example.com`, or
`http://192.168.1.20:8080`). The app checks `/api/health`, then the window opens the server
itself (its sign-in, its data). The file on this computer stays as it is; **Use on this
computer** on the Connect screen goes back to it. Later starts open the saved server straight
away; if it does not answer, the Connect screen comes back with the reason. On a server's pages,
**Settings > Account > Change server…** returns to the Connect screen.

Installs from before the offline version (a `desktop.json` with `serverUrl`) keep opening their
server as before.

## Anki

Run Anki with AnkiConnect (add-on `2055492159`) on the same computer. That is all: in the
desktop app the requests to AnkiConnect are sent by the app itself, not by the web page, so
there is **no `webCorsOriginList` entry and no "allow this site?" dialog**, in both modes. The
app forwards only to `http://127.0.0.1:8765` / `http://localhost:8765`, nothing else (see
"Security"). Connected to a server, this needs a server running a web build that knows the
bridge (0.1.0 or later).

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

Needs Rust (rustup), [uv](https://docs.astral.sh/uv/) and, on Linux,
`libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`.

```sh
pnpm install
pnpm --filter desktop sidecar          # language server -> apps/desktop/src-tauri/sidecar/ (~1.5 min)
pnpm --filter desktop tauri build --config src-tauri/tauri.sidecar.conf.json --bundles appimage,deb
pnpm --filter desktop tauri dev        # dev window on the Vite dev server
```

`pnpm --filter desktop bundle` is the build line above for every bundle of the system. The
**offline installer**: `uv run --no-project python server/nlp/desktop/build_sidecar.py --packs
<dir with the three *.tar.gz pack archives>`, then build with
`--config src-tauri/tauri.packs.conf.json` (`pnpm --filter desktop bundle:offline`).

- `build_sidecar.py` makes a fresh venv from `server/nlp/uv.lock` (Python 3.12, no dev tools),
  trims it like the slim Docker image (Dutch-only simplemma, the wordfreq lists `/detect` needs,
  no tests), and runs PyInstaller with `server/nlp/desktop/kenning-nlp.spec` (one directory,
  stripped, `kenning_nlp` kept as `.py` source because the analyzer version hashes it). The
  PyInstaller bootloader links against the build machine's glibc, so Linux releases are built
  on ubuntu-22.04 (glibc 2.35) and run on that and newer.
- Without the sidecar folder the app still builds (`tauri dev`, `cargo test`): the setup line
  then says the build has no language tools. `KENNING_NLP_URL=http://localhost:8000 pnpm
--filter desktop tauri dev` uses a language server you run yourself (`pnpm nlp`);
  `KENNING_SIDECAR=/path/to/kenning-nlp` a specific sidecar build.
- `kenning --self-test` starts the app with a hidden window, waits for the language server and
  its data, analyses a sentence through the page's own `/nlp` route and checks the database
  file, prints one JSON line and exits (0 = all good). Use a temporary `HOME` to keep it away
  from your own data.

`tauri build` builds the web app first (turbo) and bundles `apps/web/dist`. Installers land in
`apps/desktop/src-tauri/target/release/bundle/`. Windows and macOS installers (and the offline
variants) are built by CI (`.github/workflows/desktop.yml`, `v*` tags or "Run workflow"): each
job builds the sidecar on its own system first (`.github/actions/desktop-prep`, uv cache keyed on
`uv.lock`). The desktop package has no `build` script, so `pnpm build` and the normal CI do not
need Rust or PyInstaller.

## How it works

```
 Kenning window (Tauri), bundled web build ("home": tauri://localhost)
  ├─ on this computer (default)
  │    ├─ SqlDriver ── db_exec / db_export / db_import ──► Rust (rusqlite) ──► Documents/Kenning/kenning.sqlite (+ .lock)
  │    ├─ fetch("/nlp/…") ──► kenning-nlp://localhost/… ──► Rust proxy (+ token) ──► 127.0.0.1:<port> kenning-nlp sidecar
  │    └─ AnkiConnect ── anki_fetch ──► Rust ──► 127.0.0.1:8765
  └─ connected to a server: navigates to https://your-server/ (the server's own web app, cookies, CSP)
       └─ window.__KENNING_DESKTOP__ ── anki_fetch ──► Rust ──► 127.0.0.1:8765
```

- **Rust** (`apps/desktop/src-tauri/src/`): `lib.rs` (commands, startup, mode, updater),
  `db.rs` (the database file, JSON value encoding, backup checks, lock file, conflict copies),
  `sidecar.rs` (start, health, stop), `proxy.rs` (the `kenning-nlp:` protocol). Plugins:
  single-instance, window-state, updater, dialog (update prompt, "Move…" folder picker) and
  opener (external links, "Show in folder").
- **Web** (`apps/web/src/desktop/`): `bridge.ts` (detection, Anki fetch wrapper, `/nlp`
  route), `local.ts` (offline boot: native driver, services, notices), `setup.ts` +
  `DesktopSetup.tsx` (the first-run line, OCR availability), `DesktopData.tsx` (Settings > Your
  data), `LockedScreen.tsx`, `ConnectScreen.tsx`, `DesktopServer.tsx`. The driver is
  `@app/db/native` (`packages/db/src/native.ts`): the same `SqlDriver` interface as the browser
  worker and node, so schema, migrations, projections and backups are shared code. In a normal
  browser none of it does anything.
- `desktop.json` gains `mode` (`"local"` / `"server"`; unset = local unless a server was saved)
  and `database` (set by "Move…").

### Why the window loads the server (server mode)

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
- `check_server`, `connect` and every offline command (`db_*`, `nlp_*`, `use_local`) are for
  the bundled home page only.
- The language server listens on `127.0.0.1` only and refuses requests without its random
  per-start token (`X-Kenning-Token`), which never leaves the Rust side: the page talks to the
  `kenning-nlp:` protocol, which refuses http(s) origins other than the home page (a server's
  pages, any other site).
- Update packages are verified against the public key in `tauri.conf.json`.

## Troubleshooting

- **Blank window or "Could not reach …" on Linux**: run from a terminal to see errors
  (`./Kenning_*.AppImage`). With an NVIDIA GPU, `WEBKIT_DISABLE_DMABUF_RENDERER=1` helps.
- **AppImage does not start**: install FUSE 2 (`sudo apt install libfuse2`), or extract it:
  `./Kenning_*.AppImage --appimage-extract && ./squashfs-root/AppRun`.
- **Wrong server saved / stuck on a broken page**: Settings > Account > Change server… (then
  "Use on this computer" or another address), or delete `desktop.json` (see above) and restart.
- **Sign-in does not stick on a plain-http server**: the session cookie is `Secure`; use `https://`, or set
  `KENNING_COOKIE_SECURE=0` on a plain-http LAN server (as for browsers).
- **Anki shows "not running"**: Anki must be open with AnkiConnect on port 8765; a custom
  AnkiConnect address in Settings is not forwarded by the app.
- **"The language tools could not start"**: the language server's log is
  `kenning-nlp.log` in the app cache folder (`~/.cache/app.kenning.desktop/` on Linux,
  `%LOCALAPPDATA%\app.kenning.desktop\` on Windows, `~/Library/Caches/app.kenning.desktop/` on
  macOS). Antivirus software on Windows can slow the first start down a lot; **Try again** starts
  it again.
- **Language data does not download** (proxy, firewall): use the `Kenning_offline_…` installer,
  or put the three pack archives from the `packs-<version>` release into a folder and start
  Kenning with `KENNING_PACKS_DIR` pointing at it.
- **"Kenning is open on another computer" but it is not**: the other computer crashed or synced
  an old lock file; **Open anyway**, or delete `kenning.sqlite.lock` next to the data file.
- **Update check fails**: `latest.json` must be reachable without sign-in, and its file URLs too.
