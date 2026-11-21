# Android

The Android app in detail: how it is built, what runs on the phone, how it looks, and the
milestones to get there. The overview for both phones is in [Phones](phones.md).

## Shape of the app

The Android app is the Tauri v2 app in `apps/desktop` built for Android. The folder keeps its
name for now: the desktop CI, the release script and the language server's sidecar build
(`server/nlp/desktop/build_sidecar.py`) use the path, and `apps/app` is the name once those move
together. The UI is the same React app (`apps/web`) inside the Android System WebView; Rust runs
the database and the sync requests; a Kotlin plugin reaches the Android Keystore.

```
apps/desktop/src-tauri/
  src/
    lib.rs          shared: database commands, sync requests, key store commands, the window
    keys.rs         the KeyStore trait; SystemKeys (keychain, desktop), FileKeys (iOS)
    desktop.rs      computers only: sidecar, AnkiConnect, sync folders, updates, close request
    mobile.rs       phones only: QR scanner, vuurtoren:// links, AndroidKeys (Kotlin plugin)
    bridge.js       window.__VUURTOREN_DESKTOP__ (the name stays on phones), with `os`
  capabilities/     desktop.json (linux, macOS, windows), mobile.json (android, iOS)
  tauri.android.conf.json   identifier app.vuurtoren, minimum API 26, the vuurtoren scheme
  gen/android/      the Android project (Gradle), committed
    app/src/main/java/app/vuurtoren/KeystorePlugin.kt   sync key and token in the Keystore
    app/src/main/res/xml/  backup rules: the sealed secrets never go into a backup
apps/web/src/platform/
  index.ts          currentDevice(): the capability interface the UI asks
  device.ts         the Device type
  browser.ts, desktop.ts, android.ts   one per device
```

The parts only a computer has are behind `#[cfg(desktop)]` and in target-specific dependencies
(single instance, window state, updater, keyring); the phone's plugins
(`tauri-plugin-barcode-scanner`, `tauri-plugin-deep-link`) are phone-only dependencies.

