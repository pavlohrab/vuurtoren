# Local builds

How to build the test APK, the AppImage and the data packs on a Linux computer, and where
they go. CI builds the release ones (`.github/workflows/desktop.yml`); these are for trying
things before that.

## Android APK (arm64, for testing)

The shell has no Android variables, so give them inline (from the repo root):

```sh
ANDROID_HOME=~/Android/Sdk NDK_HOME=~/Android/Sdk/ndk/30.0.16248370 \
JAVA_HOME=/usr/lib/jvm/java-21-openjdk \
pnpm --filter @app/desktop tauri android build --apk --target aarch64
```

It builds the web app first (`pnpm build`), so a type error anywhere, tests included, stops it.
The result is unsigned:
`apps/desktop/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk`.

Align and sign it with the debug key:

```sh
BT=~/Android/Sdk/build-tools/36.1.0
IN=apps/desktop/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk
$BT/zipalign -f -p 4 "$IN" aligned.apk
$BT/apksigner sign --ks ~/.android/debug.keystore --ks-pass pass:android --key-pass pass:android \
  --out Vuurtoren-YYYY-MM-DD-arm64.apk aligned.apk
$BT/apksigner verify Vuurtoren-YYYY-MM-DD-arm64.apk
```

A test APK signed with the debug key installs over the last test APK. The release APK has
another key, so Android won't install it over a test one: sync, uninstall, then install. The
APK is small (about 13 MB): the dictionary, recordings and voice download inside the app. The
emulator image here is x86_64, so it can't run this APK; try it on the phone.

## AppImage and .deb (Linux)

From the repo root:

```sh
pnpm --filter @app/desktop sidecar   # the bundled language server; again whenever server/nlp changed
pnpm --filter @app/desktop bundle    # AppImage + .deb
```

Output: `apps/desktop/src-tauri/target/release/bundle/appimage/Vuurtoren_0.1.0_amd64.AppImage`
(about 440 MB) and `bundle/deb/`. This one downloads its packs on first start;
`pnpm --filter @app/desktop bundle:offline` makes the big one with the packs inside.

## Where builds go

`~/Documents/vuurtoren-builds/`, named `Vuurtoren-YYYY-MM-DD[b,c…]-arm64.apk` and
`Vuurtoren-YYYY-MM-DD.AppImage`.

## Stories bundle

After a change to the parser (`server/nlp`), rebuild the stories' bundled analysis, so they
open without a fresh one (from `server/nlp`):

```sh
VUURTOREN_DATA_DIR=~/.local/share/app.vuurtoren.desktop/nlp-data \
uv run python scripts/check_stories.py --write
```

It needs the translation model, which that folder has.

## Tests with the dictionary

The dictionary tests skip without the database. Point them at the app's copy:

```sh
cd server/nlp
VUURTOREN_DICT_PATH=~/.local/share/app.vuurtoren.desktop/nlp-data/dictionary-nl.sqlite uv run pytest -q
```

## A new data pack on data.vuurtoren.app

data.vuurtoren.app is Caddy on the home server (`deploy/data-host/compose.yml`) serving one
folder (`VUURTOREN_DATA_FOLDER` in its `.env`), with the archives at
`packs-<version>/<name>-<version>.tar.gz`. For a new dictionary, for example:

1. Bump `dictionary-nl`'s version in `server/nlp/src/vuurtoren_nlp/packs.json` (say `2026.11.3`).
2. Build it; this also writes its SHA-256 and size into packs.json:
   ```sh
   cd server/nlp
   uv run python scripts/build_packs.py --out dist/packs --only dictionary-nl
   ```
3. Copy it to the home server, into a new version folder (keep the old folders: older apps
   still download from them):
   ```sh
   ssh truenas_admin@home "mkdir -p <data folder>/packs-2026.11.3"
   scp dist/packs/dictionary-nl-2026.11.3.tar.gz truenas_admin@home:<data folder>/packs-2026.11.3/
   ```
4. Check it: `curl -sI https://data.vuurtoren.app/packs-2026.11.3/dictionary-nl-2026.11.3.tar.gz`
   (200, the right size).
5. Commit packs.json. Apps built after that commit download the new pack.