**Key store.** A `KeyStore` trait (`keys.rs`) keeps named secrets: `sync-key` (the data key) and
`sync-token` (a paired server's token). On a computer it is the system keychain with a private
file as fallback; on Android, `KeystorePlugin.kt` makes an AES-256 key inside the Android
Keystore (it never leaves it) and seals each secret with it (AES-GCM) into the app's private
preferences, which the backup rules exclude. A small Kotlin plugin rather than
`tauri-plugin-stronghold`: the Keystore is hardware-backed where the phone has it, needs no
password of its own, and adds no large dependency.

**Dictionary pack.** `dictionary.rs` reads the language server's `dictionary-nl` SQLite file
from `<app data>/packs/dictionary-nl.sqlite` (rusqlite, read-only) and answers
`dictionary_gloss` in the shape of `/gloss`: a word's own entries, else those of the lemma it is
a form of. The web dictionary service asks it first on a phone; words it does not know
(compounds, derivations) still come from the server when there is one, and without the pack
everything works as before.

**Language data is a separate download.** The APK carries no data pack, so it stays small.
The phone keeps one pack, `dictionary-nl` (about 14 MB compressed, 40 MB unpacked); grammar
examples, sentence translation and word pairs come from the server's language server, so the
phone has no use for the grammar-example or sentence packs and does not fetch them.
`dictionary_install` downloads the version named in `packs.json` (built into the app):

1. from the connected Vuurtoren server, `<server>/nlp/packs/dictionary-nl-<version>.tar.gz`,
   with the device's sync token (only an address the user allowed for sync). The language
   server keeps the verified archive of each phone pack it installs (and hands on one from
   `VUURTOREN_PACKS_DIR`); without a copy it answers 404;
2. else from the public packs release on GitHub.

The download goes to `<app data>/packs/dictionary-nl-<version>.tar.gz.part`; a try that stops
(no network, the app closed) leaves it there and the next one asks for the rest (a Range
request; both sources answer them). The whole archive is checked against the size and SHA-256
in `packs.json` before it replaces anything; a damaged one is removed, so the next try starts
clean. `dictionary_status` reports the bytes so far, and the page shows them as a progress bar.

The end of the welcome starts the download by itself on Wi-Fi; on mobile data it waits and
offers "Download now on mobile data". "Also download on mobile data" (per device) lifts that.
Settings → Your words shows the size, the progress, "Go on with the download" after a stop, and
the state. The page tells Wi-Fi from mobile data with the WebView's `navigator.connection`
(unknown counts as Wi-Fi). Without the dictionary the app keeps working: meanings come from the
cards and the server, and the stories carry their own analysis and English. Still to do: an
update when `packs.json` names a newer version.

**Safe areas.** Edge to edge, the page reads the system bars as `--safe-*` (`styles.css`): the
larger of `env(safe-area-inset-*)` and the insets `MainActivity.kt` passes in from
`WindowInsets` (`platform/insets.ts`), since not every WebView reports them.

**Platform layer.** `currentDevice()` reads the bridge's `os`; when an older bridge has none,
`isAndroidApp()` takes a user agent with "Android" inside Tauri (`__TAURI_INTERNALS__`) for
the phone, so a phone's browser is still a browser. The bridge is there only on the bundled
page: Rust compares the page with the home address, and that is the dev server only under
`tauri dev` (`tauri::is_dev()`), not in every debug build, so a debug APK has its bridge and the
Connect step. The browser and the desktop app
behave as before; on Android the device offers a server as its only sync place (Settings shows
no folder or WebDAV), has no bundled language server (no `vuurtoren-nlp:` route, no sidecar
status), keeps the database file private (no Show or Move), scans QR codes and receives
`vuurtoren://` links. Haptics and reminders are in the interface as stubs.

## What runs where

| Need                                                     | On the phone                                                                          | Notes                                                           |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Your data                                                | SQLite file in the app's private storage, opened by Rust (`rusqlite`, bundled SQLite) | the same event log and projections as desktop                   |
| Sync                                                     | the server place only (`/api/sync`), through Rust HTTP                                | folder and WebDAV are desktop-only                              |
| Sync key                                                 | Android Keystore (Kotlin plugin)                                                      | excluded from Android backups                                   |
| Dictionary, short glosses, starter words                 | on the phone: the `dictionary-nl` pack (~14 MB), a separate download, read by Rust    | glosses work offline                                            |
| Audio                                                    | the `audio-nl` pack, both voices (about 80 MB); Settings → Voice picks one            | played with the page's `<audio>` through Tauri's asset protocol |
| Analysis of a new text, sentence translation, word pairs | the server's language server (`/nlp/`, with the device's sync token)                  | results cached per text; reading is offline afterwards          |
| OCR (photo of a page)                                    | ML Kit text recognition, on device                                                    | no Google account, no network                                   |
| Speech fallback                                          | Android text-to-speech through the WebView                                            | used only when a clip is missing                                |
| Reminders                                                | `tauri-plugin-notification`                                                           | "24 reviews due" once a day, at a time you choose               |
| Haptics                                                  | `tauri-plugin-haptics`                                                                | a light tick on each review answer                              |
| Connect to a server                                      | `tauri-plugin-barcode-scanner` reads a QR code from the server's Settings → Sync      | the QR holds the address and a new sync token                   |
| Links                                                    | `tauri-plugin-deep-link`: `vuurtoren://connect?…`                                     | the same as the QR code                                         |

## First start

1. Welcome, then "Do you use Anki?" (as on desktop; on a phone, Anki import is a `.apkg` file).
2. **Connect to your Vuurtoren server**: scan the QR code, type the address, or "Not now".
   Without a server the app still works: the starter words, reviews and the demo text. Adding a
   new text asks for a server.
3. The starter words: where new words start (level 1, 2, 3, 5 or 7).
4. Downloads, with progress and sizes: the dictionary (14 MB, on Wi-Fi unless mobile data is
   allowed; from your server, else GitHub), audio with both voices
   (about 80 MB, optional).

## Connecting with a QR code

1. On the server: Settings → Sync → **Add a phone** shows a QR code of
   `vuurtoren://connect?server=<address>&code=<code>`, the same link as text, and the code. The
   **pairing code** (`POST /api/sync/pair-code`, signed in) is 10 characters without 0/O or
   1/I/L, works once for 10 minutes, and only its SHA-256 is stored; at most five work at once.
   The page asks for a new one when it expires. The QR code is drawn from `qrcode-generator`
   (MIT, no dependencies) as an SVG.
2. On the phone, at first start (the welcome's **Connect to your server**) or in Settings → Sync:
   **Connect to your server → Scan the QR code**. The app asks once whether it may send sync
   files to that address, then sends the code and its name to `POST /api/sync/pair` (through
   Rust, so the server needs no CORS setup) and gets its own sync token back, which goes into the
   key store as `sync-token`. The server becomes the place to join and, at once, the phone's
   language server (`<server>/nlp` with the token).
3. Set up shows **Your Vuurtoren server, connected with a pairing code** and **Join my synced
   data**: the phone asks for the **sync passphrase**. The passphrase is never in the QR code, so
   a photo of the code cannot read anything, and a used or old code no longer works.

The token appears in the server's sync-token list as "Phone (Pixel 8)" (the model from the
WebView's user agent) and can be revoked there. Opening a `vuurtoren://connect` link does the
same as scanning (`tauri-plugin-deep-link`; the app goes to Settings → Sync and connects). On a
computer or in a browser, paste the link or type the address and the code. Stop syncing forgets
the token.

`POST /api/sync/pair` needs no sign-in (the code is the credential), takes JSON only, answers
other sites through CORS, and counts wrong codes per address like wrong passwords, apart from
sign-in.

## Design

The phone layout from the redesign; the colours, type and logo stay as on desktop.

- **Navigation:** a bottom bar with three tabs, Read, Words and More (Grammar, Exam, Courses,
  Talk, Progress, Settings, the theme). Words opens on Review with Vuurtoren's own cards (its badge
  is the cards due; Your words, Practice and Progress are the room's tabs), on the word list with
  Anki. Each tab is 56px tall with a 24px icon and a 12px label; the current one is amber with a
  pill behind its icon; the bar sits 8px above the gesture handle. The Android **back gesture** goes back in the app's history
  (predictive back where the system offers it) and closes sheets first.
- **Edge to edge:** content runs under the status and navigation bars; padding comes from the
  insets. The status bar follows the theme (light or dark).
- **Reader:** large Literata text; a tap on a word opens a bottom sheet (meaning, play, Add to my
  words, I know it). English under the sentences (Always / only hard sentences / tap to show),
  tap to match words both ways, the structure view per sentence. Turned sideways: side by side.
- **Review:** one card; tap to reveal; swipe right for Good, left for Again; the four grade
  buttons stay at the bottom. A light haptic on each answer. Play buttons for the word and the
  sentence; autoplay as set.
- **Library:** shelves by level ("Start here", A2, B1, B2) with how much you already know.
- **Motion:** shared-element transitions (cover → reader), springs on sheets and cards, the amber
  highlight sweeping in once on new words. "Remove animations" in Android's accessibility settings
  turns them off.
- **Comfort:** 48 dp touch targets (Android's minimum), the main action within thumb reach,
  system font scale respected up to 200%, dark theme following the system.
- **Splash:** Android 12's splash screen with the lighthouse mark on the paper colour.

## Building

- **Tools:** JDK 17, the Android SDK with platform 37 (what `gen/android` compiles against) and
  build tools, the NDK (27 or newer), and the Rust targets `aarch64-linux-android`,
  `armv7-linux-androideabi`, `i686-linux-android`, `x86_64-linux-android`.
- **Set up on Linux** (once):

  ```sh
  # the command-line tools, if Android Studio is not installed (the current file name is on
  # developer.android.com/studio, under "Command line tools only")
  mkdir -p ~/Android/Sdk/cmdline-tools && cd ~/Android/Sdk/cmdline-tools
  curl -LO https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip
  unzip commandlinetools-linux-*_latest.zip && mv cmdline-tools latest
  export ANDROID_HOME=~/Android/Sdk
  export PATH=$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH
  sdkmanager --licenses
  sdkmanager "platforms;android-37" "build-tools;36.1.0" "platform-tools" "ndk;28.2.13676358"
  export NDK_HOME=$ANDROID_HOME/ndk/28.2.13676358
  rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
  ```

- **Debug APK:** `pnpm install`, then
  `pnpm --filter @app/desktop tauri android build --apk --debug` (it builds the web app first).
  The APK is
  `apps/desktop/src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`;
  `--target aarch64` builds for 64-bit ARM phones only, which is quicker.
- **Install:** `adb install -r <the apk>` with the phone connected (Developer options → USB
  debugging), or copy the file to the phone and open it ("Install unknown apps" for the file
  manager once).
- **Develop:** `pnpm --filter @app/desktop tauri android dev` with a phone connected or the
  emulator; the page comes from Vite on this computer.
- **Check the Rust code without the NDK:** `cargo check --target aarch64-linux-android` builds
  the Rust code; the C parts (SQLite, ring) need the NDK's compiler, or, for a check only, any
  stand-in that writes empty objects (`CC_aarch64_linux_android`, `AR_aarch64_linux_android`).
- **Generated project:** `gen/android` comes from `tauri android init` and is committed with the
  Keystore plugin and the backup rules. The deep-link plugin adds its intent filter for
  `vuurtoren://` to `AndroidManifest.xml` when the app is built.
- **Minimum Android:** 8.0 (API 26); target the latest API level Google Play requires.
- **Without Google Play:** a signed `.apk` installs on any phone ("Install unknown apps" for the
  browser once). ML Kit is part of the app, so OCR works the same. Sign every build with the same
  key, kept outside the repository: Android accepts an update only with the same key, and the key
  can later be the Google Play upload key. The app checks GitHub releases on start and shows "A
  new version is available" with a link to the `.apk`.
- **Release build:** `tauri android build --aab` for Google Play, `--apk` for sideloading. Signed
  with an upload key kept outside the repository (Play App Signing holds the app key).
- **CI:** a Linux runner (the cheapest) builds the `.apk` and `.aab` on a `v*` tag and attaches
  the `.apk` to the GitHub release.

## Milestones

Each one ends with something you can install and try. Milestones 1 and 2 are in the code: the
Rust app builds for Android (checked with `cargo check` and `cargo clippy` for
`aarch64-linux-android`), the platform layer and pairing are tested in the web app and the
server. Still to check on a phone: the demo offline, the Keystore plugin, the scanner, a
`vuurtoren://connect` link, and a review on the phone showing on the desktop within 20 seconds.

1. **It runs.** `tauri android init`; the app opens on a phone with the demo; Rust database on
   device; the platform layer with `android.ts`. _Check:_ the demo works offline on a phone.
2. **Your data, synced.** Connect to a server by QR code; the sync key in the Keystore; sync on
   start, on resume and a few seconds after a change. _Check:_ a review on the phone shows on the
   desktop within 20 seconds.
3. **Reading.** The dictionary pack on device; adding a text through the server; the reader with
   sheets, English under sentences, tap to match. _Check:_ read a text in flight mode after adding
   it at home.
4. **Review and audio.** The review screen with swipe and haptics; the audio pack; reminders.
   _Check:_ a week of daily reviews on the phone only.
5. **Android extras.** OCR with ML Kit; "Share to Vuurtoren" from Chrome; `.apkg` import from
   Files. _Check:_ photograph a page of a book and read it.
6. **Release.** Signed `.apk` on GitHub; Google Play internal testing, then open testing (the
   Data safety form: no tracking; data stays on the device and your own server).

## Open questions

- Store the reading analysis in the event log (synced, so a text added on the desktop is ready on
  the phone) or keep it per device (smaller sync, but the phone needs the server once per text)?
  Today it is per device.
- F-Droid: ML Kit is not free software; an F-Droid build would need OCR off or another engine.
